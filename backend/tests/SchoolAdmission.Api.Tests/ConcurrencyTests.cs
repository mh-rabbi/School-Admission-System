using System.Collections.Concurrent;
using System.Net;
using SchoolAdmission.Api.Infrastructure;
using SchoolAdmission.Api.Tests.Infrastructure;
using Xunit.Abstractions;

namespace SchoolAdmission.Api.Tests;

/// <summary>
/// MANDATORY concurrency suite (BRD §5, §9.2): many simultaneous requests must never break
/// held + confirmed &lt;= totalSeats. Every test asserts the invariant through the API AND directly in the database.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class ConcurrencyTests(PostgresFixture fixture, ITestOutputHelper output)
{
    // ---------- helpers ----------

    private static async Task<(string Id, Guid Guid)> CreateClassAsync(HttpClient client, int totalSeats, string prefix = "Concurrency")
    {
        var created = await (await client.PostJsonAsync("/classes", new { name = TestData.ClassName(prefix), totalSeats }))
            .ShouldBeAsync<ClassDetails>(HttpStatusCode.Created);
        PrefixedId.TryParse(PrefixedId.ClassPrefix, created.Id, out var guid).Should().BeTrue();
        return (created.Id, guid!.Value);
    }

    /// <summary>Starts all calls, holds them at a gate, then releases them at the same instant.</summary>
    private static async Task<T[]> FireSimultaneouslyAsync<T>(int count, Func<int, Task<T>> call)
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var tasks = Enumerable.Range(0, count)
            .Select(i => Task.Run(async () => { await gate.Task; return await call(i); }))
            .ToList();
        gate.SetResult();
        return await Task.WhenAll(tasks);
    }

    private async Task AssertApiAndDatabaseAgreeAsync(string classId, Guid classGuid, int expectedHeld, int expectedConfirmed, int total)
    {
        // Through the API …
        var stats = await (await fixture.Api.CreateClient().GetAsync($"/classes/{classId}")).ShouldBeAsync<ClassDetails>(HttpStatusCode.OK);
        stats.Should().BeEquivalentTo(new
        {
            TotalSeats = total,
            HeldSeats = expectedHeld,
            ConfirmedSeats = expectedConfirmed,
            AvailableSeats = total - expectedHeld - expectedConfirmed,
        });
        (stats.HeldSeats + stats.ConfirmedSeats).Should().BeLessThanOrEqualTo(stats.TotalSeats);

        // … and directly in the database (counters AND the actual rows).
        var db = await fixture.Db.AssertConsistentAsync(classGuid);
        db.Should().BeEquivalentTo(new
        {
            TotalSeats = total,
            HeldSeats = expectedHeld,
            ConfirmedSeats = expectedConfirmed,
            HeldRows = expectedHeld,
            ConfirmedRows = expectedConfirmed,
        });
    }

    // ---------- 1. the core requirement ----------

    [Fact]
    public async Task Two_hundred_simultaneous_applies_for_five_seats_create_exactly_five_holds()
    {
        const int seats = 5, applicants = 200;
        var client = fixture.Api.CreateClient();
        var (classId, classGuid) = await CreateClassAsync(client, seats);
        var students = TestData.StudentIds(applicants);

        var responses = await FireSimultaneouslyAsync(applicants,
            i => client.PostJsonAsync($"/classes/{classId}/holds", studentId: students[i]));

        responses.Count(r => r.StatusCode == HttpStatusCode.Created).Should().Be(seats);
        responses.Count(r => r.StatusCode == HttpStatusCode.Conflict).Should().Be(applicants - seats);
        foreach (var rejected in responses.Where(r => r.StatusCode == HttpStatusCode.Conflict).Take(3))
            await rejected.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.SeatsFull);

        await AssertApiAndDatabaseAgreeAsync(classId, classGuid, expectedHeld: seats, expectedConfirmed: 0, total: seats);
    }

    // ---------- 2. BRD §5 bonus: two backend instances, one database ----------

    [Fact]
    public async Task Two_instances_on_the_same_database_never_overbook()
    {
        const int seats = 5, applicants = 200;
        await using var instanceB = fixture.CreateApi();
        HttpClient[] instances = [fixture.Api.CreateClient(), instanceB.CreateClient()];
        var (classId, classGuid) = await CreateClassAsync(instances[0], seats);
        var students = TestData.StudentIds(applicants);

        var responses = await FireSimultaneouslyAsync(applicants,
            i => instances[i % 2].PostJsonAsync($"/classes/{classId}/holds", studentId: students[i]));

        var created = responses.Count(r => r.StatusCode == HttpStatusCode.Created);
        output.WriteLine($"Two instances: {created} created, {responses.Count(r => r.StatusCode == HttpStatusCode.Conflict)} rejected");
        created.Should().Be(seats);
        responses.Count(r => r.StatusCode == HttpStatusCode.Conflict).Should().Be(applicants - seats);
        await AssertApiAndDatabaseAgreeAsync(classId, classGuid, expectedHeld: seats, expectedConfirmed: 0, total: seats);
    }

    [Fact]
    public async Task One_student_applying_twenty_times_at_once_across_two_instances_gets_one_hold()
    {
        await using var instanceB = fixture.CreateApi();
        HttpClient[] instances = [fixture.Api.CreateClient(), instanceB.CreateClient()];
        var (classId, classGuid) = await CreateClassAsync(instances[0], totalSeats: 10);
        var student = TestData.StudentId();

        var responses = await FireSimultaneouslyAsync(20,
            i => instances[i % 2].PostJsonAsync($"/classes/{classId}/holds", studentId: student));

        responses.Count(r => r.StatusCode == HttpStatusCode.Created).Should().Be(1);
        foreach (var r in responses.Where(r => r.StatusCode != HttpStatusCode.Created))
            await r.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.AlreadyApplied);
        await AssertApiAndDatabaseAgreeAsync(classId, classGuid, expectedHeld: 1, expectedConfirmed: 0, total: 10);
    }

    // ---------- 3. everything at once, invariant monitored continuously ----------

    [Fact]
    public async Task Mixed_workload_on_two_instances_keeps_the_invariant_at_every_moment()
    {
        var fastExpiry = new Dictionary<string, string>
        {
            ["HOLD_DURATION_SECONDS"] = "2",
            ["EXPIRY_SWEEP_INTERVAL_SECONDS"] = "1",
        };
        await using var instanceA = fixture.CreateApi(fastExpiry);
        await using var instanceB = fixture.CreateApi(fastExpiry);
        HttpClient[] instances = [instanceA.CreateClient(), instanceB.CreateClient()];

        const int seatsPerClass = 10, students = 150;
        var classes = new[]
        {
            await CreateClassAsync(instances[0], seatsPerClass, "Mixed A"),
            await CreateClassAsync(instances[1], seatsPerClass, "Mixed B"),
        };

        // Continuous monitor: a single SQL statement sees one consistent snapshot, and every write changes the
        // hold rows and the counters in the same transaction — so BOTH invariants must hold in every sample.
        using var stopMonitor = new CancellationTokenSource();
        var violations = new ConcurrentBag<string>();
        var samples = 0;
        var monitor = Task.Run(async () =>
        {
            while (!stopMonitor.IsCancellationRequested)
            {
                foreach (var (_, guid) in classes)
                {
                    try { DbInspector.AssertConsistent(await fixture.Db.GetClassAsync(guid)); }
                    catch (Exception ex) { violations.Add(ex.Message); }
                }
                Interlocked.Increment(ref samples);
                await Task.Delay(20);
            }
        });

        // Workload: apply → confirm (40 %) / cancel (25 %) / abandon to expiry (35 %); retry once when full.
        var statuses = new ConcurrentBag<HttpStatusCode>();
        var confirmedPerClass = new ConcurrentDictionary<string, int>();
        var studentIds = TestData.StudentIds(students);
        var plans = Enumerable.Range(0, students).Select(i => (Roll: new Random(1000 + i).NextDouble(), Seed: 1000 + i)).ToArray();

        await FireSimultaneouslyAsync(students, async i =>
        {
            var random = new Random(plans[i].Seed);
            var student = studentIds[i];
            var (classId, _) = classes[i % classes.Length];

            for (var attempt = 0; attempt < 2; attempt++)
            {
                var apply = await instances[random.Next(2)].PostJsonAsync($"/classes/{classId}/holds", studentId: student);
                statuses.Add(apply.StatusCode);
                if (apply.StatusCode != HttpStatusCode.Created)
                {
                    await Task.Delay(random.Next(500, 3000)); // seats come back via cancel/expiry — try again later
                    continue;
                }

                var hold = await apply.ShouldBeAsync<HoldCreated>(HttpStatusCode.Created);
                await Task.Delay(random.Next(0, 400));
                if (plans[i].Roll < 0.40)
                {
                    // Double-click confirm on both instances at once.
                    var confirms = await Task.WhenAll(instances.Select(c => c.PostJsonAsync($"/holds/{hold.HoldId}/confirm", studentId: student)));
                    foreach (var c in confirms) statuses.Add(c.StatusCode);
                    if (confirms.Any(c => c.StatusCode == HttpStatusCode.OK))
                        confirmedPerClass.AddOrUpdate(classId, 1, (_, n) => n + 1);
                }
                else if (plans[i].Roll < 0.65)
                {
                    var cancel = await instances[random.Next(2)].DeleteAsStudentAsync($"/holds/{hold.HoldId}", student);
                    statuses.Add(cancel.StatusCode);
                }
                // else: abandon — the hold expires and the sweepers return the seat
                return 0;
            }
            return 0;
        });

        // Let every remaining hold expire and be swept.
        var deadline = DateTime.UtcNow.AddSeconds(20);
        while (true)
        {
            var snapshots = await Task.WhenAll(classes.Select(c => fixture.Db.GetClassAsync(c.Guid)));
            if (snapshots.All(s => s.HeldSeats == 0)) break;
            if (DateTime.UtcNow > deadline) throw new Xunit.Sdk.XunitException("holds were not swept in time");
            await Task.Delay(250);
        }
        await stopMonitor.CancelAsync();
        await monitor;

        // No server errors at all, only expected outcomes.
        statuses.Should().OnlyContain(s => s == HttpStatusCode.Created || s == HttpStatusCode.Conflict
                                           || s == HttpStatusCode.OK || s == HttpStatusCode.NoContent);
        violations.Should().BeEmpty("the invariant must hold in every sample taken during the workload");
        samples.Should().BeGreaterThan(20, "the monitor must actually have observed the workload");

        foreach (var (classId, guid) in classes)
        {
            var confirmed = confirmedPerClass.GetValueOrDefault(classId);
            confirmed.Should().BeLessThanOrEqualTo(seatsPerClass);
            await AssertApiAndDatabaseAgreeAsync(classId, guid, expectedHeld: 0, expectedConfirmed: confirmed, total: seatsPerClass);
        }

        output.WriteLine($"Mixed workload: {statuses.Count} requests " +
                         $"({string.Join(", ", statuses.GroupBy(s => (int)s).OrderBy(g => g.Key).Select(g => $"{g.Key}×{g.Count()}"))}), " +
                         $"{samples} invariant samples, confirmed per class: {string.Join("/", classes.Select(c => confirmedPerClass.GetValueOrDefault(c.Id)))}");
    }
}

