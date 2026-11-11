using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace SchoolAdmission.Api.Tests.Infrastructure;

/// <summary>
/// Hosts the real API in-memory against the test Postgres container.
/// Settings are passed with UseSetting so they are visible while Program.cs builds the host.
/// </summary>
public sealed class ApiFactory(string connectionString, IReadOnlyDictionary<string, string>? settings = null)
    : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Default", connectionString);
        foreach (var (key, value) in settings ?? new Dictionary<string, string>())
            builder.UseSetting(key, value);
    }
}
