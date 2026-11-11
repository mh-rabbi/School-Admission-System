using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SchoolAdmission.Api.Infrastructure.Entities;

namespace SchoolAdmission.Api.Infrastructure.Configurations;

public sealed class SchoolClassConfiguration : IEntityTypeConfiguration<SchoolClass>
{
    public const int NameMaxLength = 100;
    public const int MinSeats = 1;
    public const int MaxSeats = 10_000;

    public void Configure(EntityTypeBuilder<SchoolClass> b)
    {
        b.ToTable("classes", t =>
        {
            // BRD §5: held + confirmed must never exceed total — enforced by the database itself.
            t.HasCheckConstraint("ck_classes_no_overbooking", "held_seats + confirmed_seats <= total_seats");
            t.HasCheckConstraint("ck_classes_total_seats_range", $"total_seats BETWEEN {MinSeats} AND {MaxSeats}");
            t.HasCheckConstraint("ck_classes_held_seats_non_negative", "held_seats >= 0");
            t.HasCheckConstraint("ck_classes_confirmed_seats_non_negative", "confirmed_seats >= 0");
        });

        b.HasKey(c => c.Id).HasName("pk_classes");
        b.Property(c => c.Id).HasColumnName("id").ValueGeneratedNever();
        b.Property(c => c.Name).HasColumnName("name").HasMaxLength(NameMaxLength).IsRequired();
        b.Property(c => c.NameNormalized).HasColumnName("name_normalized")
            .HasMaxLength(NameMaxLength)
            .HasComputedColumnSql("lower(name)", stored: true);
        b.Property(c => c.TotalSeats).HasColumnName("total_seats");
        b.Property(c => c.HeldSeats).HasColumnName("held_seats").HasDefaultValue(0);
        b.Property(c => c.ConfirmedSeats).HasColumnName("confirmed_seats").HasDefaultValue(0);
        b.Property(c => c.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");

        b.HasIndex(c => c.NameNormalized).IsUnique().HasDatabaseName("ux_classes_name_normalized");
        b.HasIndex(c => c.CreatedAt).HasDatabaseName("ix_classes_created_at");
    }
}
