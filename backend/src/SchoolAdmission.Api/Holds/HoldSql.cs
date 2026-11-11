namespace SchoolAdmission.Api.Holds;

/// <summary>
/// The concurrency-critical SQL, kept in one place for review (architecture §4).
/// All statements are parameterized and use the database clock (now()).
/// Lock order everywhere: hold rows first, then the class row.
/// </summary>
internal static class HoldSql
{
    /// <summary>Read-only fast path: does the student already have a live application for this class?</summary>
    public const string HasActiveHold = """
        SELECT EXISTS (
            SELECT 1 FROM holds
            WHERE student_id = @student AND class_id = @class
              AND (status = 'CONFIRMED' OR (status = 'HELD' AND expires_at > now())))
        """;

    /// <summary>
    /// Expire THIS student's own expired-but-unswept hold on the class and give its seat back, so the
    /// partial unique index does not block a legitimate re-apply. Affects 0 or 1 class row.
    /// </summary>
    public const string ReleaseOwnExpiredHold = """
        WITH released AS (
            UPDATE holds SET status = 'EXPIRED', updated_at = now()
            WHERE class_id = @class AND student_id = @student
              AND status = 'HELD' AND expires_at <= now()
            RETURNING 1)
        UPDATE classes SET held_seats = held_seats - (SELECT count(*) FROM released)
        WHERE id = @class AND EXISTS (SELECT 1 FROM released)
        """;

    /// <summary>
    /// Expire every expired-but-unswept hold of the class and give the seats back.
    /// The status = 'HELD' compare-and-set guarantees each seat is released exactly once,
    /// even if the sweeper or another request releases concurrently. Affects 0 or 1 class row.
    /// </summary>
    public const string ReleaseClassExpiredHolds = """
        WITH released AS (
            UPDATE holds SET status = 'EXPIRED', updated_at = now()
            WHERE class_id = @class AND status = 'HELD' AND expires_at <= now()
            RETURNING 1)
        UPDATE classes SET held_seats = held_seats - (SELECT count(*) FROM released)
        WHERE id = @class AND EXISTS (SELECT 1 FROM released)
        """;

    /// <summary>
    /// THE atomic seat claim. Takes the class row lock; concurrent claimers queue on it and Postgres
    /// re-evaluates the WHERE against the latest committed counters, so the last seat goes to exactly one
    /// request. 1 row = seat claimed, 0 rows = full (or class missing). ck_classes_no_overbooking backs it up.
    /// </summary>
    public const string ClaimSeat = """
        UPDATE classes SET held_seats = held_seats + 1
        WHERE id = @class AND held_seats + confirmed_seats < total_seats
        """;

    /// <summary>
    /// Create the hold. ON CONFLICT on the partial unique index turns a duplicate active application into
    /// "0 rows" (→ rollback the claim, 409) instead of an exception.
    /// </summary>
    public const string InsertHold = """
        INSERT INTO holds (id, class_id, student_id, status, expires_at, created_at, updated_at)
        VALUES (@id, @class, @student, 'HELD', now() + make_interval(secs => @holdSeconds), now(), now())
        ON CONFLICT (student_id, class_id) WHERE status IN ('HELD', 'CONFIRMED') DO NOTHING
        RETURNING expires_at
        """;

    public const string ClassExists = "SELECT EXISTS (SELECT 1 FROM classes WHERE id = @class)";

    /// <summary>
    /// Status as the client must see it: a HELD hold past expires_at is EXPIRED immediately (DB clock),
    /// whether or not the sweeper has processed it yet.
    /// </summary>
    public const string EffectiveStatus =
        "CASE WHEN h.status = 'HELD' AND h.expires_at <= now() THEN 'EXPIRED' ELSE h.status END";

    public const string GetHold = $"""
        SELECT h.id, h.class_id, h.student_id, {EffectiveStatus} AS status, h.expires_at
        FROM holds h
        WHERE h.id = @hold
        """;
}
