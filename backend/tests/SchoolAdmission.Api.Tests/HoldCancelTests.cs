using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using SchoolAdmission.Api.Expiry;
using SchoolAdmission.Api.Infrastructure;
using SchoolAdmission.Api.Tests.Infrastructure;
using Xunit.Abstractions;

namespace SchoolAdmission.Api.Tests;

/// <summary>DELETE /holds/{holdId} — BRD §7.7, decision D8a (confirmed cannot be cancelled).</summary>
[Collection(DatabaseCollection.Name)]
public sealed class HoldCancelTests(PostgresFixture fixture, ITestOutputHelper output)
{
    private readonly HttpClient _client = fixture.Api.CreateClient();

    // ---------- helpers ----------

    private async Task<(string Id, Guid Guid)> CreateClassAsync(int totalSeats)
    {
        var response = await _client.PostJsonAsync("/classes", new { name = TestData.ClassName("Cancel"), totalSeats });
        var created = await response.ShouldBeAsync<ClassDetails>(HttpStatusCode.Created);
        PrefixedId.TryParse(PrefixedId.ClassPrefix, created.Id, out var guid).Should().BeTrue();
        return (created.Id, guid!.Value);
    }

    private async Task<HoldCreated> ApplyAsync(string classId, string studentId) =>
        await (await _client.PostJsonAsync($"/classes/{classId}/holds", studentId: studentId))
            .ShouldBeAsync<HoldCreated>(HttpStatusCode.Created);

    private Task<HttpResponseMessage> CancelAsync(string holdId, string? studentId) =>
        _client.DeleteAsStudentAsync($"/holds/{holdId}", studentId);

    private Task<HttpResponseMessage> ConfirmAsync(string holdId, string studentId) =>
        _client.PostJsonAsync($"/holds/{holdId}/confirm", studentId: studentId);

    private static Guid HoldGuid(string holdId)
    {
        PrefixedId.TryParse(PrefixedId.HoldPrefix, holdId, out var guid).Should().BeTrue();
        return guid!.Value;
    }

    private async Task<string> StoredStatusAsync(string holdId)
    {
        await using var conn = await fixture.Db.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT status FROM holds WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", HoldGuid(holdId));
        return (string)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task<string> ApiStatusAsync(string holdId) =>
        (await (await _client.GetAsync($"/holds/{holdId}")).ShouldBeAsync<HoldDetails>(HttpStatusCode.OK)).Status;

    // ---------- happy path ----------

    [Fact]
    public async Task Cancel_returns_204_and_returns_the_seat()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 2);
        var hold = await ApplyAsync(classId, TestData.StudentId());

        var response = await CancelAsync(hold.HoldId, hold.StudentId);

