# School Admission System

Online, **first-come-first-served** admission for a government school. Guardians put a seat on a timed **hold**, confirm it by (simulated) payment, or cancel it. Unconfirmed holds expire automatically. The system is built to take thousands of simultaneous applications **without ever overbooking a class**, including when several backend instances run against the same database.

| Part | Stack | Location |
|---|---|---|
| Backend API | C# / .NET 10, ASP.NET Core Minimal APIs, EF Core + Npgsql | [`/backend`](backend) |
| Database | PostgreSQL 16 | `docker-compose.yml` |
| Frontend | React 18 + Vite | [`/frontend`](frontend) |

Requirements: [`project_docs/BRD.md`](project_docs/BRD.md) · Design: [`project_docs/02-architecture.md`](project_docs/02-architecture.md) · Decisions: [`project_docs/decisions.md`](project_docs/decisions.md) · Assumptions: [`ASSUMPTIONS.md`](ASSUMPTIONS.md) · AI usage: [`AI_USAGE.md`](AI_USAGE.md)

---

## Quick start (Docker only)

Prerequisite: Docker with the Compose plugin. Nothing else needs to be installed.

```bash
docker compose up --build
```

| What | URL |
|---|---|
| API | http://localhost:8080 |
| Swagger UI | http://localhost:8080/swagger |
| OpenAPI document | http://localhost:8080/openapi/v1.json |
| Health check | http://localhost:8080/health |
| Frontend | http://localhost:3000 (once the `frontend` service in `docker-compose.yml` is enabled, see [Frontend](#frontend)) |

The database schema is created automatically on first start. Data lives in the named volume `db-data`, so it **survives `docker compose down` and `docker compose up`**. To start again from an empty database, run `docker compose down -v` (this deletes all data).

### Try it

```bash
# 1. Admin creates a class
curl -s -X POST localhost:8080/classes -H 'Content-Type: application/json' \
     -d '{"name":"Class 6 - Morning Shift","totalSeats":120}'
# → {"id":"c_…","name":"Class 6 - Morning Shift","totalSeats":120,…}

# 2. A student applies (identity = 17-digit registration number in X-Student-Id)
curl -s -X POST localhost:8080/classes/<classId>/holds -H 'X-Student-Id: 20152691234567890'
# → {"holdId":"h_…","status":"HELD","expiresAt":"…Z",…}

# 3. Pay the fee (simulated) → confirmed
curl -s -X POST localhost:8080/holds/<holdId>/confirm -H 'X-Student-Id: 20152691234567890'

# 4. Live seat numbers
curl -s localhost:8080/classes
```

---

## API

All endpoints and fields follow BRD §7 exactly; some responses carry extra fields, which the contract allows. Errors are [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) `application/problem+json` bodies with a human-readable `detail` and a machine-readable `code`.

| Method & path | `X-Student-Id` | Success | Errors |
|---|---|---|---|
| `POST /classes` | – | 201 | 400 `VALIDATION_FAILED`, 409 `DUPLICATE_CLASS_NAME` |
| `GET /classes` | – | 200 | – |
| `GET /classes/{classId}` | – | 200 | 404 `NOT_FOUND` |
| `POST /classes/{classId}/holds` | required | 201 | 400 `INVALID_STUDENT_ID`, 404, 409 `SEATS_FULL` / `ALREADY_APPLIED` |
| `GET /holds/{holdId}` | optional | 200 | 400, 404 |
| `POST /holds/{holdId}/confirm` | required | 200 (also when repeated) | 400, 404, 409 `HOLD_EXPIRED` / `HOLD_NOT_ACTIVE` |
| `DELETE /holds/{holdId}` | required | 204 | 400, 404, 409 `CANNOT_CANCEL_CONFIRMED` |
| `GET /me/holds` | required | 200 | 400 |

Every endpoint returns **503 `SERVICE_UNAVAILABLE`** with a friendly message while the database is unreachable, and recovers by itself once the database is back. Hold statuses are `HELD`, `CONFIRMED`, `EXPIRED` and `CANCELLED`. Interpretations of rules the BRD leaves open (such as who may read a hold, or whether a confirmed seat can be cancelled) are listed in [ASSUMPTIONS.md](ASSUMPTIONS.md).

---

## Configuration

Everything is configured with environment variables. Compose provides working defaults. To override them, copy [`.env.example`](.env.example) to `.env` next to `docker-compose.yml`.

| Variable | Default | Purpose |
|---|---|---|
| `HOLD_DURATION_SECONDS` | `600` | How long a seat stays on hold before it expires |
| `EXPIRY_SWEEP_INTERVAL_SECONDS` | `5` | How often expired holds are returned to the pool |
| `ConnectionStrings__Default` | built by compose from `POSTGRES_*` | PostgreSQL connection string (required when running outside compose) |
| `DB_POOL_SIZE` | `50` | Max DB connections per backend instance |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Comma-separated browser origins allowed to call the API |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `school_admission` / `sas` / `sas_dev_password` | Database credentials (development defaults; change for any shared deployment) |
| `POSTGRES_PORT` | `5432` | Host port of the database |
| `POSTGRES_MAX_CONNECTIONS` | `200` | Room for several API instances (50 each) plus admin connections |

