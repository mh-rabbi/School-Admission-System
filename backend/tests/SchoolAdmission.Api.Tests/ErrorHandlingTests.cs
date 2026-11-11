using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Http;
using Npgsql;
using SchoolAdmission.Api.Infrastructure;
using SchoolAdmission.Api.Tests.Infrastructure;

namespace SchoolAdmission.Api.Tests;

/// <summary>Unit tests of the exception → problem mapping (BRD §8).</summary>
public sealed class ProblemMapperTests
{
    private static PostgresException Pg(string sqlState, string? constraint = null) =>
        new("server error", "ERROR", "ERROR", sqlState, constraintName: constraint);

    public static TheoryData<string, Exception, int, string> Cases => new()
    {
        { "api exception passes through", ApiException.Conflict(ErrorCodes.SeatsFull, "full"), 409, ErrorCodes.SeatsFull },
        { "bad request", new BadHttpRequestException("x", 400), 400, ErrorCodes.ValidationFailed },
        { "payload too large", new BadHttpRequestException("x", 413), 413, ErrorCodes.PayloadTooLarge },
        { "unsupported media type", new BadHttpRequestException("x", 415), 415, ErrorCodes.UnsupportedMediaType },
        { "overbooking backstop", Pg(PostgresErrorCodes.CheckViolation, "ck_classes_no_overbooking"), 409, ErrorCodes.SeatsFull },
        { "duplicate application backstop", Pg(PostgresErrorCodes.UniqueViolation, "ux_holds_active_student_class"), 409, ErrorCodes.AlreadyApplied },
        { "other check violation is a bug", Pg(PostgresErrorCodes.CheckViolation, "ck_classes_held_seats_non_negative"), 500, ErrorCodes.InternalError },
        { "other SQL error is a bug", Pg(PostgresErrorCodes.SyntaxError), 500, ErrorCodes.InternalError },
        { "network failure", new NpgsqlException("connect failed", new SocketException()), 503, ErrorCodes.ServiceUnavailable },
        { "wrapped network failure", new InvalidOperationException("ef", new NpgsqlException("io")), 503, ErrorCodes.ServiceUnavailable },
        { "too many connections", Pg(PostgresErrorCodes.TooManyConnections), 503, ErrorCodes.ServiceUnavailable },
        { "admin shutdown", Pg(PostgresErrorCodes.AdminShutdown), 503, ErrorCodes.ServiceUnavailable },
        { "connection failure", Pg(PostgresErrorCodes.ConnectionFailure), 503, ErrorCodes.ServiceUnavailable },
        { "database dropped", Pg(PostgresErrorCodes.InvalidCatalogName), 503, ErrorCodes.ServiceUnavailable },
        { "timeout", new TimeoutException(), 503, ErrorCodes.ServiceUnavailable },
        { "unknown bug", new NullReferenceException("secret internals"), 500, ErrorCodes.InternalError },
    };

    [Theory]
    [MemberData(nameof(Cases))]
    public void Maps_exceptions_to_status_and_code(string because, Exception exception, int status, string code)
    {
        var info = ProblemMapper.Map(exception);

        info.Status.Should().Be(status, because);
        info.Code.Should().Be(code, because);
        info.Detail.Should().NotBeNullOrWhiteSpace(because);
    }

    [Fact]
    public void Internal_details_never_leak_into_the_message()
    {
        var info = ProblemMapper.Map(new InvalidOperationException("Npgsql connection string Password=hunter2"));

        info.Detail.Should().NotContain("hunter2").And.NotContain("Npgsql");
        info.Severity.Should().Be(ProblemSeverity.Error);
    }

    [Fact]
    public void Expected_outcomes_are_not_logged_as_errors()
    {
        ProblemMapper.Map(ApiException.NotFound("x")).Severity.Should().Be(ProblemSeverity.Expected);
        ProblemMapper.Map(new TimeoutException()).Severity.Should().Be(ProblemSeverity.Warning);
    }
}

/// <summary>Error responses produced end-to-end by the real pipeline.</summary>
[Collection(DatabaseCollection.Name)]
public sealed class ErrorResponseTests(PostgresFixture fixture)
{
    private readonly HttpClient _client = fixture.Api.CreateClient();

