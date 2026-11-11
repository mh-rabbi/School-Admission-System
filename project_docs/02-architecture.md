# 02 – Backend Architecture

Related: [BRD](BRD.md) §4.2, §5, §6, §7 · [Decisions](decisions.md) · [Plan](01-backend-implementation-plan.md)

## 1. Overview

```
React (Vite) ──HTTP/JSON──► SchoolAdmission.Api (.NET 10, Minimal APIs) ──Npgsql──► PostgreSQL 16
                              ├─ Classes feature   (EF Core CRUD)
                              ├─ Holds feature     (raw SQL for state transitions)
                              └─ ExpirySweeper     (BackgroundService, every N s)
```

- Stateless API: no in-memory locks, caches or counters → any number of instances can share one DB (BRD §5 multi-process).
- **All time comparisons use the database clock (`now()`)**, never the app clock → no skew between instances.
- PostgreSQL is the single source of truth for the invariant; no Redis (D2).

### Folder layout (D6)
```
backend/
  SchoolAdmission.sln
  Dockerfile
  src/SchoolAdmission.Api/
    Program.cs
    Classes/        ClassEndpoints.cs, ClassService.cs, Dtos.cs
    Holds/          HoldEndpoints.cs, HoldService.cs, HoldSql.cs, Dtos.cs
    Expiry/         ExpirySweeper.cs
    Infrastructure/ AppDbContext.cs, Entities/, Configurations/, Migrations/,
                    PrefixedId.cs, StudentIdHeader.cs, ErrorCodes.cs,
                    ExceptionHandling.cs, MigrationRunner.cs, Options.cs
  tests/SchoolAdmission.Api.Tests/
    PostgresFixture.cs (Testcontainers), ApiFactory.cs, *Tests.cs
```

## 2. Data model

### `classes`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `Guid.CreateVersion7()` (time-ordered); exposed as `c_<32 hex>` |
| `name` | `varchar(100)` NOT NULL | trimmed |
| `name_normalized` | `varchar(100)` GENERATED ALWAYS AS `lower(name)` STORED | carries the case-insensitive unique index |
| `total_seats` | `int` NOT NULL | `CHECK (total_seats BETWEEN 1 AND 10000)` |
| `held_seats` | `int` NOT NULL DEFAULT 0 | `CHECK (held_seats >= 0)` |
| `confirmed_seats` | `int` NOT NULL DEFAULT 0 | `CHECK (confirmed_seats >= 0)` |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

- **`CONSTRAINT ck_classes_no_overbooking CHECK (held_seats + confirmed_seats <= total_seats)`** ← the BRD invariant, enforced by the DB.
- `UNIQUE INDEX ux_classes_name_normalized ON classes (name_normalized)` (generated column instead of an expression index, so the whole schema stays model-driven in EF migrations).
- Other checks: `ck_classes_total_seats_range`, `ck_classes_held_seats_non_negative`, `ck_classes_confirmed_seats_non_negative`.

### `holds`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | v7; exposed as `h_<32 hex>` |
| `class_id` | `uuid` FK → classes | |
| `student_id` | `varchar(17)` NOT NULL | `CHECK (student_id ~ '^[0-9]{17}$')` (varchar avoids `char` padding/comparison quirks; the check enforces length) |
| `status` | `varchar(16)` NOT NULL | `CHECK (status IN ('HELD','CONFIRMED','EXPIRED','CANCELLED'))` |
| `expires_at` | `timestamptz` NOT NULL | `now() + HOLD_DURATION_SECONDS` at creation |
| `created_at`, `updated_at` | `timestamptz` | |
| `confirmed_at`, `cancelled_at` | `timestamptz` NULL | audit |

Indexes:
- **`ux_holds_active_student_class` UNIQUE (`student_id`, `class_id`) WHERE `status IN ('HELD','CONFIRMED')`** → "one active application per student per class" enforced by the DB (BRD §4.2). Re-apply after EXPIRED/CANCELLED allowed (D8b).
- `ix_holds_held_expiry` (`expires_at`) WHERE `status = 'HELD'` → sweeper + "expired-but-unswept" counts.
- `ix_holds_class_held` (`class_id`, `expires_at`) WHERE `status = 'HELD'`.
- `ix_holds_student_created` (`student_id`, `created_at DESC`) → `/me/holds`.
- `ix_holds_class_id` (`class_id`) → FK lookups. FK `fk_holds_classes_class_id` is `ON DELETE RESTRICT`.
- Checks: `ck_holds_status`, `ck_holds_student_id_format`.