Invalid values, such as a non-positive hold duration, stop the API at startup with a clear message instead of producing surprising behaviour later.

---

## How overbooking is prevented

The rule `heldSeats + confirmedSeats <= totalSeats` is enforced by **PostgreSQL itself**, so it holds for any number of API instances:

1. **Atomic seat claim.** `UPDATE classes SET held_seats = held_seats + 1 WHERE id = $1 AND held_seats + confirmed_seats < total_seats`. The row lock queues concurrent claims for the same class, and Postgres re-checks the condition against the latest data, so the last seat goes to exactly one request.
2. **`CHECK (held_seats + confirmed_seats <= total_seats)`** on the table is a last line of defence. A mutation test shows it blocks overbooking even if the application logic is removed.
3. **Exactly-once state changes.** Confirm, cancel and expiry each change a hold only `WHERE status = 'HELD'`, in the same statement that adjusts the counters. Double-clicks and races therefore count once.
4. **One active application per student per class** is enforced by a partial unique index.
5. **Automatic expiry with no external call.** A background sweeper in every instance returns expired seats. It uses an advisory lock and `FOR UPDATE SKIP LOCKED`, so instances never double-release. Reads report a timed-out hold as `EXPIRED` at exactly `expiresAt`, even before the sweeper runs.

Details, pseudo-SQL and the full reasoning: [project_docs/02-architecture.md](project_docs/02-architecture.md).

---

## Tests

177 automated backend tests (xUnit) run against a **real PostgreSQL 16** started automatically by [Testcontainers](https://dotnet.testcontainers.org/). They include the mandatory concurrency tests:

| Test (`backend/tests/SchoolAdmission.Api.Tests/ConcurrencyTests.cs`) | Proves |
|---|---|
| 200 simultaneous applicants for 5 seats | exactly 5 × 201, 195 × 409 |
| The same race split across **two API instances** on one database | no overbooking across processes |
| One student applying 20 times at once on two instances | exactly one hold |
| Mixed workload on two instances (apply, double-click confirm, cancel, expire, retry) | invariant holds in **every** sample taken during the run, not just at the end |

Each concurrency test asserts the invariant through the API **and** directly in the database, where the counters must also equal the actual rows.

### Run the tests

With the .NET 10 SDK and Docker installed:

```bash
cd backend
dotnet test
```

With **Docker only** (no .NET SDK needed):

```bash
cd backend
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD":/src -w /src \
  --add-host=host.docker.internal:host-gateway \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
  mcr.microsoft.com/dotnet/sdk:10.0 \
  dotnet test tests/SchoolAdmission.Api.Tests --artifacts-path /tmp/artifacts
```

A full run takes about 20 seconds after the images are downloaded.

### Multi-instance check (BRD §5 bonus) against the real containers

```bash
docker compose --profile multi up -d --build   # backend on :8080 and backend2 on :8081, same database
./scripts/multi-instance-check.sh 10 500       # 10 seats, 500 simultaneous requests split across both
```

The script prints how many seats each instance handed out. It confirms every winning hold on both instances at once and checks the result in the API and in PostgreSQL. It exits non-zero on any violation. It needs bash, curl and Docker.

---

## Local development (without Docker for the API)

```bash
docker compose up -d db                               # PostgreSQL on localhost:5432
dotnet run --project backend/src/SchoolAdmission.Api  # API on http://localhost:8080 (Development settings)
```

---

## Project structure

```
backend/
  Dockerfile                    multi-stage build, non-root runtime, health check
  src/SchoolAdmission.Api/
    Program.cs                  composition root
    Classes/                    class endpoints and service
    Holds/                      hold endpoints, service, and HoldSql.cs (all concurrency-critical SQL)
    Expiry/                     background sweeper that returns expired seats
    Infrastructure/             DbContext, schema configuration, migrations, errors, validation
  tests/SchoolAdmission.Api.Tests/
frontend/                       React + Vite application
scripts/multi-instance-check.sh
project_docs/                   BRD, plan, architecture, decisions
docker-compose.yml
```

---

## Frontend

The frontend lives in [`/frontend`](frontend). `docker-compose.yml` contains a ready-made `frontend` service (port 3000, API URL passed as the `VITE_API_BASE_URL` build argument), which is enabled once the frontend's Dockerfile is in place. The API already allows CORS from `http://localhost:5173` (Vite dev server) and `http://localhost:3000`, and exposes the `Date` response header so the hold countdown can use the server clock.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `port is already allocated` (8080 or 5432) | Stop the other process, or change `POSTGRES_PORT` in `.env`. |
| API returns 503 | The database is not reachable. Check `docker compose ps`; the API recovers automatically. |
| API exits at startup with a configuration message | A variable in `.env` has an invalid value; the message names it. |
| You want an empty database | `docker compose down -v` (deletes all data). |
