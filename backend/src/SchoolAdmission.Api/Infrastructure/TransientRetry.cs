using Npgsql;

namespace SchoolAdmission.Api.Infrastructure;

/// <summary>
/// Retries a whole transaction when Postgres aborts it with a deadlock (40P01) or serialization failure (40001).
/// Lock ordering makes these rare; this is the safety net (architecture §5, "Lock ordering").
/// The operation must be a complete, self-contained transaction so re-running it is safe.
/// </summary>
public static class TransientRetry
{
    private const int MaxAttempts = 3;

    public static async Task<T> ExecuteAsync<T>(Func<Task<T>> operation, ILogger logger, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await operation();
            }
            catch (PostgresException ex) when (attempt < MaxAttempts && IsTransient(ex))
            {
                logger.LogWarning("Transient database conflict {SqlState} (attempt {Attempt}/{Max}); retrying",
                    ex.SqlState, attempt, MaxAttempts);
                await Task.Delay(Random.Shared.Next(5, 25 * attempt), ct);
            }
        }
    }

    private static bool IsTransient(PostgresException ex) =>
        ex.SqlState is PostgresErrorCodes.DeadlockDetected or PostgresErrorCodes.SerializationFailure;
}
