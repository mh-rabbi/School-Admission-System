using System.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using SchoolAdmission.Api.Infrastructure;

namespace SchoolAdmission.Api.Expiry;

/// <summary>
/// Moves every HELD hold whose expires_at has passed to EXPIRED and returns its seat to the pool
/// (BRD §4.2 "Automatic Expiration"; architecture §4.4). Safe with any number of instances:
///   • pg_try_advisory_xact_lock — only one instance sweeps at a time; the others skip the tick.
///   • FOR UPDATE SKIP LOCKED + status = 'HELD' — rows being confirmed/cancelled/released by a request are skipped,
///     and a hold can leave HELD only once, so each seat is returned exactly once.
/// </summary>
public sealed class ExpiredHoldReleaser(AppDbContext db, ILogger<ExpiredHoldReleaser> logger)
{
    public const int DefaultBatchSize = 1000;
    private const long SweeperLockKey = 7_301_202_602; // distinct from the migration lock

    private const string TryLockSql = "SELECT pg_try_advisory_xact_lock(@key)";

    private const string SweepBatchSql = """
        WITH due AS (
            SELECT id FROM holds
            WHERE status = 'HELD' AND expires_at <= now()
            ORDER BY expires_at
            LIMIT @batch
            FOR UPDATE SKIP LOCKED),
        expired AS (
            UPDATE holds h SET status = 'EXPIRED', updated_at = now()
            FROM due
            WHERE h.id = due.id AND h.status = 'HELD'
            RETURNING h.class_id),
        per_class AS (
            SELECT class_id, count(*)::int AS n FROM expired GROUP BY class_id),
        returned AS (
            UPDATE classes c SET held_seats = c.held_seats - p.n
            FROM per_class p
            WHERE c.id = p.class_id
            RETURNING p.n)
        SELECT COALESCE(sum(n), 0)::int FROM returned
        """;

    /// <summary>Releases all currently expired holds in batches. Returns how many were released by this call.</summary>
    public async Task<int> ReleaseAllAsync(int batchSize = DefaultBatchSize, CancellationToken ct = default)
    {
        await db.Database.OpenConnectionAsync(ct);
        var conn = (NpgsqlConnection)db.Database.GetDbConnection();
        var total = 0;

        while (true)
        {
            await using var tx = await conn.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);

            await using (var lockCmd = new NpgsqlCommand(TryLockSql, conn, tx))
            {
                lockCmd.Parameters.AddWithValue("key", SweeperLockKey);
                if (!(bool)(await lockCmd.ExecuteScalarAsync(ct))!)
                {
                    await tx.CommitAsync(ct);
                    logger.LogDebug("Another instance is sweeping expired holds; skipping");
                    return total;
                }
            }

            int released;
            await using (var sweepCmd = new NpgsqlCommand(SweepBatchSql, conn, tx))
            {
                sweepCmd.Parameters.AddWithValue("batch", batchSize);
                released = (int)(await sweepCmd.ExecuteScalarAsync(ct))!;
            }

            await tx.CommitAsync(ct); // also releases the advisory lock
            total += released;

            if (released < batchSize)
                return total;
        }
    }
}
