using SchoolAdmission.Api.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// ---- Configuration (env vars, BRD §6) ----
var admissionOptions = AdmissionOptions.FromConfiguration(builder.Configuration);
builder.Services.AddSingleton(admissionOptions);

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
builder.Services.AddHealthChecks();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins([.. admissionOptions.CorsAllowedOrigins])
    .AllowAnyHeader()
    .AllowAnyMethod()));

var app = builder.Build();

// ---- Pipeline ----
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseCors();

app.MapOpenApi();
app.UseSwaggerUI(o => o.SwaggerEndpoint("/openapi/v1.json", "School Admission API v1"));
app.MapHealthChecks("/health");

app.Run();

/// <summary>Exposed for WebApplicationFactory in integration tests.</summary>
public partial class Program;
