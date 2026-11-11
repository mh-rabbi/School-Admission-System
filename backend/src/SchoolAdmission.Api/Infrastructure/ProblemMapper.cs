using Npgsql;

namespace SchoolAdmission.Api.Infrastructure;

public enum ProblemSeverity
{
    /// <summary>Expected outcome of a request (validation, conflict, not found) — not logged as a problem.</summary>
    Expected,
    /// <summary>A safety net or dependency problem worth a warning (DB constraint backstop, DB unavailable).</summary>
    Warning,
    /// <summary>A bug or unknown failure — logged as an error with the exception.</summary>
    Error,
}

public sealed record ProblemInfo(int Status, string Code, string Title, string Detail, ProblemSeverity Severity);

/// <summary>
/// Single place that turns any exception into a user-friendly RFC 7807 problem (BRD §8).
/// Pure function so every mapping is unit-testable. Messages never contain internal details.
/// </summary>
public static class ProblemMapper
{
    public const string SeatsFullDetail =
        "Sorry, all seats in this class are currently taken. Please try again later or choose another class.";
    public const string AlreadyAppliedDetail = "You already have an active application for this class.";
    public const string UnavailableDetail =
        "The admission service is temporarily unavailable. Please try again in a moment.";
    public const string InternalDetail = "Something went wrong on our side. Please try again later.";

    public static ProblemInfo Map(Exception exception)
    {
        switch (exception)
        {
            case ApiException api:
                return new(api.StatusCode, api.Code, api.Title, api.Message, ProblemSeverity.Expected);

            case BadHttpRequestException bad:
                return bad.StatusCode switch
                {
                    StatusCodes.Status413PayloadTooLarge => new(413, ErrorCodes.PayloadTooLarge, "Request too large",
                        "The request is too large.", ProblemSeverity.Expected),
                    StatusCodes.Status415UnsupportedMediaType => new(415, ErrorCodes.UnsupportedMediaType, "Unsupported content type",
                        "The request body must be JSON (Content-Type: application/json).", ProblemSeverity.Expected),
                    _ => new(bad.StatusCode, ErrorCodes.ValidationFailed, "Invalid request",
                        "The request is malformed. Please check the submitted data and try again.", ProblemSeverity.Expected),
                };
        }

        // Database errors may arrive directly or wrapped (e.g. by EF Core).
        var db = Find<NpgsqlException>(exception);

        // Last-line safety nets: the DB rejected a write the application logic should already have prevented.
        if (db is PostgresException { SqlState: PostgresErrorCodes.CheckViolation, ConstraintName: "ck_classes_no_overbooking" })
            return new(409, ErrorCodes.SeatsFull, "Conflict", SeatsFullDetail, ProblemSeverity.Warning);
        if (db is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: "ux_holds_active_student_class" })
            return new(409, ErrorCodes.AlreadyApplied, "Conflict", AlreadyAppliedDetail, ProblemSeverity.Warning);

        // Database unreachable / gone / overloaded → 503 so clients can retry (BRD §8 "Server down").
        if (IsDatabaseUnavailable(db) || Find<TimeoutException>(exception) is not null)
            return new(503, ErrorCodes.ServiceUnavailable, "Service unavailable", UnavailableDetail, ProblemSeverity.Warning);

        return new(500, ErrorCodes.InternalError, "Unexpected error", InternalDetail, ProblemSeverity.Error);
    }

    /// <summary>
    /// Connection-level failures: network/IO errors (NpgsqlException without a server error), and server errors of class
    /// 08 (connection exception), 53 (insufficient resources, e.g. too many connections), 57P (admin shutdown / cannot connect now),
    /// and 3D000 (database does not exist).
    /// </summary>
    private static bool IsDatabaseUnavailable(NpgsqlException? ex) => ex switch
    {
        null => false,
        PostgresException pg => pg.SqlState.StartsWith("08", StringComparison.Ordinal)
                                || pg.SqlState.StartsWith("53", StringComparison.Ordinal)
                                || pg.SqlState.StartsWith("57P", StringComparison.Ordinal)
                                || pg.SqlState == PostgresErrorCodes.InvalidCatalogName,
        _ => true,
    };

    private static T? Find<T>(Exception? ex) where T : Exception
    {
        for (var current = ex; current is not null; current = current.InnerException)
            if (current is T match)
                return match;
        return null;
    }
}
