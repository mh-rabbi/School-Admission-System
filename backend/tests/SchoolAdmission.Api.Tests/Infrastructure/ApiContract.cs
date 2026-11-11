namespace SchoolAdmission.Api.Tests.Infrastructure;

// Test-side copies of the BRD §7 response contracts. They are deliberately NOT shared with the API project:
// if the API renames or drops a field, deserialization into these records (plus RequireFields) fails the tests.

public sealed record ClassCreated(string Id, string Name, int TotalSeats);

public sealed record ClassDetails(
    string Id, string Name, int TotalSeats, int HeldSeats, int ConfirmedSeats, int AvailableSeats);

public sealed record HoldCreated(
    string HoldId, string ClassId, string StudentId, string Status, DateTimeOffset ExpiresAt);

public sealed record HoldDetails(string HoldId, string ClassId, string Status, DateTimeOffset ExpiresAt);

public sealed record HoldConfirmed(string HoldId, string Status);

public sealed record MyHold(string HoldId, string ClassId, string ClassName, string Status, DateTimeOffset ExpiresAt);

/// <summary>RFC 7807 body with our machine-readable <c>code</c> extension.</summary>
public sealed record Problem(int Status, string? Title, string? Detail, string Code);

/// <summary>Required JSON field names per contract, used to assert nothing is omitted or renamed.</summary>
public static class ContractFields
{
    public static readonly string[] ClassCreated = ["id", "name", "totalSeats"];
    public static readonly string[] ClassDetails = ["id", "name", "totalSeats", "heldSeats", "confirmedSeats", "availableSeats"];
    public static readonly string[] HoldCreated = ["holdId", "classId", "studentId", "status", "expiresAt"];
    public static readonly string[] HoldDetails = ["holdId", "classId", "status", "expiresAt"];
    public static readonly string[] HoldConfirmed = ["holdId", "status"];
    public static readonly string[] MyHold = ["holdId", "classId", "className", "status", "expiresAt"];
}