### Why stored counters (D1)
`held_seats`/`confirmed_seats` are denormalised counters on the class row so a single conditional `UPDATE` both checks and claims a seat under one row lock, and the `CHECK` constraint can express the invariant. Every hold state transition changes the hold row **and** the counter in the same transaction, guarded by a compare-and-set on the hold's status, so each delta is applied exactly once.

## 3. State machine

```
            confirm (owner, not expired)
   HELD ───────────────────────────────► CONFIRMED   (final; cancel → 409)
    │  \
    │   \ cancel (owner)            expires_at <= now()
    │    └────────► CANCELLED      (sweeper / lazy release)
    └──────────────────────────────────► EXPIRED
```
Counter deltas: apply `held+1` · confirm `held-1, confirmed+1` · cancel `held-1` · expire `held-1`.

## 4. Algorithms (pseudo-SQL, all parameterized, READ COMMITTED)

**Principle:** expected business outcomes (duplicate, full, already applied) are detected from row counts
(`ON CONFLICT DO NOTHING`, conditional `UPDATE … RETURNING`), not from constraint-violation exceptions, so they are never
logged as server errors under load. Constraint violations remain as the last-line safety net and are still mapped to 409.

### 4.0 Create class — `POST /classes`
```
validate name (trim, 1–100) and totalSeats (1–10,000) → 400
INSERT INTO classes (id, name, total_seats) VALUES (@id, @name, @seats)
ON CONFLICT (name_normalized) DO NOTHING;      -- 0 rows → 409 DUPLICATE_CLASS_NAME
```

### 4.1 Apply / hold seat — `POST /classes/{classId}/holds`
```
validate X-Student-Id (^\d{17}$) else 400; parse classId else 404
BEGIN;
  -- (0) release THIS student's own expired-but-unswept hold for this class,
  --     so the partial unique index does not block a legitimate re-apply
  WITH e AS (UPDATE holds SET status='EXPIRED', updated_at=now()
             WHERE class_id=@c AND student_id=@s AND status='HELD' AND expires_at<=now()
             RETURNING 1)
  UPDATE classes SET held_seats = held_seats - (SELECT count(*) FROM e)
  WHERE id=@c AND EXISTS (SELECT 1 FROM e);

  -- (1) atomic claim: row lock + re-check on latest row version
  UPDATE classes SET held_seats = held_seats + 1
  WHERE id=@c AND held_seats + confirmed_seats < total_seats
  RETURNING id;
  IF 0 rows:
     IF class does not exist → ROLLBACK; 404
     -- (2) seats may be "full" only because of expired-but-unswept holds:
     release ALL expired holds of this class (same CTE as (0) without student filter)
     retry (1) once (only if something was released);
     IF still 0 rows → COMMIT (keeps the releases); class exists ? 409 SEATS_FULL : 404

  -- (3) create the hold; partial unique index guards duplicates
  INSERT INTO holds (id, class_id, student_id, status, expires_at, ...)
  VALUES (@id, @c, @s, 'HELD', now() + make_interval(secs => @holdSeconds), ...)
  ON CONFLICT (student_id, class_id) WHERE status IN ('HELD','CONFIRMED') DO NOTHING
  RETURNING expires_at;
  IF 0 rows → ROLLBACK (counter increment undone); 409 ALREADY_APPLIED
COMMIT; → 201 {holdId, classId, studentId, status:"HELD", expiresAt}
```
A cheap read-only pre-check for an existing active, unexpired hold returns `409 ALREADY_APPLIED` early without touching the class row lock (optimisation only; the unique index is the guarantee).

### 4.2 Confirm — `POST /holds/{holdId}/confirm` (idempotent)
```
WITH c AS (UPDATE holds SET status='CONFIRMED', confirmed_at=now(), updated_at=now()
           WHERE id=@h AND student_id=@s AND status='HELD' AND expires_at > now()
           RETURNING class_id)
UPDATE classes SET held_seats = held_seats - 1, confirmed_seats = confirmed_seats + 1
WHERE id = (SELECT class_id FROM c);
```
If 0 rows, read the hold and decide:
- missing / other owner → `404`
- `CONFIRMED` → `200 {holdId, status:"CONFIRMED"}` (idempotent; counter not touched again)
- `EXPIRED` or `HELD` with `expires_at <= now()` → `409 HOLD_EXPIRED`
- `CANCELLED` → `409 HOLD_NOT_ACTIVE`

