using System.Text.RegularExpressions;

namespace SchoolAdmission.Api.Infrastructure;

/// <summary>
/// The X-Student-Id header is the user's identity (BRD §4.1, §7): exactly 17 ASCII digits (decision D9c).
/// </summary>
public static partial class StudentIds
{
    public const string HeaderName = "X-Student-Id";

    // [0-9] rather than \d: \d also matches non-ASCII digits (e.g. Bengali ০-৯), which the DB check would reject.
    [GeneratedRegex("^[0-9]{17}$")]
    private static partial Regex Format();

    /// <summary>Validates a required header value; throws 400 INVALID_STUDENT_ID when missing or malformed.</summary>
    public static string Require(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            throw ApiException.BadRequest(ErrorCodes.InvalidStudentId,
                "Student registration number is required. Please enter your 17-digit registration number.");

        var value = raw.Trim();
        if (!Format().IsMatch(value))
            throw ApiException.BadRequest(ErrorCodes.InvalidStudentId,
                "Student registration number must be exactly 17 digits (0-9).");

        return value;
    }

    /// <summary>For endpoints where the header is optional: null when absent, validated when present.</summary>
    public static string? Optional(string? raw) => string.IsNullOrWhiteSpace(raw) ? null : Require(raw);
}
