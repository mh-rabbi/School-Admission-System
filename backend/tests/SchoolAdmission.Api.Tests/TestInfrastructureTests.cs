using System.Text.RegularExpressions;
using SchoolAdmission.Api.Tests.Infrastructure;
using Xunit.Sdk;

namespace SchoolAdmission.Api.Tests;

/// <summary>Guards the test helpers themselves: an invariant checker that never fails proves nothing.</summary>
[Collection(DatabaseCollection.Name)]
public sealed partial class TestInfrastructureTests(PostgresFixture fixture)
{
    [GeneratedRegex("^[0-9]{17}$")]
    private static partial Regex SeventeenDigits();

    [Fact]
    public void Generated_student_ids_are_valid_and_unique()
    {
        var ids = TestData.StudentIds(1_000);

        ids.Should().OnlyContain(id => SeventeenDigits().IsMatch(id));
        ids.Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public void Generated_class_names_are_unique_and_within_limit()
    {
        var names = Enumerable.Range(0, 100).Select(_ => TestData.ClassName("Class 6 - Morning Shift")).ToList();

        names.Should().OnlyHaveUniqueItems();
        names.Should().OnlyContain(n => n.Length <= 100);
    }

    [Fact]
    public async Task Invariant_checker_passes_for_consistent_class()
    {
        var classId = await InsertClassAsync(total: 3, held: 1);
        await InsertHoldAsync(classId, "HELD");

        var snapshot = await fixture.Db.AssertConsistentAsync(classId);

        snapshot.HeldSeats.Should().Be(1);
        snapshot.HeldRows.Should().Be(1);
    }

    [Fact]
    public async Task Invariant_checker_detects_counter_drift()
    {
        // A HELD row that was never counted on the class row — exactly the bug the checker must catch.
        var classId = await InsertClassAsync(total: 3, held: 0);
        await InsertHoldAsync(classId, "HELD");

        var act = () => fixture.Db.AssertConsistentAsync(classId);

        await act.Should().ThrowAsync<XunitException>().WithMessage("*held_seats counter*");

        // Repair so the global "all classes consistent" checks in other tests stay meaningful.
        await fixture.Db.ExecuteAsync("UPDATE classes SET held_seats = 1 WHERE id = @id", ("id", classId));
        await fixture.Db.AssertConsistentAsync(classId);
    }

    private async Task<Guid> InsertClassAsync(int total, int held)
    {
        var id = Guid.CreateVersion7();
        await fixture.Db.ExecuteAsync(
            "INSERT INTO classes (id, name, total_seats, held_seats) VALUES (@id, @name, @total, @held)",
            ("id", id), ("name", TestData.ClassName("Infra")), ("total", total), ("held", held));
        return id;
    }

    private Task InsertHoldAsync(Guid classId, string status) =>
        fixture.Db.ExecuteAsync(
            "INSERT INTO holds (id, class_id, student_id, status, expires_at) VALUES (@id, @c, @s, @st, now() + interval '10 minutes')",
            ("id", Guid.CreateVersion7()), ("c", classId), ("s", TestData.StudentId()), ("st", status));
}
