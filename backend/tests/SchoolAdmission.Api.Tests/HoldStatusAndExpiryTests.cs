using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using SchoolAdmission.Api.Expiry;
using SchoolAdmission.Api.Infrastructure;
using SchoolAdmission.Api.Tests.Infrastructure;

namespace SchoolAdmission.Api.Tests;

/// <summary>GET /holds/{id} (BRD §7.5) and automatic expiry (BRD §4.2, architecture §4.4).</summary>
[Collection(DatabaseCollection.Name)]
public sealed class HoldStatusAndExpiryTests(PostgresFixture fixture)
{
    private static readonly Dictionary<string, string> FastExpiry = new()
    {
        ["HOLD_DURATION_SECONDS"] = "1",
        ["EXPIRY_SWEEP_INTERVAL_SECONDS"] = "1",
    };

    private readonly HttpClient _client = fixture.Api.CreateClient();

    // ---------- helpers ----------

    private async Task<(string Id, Guid Guid)> CreateClassAsync(int totalSeats, HttpClient? client = null)
    {
        var response = await (client ?? _client).PostJsonAsync("/classes", new { name = TestData.ClassName("Expiry"), totalSeats });
        var created = await response.ShouldBeAsync<ClassDetails>(HttpStatusCode.Created);
        PrefixedId.TryParse(PrefixedId.ClassPrefix, created.Id, out var guid).Should().BeTrue();
        return (created.Id, guid!.Value);
    }

    private async Task<HoldCreated> ApplyAsync(string classId, string studentId, HttpClient? client = null) =>
        await (await (client ?? _client).PostJsonAsync($"/classes/{classId}/holds", studentId: studentId))
            .ShouldBeAsync<HoldCreated>(HttpStatusCode.Created);

    private static Guid HoldGuid(string holdId)
    {
        PrefixedId.TryParse(PrefixedId.HoldPrefix, holdId, out var guid).Should().BeTrue();
        return guid!.Value;
    }

    private Task ForceExpireAsync(string holdId) =>
        fixture.Db.ExecuteAsync("UPDATE holds SET expires_at = now() - interval '1 second' WHERE id = @id", ("id", HoldGuid(holdId)));

    private async Task<string> StoredStatusAsync(string holdId)
    {
        await using var conn = await fixture.Db.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT status FROM holds WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", HoldGuid(holdId));
        return (string)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task<int> CountDueHoldsAsync()
    {
        await using var conn = await fixture.Db.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT count(*)::int FROM holds WHERE status = 'HELD' AND expires_at <= now()", conn);
        return (int)(await cmd.ExecuteScalarAsync())!;
    }

    private static async Task EventuallyAsync(Func<Task<bool>> condition, string because, int timeoutSeconds = 15)
    {
        var deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        while (!await condition())
        {
            if (DateTime.UtcNow > deadline)
                throw new Xunit.Sdk.XunitException($"Timed out after {timeoutSeconds}s waiting until {because}");
            await Task.Delay(200);
        }
    }

    private async Task<int> ReleaseWithNewScopeAsync(int batchSize = ExpiredHoldReleaser.DefaultBatchSize)
    {
        await using var scope = fixture.Api.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<ExpiredHoldReleaser>().ReleaseAllAsync(batchSize);
    }

    // ---------- GET /holds/{id} ----------

    [Fact]
    public async Task Get_without_header_returns_hold_with_contract_fields()
    {
        var (classId, _) = await CreateClassAsync(totalSeats: 2);
        var hold = await ApplyAsync(classId, TestData.StudentId());

        var response = await _client.GetAsync($"/holds/{hold.HoldId}");

        var details = await response.ShouldBeAsync<HoldDetails>(HttpStatusCode.OK);
        await response.ShouldHaveContractFieldsAsync(ContractFields.HoldDetails);
        details.Should().BeEquivalentTo(new HoldDetails(hold.HoldId, classId, "HELD", hold.ExpiresAt));
    }

    [Fact]
    public async Task Get_with_owner_header_returns_200()
    {
        var (classId, _) = await CreateClassAsync(totalSeats: 2);
        var student = TestData.StudentId();
        var hold = await ApplyAsync(classId, student);

        var response = await _client.GetAsStudentAsync($"/holds/{hold.HoldId}", student);

        (await response.ShouldBeAsync<HoldDetails>(HttpStatusCode.OK)).Status.Should().Be("HELD");
    }

    [Fact]
    public async Task Get_with_another_students_header_returns_404()
    {
        var (classId, _) = await CreateClassAsync(totalSeats: 2);
        var hold = await ApplyAsync(classId, TestData.StudentId());

        var response = await _client.GetAsStudentAsync($"/holds/{hold.HoldId}", TestData.StudentId());

        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, ErrorCodes.NotFound);
    }