Double-click: the 2nd request blocks on the hold row lock, then Postgres re-evaluates `status='HELD'` → false → 0 rows → reads `CONFIRMED` → 200. `confirmed_seats` incremented exactly once.

### 4.3 Cancel — `DELETE /holds/{holdId}`
```
WITH c AS (UPDATE holds SET status='CANCELLED', cancelled_at=now(), updated_at=now()
           WHERE id=@h AND student_id=@s AND status='HELD' AND expires_at > now()
           RETURNING class_id)
UPDATE classes SET held_seats = held_seats - 1 WHERE id = (SELECT class_id FROM c);
```
If 0 rows: missing/other owner → `404`; `CONFIRMED` → `409 CANNOT_CANCEL_CONFIRMED` (D8a); `CANCELLED` / `EXPIRED` / held-but-past-expiry → `204` (idempotent; sweeper releases the seat).

### 4.4 Expiry — hybrid (D3)
**Sweeper** (`BackgroundService`, every `EXPIRY_SWEEP_INTERVAL_SECONDS`, default 5):
```
BEGIN;
  IF NOT pg_try_advisory_xact_lock(<SWEEPER_KEY>) → COMMIT; skip tick   -- one sweeper at a time across instances
  WITH due AS (SELECT id FROM holds
               WHERE status='HELD' AND expires_at <= now()
               ORDER BY expires_at LIMIT 1000
               FOR UPDATE SKIP LOCKED),
       upd AS (UPDATE holds h SET status='EXPIRED', updated_at=now()
               FROM due WHERE h.id = due.id RETURNING h.class_id)
  UPDATE classes c SET held_seats = c.held_seats - x.n
  FROM (SELECT class_id, count(*) n FROM upd GROUP BY class_id) x
  WHERE c.id = x.class_id;
COMMIT;   -- loop while a full batch was processed
```
**Which layer guarantees what (verified by mutation tests, Step 6):**
- `FOR UPDATE SKIP LOCKED` + `status = 'HELD'` re-check → **correctness**: each hold leaves HELD once, so each seat is returned once. Removing these with 16 parallel releasers drove `held_seats` negative (blocked by `ck_classes_held_seats_non_negative`).
- `pg_try_advisory_xact_lock` → **efficiency**: only one instance sweeps per tick. Removing it alone still yields correct results.
- Implementation: `Expiry/ExpiredHoldReleaser.cs` (batches until a partial batch), `Expiry/ExpirySweeper.cs` (`PeriodicTimer`; a failed tick is logged and retried next tick, never stops the host).

**Lazy correctness (no dependency on sweeper timing):**
- Every read reports status as `CASE WHEN status='HELD' AND expires_at<=now() THEN 'EXPIRED' ELSE status END`.
- `GET /classes[/{id}]`: `heldSeats = held_seats − (# HELD holds of the class with expires_at <= now())`, `availableSeats = total − heldSeats − confirmed`. Read-only, exact to the second.
- Confirm/cancel require `expires_at > now()` (§4.2/4.3); apply releases expired holds itself when needed (§4.1).

→ Seats return to the pool with no external API call; the UI sees `EXPIRED` at exactly `expiresAt`.

### 4.5 Reads
- `GET /holds/{id}`: `X-Student-Id` optional; if present and ≠ owner → 404 (D9b). Fields: `holdId, classId, status, expiresAt`.
- `GET /me/holds`: header required; join `classes` for `className`; ordered `created_at DESC`; all statuses (history).

## 5. Why `held + confirmed <= totalSeats` can never be violated

