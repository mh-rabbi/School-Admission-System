using System.Net;
using System.Text;
using SchoolAdmission.Api.Infrastructure;
using SchoolAdmission.Api.Tests.Infrastructure;

namespace SchoolAdmission.Api.Tests;

[Collection(DatabaseCollection.Name)]
public sealed class ClassEndpointsTests(PostgresFixture fixture)
{
    private readonly HttpClient _client = fixture.Api.CreateClient();

    private async Task<ClassDetails> CreateClassAsync(string? name = null, int totalSeats = 120)
    {
        var response = await _client.PostJsonAsync("/classes", new { name = name ?? TestData.ClassName(), totalSeats });
        return await response.ShouldBeAsync<ClassDetails>(HttpStatusCode.Created);
    }

    // ---------- POST /classes ----------

    [Fact]
    public async Task Create_returns_201_with_contract_fields_and_location()
    {
        var name = TestData.ClassName("Class 6 - Morning Shift");

        var response = await _client.PostJsonAsync("/classes", new { name, totalSeats = 120 });

        var created = await response.ShouldBeAsync<ClassCreated>(HttpStatusCode.Created);
        await response.ShouldHaveContractFieldsAsync(ContractFields.ClassCreated);
        created.Id.Should().StartWith("c_");
        created.Name.Should().Be(name);
        created.TotalSeats.Should().Be(120);
        response.Headers.Location!.ToString().Should().Be($"/classes/{created.Id}");
    }

    [Fact]
    public async Task Create_trims_the_name()
    {
        var name = TestData.ClassName();

        var created = await CreateClassAsync($"   {name}  ");

        created.Name.Should().Be(name);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(10_000)]
    public async Task Create_accepts_seat_boundaries(int seats)
    {
        var created = await CreateClassAsync(totalSeats: seats);

        created.TotalSeats.Should().Be(seats);
        created.AvailableSeats.Should().Be(seats);
    }

    [Fact]
    public async Task Create_accepts_name_of_exactly_100_characters()
    {
        var name = TestData.ClassName().PadRight(100, 'x');

        var created = await CreateClassAsync(name);

        created.Name.Should().HaveLength(100);
    }

    public static TheoryData<string, object> InvalidBodies => new()
    {
        { "missing name", new { totalSeats = 10 } },
        { "empty name", new { name = "", totalSeats = 10 } },
        { "whitespace name", new { name = "   ", totalSeats = 10 } },
        { "name too long", new { name = new string('a', 101), totalSeats = 10 } },
        { "missing seats", new { name = "Valid name" } },
        { "zero seats", new { name = "Valid name", totalSeats = 0 } },
        { "negative seats", new { name = "Valid name", totalSeats = -1 } },
        { "too many seats", new { name = "Valid name", totalSeats = 10_001 } },
    };