    [Fact]
    public async Task Get_with_malformed_header_returns_400()
    {
        var (classId, _) = await CreateClassAsync(totalSeats: 2);
        var hold = await ApplyAsync(classId, TestData.StudentId());

        var response = await _client.GetAsStudentAsync($"/holds/{hold.HoldId}", "abc");

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, ErrorCodes.InvalidStudentId);
    }

    [Theory]
    [InlineData("h_00000000000070008000000000000000")]
    [InlineData("h_789")]
    [InlineData("c_0193f2a4c0de7a1b8c9d0e1f2a3b4c5d")]
    public async Task Get_unknown_or_malformed_hold_returns_404(string holdId)
    {
        var response = await _client.GetAsync($"/holds/{holdId}");

        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, ErrorCodes.NotFound);
    }

    // ---------- lazy expiry: correct to the second, independent of the sweeper ----------

    [Fact]
    public async Task Hold_past_expiry_is_reported_expired_before_the_sweeper_runs()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 1);
        var hold = await ApplyAsync(classId, TestData.StudentId());
        await ForceExpireAsync(hold.HoldId);

        var details = await (await _client.GetAsync($"/holds/{hold.HoldId}")).ShouldBeAsync<HoldDetails>(HttpStatusCode.OK);
        var stats = await (await _client.GetAsync($"/classes/{classId}")).ShouldBeAsync<ClassDetails>(HttpStatusCode.OK);

        details.Status.Should().Be("EXPIRED");
        stats.Should().BeEquivalentTo(new { HeldSeats = 0, AvailableSeats = 1 });
        (await StoredStatusAsync(hold.HoldId)).Should().Be("HELD", "the sweeper is disabled on the shared test host");
        await fixture.Db.AssertConsistentAsync(classGuid);
    }

    // ---------- background sweeper ----------

    [Fact]
    public async Task Sweeper_returns_expired_seat_to_the_pool_without_any_api_call()
    {
        await using var api = fixture.CreateApi(FastExpiry);
        var client = api.CreateClient();
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 1, client);
        var hold = await ApplyAsync(classId, TestData.StudentId(), client);
        (await fixture.Db.GetClassAsync(classGuid)).HeldSeats.Should().Be(1);

        // No HTTP calls from here on: only the background sweeper can change the stored state.
        await EventuallyAsync(async () => (await fixture.Db.GetClassAsync(classGuid)).HeldSeats == 0,
            "the sweeper has returned the seat");

        (await StoredStatusAsync(hold.HoldId)).Should().Be("EXPIRED");
        await fixture.Db.AssertConsistentAsync(classGuid);
        var stats = await (await client.GetAsync($"/classes/{classId}")).ShouldBeAsync<ClassDetails>(HttpStatusCode.OK);
        stats.AvailableSeats.Should().Be(1);
    }

    [Fact]
    public async Task Sweeper_does_not_touch_unexpired_or_confirmed_holds()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 3);
        var active = await ApplyAsync(classId, TestData.StudentId());
        var confirmed = await ApplyAsync(classId, TestData.StudentId());
        await fixture.Db.ExecuteAsync("UPDATE holds SET status = 'CONFIRMED', expires_at = now() - interval '1 hour' WHERE id = @id",
            ("id", HoldGuid(confirmed.HoldId)));
        await fixture.Db.ExecuteAsync("UPDATE classes SET held_seats = 1, confirmed_seats = 1 WHERE id = @id", ("id", classGuid));

        await ReleaseWithNewScopeAsync();

        (await StoredStatusAsync(active.HoldId)).Should().Be("HELD");
        (await StoredStatusAsync(confirmed.HoldId)).Should().Be("CONFIRMED");
        var snapshot = await fixture.Db.AssertConsistentAsync(classGuid);
        snapshot.Should().BeEquivalentTo(new { HeldSeats = 1, ConfirmedSeats = 1 });
    }

    [Fact]
    public async Task Parallel_releasers_release_each_expired_hold_exactly_once()
    {
        // Enough work (500 holds, batches of 10 → ~50 transactions per releaser) that 16 concurrent
        // releasers genuinely interleave. A first version with 12 holds let one releaser finish before the
        // others started, so it could not detect a double release (caught by a mutation test).
        const int classCount = 5, holdsPerClass = 100, releasers = 16, batchSize = 10;
        var classes = new List<Guid>();
        for (var c = 0; c < classCount; c++)
            classes.Add(await InsertClassWithExpiredHoldsAsync(holdsPerClass));
        var due = await CountDueHoldsAsync(); // ours (500) + any left by earlier tests
        due.Should().BeGreaterThanOrEqualTo(classCount * holdsPerClass);

        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var workers = Enumerable.Range(0, releasers)
            .Select(_ => Task.Run(async () => { await gate.Task; return await ReleaseWithNewScopeAsync(batchSize); }))
            .ToList();
        gate.SetResult();
        var released = await Task.WhenAll(workers);

        released.Sum().Should().Be(due, "every expired hold is released once, never twice");
        (await CountDueHoldsAsync()).Should().Be(0);
        foreach (var classGuid in classes)
            (await fixture.Db.AssertConsistentAsync(classGuid)).HeldSeats.Should().Be(0);
        await fixture.Db.AssertAllConsistentAsync();
    }

    /// <summary>Bulk-creates a class with N already-expired HELD holds and matching counters, in one statement.</summary>
    private async Task<Guid> InsertClassWithExpiredHoldsAsync(int holds)
    {
        var classGuid = Guid.CreateVersion7();
        await fixture.Db.ExecuteAsync("""
            WITH c AS (
                INSERT INTO classes (id, name, total_seats, held_seats) VALUES (@id, @name, @n, @n) RETURNING id),
            h AS (
                INSERT INTO holds (id, class_id, student_id, status, expires_at)
                SELECT gen_random_uuid(), (SELECT id FROM c), '9' || lpad(i::text, 16, '0'), 'HELD',
                       now() - interval '1 second'
                FROM generate_series(1, @n) AS i
                RETURNING 1)
            SELECT count(*) FROM h
            """, ("id", classGuid), ("name", TestData.ClassName("Bulk expiry")), ("n", holds));
        (await fixture.Db.AssertConsistentAsync(classGuid)).HeldSeats.Should().Be(holds);
        return classGuid;
    }

    [Fact]
    public async Task Releaser_processes_all_batches_in_one_call()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 10);
        for (var i = 0; i < 7; i++)
            await ForceExpireAsync((await ApplyAsync(classId, TestData.StudentId())).HoldId);
        var due = await CountDueHoldsAsync();

        var released = await ReleaseWithNewScopeAsync(batchSize: 2);

        released.Should().Be(due);
        (await fixture.Db.AssertConsistentAsync(classGuid)).HeldSeats.Should().Be(0);
    }

    [Fact]
    public async Task Two_instances_sweeping_the_same_database_keep_counters_consistent()
    {
        await using var instanceA = fixture.CreateApi(FastExpiry);
        await using var instanceB = fixture.CreateApi(FastExpiry);
        var clientA = instanceA.CreateClient();
        var clientB = instanceB.CreateClient();

        var classGuids = new List<Guid>();
        for (var c = 0; c < 4; c++)
        {
            var (classId, classGuid) = await CreateClassAsync(totalSeats: 5, c % 2 == 0 ? clientA : clientB);
            classGuids.Add(classGuid);
            await Task.WhenAll(Enumerable.Range(0, 5).Select(i =>
                ApplyAsync(classId, TestData.StudentId(), i % 2 == 0 ? clientA : clientB)));
        }

        await EventuallyAsync(async () =>
        {
            foreach (var g in classGuids)
                if ((await fixture.Db.GetClassAsync(g)).HeldSeats != 0) return false;
            return true;
        }, "both sweepers have released all 20 holds");

        foreach (var g in classGuids)
            await fixture.Db.AssertConsistentAsync(g);
        await fixture.Db.AssertAllConsistentAsync();
    }
}
