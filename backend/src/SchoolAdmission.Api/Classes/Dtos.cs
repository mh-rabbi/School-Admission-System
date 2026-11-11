namespace SchoolAdmission.Api.Classes;

/// <summary>POST /classes body. Fields are nullable so missing values produce a friendly 400, not a binding error.</summary>
public sealed record CreateClassRequest(string? Name, int? TotalSeats);

/// <summary>
/// BRD §7.2/7.3 class representation. Also returned by POST /classes (BRD §7.1 fields + extra stats, which the contract allows).
/// </summary>
public sealed record ClassResponse(
    string Id, string Name, int TotalSeats, int HeldSeats, int ConfirmedSeats, int AvailableSeats);
