using Microsoft.EntityFrameworkCore;
using SchoolAdmission.Api.Classes;
using SchoolAdmission.Api.Expiry;
using SchoolAdmission.Api.Holds;
using SchoolAdmission.Api.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// ---- Configuration (env vars, BRD §6) ----
var admissionOptions = AdmissionOptions.FromConfiguration(builder.Configuration);
builder.Services.AddSingleton(admissionOptions);

var connectionString = builder.Configuration.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(connectionString))
    throw new InvalidOperationException(
        "Database connection string is missing. Set the environment variable 'ConnectionStrings__Default'.");

// ---- Database ----
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(connectionString));

// ---- Features ----
builder.Services.AddScoped<ClassService>();
builder.Services.AddScoped<HoldService>();
builder.Services.AddScoped<ExpiredHoldReleaser>();
builder.Services.AddHostedService<ExpirySweeper>();

// Malformed JSON / wrong types must reach ApiExceptionHandler (friendly ProblemDetails) in every environment,
// not only in Development (default ThrowOnBadRequest = IsDevelopment()).
builder.Services.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);

// ---- Logging: structured JSON to console ----
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(o =>
{
    o.UseUtcTimestamp = true;
    o.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
});

// ---- Cross-cutting services ----
builder.Services.AddApiProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks().AddDbContextCheck<AppDbContext>("database");
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins([.. admissionOptions.CorsAllowedOrigins])
    .AllowAnyHeader()
    .AllowAnyMethod()));

var app = builder.Build();

await DatabaseMigrator.MigrateAsync(app.Services, app.Lifetime.ApplicationStopping);

// ---- Pipeline ----
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseCors();

app.MapOpenApi();
app.UseSwaggerUI(o => o.SwaggerEndpoint("/openapi/v1.json", "School Admission API v1"));
app.MapHealthChecks("/health");
app.MapClassEndpoints();
app.MapHoldEndpoints();

app.Run();

/// <summary>Exposed for WebApplicationFactory in integration tests.</summary>
public partial class Program;
