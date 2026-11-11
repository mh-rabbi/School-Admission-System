# Decisions Log

Every design decision agreed during planning. Format: question → options considered → choice → reason.

---

## D1. Concurrency / no-overbooking strategy
- **Options:** A) stored counters + atomic conditional `UPDATE` + DB `CHECK`; B) `SELECT … FOR UPDATE` + derived counts; C) SERIALIZABLE + retry.
- **Choice:** **A**
- **Reason:** Single statement, row-level lock serializes per class across any number of instances, highest throughput, and the invariant `held_seats + confirmed_seats <= total_seats` is declared in the schema as a `CHECK` constraint (BRD §5 "enforced at the database level").
- **Locking model:** implicit **pessimistic row lock** taken by the conditional `UPDATE` (Postgres re-evaluates the `WHERE` on the latest row version after waiting). No explicit `SELECT … FOR UPDATE`, no optimistic version column. State transitions on holds (confirm/cancel/expire) use atomic compare-and-set updates (`WHERE status = 'HELD' …`).
- **Rejected:** optimistic locking (EF concurrency token) — under thousands of requests on one class row nearly all would fail and retry → retry storms.

## D2. Redis
- **Options:** A) add Redis (seat counter / distributed lock / cache); B) PostgreSQL only.
- **Choice:** **B — no Redis** (user may revisit)
- **Reason:** DB must remain the single source of truth for the invariant; Redis adds a dual-write consistency problem, an extra container and failure mode, and persistence concerns, while Postgres row locks easily handle the expected load. Can be added later for read caching/rate limiting without touching the seat-claim path.

## D3. Hold expiry strategy
- **Options:** A) lazy only; B) background sweeper only; C) hybrid.
- **Choice:** **C — hybrid** (user accepted recommendation)
- **Reason:** Background sweeper (hosted service, periodic, atomic statement conditional on `status='HELD'` → safe with multiple instances, no double-decrement) returns seats to the pool with no external call. Reads report `HELD && expiresAt <= now` as `EXPIRED`; confirm requires `expires_at > now()`; apply releases expired holds of the class inside its own transaction. Exact-to-the-second correctness.

## D4. ID format
- **Options:** A) prefixed text IDs; B) plain GUIDs; C) GUID PK in DB, exposed as `c_<hex>` / `h_<hex>`.
- **Choice:** **C** (user accepted recommendation)
- **Reason:** Native `uuid` storage/indexing, API IDs match the contract style (`c_…`, `h_…`); malformed/unprefixed IDs → `404`.

## D5. ORM, data access & migrations
- **Options:** A) EF Core only; B) EF Core (Npgsql) for schema/migrations/simple CRUD + parameterized raw SQL for critical statements. Migrations: (i) auto-apply on startup; (ii) separate step/container.
- **Choice:** **B + (i)** (user accepted recommendation)
- **Reason:** Critical-path SQL (claim seat, confirm, cancel, sweeper) is explicit and reviewable while still "utilizing an ORM". Startup migration keeps `docker compose up` one-shot; guarded by a Postgres advisory lock so concurrent instances never migrate simultaneously.

## D6. Project structure & API style
- **Options:** A) single Web API project, feature folders, Minimal APIs + service layer; B) Clean Architecture (4 projects); C) A with Controllers.
- **Choice:** **A** (user accepted recommendation)
- **Reason:** Matches project size (8 endpoints), keeps concurrency logic in one obvious place, easy `WebApplicationFactory` integration testing.

## D7. Testing stack & concurrency test design
- **Options:** A) xUnit + Testcontainers (real Postgres); B) compose DB; C) in-memory/SQLite (rejected — cannot reproduce row locking).
- **Choice:** **A** (user accepted recommendation)
- **Concurrency test design:** class with 5 seats, 200 parallel `POST /classes/{id}/holds` from distinct students → exactly 5×`201`, 195×`409`; assert invariant via API (`GET /classes/{id}`) and direct SQL. Variant with two app instances (two factories) on the same DB for multi-instance proof. Parallel double-confirm idempotency test.

## D8. Lifecycle rules
- **(a) Cancel a CONFIRMED application:** options A) allowed, seat returns; B) not allowed. **Choice: B (user)** → `DELETE /holds/{id}` on a CONFIRMED hold returns `409` (`CANNOT_CANCEL_CONFIRMED`). Confirmed admissions are final; withdrawals are an offline/admin process.
- **(b) Re-apply after EXPIRED/CANCELLED:** **A — allowed** (user accepted recommendation). Partial unique index only blocks a second *active* (HELD/CONFIRMED) application; history is kept.
- **(c) Active holds in multiple classes:** **A — allowed** (user accepted recommendation). BRD rule is per class.

## D9. Ownership & identity
- **(a) Acting on another student's hold:** `404` (A) — does not reveal existence; hold IDs are random.
- **(b) `GET /holds/{id}` header:** optional (A) — if `X-Student-Id` present and not owner → `404`; if absent → returned (BRD lists no header for this endpoint).
- **(c) Student ID format:** exactly 17 digits `^\d{17}$` (A). Missing/malformed header on endpoints that require it → `400`.
- **Choice source:** user accepted recommendations.

## D10. Status codes for unspecified cases
| Case | Code |
|---|---|
| Apply while an active (HELD/CONFIRMED) application exists for that class | `409` |
| Confirm an expired hold | `409` ("Hold has expired") |
| Confirm a CANCELLED hold | `409` |
| Confirm an already CONFIRMED hold | `200`, same body (idempotent) |
| Cancel an already CANCELLED/EXPIRED hold | `204` (idempotent no-op) |
| Class `name` | required, trimmed, 1–100 chars, unique case-insensitive → `409` on duplicate, `400` on invalid |
| `totalSeats` | integer 1–10,000, else `400` |
| Cancel a CONFIRMED hold | `409` (see D8a) |
- **Choice source:** user accepted recommendations.

