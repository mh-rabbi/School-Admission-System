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

    // ------------------------------------------------------------------ status (BRD §7.5, decision D9b)

    public async Task<HoldDetailsResponse> GetAsync(string holdIdRaw, string? studentIdRaw, CancellationToken ct)
    {
        var requester = StudentIds.Optional(studentIdRaw);
        var hold = await FindAsync(holdIdRaw, ct);

        // Header optional; when present it must be the owner (404 hides other students' holds).
        if (hold is null || (requester is not null && hold.StudentId != requester))
            throw HoldNotFound();

        return new HoldDetailsResponse(PrefixedId.Hold(hold.Id), PrefixedId.Class(hold.ClassId), hold.Status, hold.ExpiresAt);
    }

    // ------------------------------------------------------------------ confirm (BRD §7.6, architecture §4.2)

    public async Task<HoldConfirmedResponse> ConfirmAsync(string holdIdRaw, string? studentIdRaw, CancellationToken ct)
    {
        var studentId = StudentIds.Require(studentIdRaw);
        if (!PrefixedId.TryParse(PrefixedId.HoldPrefix, holdIdRaw, out var holdId))
            throw HoldNotFound();

        var conn = await OpenConnectionAsync(ct);
        var updated = await TransientRetry.ExecuteAsync(
            () => ExecuteAsync(conn, null, HoldSql.ConfirmHold, ct, ("hold", holdId.Value), ("student", studentId)),
            logger, ct);

        if (updated == 1)
            return new HoldConfirmedResponse(PrefixedId.Hold(holdId.Value), HoldStatus.Confirmed);

        // Nothing changed: explain why from the hold's current (effective) state.
        var hold = await FindAsync(holdIdRaw, ct);
        if (hold is null || hold.StudentId != studentId)
            throw HoldNotFound();

        return hold.Status switch
        {
            HoldStatus.Confirmed => new HoldConfirmedResponse(PrefixedId.Hold(hold.Id), HoldStatus.Confirmed), // idempotent repeat
            HoldStatus.Expired => throw ApiException.Conflict(ErrorCodes.HoldExpired,
                "Your seat hold has expired, so admission can no longer be confirmed. Please apply again if seats are available."),
            _ => throw ApiException.Conflict(ErrorCodes.HoldNotActive,
                "This application is no longer active (it was cancelled) and cannot be confirmed."),
        };
    }

    // ------------------------------------------------------------------ cancel (BRD §7.7, architecture §4.3, decision D8a)

    public async Task CancelAsync(string holdIdRaw, string? studentIdRaw, CancellationToken ct)
    {
        var studentId = StudentIds.Require(studentIdRaw);
        if (!PrefixedId.TryParse(PrefixedId.HoldPrefix, holdIdRaw, out var holdId))
            throw HoldNotFound();

        var conn = await OpenConnectionAsync(ct);
        var updated = await TransientRetry.ExecuteAsync(
            () => ExecuteAsync(conn, null, HoldSql.CancelHold, ct, ("hold", holdId.Value), ("student", studentId)),
            logger, ct);

        if (updated == 1)
            return;

        var hold = await FindAsync(holdIdRaw, ct);
        if (hold is null || hold.StudentId != studentId)
            throw HoldNotFound();

        if (hold.Status == HoldStatus.Confirmed)
            throw ApiException.Conflict(ErrorCodes.CannotCancelConfirmed,
                "This admission is already confirmed and cannot be cancelled online. Please contact the school office.");

        // CANCELLED or EXPIRED: the application is already inactive — cancelling again is a harmless no-op (204).
    }

    // ------------------------------------------------------------------ my applications (BRD §7.8)

    public async Task<IReadOnlyList<MyHoldResponse>> ListForStudentAsync(string? studentIdRaw, CancellationToken ct)
    {
        var studentId = StudentIds.Require(studentIdRaw);
        var conn = await OpenConnectionAsync(ct);

        await using var cmd = Command(conn, null, HoldSql.ListStudentHolds, [("student", studentId)]);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var result = new List<MyHoldResponse>();
        while (await reader.ReadAsync(ct))
            result.Add(new MyHoldResponse(
                PrefixedId.Hold(reader.GetGuid(0)), PrefixedId.Class(reader.GetGuid(1)), reader.GetString(2),
                reader.GetString(3), reader.GetFieldValue<DateTime>(4)));
        return result;
    }

    private sealed record HoldRow(Guid Id, Guid ClassId, string StudentId, string Status, DateTime ExpiresAt);

    private async Task<HoldRow?> FindAsync(string holdIdRaw, CancellationToken ct)
    {
        if (!PrefixedId.TryParse(PrefixedId.HoldPrefix, holdIdRaw, out var holdId))
            return null;

        var conn = await OpenConnectionAsync(ct);
        await using var cmd = Command(conn, null, HoldSql.GetHold, [("hold", holdId.Value)]);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
            return null;

        return new HoldRow(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
            reader.GetFieldValue<DateTime>(4));
    }

    // ------------------------------------------------------------------ errors

    private static ApiException HoldNotFound() => ApiException.NotFound("The requested application does not exist.");

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
