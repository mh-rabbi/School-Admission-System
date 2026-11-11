using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using SchoolAdmission.Api.Infrastructure.Configurations;
using SchoolAdmission.Api.Infrastructure.Entities;

namespace SchoolAdmission.Api.Infrastructure;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<SchoolClass> Classes => Set<SchoolClass>();
    public DbSet<Hold> Holds => Set<Hold>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfiguration(new SchoolClassConfiguration());
        modelBuilder.ApplyConfiguration(new HoldConfiguration());
    }
}

/// <summary>Used only by `dotnet ef` at design time; never connects.</summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time;Username=design;Password=design")
            .Options);
}
