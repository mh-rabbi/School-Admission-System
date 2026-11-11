using Npgsql;

namespace SchoolAdmission.Api.Tests.Infrastructure;

/// <summary>Seat counters as stored on the class row, plus the actual hold rows backing them.</summary>
public sealed record ClassSnapshot(
    Guid ClassId, int TotalSeats, int HeldSeats, int ConfirmedSeats, int HeldRows, int ConfirmedRows);

/// <summary>
/// Reads the database directly (bypassing the API) so tests can prove the invariant at the storage level:
///   1. held_seats + confirmed_seats &lt;= total_seats            (BRD §5 – no overbooking)
///   2. held_seats == #holds with status HELD, confirmed_seats == #holds with status CONFIRMED
///      (counters never drift from reality)
/// </summary>
public sealed class DbInspector(string connectionString)
{
    private const string SnapshotSql = """
        SELECT c.id, c.total_seats, c.held_seats, c.confirmed_seats,
               count(h.id) FILTER (WHERE h.status = 'HELD')::int      AS held_rows,
               count(h.id) FILTER (WHERE h.status = 'CONFIRMED')::int AS confirmed_rows
        FROM classes c
        LEFT JOIN holds h ON h.class_id = c.id
        {0}
        GROUP BY c.id
        """;

    public async Task<ClassSnapshot> GetClassAsync(Guid classId)
    {
        var rows = await QueryAsync(string.Format(SnapshotSql, "WHERE c.id = @id"), classId);
        return rows.Should().ContainSingle($"class {classId} should exist").Subject;
    }

    public Task<IReadOnlyList<ClassSnapshot>> GetAllClassesAsync() =>
        QueryAsync(string.Format(SnapshotSql, ""), null);

    /// <summary>Asserts both invariants for one class.</summary>
    public async Task<ClassSnapshot> AssertConsistentAsync(Guid classId)
    {
        var snapshot = await GetClassAsync(classId);
        AssertConsistent(snapshot);
        return snapshot;
    }

    /// <summary>Asserts both invariants for every class in the database.</summary>
    public async Task AssertAllConsistentAsync()
    {
        foreach (var snapshot in await GetAllClassesAsync())
            AssertConsistent(snapshot);
    }

    public static void AssertConsistent(ClassSnapshot s)
    {
        (s.HeldSeats + s.ConfirmedSeats).Should().BeLessThanOrEqualTo(s.TotalSeats,
            $"class {s.ClassId} must never be overbooked");
        s.HeldSeats.Should().Be(s.HeldRows, $"held_seats counter of class {s.ClassId} must match HELD rows");
        s.ConfirmedSeats.Should().Be(s.ConfirmedRows, $"confirmed_seats counter of class {s.ClassId} must match CONFIRMED rows");
    }

    /// <summary>Runs arbitrary SQL (test setup such as forcing a hold to be expired).</summary>
    public async Task<int> ExecuteAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, conn);
        foreach (var (name, value) in parameters)
            cmd.Parameters.AddWithValue(name, value);
        return await cmd.ExecuteNonQueryAsync();
    }

    public async Task<NpgsqlConnection> OpenAsync()
    {
        var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();
        return conn;
    }

    private async Task<IReadOnlyList<ClassSnapshot>> QueryAsync(string sql, Guid? classId)
    {
        await using var conn = await OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, conn);
        if (classId is { } id) cmd.Parameters.AddWithValue("id", id);

        var result = new List<ClassSnapshot>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(new ClassSnapshot(
                reader.GetGuid(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetInt32(3),
                reader.GetInt32(4), reader.GetInt32(5)));
        return result;
    }
}
