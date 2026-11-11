namespace SchoolAdmission.Api.Infrastructure;

/// <summary>Machine-readable error codes returned in ProblemDetails "code" (decision D12).</summary>
public static class ErrorCodes
{
    public const string SeatsFull = "SEATS_FULL";
    public const string HoldExpired = "HOLD_EXPIRED";
    public const string HoldNotActive = "HOLD_NOT_ACTIVE";
    public const string AlreadyApplied = "ALREADY_APPLIED";
    public const string CannotCancelConfirmed = "CANNOT_CANCEL_CONFIRMED";
    public const string DuplicateClassName = "DUPLICATE_CLASS_NAME";
    public const string InvalidStudentId = "INVALID_STUDENT_ID";
    public const string ValidationFailed = "VALIDATION_FAILED";
    public const string NotFound = "NOT_FOUND";
    public const string Conflict = "CONFLICT";
    public const string MethodNotAllowed = "METHOD_NOT_ALLOWED";
    public const string UnsupportedMediaType = "UNSUPPORTED_MEDIA_TYPE";
    public const string PayloadTooLarge = "PAYLOAD_TOO_LARGE";
    public const string ServiceUnavailable = "SERVICE_UNAVAILABLE";
    public const string InternalError = "INTERNAL_ERROR";

    /// <summary>Fallback code for responses produced without an explicit code (e.g. unmatched routes).</summary>
    public static string FromStatus(int status) => status switch
    {
        400 => ValidationFailed,
        404 => NotFound,
        405 => MethodNotAllowed,
        409 => Conflict,
        413 => PayloadTooLarge,
        415 => UnsupportedMediaType,
        503 => ServiceUnavailable,
        _ when status >= 500 => InternalError,
        _ => "ERROR",
    };
}
