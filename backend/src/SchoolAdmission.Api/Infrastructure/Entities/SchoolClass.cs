namespace SchoolAdmission.Api.Infrastructure.Entities;

/// <summary>
/// A class/shift with a fixed seat capacity (e.g. "Class 6 - Morning Shift").
/// <see cref="HeldSeats"/> and <see cref="ConfirmedSeats"/> are stored counters, maintained atomically
/// together with hold state transitions. The DB enforces HeldSeats + ConfirmedSeats &lt;= TotalSeats.
/// </summary>
public sealed class SchoolClass
{
    public Guid Id { get; set; }
    public required string Name { get; set; }

    /// <summary>DB-generated lower(name), carries the case-insensitive unique index.</summary>
    public string NameNormalized { get; private set; } = null!;

    public int TotalSeats { get; set; }
    public int HeldSeats { get; set; }
    public int ConfirmedSeats { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public List<Hold> Holds { get; } = [];
}
