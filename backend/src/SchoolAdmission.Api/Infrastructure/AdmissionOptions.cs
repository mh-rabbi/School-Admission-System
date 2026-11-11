namespace SchoolAdmission.Api.Infrastructure;

/// <summary>
/// Application settings, read from flat environment variables (BRD §6).
/// Invalid values fail fast at startup.
/// </summary>
public sealed class AdmissionOptions
{
    public const string HoldDurationKey = "HOLD_DURATION_SECONDS";
    public const string SweepIntervalKey = "EXPIRY_SWEEP_INTERVAL_SECONDS";
    public const string CorsOriginsKey = "CORS_ALLOWED_ORIGINS";

    public int HoldDurationSeconds { get; init; } = 600;
    public int ExpirySweepIntervalSeconds { get; init; } = 5;
    public IReadOnlyList<string> CorsAllowedOrigins { get; init; } = ["http://localhost:5173"];

    public static AdmissionOptions FromConfiguration(IConfiguration config)
    {
        var defaults = new AdmissionOptions();
        return new AdmissionOptions
        {
            HoldDurationSeconds = ReadPositiveInt(config, HoldDurationKey, defaults.HoldDurationSeconds),
            ExpirySweepIntervalSeconds = ReadPositiveInt(config, SweepIntervalKey, defaults.ExpirySweepIntervalSeconds),
            CorsAllowedOrigins = ReadList(config, CorsOriginsKey) ?? defaults.CorsAllowedOrigins,
        };
    }

    private static int ReadPositiveInt(IConfiguration config, string key, int fallback)
    {
        var raw = config[key];
        if (string.IsNullOrWhiteSpace(raw)) return fallback;
        if (int.TryParse(raw, out var value) && value > 0) return value;
        throw new InvalidOperationException($"Configuration '{key}' must be a positive integer, got '{raw}'.");
    }

    private static string[]? ReadList(IConfiguration config, string key)
    {
        var raw = config[key];
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }
}
