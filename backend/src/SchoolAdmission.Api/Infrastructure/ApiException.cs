namespace SchoolAdmission.Api.Infrastructure;

/// <summary>
/// An expected, user-facing failure. Translated to an RFC 7807 ProblemDetails response
/// with the given status, title, human-readable detail and machine-readable code.
/// </summary>
public sealed class ApiException(int statusCode, string code, string title, string detail) : Exception(detail)
{
    public int StatusCode { get; } = statusCode;
    public string Code { get; } = code;
    public string Title { get; } = title;

    public static ApiException BadRequest(string code, string detail) =>
        new(StatusCodes.Status400BadRequest, code, "Invalid request", detail);

    public static ApiException NotFound(string detail) =>
        new(StatusCodes.Status404NotFound, ErrorCodes.NotFound, "Not found", detail);

    public static ApiException Conflict(string code, string detail) =>
        new(StatusCodes.Status409Conflict, code, "Conflict", detail);
}
