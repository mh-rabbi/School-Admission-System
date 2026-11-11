using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace SchoolAdmission.Api.Tests.Infrastructure;

public static class HttpExtensions
{
    public const string StudentHeader = "X-Student-Id";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // ---------- requests ----------

    public static Task<HttpResponseMessage> SendAsync(
        this HttpClient client, HttpMethod method, string path, string? studentId = null, object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        if (studentId is not null) request.Headers.Add(StudentHeader, studentId);
        if (body is not null) request.Content = JsonContent.Create(body, options: Json);
        return client.SendAsync(request);
    }

    public static Task<HttpResponseMessage> PostJsonAsync(this HttpClient client, string path, object? body = null, string? studentId = null) =>
        client.SendAsync(HttpMethod.Post, path, studentId, body);

    public static Task<HttpResponseMessage> GetAsStudentAsync(this HttpClient client, string path, string? studentId) =>
        client.SendAsync(HttpMethod.Get, path, studentId);

    public static Task<HttpResponseMessage> DeleteAsStudentAsync(this HttpClient client, string path, string? studentId) =>
        client.SendAsync(HttpMethod.Delete, path, studentId);

    // ---------- responses ----------

    /// <summary>Asserts the status code (showing the body on failure) and deserializes the JSON body.</summary>
    public static async Task<T> ShouldBeAsync<T>(this HttpResponseMessage response, HttpStatusCode expected)
    {
        await response.ShouldHaveStatusAsync(expected);
        var value = await response.Content.ReadFromJsonAsync<T>(Json);
        value.Should().NotBeNull();
        return value!;
    }

    public static async Task ShouldHaveStatusAsync(this HttpResponseMessage response, HttpStatusCode expected)
    {
        if (response.StatusCode != expected)
        {
            var body = await response.Content.ReadAsStringAsync();
            response.StatusCode.Should().Be(expected, $"response body was: {body}");
        }
    }

    /// <summary>Asserts a ProblemDetails error with the given status and machine-readable code.</summary>
    public static async Task<Problem> ShouldBeProblemAsync(this HttpResponseMessage response, HttpStatusCode expected, string code)
    {
        var problem = await response.ShouldBeAsync<Problem>(expected);
        response.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");
        problem.Code.Should().Be(code);
        problem.Detail.Should().NotBeNullOrWhiteSpace("errors must carry a user-friendly message");
        return problem;
    }

    /// <summary>Asserts the JSON object (or every element of a JSON array) contains all contract fields with exact names.</summary>
    public static async Task ShouldHaveContractFieldsAsync(this HttpResponseMessage response, IEnumerable<string> fields)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var objects = doc.RootElement.ValueKind == JsonValueKind.Array
            ? doc.RootElement.EnumerateArray().ToList()
            : [doc.RootElement];

        foreach (var obj in objects)
        foreach (var field in fields)
            obj.TryGetProperty(field, out _).Should().BeTrue($"contract field '{field}' must be present in {obj}");
    }
}
