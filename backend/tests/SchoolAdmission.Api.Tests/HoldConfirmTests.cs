using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using SchoolAdmission.Api.Expiry;
using SchoolAdmission.Api.Infrastructure;
using SchoolAdmission.Api.Tests.Infrastructure;

namespace SchoolAdmission.Api.Tests;

/// <summary>POST /holds/{holdId}/confirm — BRD §4.2 (Confirmation, Idempotency), §7.6.</summary>
[Collection(DatabaseCollection.Name)]
public sealed class HoldConfirmTests(PostgresFixture fixture, Xunit.Abstractions.ITestOutputHelper output)
{
    private readonly HttpClient _client = fixture.Api.CreateClient();

    // ---------- helpers ----------

    private async Task<(string Id, Guid Guid)> CreateClassAsync(int totalSeats)
    {
        var response = await _client.PostJsonAsync("/classes", new { name = TestData.ClassName("Confirm"), totalSeats });
        var created = await response.ShouldBeAsync<ClassDetails>(HttpStatusCode.Created);
        PrefixedId.TryParse(PrefixedId.ClassPrefix, created.Id, out var guid).Should().BeTrue();
        return (created.Id, guid!.Value);
    }

    private async Task<HoldCreated> ApplyAsync(string classId, string studentId) =>
        await (await _client.PostJsonAsync($"/classes/{classId}/holds", studentId: studentId))
            .ShouldBeAsync<HoldCreated>(HttpStatusCode.Created);

    private Task<HttpResponseMessage> ConfirmAsync(string holdId, string? studentId) =>
        _client.PostJsonAsync($"/holds/{holdId}/confirm", studentId: studentId);

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

    private async Task<HoldCreated> NewHoldAsync(int totalSeats = 3)
    {
        var (classId, _) = await CreateClassAsync(totalSeats);
        return await ApplyAsync(classId, TestData.StudentId());
    }

    // ---------- happy path ----------

