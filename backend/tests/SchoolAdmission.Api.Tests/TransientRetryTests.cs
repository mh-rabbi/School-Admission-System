using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using SchoolAdmission.Api.Infrastructure;

namespace SchoolAdmission.Api.Tests;

/// <summary>
/// The deadlock/serialization retry is a safety net that lock ordering makes very hard to trigger for real,
/// so its behaviour is pinned down with unit tests.
/// </summary>
public sealed class TransientRetryTests
{
    private static PostgresException Pg(string sqlState) => new("conflict", "ERROR", "ERROR", sqlState);

    private static Task<int> RunAsync(Func<int, int> attempt)
    {
        var calls = 0;
        return TransientRetry.ExecuteAsync(() => Task.FromResult(attempt(++calls)), NullLogger.Instance, CancellationToken.None);
    }

    [Theory]
    [InlineData(PostgresErrorCodes.DeadlockDetected)]
    [InlineData(PostgresErrorCodes.SerializationFailure)]
    public async Task Retries_transient_failures_and_returns_the_eventual_result(string sqlState)
    {
        var result = await RunAsync(call => call < 3 ? throw Pg(sqlState) : call);

        result.Should().Be(3, "two transient failures, success on the third attempt");
    }

    [Fact]
    public async Task Gives_up_after_three_attempts()
    {
        var calls = 0;
        var act = () => RunAsync(_ => { calls++; throw Pg(PostgresErrorCodes.DeadlockDetected); });

        (await act.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be(PostgresErrorCodes.DeadlockDetected);
        calls.Should().Be(3);
    }

    [Fact]
    public async Task Does_not_retry_non_transient_errors()
    {
        var calls = 0;
        var act = () => RunAsync(_ => { calls++; throw Pg(PostgresErrorCodes.CheckViolation); });

        await act.Should().ThrowAsync<PostgresException>();
        calls.Should().Be(1);
    }
}
