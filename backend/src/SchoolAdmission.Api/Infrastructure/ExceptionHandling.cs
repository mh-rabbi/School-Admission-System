using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace SchoolAdmission.Api.Infrastructure;

/// <summary>
/// Converts every exception into a ProblemDetails body so clients never get an empty or HTML error (BRD §8).
/// </summary>
public sealed class ApiExceptionHandler(IProblemDetailsService problemDetailsService, ILogger<ApiExceptionHandler> logger)
    : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var (status, code, title, detail) = exception switch
        {
            ApiException api => (api.StatusCode, api.Code, api.Title, api.Message),
            BadHttpRequestException bad => (bad.StatusCode, ErrorCodes.ValidationFailed, "Invalid request",
                "The request is malformed. Please check the submitted data and try again."),
            // Last-line safety net: the DB rejected a write the application logic should already have prevented.
            PostgresException { SqlState: PostgresErrorCodes.CheckViolation, ConstraintName: "ck_classes_no_overbooking" } =>
                (StatusCodes.Status409Conflict, ErrorCodes.SeatsFull, "Conflict",
                    "Sorry, all seats in this class are currently taken. Please try again later or choose another class."),
            PostgresException { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: "ux_holds_active_student_class" } =>
                (StatusCodes.Status409Conflict, ErrorCodes.AlreadyApplied, "Conflict",
                    "You already have an active application for this class."),
            _ => (StatusCodes.Status500InternalServerError, ErrorCodes.InternalError, "Unexpected error",
                "Something went wrong on our side. Please try again later."),
        };

        if (status >= 500)
            logger.LogError(exception, "Unhandled exception for {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);
        else if (exception is PostgresException pg)
            logger.LogWarning("Database constraint {Constraint} rejected a write for {Method} {Path}",
                pg.ConstraintName, httpContext.Request.Method, httpContext.Request.Path);

        httpContext.Response.StatusCode = status;
        var problem = new ProblemDetails { Status = status, Title = title, Detail = detail };
        problem.Extensions["code"] = code;

        return await problemDetailsService.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            ProblemDetails = problem,
            Exception = exception,
        });
    }
}

public static class ProblemDetailsSetup
{
    public static IServiceCollection AddApiProblemDetails(this IServiceCollection services)
    {
        services.AddProblemDetails(options => options.CustomizeProblemDetails = ctx =>
        {
            var status = ctx.ProblemDetails.Status ?? ctx.HttpContext.Response.StatusCode;
            ctx.ProblemDetails.Extensions.TryAdd("code", ErrorCodes.FromStatus(status));
        });
        services.AddExceptionHandler<ApiExceptionHandler>();
        return services;
    }
}
