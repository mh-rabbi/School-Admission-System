using System.Net;
using SchoolAdmission.Api.Infrastructure;
using SchoolAdmission.Api.Tests.Infrastructure;

namespace SchoolAdmission.Api.Tests;

/// <summary>GET /me/holds — BRD §4.1 (My Applications), §7.8.</summary>
[Collection(DatabaseCollection.Name)]
public sealed class MyHoldsTests(PostgresFixture fixture)
{
    private readonly HttpClient _client = fixture.Api.CreateClient();

    private async Task<ClassDetails> CreateClassAsync(string prefix, int totalSeats = 5) =>
        await (await _client.PostJsonAsync("/classes", new { name = TestData.ClassName(prefix), totalSeats }))
            .ShouldBeAsync<ClassDetails>(HttpStatusCode.Created);

    private async Task<HoldCreated> ApplyAsync(string classId, string studentId) =>
        await (await _client.PostJsonAsync($"/classes/{classId}/holds", studentId: studentId))
            .ShouldBeAsync<HoldCreated>(HttpStatusCode.Created);

    private Task<HttpResponseMessage> GetMineAsync(string? studentId) => _client.GetAsStudentAsync("/me/holds", studentId);

    [Fact]
    public async Task Lists_all_own_applications_with_every_status_newest_first()
    {
        var student = TestData.StudentId();
        var held = await CreateClassAsync("Class 6 - Morning Shift");
        var confirmed = await CreateClassAsync("Class 6 - Day Shift");
        var cancelled = await CreateClassAsync("Class 7 - Morning Shift");
        var expired = await CreateClassAsync("Class 8 - Day Shift");

        var hHeld = await ApplyAsync(held.Id, student);
        var hConfirmed = await ApplyAsync(confirmed.Id, student);
        await (await _client.PostJsonAsync($"/holds/{hConfirmed.HoldId}/confirm", studentId: student)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var hCancelled = await ApplyAsync(cancelled.Id, student);
        await (await _client.DeleteAsStudentAsync($"/holds/{hCancelled.HoldId}", student)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        var hExpired = await ApplyAsync(expired.Id, student);
        PrefixedId.TryParse(PrefixedId.HoldPrefix, hExpired.HoldId, out var expiredGuid).Should().BeTrue();
        await fixture.Db.ExecuteAsync("UPDATE holds SET expires_at = now() - interval '1 second' WHERE id = @id", ("id", expiredGuid!.Value));
        var hReapplied = await ApplyAsync(cancelled.Id, student); // re-apply after cancel → two entries for that class

        var response = await GetMineAsync(student);

        var mine = await response.ShouldBeAsync<List<MyHold>>(HttpStatusCode.OK);
        await response.ShouldHaveContractFieldsAsync(ContractFields.MyHold);
        mine.Should().Equal(
            [
                new MyHold(hReapplied.HoldId, cancelled.Id, cancelled.Name, "HELD", hReapplied.ExpiresAt),
                new MyHold(hExpired.HoldId, expired.Id, expired.Name, "EXPIRED", default),
                new MyHold(hCancelled.HoldId, cancelled.Id, cancelled.Name, "CANCELLED", hCancelled.ExpiresAt),
                new MyHold(hConfirmed.HoldId, confirmed.Id, confirmed.Name, "CONFIRMED", hConfirmed.ExpiresAt),
                new MyHold(hHeld.HoldId, held.Id, held.Name, "HELD", hHeld.ExpiresAt),
            ],
            (actual, expected) => actual.HoldId == expected.HoldId
                                  && actual.ClassId == expected.ClassId
                                  && actual.ClassName == expected.ClassName
                                  && actual.Status == expected.Status
                                  && (expected.ExpiresAt == default || actual.ExpiresAt == expected.ExpiresAt));
    }

    [Fact]
    public async Task Does_not_include_other_students_applications()
    {
        var me = TestData.StudentId();
        var someoneElse = TestData.StudentId();
        var cls = await CreateClassAsync("Shared");
        var mine = await ApplyAsync(cls.Id, me);
        await ApplyAsync(cls.Id, someoneElse);

        var list = await (await GetMineAsync(me)).ShouldBeAsync<List<MyHold>>(HttpStatusCode.OK);

        list.Should().ContainSingle().Which.HoldId.Should().Be(mine.HoldId);
    }

    [Fact]
    public async Task Student_without_applications_gets_an_empty_list()
    {
        var response = await GetMineAsync(TestData.StudentId());

        (await response.ShouldBeAsync<List<MyHold>>(HttpStatusCode.OK)).Should().BeEmpty();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("12345")]
    public async Task Missing_or_malformed_header_returns_400(string? studentId)
    {
        var response = await GetMineAsync(studentId);

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, ErrorCodes.InvalidStudentId);
    }
}
