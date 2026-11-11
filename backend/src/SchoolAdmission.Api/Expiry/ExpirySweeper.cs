using Npgsql;
using SchoolAdmission.Api.Infrastructure;

namespace SchoolAdmission.Api.Expiry;

/// <summary>
/// Background loop that returns expired seats to the pool every EXPIRY_SWEEP_INTERVAL_SECONDS,
/// with no external API call (BRD §4.2). Correctness never depends on its timing: reads report
/// HELD-past-expiry as EXPIRED and confirm/cancel/apply check expires_at themselves (architecture §4.4).
/// A failed tick is logged and retried on the next tick; it never stops the host.
/// </summary>
public sealed class ExpirySweeper(IServiceScopeFactory scopes, AdmissionOptions options, ILogger<ExpirySweeper> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromSeconds(options.ExpirySweepIntervalSeconds);
        logger.LogInformation("Expiry sweeper started (interval {Interval}s, hold duration {Hold}s)",
            interval.TotalSeconds, options.HoldDurationSeconds);

        using var timer = new PeriodicTimer(interval);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
                await SweepOnceAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // normal shutdown
        }
    }

    private async Task SweepOnceAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var releaser = scope.ServiceProvider.GetRequiredService<ExpiredHoldReleaser>();
            var released = await releaser.ReleaseAllAsync(ExpiredHoldReleaser.DefaultBatchSize, ct);
            if (released > 0)
                logger.LogInformation("Released {Count} expired hold(s) back to the seat pool", released);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (PostgresException ex) when (ex.SqlState is PostgresErrorCodes.DeadlockDetected or PostgresErrorCodes.SerializationFailure)
        {
            logger.LogWarning("Expiry sweep hit a transient conflict ({SqlState}); will retry next tick", ex.SqlState);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Expiry sweep failed; will retry next tick");
        }
    }
}
