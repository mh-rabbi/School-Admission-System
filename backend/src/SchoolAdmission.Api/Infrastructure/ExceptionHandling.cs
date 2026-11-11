using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace SchoolAdmission.Api.Infrastructure;

/// <summary>
/// Converts every exception into a ProblemDetails body so clients never get an empty or HTML error (BRD §8).
/// The mapping itself lives in <see cref="ProblemMapper"/>.
/// </summary>
public sealed class ApiExceptionHandler(IProblemDetailsService problemDetailsService, ILogger<ApiExceptionHandler> logger)
    : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var request = httpContext.Request;

        // Client went away (closed tab, timeout on their side): nothing to answer and not a server error.
        if (exception is OperationCanceledException && httpContext.RequestAborted.IsCancellationRequested)
        {
            logger.LogDebug("Request aborted by client: {Method} {Path}", request.Method, request.Path);
            return true;
        }

        var info = ProblemMapper.Map(exception);
        switch (info.Severity)
        {
            case ProblemSeverity.Error:
                logger.LogError(exception, "Unhandled exception for {Method} {Path}", request.Method, request.Path);
                break;
            case ProblemSeverity.Warning:
                logger.LogWarning("{Code} for {Method} {Path}: {Message}", info.Code, request.Method, request.Path, exception.Message);
                break;
        }

        httpContext.Response.StatusCode = info.Status;
        var problem = new ProblemDetails { Status = info.Status, Title = info.Title, Detail = info.Detail };
        problem.Extensions["code"] = info.Code;

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
        // Also applies to bodies produced by status-code pages (unknown route 404, wrong method 405, …):
        // guarantee a machine-readable code and a human-readable detail on every error.
        services.AddProblemDetails(options => options.CustomizeProblemDetails = ctx =>
        {
            var status = ctx.ProblemDetails.Status ?? ctx.HttpContext.Response.StatusCode;
            ctx.ProblemDetails.Extensions.TryAdd("code", ErrorCodes.FromStatus(status));
            ctx.ProblemDetails.Detail ??= DefaultDetail(status);
        });
        services.AddExceptionHandler<ApiExceptionHandler>();
        return services;
    }

    private static string DefaultDetail(int status) => status switch
    {
        StatusCodes.Status404NotFound => "The requested resource was not found.",
        StatusCodes.Status405MethodNotAllowed => "This operation is not supported for this address.",
        StatusCodes.Status400BadRequest => "The request is invalid. Please check the submitted data and try again.",
        StatusCodes.Status503ServiceUnavailable => ProblemMapper.UnavailableDetail,
        >= 500 => ProblemMapper.InternalDetail,
        _ => "The request could not be completed.",
    };
}