    [Theory]
    [MemberData(nameof(InvalidBodies))]
    public async Task Create_rejects_invalid_input_with_400(string because, object body)
    {
        var response = await _client.PostJsonAsync("/classes", body);

        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, ErrorCodes.ValidationFailed);
        problem.Detail.Should().NotBeNullOrEmpty(because);
    }

    [Theory]
    [InlineData("""{ "name": "X", "totalSeats": "abc" }""")]
    [InlineData("""{ "name": "X", "totalSeats": 12.5 }""")]
    [InlineData("""{ "name": "X", "totalSeats": 99999999999 }""")]
    [InlineData("""{ "name": 123, "totalSeats": 10 }""")]
    [InlineData("""{ not json""")]
    [InlineData("")]
    public async Task Create_rejects_malformed_json_with_400(string json)
    {
        var response = await _client.PostAsync("/classes", new StringContent(json, Encoding.UTF8, "application/json"));

        await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, ErrorCodes.ValidationFailed);
    }

    [Fact]
    public async Task Create_rejects_duplicate_name_case_insensitively_with_409()
    {
        var name = TestData.ClassName("Class 7 - Day Shift");
        await CreateClassAsync(name);

        var response = await _client.PostJsonAsync("/classes", new { name = $" {name.ToUpperInvariant()} ", totalSeats = 5 });

        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, ErrorCodes.DuplicateClassName);
    }

    [Fact]
    public async Task Concurrent_creates_with_same_name_produce_exactly_one_class()
    {
        var name = TestData.ClassName("Race");

        var responses = await Task.WhenAll(Enumerable.Range(0, 20)
            .Select(i => _client.PostJsonAsync("/classes", new { name = i % 2 == 0 ? name : name.ToUpperInvariant(), totalSeats = 5 })));

        responses.Count(r => r.StatusCode == HttpStatusCode.Created).Should().Be(1);
        responses.Count(r => r.StatusCode == HttpStatusCode.Conflict).Should().Be(19);
    }

    // ---------- GET /classes/{id} ----------

    [Fact]
    public async Task Get_returns_new_class_with_all_seats_available()
    {
        var created = await CreateClassAsync(totalSeats: 40);

        var response = await _client.GetAsync($"/classes/{created.Id}");

        var details = await response.ShouldBeAsync<ClassDetails>(HttpStatusCode.OK);
        await response.ShouldHaveContractFieldsAsync(ContractFields.ClassDetails);
        details.Should().BeEquivalentTo(new ClassDetails(created.Id, created.Name, 40, 0, 0, 40));
    }

    [Theory]
    [InlineData("c_00000000000070008000000000000000")] // well-formed, does not exist
    [InlineData("c_123")]                              // malformed
    [InlineData("h_0193f2a4c0de7a1b8c9d0e1f2a3b4c5d")] // wrong prefix
    [InlineData("not-an-id")]
    public async Task Get_unknown_or_malformed_id_returns_404(string id)
    {
        var response = await _client.GetAsync($"/classes/{id}");

        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, ErrorCodes.NotFound);
    }

    [Fact]
    public async Task Stats_count_held_and_confirmed_and_exclude_expired_but_unswept_holds()
    {
        var created = await CreateClassAsync(totalSeats: 10);
        PrefixedId.TryParse(PrefixedId.ClassPrefix, created.Id, out var classId).Should().BeTrue();

        // 2 active holds, 1 hold already past expiry (sweeper has not run yet), 3 confirmed.
        // Counters reflect the stored state: held_seats = 3, confirmed_seats = 3.
        await InsertHoldAsync(classId!.Value, "HELD", "now() + interval '5 minutes'");
        await InsertHoldAsync(classId.Value, "HELD", "now() + interval '5 minutes'");
        await InsertHoldAsync(classId.Value, "HELD", "now() - interval '1 second'");
        for (var i = 0; i < 3; i++)
            await InsertHoldAsync(classId.Value, "CONFIRMED", "now() - interval '1 minute'");
        await fixture.Db.ExecuteAsync("UPDATE classes SET held_seats = 3, confirmed_seats = 3 WHERE id = @id", ("id", classId.Value));
        await fixture.Db.AssertConsistentAsync(classId.Value);

        var details = await (await _client.GetAsync($"/classes/{created.Id}")).ShouldBeAsync<ClassDetails>(HttpStatusCode.OK);

        details.HeldSeats.Should().Be(2, "the expired hold no longer occupies a seat");
        details.ConfirmedSeats.Should().Be(3);
        details.AvailableSeats.Should().Be(5);
    }

    // ---------- GET /classes ----------

    [Fact]
    public async Task List_returns_all_classes_with_contract_fields_in_creation_order()
    {
        var first = await CreateClassAsync(totalSeats: 11);
        var second = await CreateClassAsync(totalSeats: 22);

        var response = await _client.GetAsync("/classes");

        var list = await response.ShouldBeAsync<List<ClassDetails>>(HttpStatusCode.OK);
        await response.ShouldHaveContractFieldsAsync(ContractFields.ClassDetails);
        list.Should().ContainEquivalentOf(new ClassDetails(first.Id, first.Name, 11, 0, 0, 11));
        list.Should().ContainEquivalentOf(new ClassDetails(second.Id, second.Name, 22, 0, 0, 22));
        list.FindIndex(c => c.Id == first.Id).Should().BeLessThan(list.FindIndex(c => c.Id == second.Id));
    }

    private Task InsertHoldAsync(Guid classId, string status, string expiresAtSql) =>
        fixture.Db.ExecuteAsync(
            $"INSERT INTO holds (id, class_id, student_id, status, expires_at) VALUES (@id, @c, @s, @st, {expiresAtSql})",
            ("id", Guid.CreateVersion7()), ("c", classId), ("s", TestData.StudentId()), ("st", status));
}
