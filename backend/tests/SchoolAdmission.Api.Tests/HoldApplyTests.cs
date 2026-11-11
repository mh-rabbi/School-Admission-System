using System.Net;
using System.Text.Json;
using SchoolAdmission.Api.Infrastructure;
using SchoolAdmission.Api.Tests.Infrastructure;

namespace SchoolAdmission.Api.Tests;

/// <summary>POST /classes/{classId}/holds — BRD §4.2, §5, §7.4.</summary>
[Collection(DatabaseCollection.Name)]
public sealed class HoldApplyTests(PostgresFixture fixture)
{
    private readonly HttpClient _client = fixture.Api.CreateClient();

    // ---------- helpers ----------

    private async Task<(string Id, Guid Guid)> CreateClassAsync(int totalSeats)
    {
        var response = await _client.PostJsonAsync("/classes", new { name = TestData.ClassName("Apply"), totalSeats });
        var created = await response.ShouldBeAsync<ClassDetails>(HttpStatusCode.Created);
        PrefixedId.TryParse(PrefixedId.ClassPrefix, created.Id, out var guid).Should().BeTrue();
        return (created.Id, guid!.Value);
    }

    private Task<HttpResponseMessage> ApplyAsync(string classId, string? studentId, HttpClient? client = null) =>
        (client ?? _client).PostJsonAsync($"/classes/{classId}/holds", studentId: studentId);

    private async Task<HoldCreated> ApplyOkAsync(string classId, string studentId) =>
        await (await ApplyAsync(classId, studentId)).ShouldBeAsync<HoldCreated>(HttpStatusCode.Created);

    private async Task<ClassDetails> GetClassAsync(string classId) =>
        await (await _client.GetAsync($"/classes/{classId}")).ShouldBeAsync<ClassDetails>(HttpStatusCode.OK);

    private static Guid HoldGuid(string holdId)
    {
        PrefixedId.TryParse(PrefixedId.HoldPrefix, holdId, out var guid).Should().BeTrue();
        return guid!.Value;
    }

    private Task<int> ForceExpireAsync(string holdId) =>
        fixture.Db.ExecuteAsync("UPDATE holds SET expires_at = now() - interval '1 second' WHERE id = @id", ("id", HoldGuid(holdId)));

    private async Task<string> HoldStatusInDbAsync(string holdId)
    {
        await using var conn = await fixture.Db.OpenAsync();
        await using var cmd = new Npgsql.NpgsqlCommand("SELECT status FROM holds WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", HoldGuid(holdId));
        return (string)(await cmd.ExecuteScalarAsync())!;
    }

    // ---------- happy path & contract ----------

