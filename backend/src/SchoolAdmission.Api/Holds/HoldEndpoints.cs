using Microsoft.AspNetCore.Mvc;
using SchoolAdmission.Api.Infrastructure;

namespace SchoolAdmission.Api.Holds;

public static class HoldEndpoints
{
    public static IEndpointRouteBuilder MapHoldEndpoints(this IEndpointRouteBuilder app)
    {
        // BRD §7.4
        app.MapPost("/classes/{classId}/holds", async (
                string classId,
                [FromHeader(Name = StudentIds.HeaderName)] string? studentId,
                HoldService service,
                CancellationToken ct) =>
            {
                var hold = await service.ApplyAsync(classId, studentId, ct);
                return Results.Created($"/holds/{hold.HoldId}", hold);
            })
            .WithTags("Holds")
            .WithName("ApplyForSeat")
            .Produces<HoldCreatedResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        return app;
    }
}
