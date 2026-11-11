using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SchoolAdmission.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "classes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    name_normalized = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, computedColumnSql: "lower(name)", stored: true),
                    total_seats = table.Column<int>(type: "integer", nullable: false),
                    held_seats = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    confirmed_seats = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_classes", x => x.id);
                    table.CheckConstraint("ck_classes_confirmed_seats_non_negative", "confirmed_seats >= 0");
                    table.CheckConstraint("ck_classes_held_seats_non_negative", "held_seats >= 0");
                    table.CheckConstraint("ck_classes_no_overbooking", "held_seats + confirmed_seats <= total_seats");
                    table.CheckConstraint("ck_classes_total_seats_range", "total_seats BETWEEN 1 AND 10000");
                });

            migrationBuilder.CreateTable(
                name: "holds",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    class_id = table.Column<Guid>(type: "uuid", nullable: false),
                    student_id = table.Column<string>(type: "character varying(17)", maxLength: 17, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    confirmed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    cancelled_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_holds", x => x.id);
                    table.CheckConstraint("ck_holds_status", "status IN ('HELD', 'CONFIRMED', 'EXPIRED', 'CANCELLED')");
                    table.CheckConstraint("ck_holds_student_id_format", "student_id ~ '^[0-9]{17}$'");
                    table.ForeignKey(
                        name: "fk_holds_classes_class_id",
                        column: x => x.class_id,
                        principalTable: "classes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_classes_created_at",
                table: "classes",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "ux_classes_name_normalized",
                table: "classes",
                column: "name_normalized",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_holds_class_held",
                table: "holds",
                columns: new[] { "class_id", "expires_at" },
                filter: "status = 'HELD'");

            migrationBuilder.CreateIndex(
                name: "ix_holds_class_id",
                table: "holds",
                column: "class_id");

            migrationBuilder.CreateIndex(
                name: "ix_holds_held_expiry",
                table: "holds",
                column: "expires_at",
                filter: "status = 'HELD'");

            migrationBuilder.CreateIndex(
                name: "ix_holds_student_created",
                table: "holds",
                columns: new[] { "student_id", "created_at" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "ux_holds_active_student_class",
                table: "holds",
                columns: new[] { "student_id", "class_id" },
                unique: true,
                filter: "status IN ('HELD', 'CONFIRMED')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "holds");

            migrationBuilder.DropTable(
                name: "classes");
        }
    }
}
