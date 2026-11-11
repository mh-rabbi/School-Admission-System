using Npgsql;
using Testcontainers.PostgreSql;

namespace SchoolAdmission.Api.Tests.Infrastructure;

/// <summary>
/// One real PostgreSQL 16 container and one shared API host for every test in the "Database" collection.
/// Tests isolate themselves with unique data (fresh classes + student IDs) rather than resetting the DB,
/// so the global invariant checks also see everything previous tests did.
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("school_admission_tests")
        .WithUsername("test")
        .WithPassword("test")
        .Build();

    private ApiFactory? _api;

    public string ConnectionString => _container.GetConnectionString();

    /// <summary>Shared API host with default settings (started once; applies migrations).</summary>
    public ApiFactory Api => _api ?? throw new InvalidOperationException("Fixture not initialized.");

    /// <summary>Direct SQL access for assertions that must not go through the API.</summary>
    public DbInspector Db { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _api = new ApiFactory(ConnectionString);
        _ = _api.Server; // start host → migrations applied
        Db = new DbInspector(ConnectionString);
    }

    public async Task DisposeAsync()
    {
        if (_api is not null) await _api.DisposeAsync();
        await _container.DisposeAsync();
    }

    /// <summary>
    /// Additional API host on the same database (custom settings, or a second "instance" for multi-process tests).
    /// Caller owns disposal.
    /// </summary>
    public ApiFactory CreateApi(IReadOnlyDictionary<string, string>? settings = null)
    {
        var factory = new ApiFactory(ConnectionString, settings);
        _ = factory.Server;
        return factory;
    }

    /// <summary>Wipes all data. Only for tests that need an empty database; most tests should not need it.</summary>
    public async Task ResetAsync()
    {
        await using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("TRUNCATE holds, classes", conn);
        await cmd.ExecuteNonQueryAsync();
    }
}

[CollectionDefinition(Name)]
public sealed class DatabaseCollection : ICollectionFixture<PostgresFixture>
{
    public const string Name = "Database";
}