        await response.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        (await response.Content.ReadAsStringAsync()).Should().BeEmpty();
        (await ApiStatusAsync(hold.HoldId)).Should().Be("CANCELLED");
        var stats = await (await _client.GetAsync($"/classes/{classId}")).ShouldBeAsync<ClassDetails>(HttpStatusCode.OK);
        stats.Should().BeEquivalentTo(new { HeldSeats = 0, ConfirmedSeats = 0, AvailableSeats = 2 });
        await fixture.Db.AssertConsistentAsync(classGuid);
    }

    [Fact]
    public async Task Cancelled_seat_goes_to_the_next_applicant_and_the_student_may_reapply()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 1);
        var hold = await ApplyAsync(classId, TestData.StudentId());
        await (await _client.PostJsonAsync($"/classes/{classId}/holds", studentId: TestData.StudentId()))
            .ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.SeatsFull);

        await (await CancelAsync(hold.HoldId, hold.StudentId)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);

        var next = await ApplyAsync(classId, TestData.StudentId());
        next.Status.Should().Be("HELD");
        await (await CancelAsync(next.HoldId, next.StudentId)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        var again = await ApplyAsync(classId, hold.StudentId); // original student re-applies (decision D8b)
        again.HoldId.Should().NotBe(hold.HoldId);
        (await fixture.Db.AssertConsistentAsync(classGuid)).HeldSeats.Should().Be(1);
    }

    // ---------- idempotency ----------

    [Fact]
    public async Task Cancelling_twice_returns_204_and_returns_the_seat_once()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 3);
        await ApplyAsync(classId, TestData.StudentId()); // another student's hold keeps held_seats > 0
        var hold = await ApplyAsync(classId, TestData.StudentId());

        await (await CancelAsync(hold.HoldId, hold.StudentId)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await (await CancelAsync(hold.HoldId, hold.StudentId)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);

        (await fixture.Db.AssertConsistentAsync(classGuid)).HeldSeats.Should().Be(1);
    }

    [Fact]
    public async Task Parallel_cancels_of_the_same_hold_return_the_seat_exactly_once()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 5);
        for (var i = 0; i < 3; i++)
            await ApplyAsync(classId, TestData.StudentId());
        var hold = await ApplyAsync(classId, TestData.StudentId());

        var responses = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => CancelAsync(hold.HoldId, hold.StudentId)));

        responses.Should().OnlyContain(r => r.StatusCode == HttpStatusCode.NoContent);
        (await fixture.Db.AssertConsistentAsync(classGuid)).HeldSeats.Should().Be(3);
    }

    [Fact]
    public async Task Cancelling_an_expired_hold_returns_204_and_the_sweeper_still_releases_it_once()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 2);
        var hold = await ApplyAsync(classId, TestData.StudentId());
        await fixture.Db.ExecuteAsync("UPDATE holds SET expires_at = now() - interval '1 second' WHERE id = @id",
            ("id", HoldGuid(hold.HoldId)));

        await (await CancelAsync(hold.HoldId, hold.StudentId)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        (await ApiStatusAsync(hold.HoldId)).Should().Be("EXPIRED", "it expired before it was cancelled");

        await using (var scope = fixture.Api.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<ExpiredHoldReleaser>().ReleaseAllAsync();

        (await StoredStatusAsync(hold.HoldId)).Should().Be("EXPIRED");
        (await fixture.Db.AssertConsistentAsync(classGuid)).HeldSeats.Should().Be(0);
    }

    // ---------- rejected cancellations ----------

    [Fact]
    public async Task Cancelling_a_confirmed_admission_returns_409_and_keeps_it()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 2);
        var hold = await ApplyAsync(classId, TestData.StudentId());
        await (await ConfirmAsync(hold.HoldId, hold.StudentId)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        var response = await CancelAsync(hold.HoldId, hold.StudentId);

        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.CannotCancelConfirmed);
        (await ApiStatusAsync(hold.HoldId)).Should().Be("CONFIRMED");
        (await fixture.Db.AssertConsistentAsync(classGuid)).ConfirmedSeats.Should().Be(1);
    }

    [Fact]
    public async Task Another_student_cannot_cancel_and_gets_404()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 2);
        var hold = await ApplyAsync(classId, TestData.StudentId());

        var response = await CancelAsync(hold.HoldId, TestData.StudentId());

        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, ErrorCodes.NotFound);
        (await StoredStatusAsync(hold.HoldId)).Should().Be("HELD");
        (await fixture.Db.AssertConsistentAsync(classGuid)).HeldSeats.Should().Be(1);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("not-a-student")]
    public async Task Missing_or_malformed_header_returns_400(string? studentId)
    {
        var (classId, _) = await CreateClassAsync(totalSeats: 2);
        var hold = await ApplyAsync(classId, TestData.StudentId());

        var response = await CancelAsync(hold.HoldId, studentId);

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, ErrorCodes.InvalidStudentId);
        (await StoredStatusAsync(hold.HoldId)).Should().Be("HELD");
    }

    [Theory]
    [InlineData("h_00000000000070008000000000000000")]
    [InlineData("h_789")]
    public async Task Unknown_or_malformed_hold_returns_404(string holdId)
    {
        var response = await CancelAsync(holdId, TestData.StudentId());

        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, ErrorCodes.NotFound);
    }

    // ---------- race: cancel vs confirm ----------

    [Fact]
    public async Task Cancel_racing_confirm_has_exactly_one_winner_per_hold()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 40);
        var holds = new List<HoldCreated>();
        for (var i = 0; i < 40; i++)
            holds.Add(await ApplyAsync(classId, TestData.StudentId()));

        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var races = holds.Select(h => Task.Run(async () =>
        {
            await gate.Task;
            var confirm = ConfirmAsync(h.HoldId, h.StudentId);
            var cancel = CancelAsync(h.HoldId, h.StudentId);
            return (Hold: h, Confirm: await confirm, Cancel: await cancel);
        })).ToList();
        gate.SetResult();
        var results = await Task.WhenAll(races);

        var confirmWins = 0;
        foreach (var (hold, confirm, cancel) in results)
        {
            var stored = await StoredStatusAsync(hold.HoldId);
            if (confirm.StatusCode == HttpStatusCode.OK)
            {
                confirmWins++;
                await cancel.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.CannotCancelConfirmed);
                stored.Should().Be("CONFIRMED");
            }
            else
            {
                await confirm.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.HoldNotActive);
                await cancel.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
                stored.Should().Be("CANCELLED");
            }
        }

        var snapshot = await fixture.Db.AssertConsistentAsync(classGuid);
        snapshot.Should().BeEquivalentTo(new { HeldSeats = 0, ConfirmedSeats = confirmWins });
        output.WriteLine($"Cancel vs confirm race: confirm won {confirmWins}, cancel won {holds.Count - confirmWins}");
    }
}