    [Fact]
    public async Task Confirm_returns_200_with_contract_fields_and_moves_seat_to_confirmed()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 3);
        var hold = await ApplyAsync(classId, TestData.StudentId());

        var response = await ConfirmAsync(hold.HoldId, hold.StudentId);

        var confirmed = await response.ShouldBeAsync<HoldConfirmed>(HttpStatusCode.OK);
        await response.ShouldHaveContractFieldsAsync(ContractFields.HoldConfirmed);
        confirmed.Should().Be(new HoldConfirmed(hold.HoldId, "CONFIRMED"));

        var stats = await (await _client.GetAsync($"/classes/{classId}")).ShouldBeAsync<ClassDetails>(HttpStatusCode.OK);
        stats.Should().BeEquivalentTo(new { HeldSeats = 0, ConfirmedSeats = 1, AvailableSeats = 2 });
        var status = await (await _client.GetAsync($"/holds/{hold.HoldId}")).ShouldBeAsync<HoldDetails>(HttpStatusCode.OK);
        status.Status.Should().Be("CONFIRMED");
        await fixture.Db.AssertConsistentAsync(classGuid);
    }

    [Fact]
    public async Task Confirmed_seat_stays_taken_after_the_original_expiry_time()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 1);
        var hold = await ApplyAsync(classId, TestData.StudentId());
        await (await ConfirmAsync(hold.HoldId, hold.StudentId)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await ForceExpireAsync(hold.HoldId);

        await using (var scope = fixture.Api.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<ExpiredHoldReleaser>().ReleaseAllAsync();

        (await StoredStatusAsync(hold.HoldId)).Should().Be("CONFIRMED");
        var details = await (await _client.GetAsync($"/holds/{hold.HoldId}")).ShouldBeAsync<HoldDetails>(HttpStatusCode.OK);
        details.Status.Should().Be("CONFIRMED", "only HELD holds expire");
        (await fixture.Db.AssertConsistentAsync(classGuid)).ConfirmedSeats.Should().Be(1);
        await (await _client.PostJsonAsync($"/classes/{classId}/holds", studentId: TestData.StudentId()))
            .ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.SeatsFull);
    }

    // ---------- idempotency ----------

    [Fact]
    public async Task Confirming_twice_returns_200_both_times_and_counts_once()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 3);
        var hold = await ApplyAsync(classId, TestData.StudentId());

        var first = await (await ConfirmAsync(hold.HoldId, hold.StudentId)).ShouldBeAsync<HoldConfirmed>(HttpStatusCode.OK);
        var second = await (await ConfirmAsync(hold.HoldId, hold.StudentId)).ShouldBeAsync<HoldConfirmed>(HttpStatusCode.OK);

        second.Should().Be(first);
        (await fixture.Db.AssertConsistentAsync(classGuid)).ConfirmedSeats.Should().Be(1);
    }

    [Fact]
    public async Task Parallel_confirms_of_the_same_hold_increment_confirmed_seats_exactly_once()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 3);
        var hold = await ApplyAsync(classId, TestData.StudentId());

        var responses = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => ConfirmAsync(hold.HoldId, hold.StudentId)));

        responses.Should().OnlyContain(r => r.StatusCode == HttpStatusCode.OK);
        var snapshot = await fixture.Db.AssertConsistentAsync(classGuid);
        snapshot.Should().BeEquivalentTo(new { HeldSeats = 0, ConfirmedSeats = 1 });
    }

    // ---------- rejected confirmations ----------

    [Fact]
    public async Task Confirming_an_expired_but_unswept_hold_returns_409_hold_expired()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 3);
        var hold = await ApplyAsync(classId, TestData.StudentId());
        await ForceExpireAsync(hold.HoldId);

        var response = await ConfirmAsync(hold.HoldId, hold.StudentId);

        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.HoldExpired);
        (await StoredStatusAsync(hold.HoldId)).Should().Be("HELD", "a rejected confirm changes nothing");
        (await fixture.Db.AssertConsistentAsync(classGuid)).ConfirmedSeats.Should().Be(0);
    }

    [Fact]
    public async Task Confirming_a_swept_expired_hold_returns_409_hold_expired()
    {
        var hold = await NewHoldAsync();
        await ForceExpireAsync(hold.HoldId);
        await using (var scope = fixture.Api.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<ExpiredHoldReleaser>().ReleaseAllAsync();
        (await StoredStatusAsync(hold.HoldId)).Should().Be("EXPIRED");

        var response = await ConfirmAsync(hold.HoldId, hold.StudentId);

        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.HoldExpired);
    }

    [Fact]
    public async Task Confirming_a_cancelled_hold_returns_409_hold_not_active()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 3);
        var hold = await ApplyAsync(classId, TestData.StudentId());
        await fixture.Db.ExecuteAsync("UPDATE holds SET status = 'CANCELLED' WHERE id = @id", ("id", HoldGuid(hold.HoldId)));
        await fixture.Db.ExecuteAsync("UPDATE classes SET held_seats = 0 WHERE id = @id", ("id", classGuid));

        var response = await ConfirmAsync(hold.HoldId, hold.StudentId);

        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.HoldNotActive);
        (await fixture.Db.AssertConsistentAsync(classGuid)).ConfirmedSeats.Should().Be(0);
    }

    [Fact]
    public async Task Another_student_cannot_confirm_and_gets_404()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 3);
        var hold = await ApplyAsync(classId, TestData.StudentId());

        var response = await ConfirmAsync(hold.HoldId, TestData.StudentId());

        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, ErrorCodes.NotFound);
        (await StoredStatusAsync(hold.HoldId)).Should().Be("HELD");
        (await fixture.Db.AssertConsistentAsync(classGuid)).ConfirmedSeats.Should().Be(0);
    }

    [Fact]
    public async Task Another_student_gets_404_even_for_a_confirmed_hold()
    {
        var hold = await NewHoldAsync();
        await (await ConfirmAsync(hold.HoldId, hold.StudentId)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        var response = await ConfirmAsync(hold.HoldId, TestData.StudentId());

        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, ErrorCodes.NotFound);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("123")]
    public async Task Missing_or_malformed_header_returns_400(string? studentId)
    {
        var hold = await NewHoldAsync();

        var response = await ConfirmAsync(hold.HoldId, studentId);

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, ErrorCodes.InvalidStudentId);
    }

    [Theory]
    [InlineData("h_00000000000070008000000000000000")]
    [InlineData("h_789")]
    public async Task Unknown_or_malformed_hold_returns_404(string holdId)
    {
        var response = await ConfirmAsync(holdId, TestData.StudentId());

        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, ErrorCodes.NotFound);
    }

    // ---------- race at the expiry boundary ----------

    [Fact]
    public async Task Confirm_racing_the_sweeper_at_expiry_is_all_or_nothing_per_hold()
    {
        // 30 holds expiring ~300 ms from now; confirms and sweeps fire around that instant.
        // Each hold must end either CONFIRMED (confirm got 200) or EXPIRED (confirm got 409) — never both or neither,
        // and the counters must match the rows exactly.
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 30);
        var holds = new List<HoldCreated>();
        for (var i = 0; i < 30; i++)
            holds.Add(await ApplyAsync(classId, TestData.StudentId()));
        await fixture.Db.ExecuteAsync(
            "UPDATE holds SET expires_at = now() + (random() * interval '600 milliseconds') WHERE class_id = @c", ("c", classGuid));
        await Task.Delay(300);

        var confirmAll = Task.WhenAll(holds.Select(h => ConfirmAsync(h.HoldId, h.StudentId)));
        var sweepAll = Task.WhenAll(Enumerable.Range(0, 5).Select(async i =>
        {
            await Task.Delay(i * 100);
            await using var scope = fixture.Api.Services.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<ExpiredHoldReleaser>().ReleaseAllAsync();
        }));
        await sweepAll;
        var responses = await confirmAll;

        for (var i = 0; i < holds.Count; i++)
        {
            var response = responses[i];
            var stored = await StoredStatusAsync(holds[i].HoldId);
            if (response.StatusCode == HttpStatusCode.OK)
                stored.Should().Be("CONFIRMED");
            else
            {
                await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.HoldExpired);
                stored.Should().BeOneOf("HELD", "EXPIRED"); // HELD = expired but not yet swept
            }
        }
        var snapshot = await fixture.Db.AssertConsistentAsync(classGuid);
        var confirmedCount = responses.Count(r => r.StatusCode == HttpStatusCode.OK);
        snapshot.ConfirmedSeats.Should().Be(confirmedCount);
        output.WriteLine($"Boundary race: {confirmedCount} confirmed, {holds.Count - confirmedCount} expired");
    }
}
