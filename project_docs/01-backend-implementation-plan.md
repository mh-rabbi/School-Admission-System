# 01 – Backend Implementation Plan

Source of truth: [BRD.md](BRD.md) · Design: [02-architecture.md](02-architecture.md) · Decisions: [decisions.md](decisions.md) · Tracker: [/AGENTS.md](../AGENTS.md)

Conventions: each step is verified (build + tests) before being marked DONE. Git is managed by the user (D13); every step ends with a **suggested** commit message.
Note on order: test infrastructure is set up early (Step 3) so every feature step is verified by automated tests; Step 11 adds the mandatory concurrency suite and fills gaps.

---

## Step 1 – Solution scaffold
**Goal:** buildable .NET 10 solution with the cross-cutting skeleton.
**Tasks**
- [x] `backend/SchoolAdmission.sln`, `src/SchoolAdmission.Api` (Minimal API, net10.0), `tests/SchoolAdmission.Api.Tests` (xUnit)
- [x] `.gitignore` (bin/obj, IDE files), `.editorconfig`, `Directory.Build.props` (nullable, warnings as errors, LangVersion latest)
- [x] Options binding from env vars (`HOLD_DURATION_SECONDS`, `EXPIRY_SWEEP_INTERVAL_SECONDS`, `CORS_ALLOWED_ORIGINS`) with validation
- [x] ProblemDetails + `code` extension, global exception handler skeleton
- [x] CORS, Swagger at `/swagger`, JSON console logging, `GET /health` (liveness only for now)
- [x] Kestrel on `http://+:8080`
**Files:** `backend/**`, `.gitignore`
**Acceptance:** `dotnet build` passes with 0 warnings; `dotnet run` → `GET http://localhost:8080/health` 200; `/swagger` loads; 1 smoke test passes.
**BRD:** §6, §8
**Commit:** `chore(backend): scaffold .NET 10 solution with health, swagger, cors and problem details`

## Step 2 – Database model & migrations
**Goal:** schema from architecture §2 with all constraints, auto-migrated on startup.
**Tasks**
- [x] Add `Npgsql.EntityFrameworkCore.PostgreSQL`, EF tools
- [x] Entities `SchoolClass`, `Hold`, `HoldStatus`; `AppDbContext` with snake_case config
- [x] `CHECK` constraints (incl. `ck_classes_no_overbooking`), partial unique index `ux_holds_active_student_class`, supporting indexes
- [x] `PrefixedId` helper (`c_`/`h_` ↔ Guid v7)
- [x] Initial migration; `DatabaseMigrator` applying migrations under `pg_advisory_lock`
- [x] Root `docker-compose.yml` with **db service only** (postgres:16-alpine, named volume, healthcheck) for local dev
- [x] `/health` extended with DB check
- [x] *(pulled forward from Step 3)* Testcontainers `PostgresFixture` + `ApiFactory`, needed because the app now requires a DB to start; schema tests proving every DB constraint
**Files:** `backend/src/SchoolAdmission.Api/Infrastructure/**`, `docker-compose.yml`
**Acceptance:** `docker compose up db` + `dotnet run` creates tables; `\d classes` / `\d holds` show the CHECKs and partial index; manual `UPDATE` violating the invariant is rejected by Postgres.
**BRD:** §5, §6
**Commit:** `feat(db): add classes/holds schema with no-overbooking check and active-application index`

## Step 3 – Test infrastructure
**Goal:** integration tests against real Postgres.
**Tasks**
- [x] `Testcontainers.PostgreSql`, `Microsoft.AspNetCore.Mvc.Testing`, FluentAssertions *(done in Steps 1–2)*
- [x] `PostgresFixture` (one container per test run, collection fixture), `ApiFactory` (WebApplicationFactory, overridable settings) *(done in Step 2)*
- [x] Shared API host for the whole run (`PostgresFixture.Api`, extra hosts via `CreateApi(settings)`), JSON/HTTP helpers (`X-Student-Id`, typed contract reads, ProblemDetails + contract-field assertions), test data builders (unique class names, student IDs), direct-SQL invariant helper `DbInspector` (`held+confirmed<=total`, counters == row counts), self-tests proving the checker detects drift
- [x] Health test runs against the container *(done in Step 2)*
**Files:** `backend/tests/SchoolAdmission.Api.Tests/**`
**Acceptance:** `dotnet test` green; container starts/stops automatically.
**BRD:** §9.2
**Commit:** `test: add Testcontainers-based integration test infrastructure`

## Step 4 – Class endpoints
**Goal:** `POST /classes`, `GET /classes`, `GET /classes/{id}` per contract.
**Tasks**
- [x] Validation: name required/trimmed/1–100, unique case-insensitive (409); totalSeats 1–10,000 (400)
- [x] Stats: `heldSeats` (minus expired-but-unswept), `confirmedSeats`, `availableSeats`
- [x] 201 + `Location`; 404 for unknown/malformed id
- [x] Tests: create, list, get, validation 400, duplicate 409, not-found 404 (+ malformed JSON 400, boundaries, concurrent duplicate creates, lazy-expiry stats)
**Files:** `Classes/**`, tests
**Acceptance:** responses match BRD §7.1–7.3 field-for-field; tests green.
**BRD:** §4.1, §7.1–7.3, §8
**Commit:** `feat(classes): add create, list and get class endpoints`

