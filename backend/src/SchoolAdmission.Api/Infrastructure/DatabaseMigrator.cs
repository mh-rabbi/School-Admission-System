using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace SchoolAdmission.Api.Infrastructure;

/// <summary>
/// Applies EF Core migrations at startup (decision D5). A Postgres session-level advisory lock ensures
/// that when several instances start at once only one migrates; the others wait and then find nothing to do.
/// Retries the initial connection so the API tolerates a database that is still starting.
/// </summary>
public static class DatabaseMigrator
{
    private const long MigrationLockKey = 7_301_202_601; // arbitrary, app-wide constant
    private const int MaxConnectAttempts = 15;
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(2);

    public static async Task MigrateAsync(IServiceProvider services, CancellationToken ct = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(DatabaseMigrator));

        await OpenWithRetryAsync(db, logger, ct);
        try
        {
            await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_lock({MigrationLockKey})", ct);
            try
            {
                var pending = (await db.Database.GetPendingMigrationsAsync(ct)).ToList();
                if (pending.Count > 0)
                {
                    logger.LogInformation("Applying {Count} migration(s): {Migrations}", pending.Count, pending);
                    await db.Database.MigrateAsync(ct);
                }
                else
                {
                    logger.LogInformation("Database schema is up to date");
                }
            }
            finally
            {
                await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_unlock({MigrationLockKey})", ct);
            }
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    private static async Task OpenWithRetryAsync(AppDbContext db, ILogger logger, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await db.Database.OpenConnectionAsync(ct);
                return;
            }
            catch (Exception ex) when (attempt < MaxConnectAttempts && ex is NpgsqlException or TimeoutException)
            {
                logger.LogWarning("Database not reachable (attempt {Attempt}/{Max}): {Message}. Retrying in {Delay}s",
                    attempt, MaxConnectAttempts, ex.Message, RetryDelay.TotalSeconds);
                await Task.Delay(RetryDelay, ct);
            }
        }
    }
}
