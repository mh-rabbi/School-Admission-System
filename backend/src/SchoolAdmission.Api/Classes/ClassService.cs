using Microsoft.EntityFrameworkCore;
using SchoolAdmission.Api.Infrastructure;
using SchoolAdmission.Api.Infrastructure.Configurations;

namespace SchoolAdmission.Api.Classes;

public sealed class ClassService(AppDbContext db)
{
    /// <summary>Row shape for the stats query (column aliases match property names).</summary>
    private sealed record ClassStatsRow(Guid Id, string Name, int TotalSeats, int HeldSeats, int ConfirmedSeats);

    // heldSeats excludes holds that are past expires_at but not yet swept (DB clock), so stats are exact
    // to the second without the read path writing anything (architecture §4.4).
    private const string StatsSelect = """
        SELECT c.id              AS "Id",
               c.name            AS "Name",
               c.total_seats     AS "TotalSeats",
               c.held_seats - (SELECT count(*)::int FROM holds h
                               WHERE h.class_id = c.id AND h.status = 'HELD' AND h.expires_at <= now())
                                 AS "HeldSeats",
               c.confirmed_seats AS "ConfirmedSeats"
        FROM classes c
        """;

    public async Task<ClassResponse> CreateAsync(CreateClassRequest request, CancellationToken ct)
    {
        var (name, totalSeats) = Validate(request);
        var id = PrefixedId.NewGuid();

        // ON CONFLICT on the case-insensitive unique index: a duplicate is an expected business outcome (409),
        // so it is detected as "0 rows inserted" instead of a unique-violation exception that EF logs as an error.
        var inserted = await db.Database.ExecuteSqlAsync($"""
            INSERT INTO classes (id, name, total_seats)
            VALUES ({id}, {name}, {totalSeats})
            ON CONFLICT (name_normalized) DO NOTHING
            """, ct);

        if (inserted == 0)
            throw ApiException.Conflict(ErrorCodes.DuplicateClassName,
                $"A class named '{name}' already exists. Please choose a different name.");

        return new ClassResponse(PrefixedId.Class(id), name, totalSeats, 0, 0, totalSeats);
    }

    public async Task<IReadOnlyList<ClassResponse>> ListAsync(CancellationToken ct)
    {
        var rows = await db.Database
            .SqlQueryRaw<ClassStatsRow>(StatsSelect + " ORDER BY c.created_at, c.id")
            .ToListAsync(ct);
        return rows.Select(ToResponse).ToList();
    }

    public async Task<ClassResponse> GetAsync(string classId, CancellationToken ct)
    {
        if (!PrefixedId.TryParse(PrefixedId.ClassPrefix, classId, out var id))
            throw ClassNotFound();

        var row = await db.Database
            .SqlQueryRaw<ClassStatsRow>(StatsSelect + " WHERE c.id = {0}", id.Value)
            .SingleOrDefaultAsync(ct);
        return row is null ? throw ClassNotFound() : ToResponse(row);
    }

    public static ApiException ClassNotFound() => ApiException.NotFound("The requested class does not exist.");

    private static ClassResponse ToResponse(ClassStatsRow r) => new(
        PrefixedId.Class(r.Id), r.Name, r.TotalSeats, r.HeldSeats, r.ConfirmedSeats,
        Math.Max(0, r.TotalSeats - r.HeldSeats - r.ConfirmedSeats));

    private static (string Name, int TotalSeats) Validate(CreateClassRequest request)
    {
        var name = request.Name?.Trim();
        if (string.IsNullOrEmpty(name))
            throw Invalid("Class name is required.");
        if (name.Length > SchoolClassConfiguration.NameMaxLength)
            throw Invalid($"Class name must be at most {SchoolClassConfiguration.NameMaxLength} characters.");

        if (request.TotalSeats is not { } seats)
            throw Invalid("Total seats is required.");
        if (seats is < SchoolClassConfiguration.MinSeats or > SchoolClassConfiguration.MaxSeats)
            throw Invalid($"Total seats must be between {SchoolClassConfiguration.MinSeats} and {SchoolClassConfiguration.MaxSeats:N0}.");

        return (name, seats);
    }

    private static ApiException Invalid(string detail) => ApiException.BadRequest(ErrorCodes.ValidationFailed, detail);
}
