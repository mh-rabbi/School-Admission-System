using System.Diagnostics.CodeAnalysis;

namespace SchoolAdmission.Api.Infrastructure;

/// <summary>
/// Public IDs are a type prefix + 32 hex chars of a UUID v7, e.g. "c_0193f2a4...". (decision D4)
/// Anything that does not parse is treated as "not found" by the endpoints.
/// </summary>
public static class PrefixedId
{
    public const string ClassPrefix = "c_";
    public const string HoldPrefix = "h_";

    public static Guid NewGuid() => Guid.CreateVersion7();

    public static string Format(string prefix, Guid id) => prefix + id.ToString("N");

    public static string Class(Guid id) => Format(ClassPrefix, id);
    public static string Hold(Guid id) => Format(HoldPrefix, id);

    public static bool TryParse(string prefix, string? value, [NotNullWhen(true)] out Guid? id)
    {
        id = null;
        if (value is null || value.Length != prefix.Length + 32 || !value.StartsWith(prefix, StringComparison.Ordinal))
            return false;
        if (!Guid.TryParseExact(value.AsSpan(prefix.Length), "N", out var guid))
            return false;
        id = guid;
        return true;
    }
}