1. **Declarative guard:** `ck_classes_no_overbooking` is checked by Postgres on every write to a class row, whatever code path, instance, or bug issued it. A violating write fails (`23514`) and its transaction rolls back (mapped to `409 SEATS_FULL` as defence in depth).
2. **Serialized claims per class:** the claim `UPDATE` takes a row-level exclusive lock. Concurrent claimers on the same class queue on that lock; under READ COMMITTED, when a waiter acquires the lock Postgres **re-evaluates the `WHERE` against the newest committed row version** (EvalPlanQual). So the k-th waiter sees counters already incremented by the previous k−1 and fails cleanly once seats run out. No read-then-write gap exists, so no lost update.
3. **Exactly-once counter deltas:** every decrement/transfer is coupled to a compare-and-set on the hold (`WHERE status='HELD' …`) in the same statement. Only one transaction can move a given hold out of `HELD`, so a seat is released or transferred exactly once — even with double-clicks, concurrent cancel+confirm, sweeper vs. lazy release, or two sweepers.
4. **Atomicity:** counter increment and hold insert are in one transaction; a failure (e.g. duplicate application) rolls back the increment.
5. **Multi-instance:** all coordination lives in Postgres (row locks, unique/check constraints, advisory lock, DB clock); instances share nothing in memory, so N instances behave exactly like N concurrent request threads.

### Lock ordering / deadlocks
All transactions that touch both tables lock **hold rows before the class row** (release CTEs, confirm, cancel, sweeper). The claim locks only the class row and inserts a new hold row. The sweeper uses `SKIP LOCKED` and a global advisory lock so sweepers never contend with each other. As a final safety net, `40P01` (deadlock) and `40001` are retried once by the hold service.

## 6. API mapping

| Endpoint | Success | Errors |
|---|---|---|
| `POST /classes` | 201 + `Location` | 400 `VALIDATION_FAILED`, 409 `DUPLICATE_CLASS_NAME` |
| `GET /classes` | 200 | — |
| `GET /classes/{id}` | 200 | 404 |
| `POST /classes/{id}/holds` | 201 + `Location` | 400 `INVALID_STUDENT_ID`, 404, 409 `SEATS_FULL` / `ALREADY_APPLIED` |
| `GET /holds/{id}` | 200 | 400 (malformed header if sent), 404 |
| `POST /holds/{id}/confirm` | 200 (also on repeat) | 400, 404, 409 `HOLD_EXPIRED` / `HOLD_NOT_ACTIVE` |
| `DELETE /holds/{id}` | 204 (also on repeat/expired) | 400, 404, 409 `CANNOT_CANCEL_CONFIRMED` |
| `GET /me/holds` | 200 | 400 |
| `GET /health` | 200 | 503 |

Error body: RFC 7807 `ProblemDetails` + `code` (D12). Timestamps serialized as UTC ISO-8601 with `Z`. Unknown / unprefixed IDs → 404.

Cross-cutting errors (Step 10, `Infrastructure/ProblemMapper.cs` — pure, unit-tested):

| Situation | Status / code | Logged as |
|---|---|---|
| Validation / business rule (`ApiException`) | 400 / 404 / 409, specific code | not logged |
| Malformed JSON, wrong types, `null`/array body | 400 `VALIDATION_FAILED` | not logged |
| Non-JSON `Content-Type` | 415 `UNSUPPORTED_MEDIA_TYPE` | not logged |
| Body > 64 KB (Kestrel limit) | 413 `PAYLOAD_TOO_LARGE` | not logged |
| Unknown route / wrong method | 404 `NOT_FOUND` / 405 `METHOD_NOT_ALLOWED` (default detail added) | not logged |
| DB constraint backstop (`ck_classes_no_overbooking`, `ux_holds_active_student_class`) | 409 `SEATS_FULL` / `ALREADY_APPLIED` | warning |
| DB unreachable / dropped / overloaded (IO errors, SQLSTATE 08xxx, 53xxx, 57Pxx, 3D000), timeouts | **503 `SERVICE_UNAVAILABLE`** | warning |
| Client aborted the request | nothing written | debug |
| Anything else | 500 `INTERNAL_ERROR`, generic message (no internals) | error + exception |

`GET /health` returns 503 while the DB is unavailable; the API recovers automatically once the DB is back (Npgsql pool reconnects).

## 7. Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ConnectionStrings__Default` | — (required) | Npgsql connection string |
| `HOLD_DURATION_SECONDS` | `600` | hold lifetime |
| `EXPIRY_SWEEP_INTERVAL_SECONDS` | `5` | sweeper period |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | comma-separated |
| `ASPNETCORE_URLS` | `http://+:8080` | listen address |

Startup: migrations applied automatically under `pg_advisory_lock(<MIGRATION_KEY>)` so concurrent instances never migrate simultaneously (D5).