## Step 5 – Apply / hold seat (concurrency-safe core)
**Goal:** `POST /classes/{id}/holds` per architecture §4.1.
**Tasks**
- [x] `X-Student-Id` parsing/validation helper (`^[0-9]{17}$`, 400 `INVALID_STUDENT_ID`)
- [x] `HoldService.ApplyAsync`: pre-check → own-expired release → atomic claim → release-all-expired + single retry → `INSERT … ON CONFLICT DO NOTHING` (0 rows → rollback, 409 `ALREADY_APPLIED`), 0 claim rows → 409 `SEATS_FULL`; safety-net mapping 23514/23505 → 409 in global handler; whole transaction retried on 40P01/40001 (max 3 attempts)
- [x] Response 201 `{holdId, classId, studentId, status, expiresAt}` + `Location`
- [x] Tests: success, full → 409, duplicate → 409, re-apply after cancel/expire allowed, bad header → 400, unknown class → 404, small parallel smoke (20 requests / 3 seats; 10 same-student requests)
**Files:** `Holds/**`, `Infrastructure/StudentIdHeader.cs`, tests
**Acceptance:** tests green; DB counters equal number of HELD rows.
**BRD:** §4.2, §5, §7.4
**Commit:** `feat(holds): add concurrency-safe seat hold endpoint`

## Step 6 – Hold status & automatic expiry
**Goal:** `GET /holds/{id}` + hybrid expiry (architecture §4.4).
**Tasks**
- [x] `GET /holds/{id}` with lazy EXPIRED reporting; optional header ownership check (404)
- [x] `ExpirySweeper` BackgroundService + `ExpiredHoldReleaser` (advisory lock, SKIP LOCKED batch, counter decrement, batch loop, error logging)
- [x] Tests (`HOLD_DURATION_SECONDS=1`, sweep 1s): status flips to EXPIRED after expiry; seat returns to `availableSeats` without any API write; 16 parallel releasers over 500 holds release each exactly once; two sweeping hosts on one DB stay consistent
- [x] Test hosts default to `EXPIRY_SWEEP_INTERVAL_SECONDS=3600` (deterministic); expiry tests opt in
**Files:** `Holds/**`, `Expiry/**`, tests
**Acceptance:** tests green; counters == HELD-unexpired + CONFIRMED rows after sweep.
**BRD:** §4.2 (Automatic Expiration), §7.5
**Commit:** `feat(holds): add hold status endpoint and background expiry sweeper`

## Step 7 – Confirm admission (idempotent)
**Goal:** `POST /holds/{id}/confirm` per architecture §4.2.
**Tasks**
- [x] CAS update + counter transfer; 0-row resolution (404 / 200 idempotent / 409 `HOLD_EXPIRED` / 409 `HOLD_NOT_ACTIVE`)
- [x] Tests: confirm OK; double confirm → 200 and `confirmedSeats` +1 only; **parallel** 20× confirm same hold → `confirmedSeats` +1; expired (unswept and swept) → 409; other student → 404; cancelled → 409; confirm-vs-sweeper race at the expiry boundary
**Files:** `Holds/**`, tests
**Acceptance:** tests green.
**BRD:** §4.2 (Confirmation, Idempotency), §7.6
**Commit:** `feat(holds): add idempotent admission confirmation`

## Step 8 – Cancel application
**Goal:** `DELETE /holds/{id}` per architecture §4.3.
**Tasks**
- [x] CAS update + counter decrement; 0-row resolution (404 / 409 `CANNOT_CANCEL_CONFIRMED` / 204 idempotent)
- [x] Tests: cancel HELD → 204 and seat returned; repeat → 204; 20 parallel cancels → seat returned once; expired → 204; confirmed → 409; other student → 404; cancel vs confirm race → exactly one wins, counters consistent
**Files:** `Holds/**`, tests
**Acceptance:** tests green.
**BRD:** §7.7
**Commit:** `feat(holds): add application cancellation`

## Step 9 – My applications
**Goal:** `GET /me/holds`.
**Tasks**
- [x] Join class name, all statuses with lazy EXPIRED, newest first; header required
- [x] Tests: lists only own holds incl. history; 400 without header
**Files:** `Holds/**`, tests
**Acceptance:** response matches BRD §7.8; tests green.
**BRD:** §4.1 (My Applications), §7.8
**Commit:** `feat(holds): add my applications endpoint`

