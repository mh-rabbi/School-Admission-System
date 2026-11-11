namespace SchoolAdmission.Api.Holds;

/// <summary>BRD §7.4 response. ExpiresAt is a UTC DateTime so it serializes with a trailing "Z".</summary>
public sealed record HoldCreatedResponse(string HoldId, string ClassId, string StudentId, string Status, DateTime ExpiresAt);

/// <summary>BRD §7.5 response. studentId is intentionally not exposed (the header is optional on this endpoint).</summary>
public sealed record HoldDetailsResponse(string HoldId, string ClassId, string Status, DateTime ExpiresAt);

/// <summary>BRD §7.8 list item.</summary>
public sealed record MyHoldResponse(string HoldId, string ClassId, string ClassName, string Status, DateTime ExpiresAt);

/// <summary>BRD §7.6 response.</summary>
public sealed record HoldConfirmedResponse(string HoldId, string Status);
