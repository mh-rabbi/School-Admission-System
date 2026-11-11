namespace SchoolAdmission.Api.Tests.Infrastructure;

/// <summary>Generates unique test data so tests never collide on the shared database.</summary>
public static class TestData
{
    private static long _counter = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() % 1_000_000_000;

    /// <summary>A unique, valid 17-digit student registration number.</summary>
    public static string StudentId()
    {
        var n = Interlocked.Increment(ref _counter);
        return $"2026{n % 10_000_000_000_000:D13}";
    }

    /// <summary><paramref name="count"/> distinct valid student IDs.</summary>
    public static IReadOnlyList<string> StudentIds(int count) =>
        Enumerable.Range(0, count).Select(_ => StudentId()).ToList();

    /// <summary>A unique class name (≤ 100 chars): the prefix is truncated, never the unique suffix.</summary>
    public static string ClassName(string prefix = "Class") =>
        $"{prefix[..Math.Min(prefix.Length, 100 - 33)]} {Guid.NewGuid():N}";
}
