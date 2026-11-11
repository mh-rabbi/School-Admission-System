using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

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
            _ => (StatusCodes.Status500InternalServerError, ErrorCodes.InternalError, "Unexpected error",
                "Something went wrong on our side. Please try again later."),
        };

        if (status >= 500)
            logger.LogError(exception, "Unhandled exception for {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);

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