## D11. .NET version
- **Options:** A) .NET 8 LTS (support ends 2026-11-10); B) .NET 10 LTS (supported to Nov 2028, SDK 10.0.114 installed).
- **Choice:** **B — .NET 10** (user accepted recommendation). Satisfies BRD "8 or newer".

## D12. Cross-cutting
- **Error format:** RFC 7807 `ProblemDetails` + machine-readable `code` extension (`SEATS_FULL`, `HOLD_EXPIRED`, `ALREADY_APPLIED`, `CANNOT_CANCEL_CONFIRMED`, `HOLD_NOT_ACTIVE`, `DUPLICATE_CLASS_NAME`, `INVALID_STUDENT_ID`, `VALIDATION_FAILED`, `NOT_FOUND`, `INTERNAL_ERROR`; added during implementation: `METHOD_NOT_ALLOWED`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE` (503 when the DB is down)). Frontend maps `code` → friendly text; every error also carries a human-readable `detail`.
- **CORS:** origins from `CORS_ALLOWED_ORIGINS` (comma-separated), default `http://localhost:5173`.
- **Swagger/OpenAPI:** enabled in all environments at `/swagger`.
- **Health:** `GET /health` (liveness + DB check); used by compose healthcheck.
- **Logging:** built-in console logger, JSON formatter.
- **Config (env vars):** `ConnectionStrings__Default`, `HOLD_DURATION_SECONDS` (default 600), `EXPIRY_SWEEP_INTERVAL_SECONDS` (default 5), `ASPNETCORE_URLS=http://+:8080`.
- **Docker:** multi-stage (SDK build → `aspnet:10.0` runtime, non-root). Postgres `postgres:16-alpine` with named volume.
- **Choice source:** user accepted recommendations.

## D14. Database connection budget (raised in Step 11)
- **Problem:** Npgsql pool default 100 connections/instance vs Postgres `max_connections` default 100 → two instances under a burst can exhaust the DB (503s, never overbooking).
- **Options:** A) explicit budget in compose: `Maximum Pool Size=50` per instance (in the connection-string env var) + Postgres `max_connections=200`; B) keep defaults; C) PgBouncer.
- **Choice:** **A** (user accepted recommendation).
- **Reason:** closes a real failure mode with configuration only; ≥3 instances + admin headroom fit; at peak, requests queue briefly in the app pool instead of failing; throughput unaffected because claims on one class serialize on its row lock anyway. C rejected: extra container and transaction pooling breaks the session-level advisory lock used by migrations.

## D15. Expose the `Date` response header via CORS (requested by the frontend, 2026-11-11)
- **Problem:** the countdown must follow the server clock (expiry is decided on the DB clock), but browsers hide non-safelisted response headers such as `Date` from cross-origin JavaScript.
- **Choice:** CORS policy adds `.WithExposedHeaders("Date")` (user approved).
- **Reason:** one-line, additive change. No endpoint, field or status code changes; same-origin and non-browser clients are unaffected. Tested in `SmokeTests`.

## D13. Git workflow
- **Choice:** **User manages git manually** (init, commits, branches, pushes). The agent never runs git write commands; each completed step ends with a *suggested* Conventional Commits message for the user.

---

# Frontend decisions (2026-11-11, from the frontend plan `fe_implementation_plan.md`)

## D16. Frontend stack and data fetching (plan Q1, Q4)
- **Choice:** React 18 + TypeScript + Vite; **TanStack Query v5** for server state; hash routing (no router library); no UI kit or CSS framework; Vitest + React Testing Library. Dev/verification runs on Node 22 (nvm) or Docker only (`docker build --target test`).
- **Reason:** polling that never overlaps, pauses in hidden tabs, de-duplicates and invalidates is exactly what the query library provides and is better tested than hand-written effects (~13 kB). Everything else stays dependency-free.

## D17. Default route (Q3)
- **Choice:** the portal (ID field at the top, Classes tab) opens first; the landing page is "How it works" (`#/welcome`).
- **Reason:** BRD wants the ID field at the top of the page; the main flow is zero clicks away.

## D18. Language scope (Q5)
- **Choice:** English UI and messages, Bangla for the three primary actions (BRD labels); all wording in one file. No language toggle.

## D19. Identity handling
- **Choice:** convert Bengali digits and trim, but never strip other characters; validate before any request; keep the ID in `localStorage`.
- **Reason:** silently "repairing" a wrong ID could act on another student's applications.

## D20. Expiry model (builds on D15)
- **Choice:** the server decides. The UI counts down to the server `expiresAt` using the server clock estimated from the `Date` header (median of recent samples, +0.5 s for header truncation), flips to `EXPIRED` and disables Pay at zero, immediately re-reads from the server, and keeps re-checking every second (max 15) until the server agrees; normal polling continues afterwards.
- **Reason:** correct even with a wrong device clock, no stale "Pay" button, and it can never show a final answer the server contradicts.

## D21. Design adjustments for accessibility, and honest landing data (Q6)
- **Choice:** keep the approved look; change three colour values after an automated WCAG AA contrast test failed on the demo palette (light error red darker, dark-theme background glow softer via `--orb-opacity`, dark primary teal slightly deeper). The landing hero shows live totals from the API or nothing. Misleading demo copy ("one minute") and fake activity were removed.

## D22. Fonts (Q8) and serving
- **Choice:** fonts are bundled with `@fontsource` (no third-party requests, works offline). The image is built with Node and served by nginx (SPA fallback, gzip, immutable hashed assets, `no-store` HTML shell) on container port 80, published as 3000. The API address is a build argument.

