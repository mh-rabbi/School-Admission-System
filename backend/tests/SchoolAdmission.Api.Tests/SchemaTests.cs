using Npgsql;
using SchoolAdmission.Api.Tests.Infrastructure;

namespace SchoolAdmission.Api.Tests;

/// <summary>
/// Proves the database itself rejects invalid states, independent of application code (BRD §4.2, §5).
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class SchemaTests(PostgresFixture fixture)
{
    private readonly string StudentA = TestData.StudentId();

    private Task<NpgsqlConnection> OpenAsync() => fixture.Db.OpenAsync();

    private static async Task<Guid> InsertClassAsync(NpgsqlConnection conn, int total, int held = 0, int confirmed = 0)
    {
        var id = Guid.CreateVersion7();
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO classes (id, name, total_seats, held_seats, confirmed_seats) VALUES (@id, @name, @t, @h, @c)", conn);
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("name", $"Schema test {id:N}");
        cmd.Parameters.AddWithValue("t", total);
        cmd.Parameters.AddWithValue("h", held);
        cmd.Parameters.AddWithValue("c", confirmed);
        await cmd.ExecuteNonQueryAsync();
        return id;
    }

    /// <summary>
    /// Inserts a hold and, in the same statement, keeps the class counters in step, so data left behind by these
    /// raw-constraint tests never breaks the global counter-consistency checks in other tests.
    /// If the INSERT violates a constraint, the whole statement fails and nothing changes.
    /// </summary>
    private static async Task InsertHoldAsync(NpgsqlConnection conn, Guid classId, string studentId, string status)
    {
        await using var cmd = new NpgsqlCommand("""
            WITH h AS (
                INSERT INTO holds (id, class_id, student_id, status, expires_at)
                VALUES (@id, @c, @s, @st, now() + interval '10 minutes')
                RETURNING status)
            UPDATE classes SET
                held_seats      = held_seats      + (SELECT count(*) FROM h WHERE status = 'HELD'),
                confirmed_seats = confirmed_seats + (SELECT count(*) FROM h WHERE status = 'CONFIRMED')
            WHERE id = @c
            """, conn);
        cmd.Parameters.AddWithValue("id", Guid.CreateVersion7());
        cmd.Parameters.AddWithValue("c", classId);
        cmd.Parameters.AddWithValue("s", studentId);
        cmd.Parameters.AddWithValue("st", status);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<PostgresException> ShouldFailAsync(Func<Task> action)
    {
        var ex = await action.Should().ThrowAsync<PostgresException>();
        return ex.Which;
    }

    [Fact]
    public async Task Overbooking_update_is_rejected_by_check_constraint()
    {
        await using var conn = await OpenAsync();
        var classId = await InsertClassAsync(conn, total: 2);
        await InsertHoldAsync(conn, classId, TestData.StudentId(), "HELD");      // held_seats = 1
        await InsertHoldAsync(conn, classId, TestData.StudentId(), "CONFIRMED"); // confirmed_seats = 1 → full

        await using var cmd = new NpgsqlCommand("UPDATE classes SET held_seats = held_seats + 1 WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", classId);

        var ex = await ShouldFailAsync(() => cmd.ExecuteNonQueryAsync());
        ex.SqlState.Should().Be(PostgresErrorCodes.CheckViolation);
        ex.ConstraintName.Should().Be("ck_classes_no_overbooking");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(10_001)]
    public async Task Total_seats_out_of_range_is_rejected(int total)
    {
        await using var conn = await OpenAsync();

        var ex = await ShouldFailAsync(() => InsertClassAsync(conn, total));
        ex.ConstraintName.Should().Be("ck_classes_total_seats_range");
    }

    [Fact]
    public async Task Class_names_are_unique_case_insensitively()
    {
        await using var conn = await OpenAsync();
        var name = TestData.ClassName("Class 9 - Day Shift");
        await using (var cmd = new NpgsqlCommand("INSERT INTO classes (id, name, total_seats) VALUES (@id, @name, 10)", conn))
        {
            cmd.Parameters.AddWithValue("id", Guid.CreateVersion7());
            cmd.Parameters.AddWithValue("name", name);
            await cmd.ExecuteNonQueryAsync();
        }

        await using var dup = new NpgsqlCommand("INSERT INTO classes (id, name, total_seats) VALUES (@id, @name, 10)", conn);
        dup.Parameters.AddWithValue("id", Guid.CreateVersion7());
        dup.Parameters.AddWithValue("name", name.ToUpperInvariant());

        var ex = await ShouldFailAsync(() => dup.ExecuteNonQueryAsync());
        ex.SqlState.Should().Be(PostgresErrorCodes.UniqueViolation);
        ex.ConstraintName.Should().Be("ux_classes_name_normalized");
    }

    [Theory]
    [InlineData("HELD", "HELD")]
    [InlineData("HELD", "CONFIRMED")]
    [InlineData("CONFIRMED", "HELD")]
    public async Task Second_active_application_for_same_class_is_rejected(string first, string second)
    {
        await using var conn = await OpenAsync();
        var classId = await InsertClassAsync(conn, total: 10);
        await InsertHoldAsync(conn, classId, StudentA, first);

        var ex = await ShouldFailAsync(() => InsertHoldAsync(conn, classId, StudentA, second));
        ex.SqlState.Should().Be(PostgresErrorCodes.UniqueViolation);
        ex.ConstraintName.Should().Be("ux_holds_active_student_class");
    }

    [Theory]
    [InlineData("EXPIRED")]
    [InlineData("CANCELLED")]
    public async Task Reapplying_after_inactive_application_is_allowed(string inactive)
    {
        await using var conn = await OpenAsync();
        var classId = await InsertClassAsync(conn, total: 10);
        await InsertHoldAsync(conn, classId, StudentA, inactive);

        await InsertHoldAsync(conn, classId, StudentA, "HELD");
    }

    [Theory]
    [InlineData("1234567890123456")]   // 16 chars
    [InlineData("1234567890123456A")]  // non-digit
    public async Task Invalid_student_id_is_rejected(string studentId)
    {
        await using var conn = await OpenAsync();
        var classId = await InsertClassAsync(conn, total: 10);

        var ex = await ShouldFailAsync(() => InsertHoldAsync(conn, classId, studentId, "HELD"));
        ex.ConstraintName.Should().Be("ck_holds_student_id_format");
    }

    [Fact]
    public async Task Unknown_status_is_rejected()
    {
        await using var conn = await OpenAsync();
        var classId = await InsertClassAsync(conn, total: 10);

        var ex = await ShouldFailAsync(() => InsertHoldAsync(conn, classId, StudentA, "PENDING"));
        ex.ConstraintName.Should().Be("ck_holds_status");
    }
}