/// <summary>Unit tests for X-Student-Id validation (decision D9c).</summary>
public sealed class StudentIdsTests
{
    [Theory]
    [InlineData("20152691234567890", "20152691234567890")]
    [InlineData("  20152691234567890 ", "20152691234567890")]
    [InlineData("00000000000000000", "00000000000000000")]
    public void Valid_ids_are_accepted_and_trimmed(string raw, string expected) =>
        StudentIds.Require(raw).Should().Be(expected);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("2015269123456789")]
    [InlineData("201526912345678901")]
    [InlineData("2015269123456789O")]
    [InlineData("২০১৫২৬৯১২৩৪৫৬৭৮৯০")]
    [InlineData("20152691234567890,20152691234567891")]
    public void Invalid_ids_are_rejected_with_invalid_student_id(string? raw)
    {
        var act = () => StudentIds.Require(raw);

        act.Should().Throw<ApiException>().Which.Code.Should().Be(ErrorCodes.InvalidStudentId);
    }

    [Fact]
    public void Optional_returns_null_when_absent_but_still_validates_when_present()
    {
        StudentIds.Optional(null).Should().BeNull();
        StudentIds.Optional(" ").Should().BeNull();
        var act = () => StudentIds.Optional("abc");
        act.Should().Throw<ApiException>();
    }
}
