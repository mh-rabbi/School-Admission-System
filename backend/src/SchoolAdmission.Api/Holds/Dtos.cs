namespace SchoolAdmission.Api.Holds;

/// <summary>BRD §7.4 response. ExpiresAt is a UTC DateTime so it serializes with a trailing "Z".</summary>
public sealed record HoldCreatedResponse(string HoldId, string ClassId, string StudentId, string Status, DateTime ExpiresAt);