    [Theory]
    [InlineData("PUT", "/classes")]
    [InlineData("DELETE", "/classes")]
    [InlineData("PATCH", "/holds/h_00000000000070008000000000000000")]
    [InlineData("PUT", "/me/holds")]
    public async Task Wrong_method_returns_405_problem(string method, string path)
    {
        var response = await _client.SendAsync(new HttpMethod(method), path, TestData.StudentId());

        await response.ShouldBeProblemAsync(HttpStatusCode.MethodNotAllowed, ErrorCodes.MethodNotAllowed);
    }

    [Fact]
    public async Task Unknown_route_returns_404_problem_with_detail()
    {
        var response = await _client.GetAsync("/no/such/route");

        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, ErrorCodes.NotFound);
    }

    [Fact]
    public async Task Non_json_content_type_returns_415_problem()
    {
        var response = await _client.PostAsync("/classes", new StringContent("name=x&totalSeats=5", Encoding.UTF8, "application/x-www-form-urlencoded"));

        await response.ShouldBeProblemAsync(HttpStatusCode.UnsupportedMediaType, ErrorCodes.UnsupportedMediaType);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"text\"")]
    public async Task Non_object_json_body_returns_400_problem(string json)
    {
        var response = await _client.PostAsync("/classes", new StringContent(json, Encoding.UTF8, "application/json"));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, ErrorCodes.ValidationFailed);
    }
}

/// <summary>"Server down" (BRD §8): a dedicated host on its own database, which is then dropped.</summary>
[Collection(DatabaseCollection.Name)]
public sealed class DatabaseOutageTests(PostgresFixture fixture) : IAsyncLifetime
{
    private readonly string _database = $"outage_{Guid.NewGuid():N}";
    private ApiFactory _api = null!;
    private string _classId = null!;
    private string _holdId = null!;
    private readonly string _student = TestData.StudentId();

    public async Task InitializeAsync()
    {
        await AdminAsync($"CREATE DATABASE \"{_database}\"");
        var connectionString = new NpgsqlConnectionStringBuilder(fixture.ConnectionString) { Database = _database }.ConnectionString;
        _api = new ApiFactory(connectionString);
        var client = _api.CreateClient();

        // Healthy first: real data exists.
        var created = await (await client.PostJsonAsync("/classes", new { name = "Outage class", totalSeats = 3 }))
            .ShouldBeAsync<ClassDetails>(HttpStatusCode.Created);
        _classId = created.Id;
        _holdId = (await (await client.PostJsonAsync($"/classes/{_classId}/holds", studentId: _student))
            .ShouldBeAsync<HoldCreated>(HttpStatusCode.Created)).HoldId;

        // Simulate the database disappearing underneath the running API.
        await AdminAsync($"DROP DATABASE \"{_database}\" WITH (FORCE)");
    }

    public async Task DisposeAsync() => await _api.DisposeAsync();

    private async Task AdminAsync(string sql)
    {
        await using var conn = await fixture.Db.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync();
    }

    [Fact]
    public async Task Every_endpoint_answers_503_with_a_friendly_problem_when_the_database_is_gone()
    {
        var client = _api.CreateClient();
        var calls = new (string Name, Func<Task<HttpResponseMessage>> Call)[]
        {
            ("list classes", () => client.GetAsync("/classes")),
            ("get class", () => client.GetAsync($"/classes/{_classId}")),
            ("create class", () => client.PostJsonAsync("/classes", new { name = "x", totalSeats = 1 })),
            ("apply", () => client.PostJsonAsync($"/classes/{_classId}/holds", studentId: TestData.StudentId())),
            ("get hold", () => client.GetAsync($"/holds/{_holdId}")),
            ("confirm", () => client.PostJsonAsync($"/holds/{_holdId}/confirm", studentId: _student)),
            ("cancel", () => client.DeleteAsStudentAsync($"/holds/{_holdId}", _student)),
            ("my holds", () => client.GetAsStudentAsync("/me/holds", _student)),
        };

        foreach (var (name, call) in calls)
        {
            var problem = await (await call()).ShouldBeProblemAsync(HttpStatusCode.ServiceUnavailable, ErrorCodes.ServiceUnavailable);
            problem.Detail.Should().Be(ProblemMapper.UnavailableDetail, name);
        }
    }

    [Fact]
    public async Task Health_endpoint_reports_503_when_the_database_is_gone()
    {
        var response = await _api.CreateClient().GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
    }
}
