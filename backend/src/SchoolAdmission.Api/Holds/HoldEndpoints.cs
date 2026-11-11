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

        var holds = app.MapGroup("/holds").WithTags("Holds");

        // BRD §7.5 — X-Student-Id optional (decision D9b)
        holds.MapGet("{holdId}", (
                string holdId,
                [FromHeader(Name = StudentIds.HeaderName)] string? studentId,
                HoldService service,
                CancellationToken ct) => service.GetAsync(holdId, studentId, ct))
            .WithName("GetHold")
            .Produces<HoldDetailsResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);

        // BRD §7.6 — idempotent
        holds.MapPost("{holdId}/confirm", (
                string holdId,
                [FromHeader(Name = StudentIds.HeaderName)] string? studentId,
                HoldService service,
                CancellationToken ct) => service.ConfirmAsync(holdId, studentId, ct))
            .WithName("ConfirmAdmission")
            .Produces<HoldConfirmedResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        return app;
    }
}
