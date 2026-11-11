namespace SchoolAdmission.Api.Infrastructure.Entities;

/// <summary>A student's application for a seat in a class.</summary>
public sealed class Hold
{
    public Guid Id { get; set; }
    public Guid ClassId { get; set; }
    public SchoolClass? Class { get; set; }

    /// <summary>17-digit student registration number (X-Student-Id).</summary>
    public required string StudentId { get; set; }

    /// <summary>One of <see cref="HoldStatus"/>.</summary>
    public required string Status { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? ConfirmedAt { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
}

/// <summary>Hold status values exactly as exposed by the API (BRD §7.5).</summary>
public static class HoldStatus
{
    public const string Held = "HELD";
    public const string Confirmed = "CONFIRMED";
    public const string Expired = "EXPIRED";
    public const string Cancelled = "CANCELLED";

    public static readonly IReadOnlyList<string> All = [Held, Confirmed, Expired, Cancelled];
}
