using System.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using SchoolAdmission.Api.Classes;
using SchoolAdmission.Api.Infrastructure;
using SchoolAdmission.Api.Infrastructure.Entities;

namespace SchoolAdmission.Api.Holds;

/// <summary>Hold lifecycle. State transitions use raw SQL on EF Core's connection (decision D5).</summary>
public sealed class HoldService(AppDbContext db, AdmissionOptions options, ILogger<HoldService> logger)
{
    // ------------------------------------------------------------------ apply (BRD §7.4, architecture §4.1)

    public async Task<HoldCreatedResponse> ApplyAsync(string classIdRaw, string? studentIdRaw, CancellationToken ct)
    {
        var studentId = StudentIds.Require(studentIdRaw);
        if (!PrefixedId.TryParse(PrefixedId.ClassPrefix, classIdRaw, out var parsedClassId))
            throw ClassService.ClassNotFound();
        var classId = parsedClassId.Value;

        var conn = await OpenConnectionAsync(ct);

        // Fast path without touching the class row lock. Not the guarantee (the unique index is).
        if (await ScalarAsync<bool>(conn, null, HoldSql.HasActiveHold, ct, ("class", classId), ("student", studentId)))
            throw AlreadyApplied();

        return await TransientRetry.ExecuteAsync(() => ApplyInTransactionAsync(conn, classId, studentId, ct), logger, ct);
    }

    private async Task<HoldCreatedResponse> ApplyInTransactionAsync(
        NpgsqlConnection conn, Guid classId, string studentId, CancellationToken ct)
    {
        await using var tx = await conn.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);

        await ExecuteAsync(conn, tx, HoldSql.ReleaseOwnExpiredHold, ct, ("class", classId), ("student", studentId));

        var claimed = await ExecuteAsync(conn, tx, HoldSql.ClaimSeat, ct, ("class", classId)) == 1;
        if (!claimed)
        {
            // "Full" may only be due to expired holds the sweeper has not processed yet: release them, retry once.
            var released = await ExecuteAsync(conn, tx, HoldSql.ReleaseClassExpiredHolds, ct, ("class", classId)) == 1;
            claimed = released && await ExecuteAsync(conn, tx, HoldSql.ClaimSeat, ct, ("class", classId)) == 1;
        }

        if (!claimed)
        {
            await tx.CommitAsync(ct); // keep any releases made above
            var exists = await ScalarAsync<bool>(conn, null, HoldSql.ClassExists, ct, ("class", classId));
            throw exists ? SeatsFull() : ClassService.ClassNotFound();
        }

        var holdId = PrefixedId.NewGuid();
        var expiresAt = await ScalarAsync<DateTime?>(conn, tx, HoldSql.InsertHold, ct,
            ("id", holdId), ("class", classId), ("student", studentId), ("holdSeconds", (double)options.HoldDurationSeconds));

        if (expiresAt is null)
        {
            await tx.RollbackAsync(ct); // undo the seat claim
            throw AlreadyApplied();
        }

        await tx.CommitAsync(ct);
        return new HoldCreatedResponse(
            PrefixedId.Hold(holdId), PrefixedId.Class(classId), studentId, HoldStatus.Held, expiresAt.Value);
    }

    // ------------------------------------------------------------------ errors

    private static ApiException SeatsFull() => ApiException.Conflict(ErrorCodes.SeatsFull,
        "Sorry, all seats in this class are currently taken. Please try again later or choose another class.");

    private static ApiException AlreadyApplied() => ApiException.Conflict(ErrorCodes.AlreadyApplied,
        "You already have an active application for this class.");

    // ------------------------------------------------------------------ ADO.NET helpers (EF Core's connection)

    private async Task<NpgsqlConnection> OpenConnectionAsync(CancellationToken ct)
    {
        await db.Database.OpenConnectionAsync(ct); // closed again when the scoped DbContext is disposed
        return (NpgsqlConnection)db.Database.GetDbConnection();
    }

    private static NpgsqlCommand Command(NpgsqlConnection conn, NpgsqlTransaction? tx, string sql, (string Name, object Value)[] parameters)
    {
        var cmd = new NpgsqlCommand(sql, conn, tx);
        foreach (var (name, value) in parameters)
            cmd.Parameters.AddWithValue(name, value);
        return cmd;
    }

    private static async Task<int> ExecuteAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string sql,
        CancellationToken ct, params (string Name, object Value)[] parameters)
    {
        await using var cmd = Command(conn, tx, sql, parameters);
        return await cmd.ExecuteNonQueryAsync(ct);
    }

    private static async Task<T> ScalarAsync<T>(NpgsqlConnection conn, NpgsqlTransaction? tx, string sql,
        CancellationToken ct, params (string Name, object Value)[] parameters)
    {
        await using var cmd = Command(conn, tx, sql, parameters);
        var result = await cmd.ExecuteScalarAsync(ct);
        return result is null or DBNull ? default! : (T)result;
    }
}
