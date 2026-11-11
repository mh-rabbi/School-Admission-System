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

This starts three containers: the database, the API and the web app. Open **http://localhost:3000** (use `localhost`, not `127.0.0.1`, see [Troubleshooting](#troubleshooting)).

| What | URL |
|---|---|
| API | http://localhost:8080 |
| Swagger UI | http://localhost:8080/swagger |
| OpenAPI document | http://localhost:8080/openapi/v1.json |
| Health check | http://localhost:8080/health |
| **Web app (frontend)** | **http://localhost:3000** |

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
| `VITE_API_BASE_URL` | `http://localhost:8080` | Address the **browser** uses to reach the API. Baked into the web app at build time: after changing it run `docker compose up --build` |
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

179 automated backend tests (xUnit) run against a **real PostgreSQL 16** started automatically by [Testcontainers](https://dotnet.testcontainers.org/). They include the mandatory concurrency tests:

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

### Frontend

A React 18 + TypeScript single-page app (Vite), served by nginx on **http://localhost:3000**. There is no login: guardians type their 17-digit student registration number into the field at the top of the page, and it is sent as `X-Student-Id`. The number is kept in the browser, so it survives a refresh or restart.

| Screen | What it does |
|---|---|
| **Classes** | Live seat numbers (total / held / confirmed / available), refreshed every 3 s without a reload. **আবেদন করুন** puts a seat on hold. Above the list, **Your active applications** show the countdown with **ভর্তি ফি দিন** (simulated payment) and **বাতিল** (cancel). |
| **My Applications** | Every past and present application of that ID with its status (`HELD`, `CONFIRMED`, `EXPIRED`, `CANCELLED`). |
| **Admin** | Create a class (name and total seats). There is no login, so anyone can use it (BRD §2.2). |
| **How it works** | A short landing page with real, live seat totals. |

Behaviour worth knowing:

- **Countdown.** It uses the server's `expiresAt` and the server's clock (read from the HTTP `Date` header, which the API exposes through CORS), so a wrong phone clock does not matter. At zero the application turns `EXPIRED` and **Pay** is disabled immediately, then the app confirms with the server, which always has the final say.
- **Errors** (seats full, hold expired, invalid input, server down) appear as plain-language messages, never raw codes. While the server is unreachable the last known seat numbers stay visible with a notice, and the page recovers by itself.
- **Double-clicks** send one request; the backend is idempotent as well.
- **Accessibility.** Keyboard operable, screen-reader labels and announcements, light/dark theme (follows the system, switchable), reduced-motion respected, usable from 360 px wide, colour contrast checked by an automated test.

The API address is `VITE_API_BASE_URL` (default `http://localhost:8080`), read when the image is built. The API allows CORS from `http://localhost:3000` (this container) and `http://localhost:5173` (Vite dev server). See [Frontend tests](#frontend-tests-brd-92-bonus) and [Local development](#local-development-without-docker-for-the-api).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `port is already allocated` (8080 or 5432) | Stop the other process, or change `POSTGRES_PORT` in `.env`. |
| The web app says it **can't reach the server** although the API runs | Open it as `http://localhost:3000`. The API allows CORS only for `localhost` origins, so `http://127.0.0.1:3000` (or a LAN address) is blocked by the browser. To allow another origin, add it to `CORS_ALLOWED_ORIGINS`. |
| The web app calls the wrong API address | `VITE_API_BASE_URL` is baked in at build time. Change it, then run `docker compose up --build`. |
| The page is blank | The app needs JavaScript. A message in the page says so when it is disabled. |
| API returns 503 | The database is not reachable. Check `docker compose ps`; the API recovers automatically. |
| API exits at startup with a configuration message | A variable in `.env` has an invalid value; the message names it. |
| You want an empty database | `docker compose down -v` (deletes all data). |
