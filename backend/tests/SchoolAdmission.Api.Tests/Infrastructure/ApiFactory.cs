using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace SchoolAdmission.Api.Tests.Infrastructure;

/// <summary>
/// Hosts the real API in-memory against the test Postgres container.
/// Settings are passed with UseSetting so they are visible while Program.cs builds the host.
/// The background expiry sweeper is effectively disabled by default (1 h interval) so tests that
/// arrange data with direct SQL are deterministic; expiry tests opt in with a short interval.
/// </summary>
public sealed class ApiFactory(string connectionString, IReadOnlyDictionary<string, string>? settings = null)
    : WebApplicationFactory<Program>
{
    public static readonly IReadOnlyDictionary<string, string> Defaults = new Dictionary<string, string>
    {
        ["EXPIRY_SWEEP_INTERVAL_SECONDS"] = "3600",
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Default", connectionString);
        foreach (var (key, value) in Defaults)
            builder.UseSetting(key, value);
        foreach (var (key, value) in settings ?? new Dictionary<string, string>())
            builder.UseSetting(key, value);
    }
}
