using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SchoolAdmission.Api.Infrastructure.Entities;

namespace SchoolAdmission.Api.Infrastructure.Configurations;

public sealed class HoldConfiguration : IEntityTypeConfiguration<Hold>
{
    public const int StudentIdLength = 17;

    public void Configure(EntityTypeBuilder<Hold> b)
    {
        b.ToTable("holds", t =>
        {
            t.HasCheckConstraint("ck_holds_status",
                $"status IN ({string.Join(", ", HoldStatus.All.Select(s => $"'{s}'"))})");
            t.HasCheckConstraint("ck_holds_student_id_format", "student_id ~ '^[0-9]{17}$'");
        });

        b.HasKey(h => h.Id).HasName("pk_holds");
        b.Property(h => h.Id).HasColumnName("id").ValueGeneratedNever();
        b.Property(h => h.ClassId).HasColumnName("class_id");
        b.Property(h => h.StudentId).HasColumnName("student_id").HasMaxLength(StudentIdLength).IsRequired();
        b.Property(h => h.Status).HasColumnName("status").HasMaxLength(16).IsRequired();
        b.Property(h => h.ExpiresAt).HasColumnName("expires_at");
        b.Property(h => h.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
        b.Property(h => h.UpdatedAt).HasColumnName("updated_at").HasDefaultValueSql("now()");
        b.Property(h => h.ConfirmedAt).HasColumnName("confirmed_at");
        b.Property(h => h.CancelledAt).HasColumnName("cancelled_at");

        b.HasOne(h => h.Class).WithMany(c => c.Holds)
            .HasForeignKey(h => h.ClassId)
            .HasConstraintName("fk_holds_classes_class_id")
            .OnDelete(DeleteBehavior.Restrict);

        // BRD §4.2: at most one active (HELD/CONFIRMED) application per student per class.
        b.HasIndex(h => new { h.StudentId, h.ClassId })
            .IsUnique()
            .HasFilter($"status IN ('{HoldStatus.Held}', '{HoldStatus.Confirmed}')")
            .HasDatabaseName("ux_holds_active_student_class");

        // Sweeper: find due HELD holds quickly.
        b.HasIndex(h => h.ExpiresAt)
            .HasFilter($"status = '{HoldStatus.Held}'")
            .HasDatabaseName("ix_holds_held_expiry");

        // Per-class lazy expiry / held counts.
        b.HasIndex(h => new { h.ClassId, h.ExpiresAt })
            .HasFilter($"status = '{HoldStatus.Held}'")
            .HasDatabaseName("ix_holds_class_held");

        // FK lookups (all statuses).
        b.HasIndex(h => h.ClassId).HasDatabaseName("ix_holds_class_id");

        // GET /me/holds, newest first.
        b.HasIndex(h => new { h.StudentId, h.CreatedAt })
            .IsDescending(false, true)
            .HasDatabaseName("ix_holds_student_created");
    }
}
