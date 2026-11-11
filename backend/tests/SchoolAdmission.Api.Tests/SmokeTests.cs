using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using SchoolAdmission.Api.Infrastructure;
using SchoolAdmission.Api.Tests.Infrastructure;

namespace SchoolAdmission.Api.Tests;

[Collection(DatabaseCollection.Name)]
public sealed class SmokeTests(PostgresFixture db) : IDisposable
{
    private readonly ApiFactory _factory = new(db.ConnectionString);

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task Health_endpoint_returns_200_when_database_is_reachable()
    {
        var response = await _factory.CreateClient().GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Unknown_route_returns_problem_details_with_code()
    {
        var response = await _factory.CreateClient().GetAsync("/does-not-exist");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        response.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("code").GetString().Should().Be(ErrorCodes.NotFound);
    }

    [Fact]
    public async Task OpenApi_document_is_served()
    {
        var response = await _factory.CreateClient().GetAsync("/openapi/v1.json");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}

public sealed class AdmissionOptionsTests
{
    private static IConfiguration Config(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value)))
            .Build();

    [Fact]
    public void Defaults_apply_when_env_vars_are_missing()
    {
        var options = AdmissionOptions.FromConfiguration(Config());

        options.HoldDurationSeconds.Should().Be(600);
        options.ExpirySweepIntervalSeconds.Should().Be(5);
        options.CorsAllowedOrigins.Should().Equal("http://localhost:5173");
    }

    [Fact]
    public void Env_vars_override_defaults()
    {
        var options = AdmissionOptions.FromConfiguration(Config(
            (AdmissionOptions.HoldDurationKey, "30"),
            (AdmissionOptions.SweepIntervalKey, "2"),
            (AdmissionOptions.CorsOriginsKey, "http://a.test, http://b.test")));

        options.HoldDurationSeconds.Should().Be(30);
        options.ExpirySweepIntervalSeconds.Should().Be(2);
        options.CorsAllowedOrigins.Should().Equal("http://a.test", "http://b.test");
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-5")]
    [InlineData("abc")]
    public void Invalid_hold_duration_fails_fast(string value)
    {
        var act = () => AdmissionOptions.FromConfiguration(Config((AdmissionOptions.HoldDurationKey, value)));

        act.Should().Throw<InvalidOperationException>();
    }
}