    [Fact]
    public async Task Apply_returns_201_with_contract_fields_and_takes_a_seat()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 5);
        var student = TestData.StudentId();
        var before = DateTimeOffset.UtcNow;

        var response = await ApplyAsync(classId, student);

        var hold = await response.ShouldBeAsync<HoldCreated>(HttpStatusCode.Created);
        await response.ShouldHaveContractFieldsAsync(ContractFields.HoldCreated);
        hold.HoldId.Should().StartWith("h_");
        hold.ClassId.Should().Be(classId);
        hold.StudentId.Should().Be(student);
        hold.Status.Should().Be("HELD");
        hold.ExpiresAt.Should().BeCloseTo(before.AddSeconds(600), TimeSpan.FromSeconds(15));
        response.Headers.Location!.ToString().Should().Be($"/holds/{hold.HoldId}");

        var stats = await GetClassAsync(classId);
        stats.Should().BeEquivalentTo(new { HeldSeats = 1, ConfirmedSeats = 0, AvailableSeats = 4 });
        await fixture.Db.AssertConsistentAsync(classGuid);
    }

    [Fact]
    public async Task ExpiresAt_is_serialized_as_utc_with_z_suffix()
    {
        var (classId, _) = await CreateClassAsync(totalSeats: 1);

        var response = await ApplyAsync(classId, TestData.StudentId());

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        json.RootElement.GetProperty("expiresAt").GetString().Should().EndWith("Z");
    }

    [Fact]
    public async Task Hold_duration_comes_from_HOLD_DURATION_SECONDS()
    {
        await using var api = fixture.CreateApi(new Dictionary<string, string> { ["HOLD_DURATION_SECONDS"] = "30" });
        var (classId, _) = await CreateClassAsync(totalSeats: 1);
        var before = DateTimeOffset.UtcNow;

        var hold = await (await ApplyAsync(classId, TestData.StudentId(), api.CreateClient()))
            .ShouldBeAsync<HoldCreated>(HttpStatusCode.Created);

        hold.ExpiresAt.Should().BeCloseTo(before.AddSeconds(30), TimeSpan.FromSeconds(10));
    }

    [Fact]
    public async Task Student_can_hold_seats_in_different_classes()
    {
        var (morning, _) = await CreateClassAsync(totalSeats: 1);
        var (day, _) = await CreateClassAsync(totalSeats: 1);
        var student = TestData.StudentId();

        await ApplyOkAsync(morning, student);
        await ApplyOkAsync(day, student);
    }

    // ---------- seats full ----------

    [Fact]
    public async Task Apply_to_full_class_returns_409_seats_full()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 1);
        await ApplyOkAsync(classId, TestData.StudentId());

        var response = await ApplyAsync(classId, TestData.StudentId());

        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.SeatsFull);
        (await GetClassAsync(classId)).AvailableSeats.Should().Be(0);
        await fixture.Db.AssertConsistentAsync(classGuid);
    }

    [Fact]
    public async Task Confirmed_seats_also_count_towards_capacity()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 1);
        var hold = await ApplyOkAsync(classId, TestData.StudentId());
        await fixture.Db.ExecuteAsync("UPDATE holds SET status = 'CONFIRMED' WHERE id = @id", ("id", HoldGuid(hold.HoldId)));
        await fixture.Db.ExecuteAsync("UPDATE classes SET held_seats = 0, confirmed_seats = 1 WHERE id = @id", ("id", classGuid));

        var response = await ApplyAsync(classId, TestData.StudentId());

        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.SeatsFull);
    }

    [Fact]
    public async Task Full_class_with_an_expired_unswept_hold_gives_that_seat_to_the_next_applicant()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 1);
        var stale = await ApplyOkAsync(classId, TestData.StudentId());
        await ForceExpireAsync(stale.HoldId);

        var fresh = await ApplyOkAsync(classId, TestData.StudentId());

        fresh.Status.Should().Be("HELD");
        (await HoldStatusInDbAsync(stale.HoldId)).Should().Be("EXPIRED");
        var snapshot = await fixture.Db.AssertConsistentAsync(classGuid);
        snapshot.HeldSeats.Should().Be(1);
    }

    // ---------- one active application per student per class ----------

    [Fact]
    public async Task Second_apply_while_held_returns_409_already_applied()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 5);
        var student = TestData.StudentId();
        await ApplyOkAsync(classId, student);

        var response = await ApplyAsync(classId, student);

        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.AlreadyApplied);
        (await fixture.Db.AssertConsistentAsync(classGuid)).HeldSeats.Should().Be(1);
    }

    [Fact]
    public async Task Apply_after_confirmation_returns_409_already_applied()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 5);
        var student = TestData.StudentId();
        var hold = await ApplyOkAsync(classId, student);
        await fixture.Db.ExecuteAsync("UPDATE holds SET status = 'CONFIRMED' WHERE id = @id", ("id", HoldGuid(hold.HoldId)));
        await fixture.Db.ExecuteAsync("UPDATE classes SET held_seats = 0, confirmed_seats = 1 WHERE id = @id", ("id", classGuid));

        var response = await ApplyAsync(classId, student);

        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.AlreadyApplied);
    }

    [Fact]
    public async Task Reapply_after_cancellation_is_allowed()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 5);
        var student = TestData.StudentId();
        var first = await ApplyOkAsync(classId, student);
        await fixture.Db.ExecuteAsync("UPDATE holds SET status = 'CANCELLED' WHERE id = @id", ("id", HoldGuid(first.HoldId)));
        await fixture.Db.ExecuteAsync("UPDATE classes SET held_seats = 0 WHERE id = @id", ("id", classGuid));

        var second = await ApplyOkAsync(classId, student);

        second.HoldId.Should().NotBe(first.HoldId);
        (await fixture.Db.AssertConsistentAsync(classGuid)).HeldSeats.Should().Be(1);
    }

    [Fact]
    public async Task Reapply_after_own_hold_expired_but_unswept_is_allowed_and_releases_the_old_seat()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 5);
        var student = TestData.StudentId();
        var first = await ApplyOkAsync(classId, student);
        await ForceExpireAsync(first.HoldId);

        var second = await ApplyOkAsync(classId, student);

        second.HoldId.Should().NotBe(first.HoldId);
        (await HoldStatusInDbAsync(first.HoldId)).Should().Be("EXPIRED");
        (await fixture.Db.AssertConsistentAsync(classGuid)).HeldSeats.Should().Be(1);
    }

    // ---------- validation ----------

    [Fact]
    public async Task Missing_student_header_returns_400()
    {
        var (classId, _) = await CreateClassAsync(totalSeats: 1);

        var response = await ApplyAsync(classId, studentId: null);

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, ErrorCodes.InvalidStudentId);
    }

    [Theory]
    [InlineData("1234567890123456")]     // 16 digits
    [InlineData("123456789012345678")]   // 18 digits
    [InlineData("1234567890123456A")]    // letter
    [InlineData("12345678 012345678")]   // inner space
    [InlineData("২০১৫২৬৯১২৩৪৫৬৭৮৯০")]    // Bengali digits
    [InlineData("   ")]
    public async Task Malformed_student_header_returns_400(string studentId)
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 1);

        var response = await ApplyAsync(classId, studentId);

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, ErrorCodes.InvalidStudentId);
        (await fixture.Db.AssertConsistentAsync(classGuid)).HeldSeats.Should().Be(0);
    }

    [Fact]
    public async Task Invalid_header_is_reported_before_unknown_class()
    {
        var response = await ApplyAsync("c_00000000000070008000000000000000", "bad");

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, ErrorCodes.InvalidStudentId);
    }

    [Theory]
    [InlineData("c_00000000000070008000000000000000")]
    [InlineData("c_123")]
    [InlineData("h_0193f2a4c0de7a1b8c9d0e1f2a3b4c5d")]
    public async Task Unknown_or_malformed_class_returns_404(string classId)
    {
        var response = await ApplyAsync(classId, TestData.StudentId());

        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, ErrorCodes.NotFound);
    }

    // ---------- concurrency smoke (full suite in Step 11) ----------

    [Fact]
    public async Task Parallel_applies_never_exceed_capacity()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 3);
        var students = TestData.StudentIds(20);

        var responses = await Task.WhenAll(students.Select(s => ApplyAsync(classId, s)));

        responses.Count(r => r.StatusCode == HttpStatusCode.Created).Should().Be(3);
        responses.Count(r => r.StatusCode == HttpStatusCode.Conflict).Should().Be(17);
        var snapshot = await fixture.Db.AssertConsistentAsync(classGuid);
        snapshot.HeldSeats.Should().Be(3);
    }

    [Fact]
    public async Task Parallel_applies_by_the_same_student_create_exactly_one_hold()
    {
        var (classId, classGuid) = await CreateClassAsync(totalSeats: 10);
        var student = TestData.StudentId();

        var responses = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => ApplyAsync(classId, student)));

        responses.Count(r => r.StatusCode == HttpStatusCode.Created).Should().Be(1);
        foreach (var r in responses.Where(r => r.StatusCode != HttpStatusCode.Created))
            await r.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.AlreadyApplied);
        (await fixture.Db.AssertConsistentAsync(classGuid)).HeldSeats.Should().Be(1);
    }
}
