namespace SchoolAdmission.Api.Classes;

public static class ClassEndpoints
{
    public static IEndpointRouteBuilder MapClassEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/classes").WithTags("Classes");

        // BRD §7.1
        group.MapPost("", async (CreateClassRequest request, ClassService service, CancellationToken ct) =>
            {
                var created = await service.CreateAsync(request, ct);
                return Results.Created($"/classes/{created.Id}", created);
            })
            .WithName("CreateClass")
            .Produces<ClassResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);

        // BRD §7.2
        group.MapGet("", (ClassService service, CancellationToken ct) => service.ListAsync(ct))
            .WithName("ListClasses")
            .Produces<IReadOnlyList<ClassResponse>>();

        // BRD §7.3
        group.MapGet("{classId}", (string classId, ClassService service, CancellationToken ct) => service.GetAsync(classId, ct))
            .WithName("GetClass")
            .Produces<ClassResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        return app;
    }
}