## Step 10 – Error handling & validation hardening
**Goal:** uniform, friendly errors everywhere.
**Tasks**
- [x] Review every endpoint against architecture §6 status/code table
- [x] Global handler: malformed JSON → 400, unhandled → 500 `INTERNAL_ERROR` (no stack traces), Npgsql constraint codes mapped centrally (`ProblemMapper`); DB outage → 503; client abort not logged as error; 415/413/405 with codes; 64 KB body limit
- [x] Human-readable `detail` messages for each `code` (including routing-produced 404/405)
- [x] Tests: malformed body, wrong types, missing header per endpoint (Steps 4–9), mapper unit tests, 405/415/non-object bodies, end-to-end DB outage → 503 on all 8 endpoints + `/health`
**Files:** `Infrastructure/ExceptionHandling.cs`, `ErrorCodes.cs`, endpoints, tests
**Acceptance:** no endpoint returns an empty/HTML error body; tests green.
**BRD:** §8
**Commit:** `feat(api): harden validation and standardize problem details errors`

## Step 11 – Concurrency test suite (mandatory) & gap tests
**Goal:** prove the invariant under load.
**Tasks**
- [x] **Overbooking test:** 5 seats, 200 parallel applies (distinct students, released together via barrier) → exactly 5×201, 195×409; assert via `GET /classes/{id}` **and** direct SQL (`held+confirmed <= total`, counters == row counts)
- [x] **Multi-instance test:** two `ApiFactory` instances on the same DB, requests split between them → same assertions
- [x] **Mixed-workload test:** parallel applies + confirms (double-click across instances) + cancels + expiry (2 s hold, sweepers on both instances) → invariant and counter consistency sampled **continuously** (~250 samples) and at the end; no 5xx
- [x] **Same-student race:** 20 parallel applies by one student across two instances → exactly 1×201
- [x] Coverage review (core logic 100 %); added unit tests for StudentIds and TransientRetry (PrefixedId done in Step 2)
- [x] Mutation proof: without the claim condition **and** the DB check, the suite fails (200/5 created; monitor saw 58/10)
**Files:** tests
**Acceptance:** whole suite green 5 runs in a row (flakiness check).
**BRD:** §5, §9.2
**Commit:** `test: add concurrency, multi-instance and race condition tests`

## Step 12 – Dockerfile & docker-compose (persistence)
**Goal:** `docker compose up` runs the full stack with no local installs.
**Tasks**
- [x] `backend/Dockerfile` multi-stage, non-root, port 8080, `.dockerignore`, image HEALTHCHECK on `/health` (bash `/dev/tcp`, no curl in runtime image)
- [x] `docker-compose.yml`: `db` (named volume, healthcheck, `max_connections=200`), `backend` (env vars incl. `Maximum Pool Size=50` per D14, `depends_on: db healthy`, port 8080). `frontend`: `/frontend` still empty → documented, commented-out service ready to enable
- [x] `.env.example` (root, for compose) + `backend/.env.example` (for `dotnet run`)
**Files:** `backend/Dockerfile`, `backend/.dockerignore`, `docker-compose.yml`, `.env.example`
**Acceptance:** fresh `docker compose up --build` → API healthy on :8080; create class + hold; `docker compose down` → `up` → data still present (verified via `GET /classes`, `GET /holds/{id}`).
**BRD:** §5 (Data Persistence), §6
**Commit:** `build: add backend Dockerfile and docker compose stack with persistent volume`

## Step 13 – Multi-instance verification
**Goal:** demonstrate BRD §5 bonus outside the test suite.
**Tasks**
- [x] Compose profile `multi` adding `backend2` on `:8081` (same DB)
- [x] Script `scripts/multi-instance-check.sh` (bash + curl/xargs, no jq): create class with N seats, fire M parallel applies split across :8080/:8081, double-click confirm every winner on both instances, check stats on both instances and the DB invariant + counter/row consistency; non-zero exit on failure
**Files:** `docker-compose.yml`, `scripts/**`
**Acceptance:** script output shows exactly N successes, rest 409, invariant holds.
**BRD:** §5 (Multi-Process Safety)
**Commit:** `test: add multi-instance compose profile and verification script`

## Step 14 – Documentation
**Goal:** deliverable docs complete and accurate.
**Tasks**
- [x] `README.md`: overview, run with Docker, URLs (API, Swagger, frontend), env vars, running tests (with SDK, or Docker-only), multi-instance check, project structure, troubleshooting
- [x] `ASSUMPTIONS.md`: from decisions D8–D10, D12, D14 and everything found during implementation (26 items)
- [x] `AI_USAGE.md`: tools used, developer-controlled workflow, where AI failed and how corrected (from AGENTS.md log), verification practices
- [x] Final pass: AGENTS.md all DONE, plan checklists ticked
**Files:** `README.md`, `ASSUMPTIONS.md`, `AI_USAGE.md`, `AGENTS.md`
**Acceptance:** a fresh reader can run stack and tests using README only.
**BRD:** §9.1
**Commit:** `docs: add README, assumptions and AI usage notes`
