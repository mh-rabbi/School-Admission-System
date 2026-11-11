# API Verification Report (live build, run and API calls)

| | |
|---|---|
| Date | 2026-11-11, live run 14:24:44Z – 14:25:36Z (UTC) |
| Code under test | commit `ba65dae` (backend unchanged since) |
| Requirements | [BRD.md](BRD.md) §4.2, §5, §6, §7, §8, §9.2 |
| Result | **Build OK · 177/177 automated tests · 100/100 live API checks passed** |

## 1. Purpose and short answer

**Question:** do the BRD backend requirements work when the API is called for real, request by request?

**Before this report:** yes, with one gap.
- **177 automated tests** call every endpoint over HTTP against a real PostgreSQL started by Testcontainers. They check status codes, BRD §7 field names, error codes, concurrency and the database invariant.
- Each implementation step was also spot-checked manually with `curl` against the running server and containers. Examples: 100 or 300 parallel applies, persistence across `down`/`up`, and a database outage.
- **Gap:** no single, recorded request-and-response transcript of every endpoint against the Docker deployment existed.

**This report closes that gap.** It records one clean end-to-end run against the real `docker compose` stack:
- 2 API instances on one PostgreSQL;
- every BRD §7 endpoint, with success and error cases;
- automatic expiry, concurrency, multi-instance safety, persistence and a database outage.

Every request and response is in §6 exactly as received.

## 2. How the test was run

| Item | Value |
|---|---|
| Build | `dotnet build -c Release` → **0 warnings, 0 errors** (.NET SDK 10.0.114, warnings as errors) |
| Automated tests | `dotnet test -c Release` → **Passed 177, Failed 0, Skipped 0** (19 s) |
| Deployment | `docker compose --profile multi up -d --build` (Docker 29.9.3, Compose v5.7.0) |
| Instances | API **A** = `http://localhost:8080`, API **B** = `http://localhost:8081` (`backend2`), both on the same PostgreSQL 16 |
| Isolation | Compose project `sas-apitest`, with its own volume and the database on host port 55432. The developer's dev database (`school-admission`) was not touched. |
| Settings | Root `.env` = BRD defaults: `HOLD_DURATION_SECONDS=600`, `EXPIRY_SWEEP_INTERVAL_SECONDS=5`. **Only for §10 (expiry)** both instances were recreated with `HOLD_DURATION_SECONDS=10`, `EXPIRY_SWEEP_INTERVAL_SECONDS=2`, so the demo didn't need a 10-minute wait. Defaults were restored for §11 onwards. |
| Client | `curl` 8.5.0, `jq`; parallel load with `xargs -P`; ground truth with `psql` inside the db container |
| Start state | Empty database (fresh volume) |

Each check compares the HTTP status (or a value) with the expected one. Where it matters, the result is also checked in PostgreSQL directly, so the report doesn't rely on the API's own view of itself.

## 3. Result per BRD requirement

| BRD | Requirement | Evidence (§6) | Result |
|---|---|---|---|
| §6 | API on `http://localhost:8080`, DB connection string from environment, Docker Compose | 1.1–1.4, whole run | ✅ |
| §7.1 | `POST /classes` → 201 `{id, name, totalSeats}` | 2.1–2.3 | ✅ |
| §7.2 | `GET /classes` → 200 list with `heldSeats`, `confirmedSeats`, `availableSeats` | 3.1 | ✅ |
| §7.3 | `GET /classes/{classId}` → 200 | 3.2 | ✅ |
| §7.4 | `POST /classes/{classId}/holds` + `X-Student-Id` → 201 `{holdId, classId, studentId, status, expiresAt}`; **409 when full** | 4.1, 4.9, 4.10 | ✅ |
| §7.5 | `GET /holds/{holdId}` → 200 `{holdId, classId, status, expiresAt}`; statuses HELD / CONFIRMED / EXPIRED / CANCELLED all observed | 5.1–5.5, 7.4, 10.4 | ✅ |
| §7.6 | `POST /holds/{holdId}/confirm` → 200 `{holdId, status: "CONFIRMED"}` | 6.3 | ✅ |
| §7.7 | `DELETE /holds/{holdId}` → 204 No Content | 7.2 | ✅ |
| §7.8 | `GET /me/holds` → 200 `[{holdId, classId, className, status, expiresAt}]` | 8.1–8.3 | ✅ |
| §4.2 | Hold lasts `HOLD_DURATION_SECONDS` | 4.1c (600 s), 10.2a (10 s) | ✅ |
| §4.2 | **Automatic expiry without an API call**: seat returned to the pool | 10.3a (stored row EXPIRED and `held_seats` 0 in PostgreSQL before any API call), 10.4–10.7 | ✅ |
| §4.2 | Only the owner can confirm, and only an unexpired HELD hold | 6.1, 7.6, 10.6 | ✅ |
| §4.2 | **Idempotent confirm**: `confirmedSeats` increments once | 6.3–6.6a (3 calls), 11.4 (20 simultaneous calls on 2 instances) | ✅ |
| §4.2 | One active application per student per class | 4.3, 7.9, 11.5 (20 simultaneous on 2 instances → 1 hold), 12.3 | ✅ |
| §5 | **No overbooking** under concurrency | 11.1 (200 simultaneous → exactly 5 of 5 seats), 11.3b, 14.1 | ✅ |
| §5 | **Multi-instance safety** (bonus) | 11.1–11.6 (two instances, same DB; repository script with 500 requests) | ✅ |
| §5 | **Persistence** across `docker compose down` / `up` | 12.1–12.3 | ✅ |
| §8 | 400 invalid input, 404 not found, 409 conflicts; friendly messages | 2.4–2.10, 3.3–3.4, 4.5–4.8, 5.3–5.4, 9.1–9.3, 13.1–13.3 | ✅ |
| §9.2 | Concurrency test proving `held + confirmed <= totalSeats` | automated suite (177 tests) + live 11.1–11.6 | ✅ |

**Not covered here:** the frontend (BRD §4.1, §6 "Frontend", §9.2 bonus). `/frontend` is a separate workstream that has not landed yet, so the `frontend` compose service is still commented out.

## 4. Observations

1. **One check failed in a first run because of how I designed the test; there was no product defect.** In §10, a 10-second hold was still active when the "before" snapshot of the persistence check (§12) was taken. It then expired correctly during the ~10-second `down`/`up`, so `Class 9` changed from `1 held / 0 available` to `0 held / 1 available`.
   - The database showed the hold expiring at 14:21:58 and being released by the restarted instance at 14:22:05. So the first run also showed expiry continuing across a restart.
   - Repeating the comparison with stable data gave identical output.
   - The script was fixed: step 10.8 cancels that hold. The whole run was then repeated on a fresh database, and that clean run is the one recorded here.
2. **Seat distribution across instances.** In §11.1 all 5 seats happened to be won by requests sent to instance A, which simply received its requests a moment earlier. In §11.6 the 10 seats split 4 (A) / 6 (B). Both instances therefore hand out seats from the same pool, and neither oversold.
3. **Logs.** All Error-level lines in the API logs since the §12 restart appeared between 14:25:29 and 14:25:32, the deliberate database outage in §13.
   - They come from EF Core and the health check reporting the stopped database.
   - The API's own handler logged those requests as Warnings and returned 503 with a friendly message.
   - No errors were logged during normal operation or under concurrent load.
4. **The API recovered from the database outage by itself**, without a restart (13.3).
5. Behaviour the BRD leaves open is documented in [ASSUMPTIONS.md](../ASSUMPTIONS.md). Examples: 409 for cancelling a confirmed admission, 404 for another student's hold, and 204 for repeating a cancel.

## 5. All checks

| # | Check | Expected | Actual | Result |
|---|---|---|---|---|
| 1.1 | Health check | `200` | `200` | ✅ PASS |
| 1.2 | OpenAPI document served | `200` | `200` | ✅ PASS |
| 1.2a | Distinct paths documented (6 paths = the 8 BRD endpoints) | `6` | `6` | ✅ PASS |
| 1.3 | Swagger UI | `200` | `200` | ✅ PASS |
| 1.4 | CORS preflight from the Vite dev origin | `204` | `204` | ✅ PASS |
| 2.1 | Create class (BRD example) | `201` | `201` | ✅ PASS |
| 2.2 | Create class with 3 seats (name is trimmed) | `201` | `201` | ✅ PASS |
| 2.2a | Name returned trimmed | `Class 7 - Day Shift` | `Class 7 - Day Shift` | ✅ PASS |
| 2.3 | Create class with 1 seat | `201` | `201` | ✅ PASS |
| 2.4 | Duplicate name, different case → 409 | `409` | `409` | ✅ PASS |
| 2.5 | totalSeats = 0 → 400 | `400` | `400` | ✅ PASS |
| 2.6 | Blank name → 400 | `400` | `400` | ✅ PASS |
| 2.7 | Missing totalSeats → 400 | `400` | `400` | ✅ PASS |
| 2.8 | Malformed JSON → 400 | `400` | `400` | ✅ PASS |
| 2.9 | Wrong type (totalSeats as text) → 400 | `400` | `400` | ✅ PASS |
| 2.10 | Non-JSON content type → 415 | `415` | `415` | ✅ PASS |
| 3.1 | List all classes | `200` | `200` | ✅ PASS |
| 3.1a | Number of classes | `3` | `3` | ✅ PASS |
| 3.2 | Get one class | `200` | `200` | ✅ PASS |
| 3.3 | Unknown class id → 404 | `404` | `404` | ✅ PASS |
| 3.4 | Malformed class id → 404 | `404` | `404` | ✅ PASS |
| 4.1 | Student 1 applies to Class 7 (3 seats) | `201` | `201` | ✅ PASS |
| 4.1a | Status of the new hold | `HELD` | `HELD` | ✅ PASS |
| 4.1b | studentId echoed | `20152691234567890` | `20152691234567890` | ✅ PASS |
| 4.1c | expiresAt ≈ now + HOLD_DURATION_SECONDS (600 s, ±5 s) | `ok` | `ok` | ✅ PASS |
| 4.2 | Class stats after the hold | `200` | `200` | ✅ PASS |
| 4.2a | held / confirmed / available | `1/0/2` | `1/0/2` | ✅ PASS |
| 4.3 | Same student applies to the same class again → 409 | `409` | `409` | ✅ PASS |
| 4.4 | Same student applies to a different class (allowed) | `201` | `201` | ✅ PASS |
| 4.5 | Missing X-Student-Id → 400 | `400` | `400` | ✅ PASS |
| 4.6 | X-Student-Id with 16 digits → 400 | `400` | `400` | ✅ PASS |
| 4.7 | X-Student-Id with letters → 400 | `400` | `400` | ✅ PASS |
| 4.8 | Unknown class → 404 | `404` | `404` | ✅ PASS |
| 4.9 | Student 2 takes the only seat of Class 8 | `201` | `201` | ✅ PASS |
| 4.10 | Student 3 applies to the full Class 8 → 409 | `409` | `409` | ✅ PASS |
| 5.1 | Without header (header is optional here) | `200` | `200` | ✅ PASS |
| 5.2 | With the owner's header | `200` | `200` | ✅ PASS |
| 5.3 | With another student's header → 404 | `404` | `404` | ✅ PASS |
| 5.4 | Unknown hold → 404 | `404` | `404` | ✅ PASS |
| 5.5 | Read through the second instance (:8081) | `200` | `200` | ✅ PASS |
| 6.1 | Another student tries to confirm → 404 | `404` | `404` | ✅ PASS |
| 6.2 | Missing header → 400 | `400` | `400` | ✅ PASS |
| 6.3 | Owner confirms (simulated payment) | `200` | `200` | ✅ PASS |
| 6.4 | Double-click: confirm again → 200, same body | `200` | `200` | ✅ PASS |
| 6.5 | Confirm again via the other instance | `200` | `200` | ✅ PASS |
| 6.6 | Class stats after 3 confirm calls | `200` | `200` | ✅ PASS |
| 6.6a | confirmedSeats incremented once (held/confirmed/available) | `0/1/2` | `0/1/2` | ✅ PASS |
| 7.1 | Another student tries to cancel → 404 | `404` | `404` | ✅ PASS |
| 7.2 | Owner cancels the hold on Class 8 | `204` | `204` | ✅ PASS |
| 7.3 | Cancel again (idempotent) → 204 | `204` | `204` | ✅ PASS |
| 7.4 | Hold status after cancel | `200` | `200` | ✅ PASS |
| 7.4a | Status | `CANCELLED` | `CANCELLED` | ✅ PASS |
| 7.5 | Seat returned to the pool | `200` | `200` | ✅ PASS |
| 7.5a | held / confirmed / available | `0/0/1` | `0/0/1` | ✅ PASS |
| 7.6 | Confirm a cancelled hold → 409 | `409` | `409` | ✅ PASS |
| 7.7 | Cancel a confirmed admission → 409 (decision D8a) | `409` | `409` | ✅ PASS |
| 7.8 | Student 3 now gets the freed seat | `201` | `201` | ✅ PASS |
| 7.9 | Student 2 re-applies after cancelling → 409 (class full again) | `409` | `409` | ✅ PASS |
| 8.1 | Student 1 (one CONFIRMED, one HELD) | `200` | `200` | ✅ PASS |
| 8.1a | Entries | `2` | `2` | ✅ PASS |
| 8.2 | Student 2 (history keeps the CANCELLED one) | `200` | `200` | ✅ PASS |
| 8.3 | Student with no applications → [] | `200` | `200` | ✅ PASS |
| 8.4 | Missing header → 400 | `400` | `400` | ✅ PASS |
| 9.1 | Unknown route → 404 | `404` | `404` | ✅ PASS |
| 9.2 | Wrong method → 405 | `405` | `405` | ✅ PASS |
| 9.3 | Body over 64 KB → 413 | `413` | `413` | ✅ PASS |
| 10.1 | Create a 1-seat class | `201` | `201` | ✅ PASS |
| 10.2 | Student 1 holds the only seat | `201` | `201` | ✅ PASS |
| 10.2a | expiresAt ≈ now + 10 s (±2 s) | `ok` | `ok` | ✅ PASS |
| 10.3 | Student 2 → 409, class is full | `409` | `409` | ✅ PASS |
| 10.3a | Stored status and held_seats after expiry (released by the background sweeper, no API call) | `EXPIRED \| 0` | `EXPIRED \| 0` | ✅ PASS |
| 10.4 | Hold status now EXPIRED | `200` | `200` | ✅ PASS |
| 10.4a | Status | `EXPIRED` | `EXPIRED` | ✅ PASS |
| 10.5 | Seat is back in the pool | `200` | `200` | ✅ PASS |
| 10.5a | held / confirmed / available | `0/0/1` | `0/0/1` | ✅ PASS |
| 10.6 | Confirm the expired hold → 409 | `409` | `409` | ✅ PASS |
| 10.7 | Student 2 now gets the seat | `201` | `201` | ✅ PASS |
| 10.8 | Student 2 cancels (keeps later snapshots stable) | `204` | `204` | ✅ PASS |
| 11.1 | Create a 5-seat class | `201` | `201` | ✅ PASS |
| 11.1a | 201 responses | `5` | `5` | ✅ PASS |
| 11.1b | 409 SEATS_FULL responses | `195` | `195` | ✅ PASS |
| 11.1c | Other responses | `0` | `0` | ✅ PASS |
| 11.2 | Class stats on instance A | `200` | `200` | ✅ PASS |
| 11.3 | Class stats on instance B | `200` | `200` | ✅ PASS |
| 11.3a | A and B agree: held / confirmed / available | `5/0/0 = 5/0/0` | `5/0/0 = 5/0/0` | ✅ PASS |
| 11.3b | Database: total \| held \| confirmed \| hold rows | `5 \| 5 \| 0 \| 5` | `5 \| 5 \| 0 \| 5` | ✅ PASS |
| 11.4a | All 20 confirms return 200 | `20` | `20` | ✅ PASS |
| 11.4 | Class stats after the storm | `200` | `200` | ✅ PASS |
| 11.4b | confirmedSeats counted once (held/confirmed/available) | `4/1/0` | `4/1/0` | ✅ PASS |
| 11.5 | Create a 10-seat class for the same-student race | `201` | `201` | ✅ PASS |
| 11.5a | Exactly one hold created | `1` | `1` | ✅ PASS |
| 11.5b | Rejected with 409 | `19` | `19` | ✅ PASS |
| 11.6 | scripts/multi-instance-check.sh 10 500 exit code | `0` | `0` | ✅ PASS |
| 12.1 | GET /classes identical after restart | `same` | `same` | ✅ PASS |
| 12.2 | GET /me/holds identical after restart | `same` | `same` | ✅ PASS |
| 12.3 | Rules still enforced on persisted data: student 1 re-applies to Class 7 | `409` | `409` | ✅ PASS |
| 13.1 | List classes while the database is down → 503 | `503` | `503` | ✅ PASS |
| 13.2 | Health check while the database is down → 503 | `503` | `503` | ✅ PASS |
| 13.3 | Same call after the database is back (API not restarted) | `200` | `200` | ✅ PASS |
| 14.1 | Classes violating held+confirmed<=total or counter≠rows | `0` | `0` | ✅ PASS |

**Total: 100 checks, 100 passed, 0 failed.**

## 6. Requests and responses (verbatim)

Each block shows the request sent and the response received (status line, relevant headers, body). Large bodies (OpenAPI, Swagger HTML) are truncated. IDs and timestamps are from this run.

### 6.1 Service endpoints

#### 1.1 · Health check

```http
GET /health HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: text/plain

Healthy
```

#### 1.2 · OpenAPI document served

```http
GET /openapi/v1.json HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json;charset=utf-8

{
  "openapi": "3.1.1",
  "info": {
    "title": "SchoolAdmission.Api | v1",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "http://localhost:8080/"
    }
  ],
  "paths": {
… (truncated: 14653 bytes, 636 lines)
```

- **Check 1.2a** – Distinct paths documented (6 paths = the 8 BRD endpoints): expected `6`, got `6` → **PASS**
#### 1.3 · Swagger UI

```http
GET /swagger/index.html HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: text/html;charset=utf-8

<!-- HTML for static distribution bundle build -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Swagger UI</title>
    <link rel="stylesheet" type="text/css" href="./swagger-ui.css">
    <link rel="stylesheet" type="text/css" href="./index.css">
    <link rel="icon" type="image/png" href="./favicon-32x32.png" sizes="32x32" />
    <link rel="icon" type="image/png" href="./favicon-16x16.png" sizes="16x16" />
       
</head>

<body>
    <div id="swagger-ui"></div>

    <script src="./swagger-ui-bundle.js" charset="utf-8"></script>
    <script src="./swagger-ui-standalone-preset.js" charset="utf-8"></script>
    <script src="index.js" charset="utf-8"></script>
</body>
</html>
```

#### 1.4 · CORS preflight from the Vite dev origin

```http
OPTIONS /classes HTTP/1.1
Host: localhost:8080
Origin: http://localhost:5173
Access-Control-Request-Method: POST
Access-Control-Request-Headers: x-student-id,content-type
```
Response — expected `204`, got `204` → **PASS**

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Headers: x-student-id,content-type
Access-Control-Allow-Methods: POST
Access-Control-Allow-Origin: http://localhost:5173

(empty body)
```

### 6.2 §7.1 Create class — POST /classes

#### 2.1 · Create class (BRD example)

```http
POST /classes HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{"name":"Class 6 - Morning Shift","totalSeats":120}
```
Response — expected `201`, got `201` → **PASS**

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Location: /classes/c_01a1caff67167d9ca03a120f6c207e21

{
  "id": "c_01a1caff67167d9ca03a120f6c207e21",
  "name": "Class 6 - Morning Shift",
  "totalSeats": 120,
  "heldSeats": 0,
  "confirmedSeats": 0,
  "availableSeats": 120
}
```

#### 2.2 · Create class with 3 seats (name is trimmed)

```http
POST /classes HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{"name":"  Class 7 - Day Shift  ","totalSeats":3}
```
Response — expected `201`, got `201` → **PASS**

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Location: /classes/c_01a1caff67337900bdb42daf11412024

{
  "id": "c_01a1caff67337900bdb42daf11412024",
  "name": "Class 7 - Day Shift",
  "totalSeats": 3,
  "heldSeats": 0,
  "confirmedSeats": 0,
  "availableSeats": 3
}
```

- **Check 2.2a** – Name returned trimmed: expected `Class 7 - Day Shift`, got `Class 7 - Day Shift` → **PASS**
#### 2.3 · Create class with 1 seat

```http
POST /classes HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{"name":"Class 8 - Morning Shift","totalSeats":1}
```
Response — expected `201`, got `201` → **PASS**

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Location: /classes/c_01a1caff674f7b0bb26bcc5b06758e15

{
  "id": "c_01a1caff674f7b0bb26bcc5b06758e15",
  "name": "Class 8 - Morning Shift",
  "totalSeats": 1,
  "heldSeats": 0,
  "confirmedSeats": 0,
  "availableSeats": 1
}
```

#### 2.4 · Duplicate name, different case → 409

```http
POST /classes HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{"name":"class 6 - MORNING shift","totalSeats":50}
```
Response — expected `409`, got `409` → **PASS**

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.10",
  "title": "Conflict",
  "status": 409,
  "detail": "A class named 'class 6 - MORNING shift' already exists. Please choose a different name.",
  "code": "DUPLICATE_CLASS_NAME",
  "traceId": "00-0c480d6097d8f801d6647e74b0d87355-57b3b00066d0b3dc-00"
}
```

#### 2.5 · totalSeats = 0 → 400

```http
POST /classes HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{"name":"Class 9","totalSeats":0}
```
Response — expected `400`, got `400` → **PASS**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "Invalid request",
  "status": 400,
  "detail": "Total seats must be between 1 and 10,000.",
  "code": "VALIDATION_FAILED",
  "traceId": "00-5eb8816c108242bd6fe1ed1ad374177d-c354c914fc63b7a5-00"
}
```

#### 2.6 · Blank name → 400

```http
POST /classes HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{"name":"   ","totalSeats":10}
```
Response — expected `400`, got `400` → **PASS**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "Invalid request",
  "status": 400,
  "detail": "Class name is required.",
  "code": "VALIDATION_FAILED",
  "traceId": "00-2ebfda5b5b19bc74744fd8998a7b3e49-6796ff494e3f852b-00"
}
```

#### 2.7 · Missing totalSeats → 400

```http
POST /classes HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{"name":"Class 9"}
```
Response — expected `400`, got `400` → **PASS**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "Invalid request",
  "status": 400,
  "detail": "Total seats is required.",
  "code": "VALIDATION_FAILED",
  "traceId": "00-c5e14c8f27a731c0907f37bc8efa3ab3-af307ad619a0625c-00"
}
```

#### 2.8 · Malformed JSON → 400

```http
POST /classes HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{"name":"Class 9",
```
Response — expected `400`, got `400` → **PASS**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "Invalid request",
  "status": 400,
  "detail": "The request is malformed. Please check the submitted data and try again.",
  "code": "VALIDATION_FAILED",
  "traceId": "00-347262acc4629bc073e69bb054087450-dabd15c458a2c843-00"
}
```

#### 2.9 · Wrong type (totalSeats as text) → 400

```http
POST /classes HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{"name":"Class 9","totalSeats":"many"}
```
Response — expected `400`, got `400` → **PASS**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "Invalid request",
  "status": 400,
  "detail": "The request is malformed. Please check the submitted data and try again.",
  "code": "VALIDATION_FAILED",
  "traceId": "00-2d148613e4759f8a31aee3f96b42972a-1c2759ad16bf5316-00"
}
```

#### 2.10 · Non-JSON content type → 415

```http
POST /classes HTTP/1.1
Host: localhost:8080
Content-Type: text/plain

Class 9
```
Response — expected `415`, got `415` → **PASS**

```http
HTTP/1.1 415 Unsupported Media Type
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.16",
  "title": "Unsupported Media Type",
  "status": 415,
  "detail": "The request could not be completed.",
  "traceId": "00-0d23b0108872c821e40750fb279b063c-3fce4b9ae7c3ff24-00",
  "code": "UNSUPPORTED_MEDIA_TYPE"
}
```

### 6.3 §7.2 / §7.3 List and get classes

#### 3.1 · List all classes

```http
GET /classes HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

[
  {
    "id": "c_01a1caff67167d9ca03a120f6c207e21",
    "name": "Class 6 - Morning Shift",
    "totalSeats": 120,
    "heldSeats": 0,
    "confirmedSeats": 0,
    "availableSeats": 120
  },
  {
    "id": "c_01a1caff67337900bdb42daf11412024",
    "name": "Class 7 - Day Shift",
    "totalSeats": 3,
    "heldSeats": 0,
    "confirmedSeats": 0,
    "availableSeats": 3
  },
  {
    "id": "c_01a1caff674f7b0bb26bcc5b06758e15",
    "name": "Class 8 - Morning Shift",
    "totalSeats": 1,
    "heldSeats": 0,
    "confirmedSeats": 0,
    "availableSeats": 1
  }
]
```

- **Check 3.1a** – Number of classes: expected `3`, got `3` → **PASS**
#### 3.2 · Get one class

```http
GET /classes/c_01a1caff67167d9ca03a120f6c207e21 HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": "c_01a1caff67167d9ca03a120f6c207e21",
  "name": "Class 6 - Morning Shift",
  "totalSeats": 120,
  "heldSeats": 0,
  "confirmedSeats": 0,
  "availableSeats": 120
}
```

#### 3.3 · Unknown class id → 404

```http
GET /classes/c_0190f0aa0000700080000000000000ff HTTP/1.1
Host: localhost:8080
```
Response — expected `404`, got `404` → **PASS**

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.5",
  "title": "Not found",
  "status": 404,
  "detail": "The requested class does not exist.",
  "code": "NOT_FOUND",
  "traceId": "00-86119daa052475cd9dd6eee0e7b5593f-f4b3099d199364bf-00"
}
```

#### 3.4 · Malformed class id → 404

```http
GET /classes/123 HTTP/1.1
Host: localhost:8080
```
Response — expected `404`, got `404` → **PASS**

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.5",
  "title": "Not found",
  "status": 404,
  "detail": "The requested class does not exist.",
  "code": "NOT_FOUND",
  "traceId": "00-8460668a254baa481f0681df9da15912-1dcf75f2321dcc10-00"
}
```

### 6.4 §7.4 Apply / hold seat — POST /classes/{classId}/holds

#### 4.1 · Student 1 applies to Class 7 (3 seats)

```http
POST /classes/c_01a1caff67337900bdb42daf11412024/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567890
```
Response — expected `201`, got `201` → **PASS**

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Location: /holds/h_01a1caff691d705cb071620fa6440060

{
  "holdId": "h_01a1caff691d705cb071620fa6440060",
  "classId": "c_01a1caff67337900bdb42daf11412024",
  "studentId": "20152691234567890",
  "status": "HELD",
  "expiresAt": "2026-11-11T14:34:58.650983Z"
}
```

- **Check 4.1a** – Status of the new hold: expected `HELD`, got `HELD` → **PASS**
- **Check 4.1b** – studentId echoed: expected `20152691234567890`, got `20152691234567890` → **PASS**
- **Check 4.1c** – expiresAt ≈ now + HOLD_DURATION_SECONDS (600 s, ±5 s): expected `ok`, got `ok` → **PASS**
#### 4.2 · Class stats after the hold

```http
GET /classes/c_01a1caff67337900bdb42daf11412024 HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": "c_01a1caff67337900bdb42daf11412024",
  "name": "Class 7 - Day Shift",
  "totalSeats": 3,
  "heldSeats": 1,
  "confirmedSeats": 0,
  "availableSeats": 2
}
```

- **Check 4.2a** – held / confirmed / available: expected `1/0/2`, got `1/0/2` → **PASS**
#### 4.3 · Same student applies to the same class again → 409

```http
POST /classes/c_01a1caff67337900bdb42daf11412024/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567890
```
Response — expected `409`, got `409` → **PASS**

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.10",
  "title": "Conflict",
  "status": 409,
  "detail": "You already have an active application for this class.",
  "code": "ALREADY_APPLIED",
  "traceId": "00-b64253b6a5f6973d18093addb1740706-518e2a617e9689ec-00"
}
```

#### 4.4 · Same student applies to a different class (allowed)

```http
POST /classes/c_01a1caff67167d9ca03a120f6c207e21/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567890
```
Response — expected `201`, got `201` → **PASS**

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Location: /holds/h_01a1caff69857f8f80c24fa44a821f8d

{
  "holdId": "h_01a1caff69857f8f80c24fa44a821f8d",
  "classId": "c_01a1caff67167d9ca03a120f6c207e21",
  "studentId": "20152691234567890",
  "status": "HELD",
  "expiresAt": "2026-11-11T14:34:58.756894Z"
}
```

#### 4.5 · Missing X-Student-Id → 400

```http
POST /classes/c_01a1caff67337900bdb42daf11412024/holds HTTP/1.1
Host: localhost:8080
```
Response — expected `400`, got `400` → **PASS**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "Invalid request",
  "status": 400,
  "detail": "Student registration number is required. Please enter your 17-digit registration number.",
  "code": "INVALID_STUDENT_ID",
  "traceId": "00-c599889e2cdf8deef6a90c42295de969-b6b0a1ee2a3fe70c-00"
}
```

#### 4.6 · X-Student-Id with 16 digits → 400

```http
POST /classes/c_01a1caff67337900bdb42daf11412024/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 2015269123456789
```
Response — expected `400`, got `400` → **PASS**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "Invalid request",
  "status": 400,
  "detail": "Student registration number must be exactly 17 digits (0-9).",
  "code": "INVALID_STUDENT_ID",
  "traceId": "00-ad2ad700bcf27dde209134def4eb76df-1956ba4f112b9605-00"
}
```

#### 4.7 · X-Student-Id with letters → 400

```http
POST /classes/c_01a1caff67337900bdb42daf11412024/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 2015269123456789A
```
Response — expected `400`, got `400` → **PASS**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "Invalid request",
  "status": 400,
  "detail": "Student registration number must be exactly 17 digits (0-9).",
  "code": "INVALID_STUDENT_ID",
  "traceId": "00-b635a4aaed9abcecef13f6e6944ec0cb-a4ffab8e78a5b03b-00"
}
```

#### 4.8 · Unknown class → 404

```http
POST /classes/c_0190f0aa0000700080000000000000ff/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567890
```
Response — expected `404`, got `404` → **PASS**

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.5",
  "title": "Not found",
  "status": 404,
  "detail": "The requested class does not exist.",
  "code": "NOT_FOUND",
  "traceId": "00-11c0fd2124f0924f97bfa39835e98a2b-77eb57de86ee0856-00"
}
```

#### 4.9 · Student 2 takes the only seat of Class 8

```http
POST /classes/c_01a1caff674f7b0bb26bcc5b06758e15/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567891
```
Response — expected `201`, got `201` → **PASS**

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Location: /holds/h_01a1caff69ef79a09319ea49f8f64b8c

{
  "holdId": "h_01a1caff69ef79a09319ea49f8f64b8c",
  "classId": "c_01a1caff674f7b0bb26bcc5b06758e15",
  "studentId": "20152691234567891",
  "status": "HELD",
  "expiresAt": "2026-11-11T14:34:58.863402Z"
}
```

#### 4.10 · Student 3 applies to the full Class 8 → 409

```http
POST /classes/c_01a1caff674f7b0bb26bcc5b06758e15/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567892
```
Response — expected `409`, got `409` → **PASS**

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.10",
  "title": "Conflict",
  "status": 409,
  "detail": "Sorry, all seats in this class are currently taken. Please try again later or choose another class.",
  "code": "SEATS_FULL",
  "traceId": "00-f4e7e19e70a3a9153d8a2fa9f3728753-5f19021dbeb6df5a-00"
}
```

### 6.5 §7.5 Get hold status — GET /holds/{holdId}

#### 5.1 · Without header (header is optional here)

```http
GET /holds/h_01a1caff691d705cb071620fa6440060 HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "holdId": "h_01a1caff691d705cb071620fa6440060",
  "classId": "c_01a1caff67337900bdb42daf11412024",
  "status": "HELD",
  "expiresAt": "2026-11-11T14:34:58.650983Z"
}
```

#### 5.2 · With the owner's header

```http
GET /holds/h_01a1caff691d705cb071620fa6440060 HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567890
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "holdId": "h_01a1caff691d705cb071620fa6440060",
  "classId": "c_01a1caff67337900bdb42daf11412024",
  "status": "HELD",
  "expiresAt": "2026-11-11T14:34:58.650983Z"
}
```

#### 5.3 · With another student's header → 404

```http
GET /holds/h_01a1caff691d705cb071620fa6440060 HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567891
```
Response — expected `404`, got `404` → **PASS**

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.5",
  "title": "Not found",
  "status": 404,
  "detail": "The requested application does not exist.",
  "code": "NOT_FOUND",
  "traceId": "00-1a62e9c16807adba281d8769d89dc446-2205de605f95b69a-00"
}
```

#### 5.4 · Unknown hold → 404

```http
GET /holds/h_0190f0aa0000700080000000000000ff HTTP/1.1
Host: localhost:8080
```
Response — expected `404`, got `404` → **PASS**

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.5",
  "title": "Not found",
  "status": 404,
  "detail": "The requested application does not exist.",
  "code": "NOT_FOUND",
  "traceId": "00-591c8cac99d706656fd32ed27e204eec-3362089a93a10937-00"
}
```

#### 5.5 · Read through the second instance (:8081)

```http
GET /holds/h_01a1caff691d705cb071620fa6440060 HTTP/1.1
Host: localhost:8081
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "holdId": "h_01a1caff691d705cb071620fa6440060",
  "classId": "c_01a1caff67337900bdb42daf11412024",
  "status": "HELD",
  "expiresAt": "2026-11-11T14:34:58.650983Z"
}
```

### 6.6 §7.6 Confirm admission — POST /holds/{holdId}/confirm

#### 6.1 · Another student tries to confirm → 404

```http
POST /holds/h_01a1caff691d705cb071620fa6440060/confirm HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567891
```
Response — expected `404`, got `404` → **PASS**

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.5",
  "title": "Not found",
  "status": 404,
  "detail": "The requested application does not exist.",
  "code": "NOT_FOUND",
  "traceId": "00-e7f2e7eb7380850133388a1e37e2f1a8-27d31cb26a6b4f36-00"
}
```

#### 6.2 · Missing header → 400

```http
POST /holds/h_01a1caff691d705cb071620fa6440060/confirm HTTP/1.1
Host: localhost:8080
```
Response — expected `400`, got `400` → **PASS**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "Invalid request",
  "status": 400,
  "detail": "Student registration number is required. Please enter your 17-digit registration number.",
  "code": "INVALID_STUDENT_ID",
  "traceId": "00-8a631f259292adc309fb9719ea46fbb3-8bdc20f698f4b7c3-00"
}
```

#### 6.3 · Owner confirms (simulated payment)

```http
POST /holds/h_01a1caff691d705cb071620fa6440060/confirm HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567890
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "holdId": "h_01a1caff691d705cb071620fa6440060",
  "status": "CONFIRMED"
}
```

#### 6.4 · Double-click: confirm again → 200, same body

```http
POST /holds/h_01a1caff691d705cb071620fa6440060/confirm HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567890
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "holdId": "h_01a1caff691d705cb071620fa6440060",
  "status": "CONFIRMED"
}
```

#### 6.5 · Confirm again via the other instance

```http
POST /holds/h_01a1caff691d705cb071620fa6440060/confirm HTTP/1.1
Host: localhost:8081
X-Student-Id: 20152691234567890
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "holdId": "h_01a1caff691d705cb071620fa6440060",
  "status": "CONFIRMED"
}
```

#### 6.6 · Class stats after 3 confirm calls

```http
GET /classes/c_01a1caff67337900bdb42daf11412024 HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": "c_01a1caff67337900bdb42daf11412024",
  "name": "Class 7 - Day Shift",
  "totalSeats": 3,
  "heldSeats": 0,
  "confirmedSeats": 1,
  "availableSeats": 2
}
```

- **Check 6.6a** – confirmedSeats incremented once (held/confirmed/available): expected `0/1/2`, got `0/1/2` → **PASS**
### 6.7 §7.7 Cancel application — DELETE /holds/{holdId}

#### 7.1 · Another student tries to cancel → 404

```http
DELETE /holds/h_01a1caff69ef79a09319ea49f8f64b8c HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567890
```
Response — expected `404`, got `404` → **PASS**

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.5",
  "title": "Not found",
  "status": 404,
  "detail": "The requested application does not exist.",
  "code": "NOT_FOUND",
  "traceId": "00-d8a596a099289031ee0d62ed5e2bdda7-cfabe41d96c76b13-00"
}
```

#### 7.2 · Owner cancels the hold on Class 8

```http
DELETE /holds/h_01a1caff69ef79a09319ea49f8f64b8c HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567891
```
Response — expected `204`, got `204` → **PASS**

```http
HTTP/1.1 204 No Content

(empty body)
```

#### 7.3 · Cancel again (idempotent) → 204

```http
DELETE /holds/h_01a1caff69ef79a09319ea49f8f64b8c HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567891
```
Response — expected `204`, got `204` → **PASS**

```http
HTTP/1.1 204 No Content

(empty body)
```

#### 7.4 · Hold status after cancel

```http
GET /holds/h_01a1caff69ef79a09319ea49f8f64b8c HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "holdId": "h_01a1caff69ef79a09319ea49f8f64b8c",
  "classId": "c_01a1caff674f7b0bb26bcc5b06758e15",
  "status": "CANCELLED",
  "expiresAt": "2026-11-11T14:34:58.863402Z"
}
```

- **Check 7.4a** – Status: expected `CANCELLED`, got `CANCELLED` → **PASS**
#### 7.5 · Seat returned to the pool

```http
GET /classes/c_01a1caff674f7b0bb26bcc5b06758e15 HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": "c_01a1caff674f7b0bb26bcc5b06758e15",
  "name": "Class 8 - Morning Shift",
  "totalSeats": 1,
  "heldSeats": 0,
  "confirmedSeats": 0,
  "availableSeats": 1
}
```

- **Check 7.5a** – held / confirmed / available: expected `0/0/1`, got `0/0/1` → **PASS**
#### 7.6 · Confirm a cancelled hold → 409

```http
POST /holds/h_01a1caff69ef79a09319ea49f8f64b8c/confirm HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567891
```
Response — expected `409`, got `409` → **PASS**

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.10",
  "title": "Conflict",
  "status": 409,
  "detail": "This application is no longer active (it was cancelled) and cannot be confirmed.",
  "code": "HOLD_NOT_ACTIVE",
  "traceId": "00-c38bc197205f1ccb5f0524e39ddd9833-7a45543cb3f387dd-00"
}
```

#### 7.7 · Cancel a confirmed admission → 409 (decision D8a)

```http
DELETE /holds/h_01a1caff691d705cb071620fa6440060 HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567890
```
Response — expected `409`, got `409` → **PASS**

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.10",
  "title": "Conflict",
  "status": 409,
  "detail": "This admission is already confirmed and cannot be cancelled online. Please contact the school office.",
  "code": "CANNOT_CANCEL_CONFIRMED",
  "traceId": "00-e1c44c3f5e4955cba606b8c167a869e2-d6d1c7118db9c564-00"
}
```

#### 7.8 · Student 3 now gets the freed seat

```http
POST /classes/c_01a1caff674f7b0bb26bcc5b06758e15/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567892
```
Response — expected `201`, got `201` → **PASS**

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Location: /holds/h_01a1caff6c0075ff817a9a581d187e52

{
  "holdId": "h_01a1caff6c0075ff817a9a581d187e52",
  "classId": "c_01a1caff674f7b0bb26bcc5b06758e15",
  "studentId": "20152691234567892",
  "status": "HELD",
  "expiresAt": "2026-11-11T14:34:59.392101Z"
}
```

#### 7.9 · Student 2 re-applies after cancelling → 409 (class full again)

```http
POST /classes/c_01a1caff674f7b0bb26bcc5b06758e15/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567891
```
Response — expected `409`, got `409` → **PASS**

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.10",
  "title": "Conflict",
  "status": 409,
  "detail": "Sorry, all seats in this class are currently taken. Please try again later or choose another class.",
  "code": "SEATS_FULL",
  "traceId": "00-33b6a72b9d8476c179b952db4e6c8936-0d1fa07937561044-00"
}
```

### 6.8 §7.8 My applications — GET /me/holds

#### 8.1 · Student 1 (one CONFIRMED, one HELD)

```http
GET /me/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567890
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

[
  {
    "holdId": "h_01a1caff69857f8f80c24fa44a821f8d",
    "classId": "c_01a1caff67167d9ca03a120f6c207e21",
    "className": "Class 6 - Morning Shift",
    "status": "HELD",
    "expiresAt": "2026-11-11T14:34:58.756894Z"
  },
  {
    "holdId": "h_01a1caff691d705cb071620fa6440060",
    "classId": "c_01a1caff67337900bdb42daf11412024",
    "className": "Class 7 - Day Shift",
    "status": "CONFIRMED",
    "expiresAt": "2026-11-11T14:34:58.650983Z"
  }
]
```

- **Check 8.1a** – Entries: expected `2`, got `2` → **PASS**
#### 8.2 · Student 2 (history keeps the CANCELLED one)

```http
GET /me/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567891
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

[
  {
    "holdId": "h_01a1caff69ef79a09319ea49f8f64b8c",
    "classId": "c_01a1caff674f7b0bb26bcc5b06758e15",
    "className": "Class 8 - Morning Shift",
    "status": "CANCELLED",
    "expiresAt": "2026-11-11T14:34:58.863402Z"
  }
]
```

#### 8.3 · Student with no applications → []

```http
GET /me/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567893
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

[]
```

#### 8.4 · Missing header → 400

```http
GET /me/holds HTTP/1.1
Host: localhost:8080
```
Response — expected `400`, got `400` → **PASS**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "Invalid request",
  "status": 400,
  "detail": "Student registration number is required. Please enter your 17-digit registration number.",
  "code": "INVALID_STUDENT_ID",
  "traceId": "00-8e0a3d96ab17d474ef458a8aef70065e-70573e5be7e84b3d-00"
}
```

### 6.9 Other HTTP errors

#### 9.1 · Unknown route → 404

```http
GET /does-not-exist HTTP/1.1
Host: localhost:8080
```
Response — expected `404`, got `404` → **PASS**

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.5",
  "title": "Not Found",
  "status": 404,
  "detail": "The requested resource was not found.",
  "traceId": "00-7de8b5853f37eb3f1513dc3a29d24ce3-c86f24c1347bc318-00",
  "code": "NOT_FOUND"
}
```

#### 9.2 · Wrong method → 405

```http
PUT /classes HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{}
```
Response — expected `405`, got `405` → **PASS**

```http
HTTP/1.1 405 Method Not Allowed
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.6",
  "title": "Method Not Allowed",
  "status": 405,
  "detail": "This operation is not supported for this address.",
  "traceId": "00-f342af5305938dd77dcee8f38c8dea41-8b829e64b4417f36-00",
  "code": "METHOD_NOT_ALLOWED"
}
```

#### 9.3 · Body over 64 KB → 413

```http
POST /classes HTTP/1.1
Content-Type: application/json

(70,029-byte JSON body)
```
Response — expected `413`, got `413`

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.14",
  "title": "Content Too Large",
  "status": 413,
  "detail": "The request could not be completed.",
  "traceId": "00-af8a6899cd669133c7e27abacf348d84-7085dc16148ce3fe-00",
  "code": "PAYLOAD_TOO_LARGE"
}
```

### 6.10 Automatic expiry (BRD §4.2)

To avoid waiting 10 minutes, both API containers were recreated with a short hold. Everything else is unchanged:

```console
$ HOLD_DURATION_SECONDS=10 EXPIRY_SWEEP_INTERVAL_SECONDS=2 docker compose --profile multi up -d backend backend2
```

#### 10.1 · Create a 1-seat class

```http
POST /classes HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{"name":"Class 9 - Expiry Demo","totalSeats":1}
```
Response — expected `201`, got `201` → **PASS**

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Location: /classes/c_01a1caff74247139a821de579643c246

{
  "id": "c_01a1caff74247139a821de579643c246",
  "name": "Class 9 - Expiry Demo",
  "totalSeats": 1,
  "heldSeats": 0,
  "confirmedSeats": 0,
  "availableSeats": 1
}
```

#### 10.2 · Student 1 holds the only seat

```http
POST /classes/c_01a1caff74247139a821de579643c246/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567890
```
Response — expected `201`, got `201` → **PASS**

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Location: /holds/h_01a1caff74867338af325c98ff3139a8

{
  "holdId": "h_01a1caff74867338af325c98ff3139a8",
  "classId": "c_01a1caff74247139a821de579643c246",
  "studentId": "20152691234567890",
  "status": "HELD",
  "expiresAt": "2026-11-11T14:25:11.57208Z"
}
```

- **Check 10.2a** – expiresAt ≈ now + 10 s (±2 s): expected `ok`, got `ok` → **PASS**
#### 10.3 · Student 2 → 409, class is full

```http
POST /classes/c_01a1caff74247139a821de579643c246/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567891
```
Response — expected `409`, got `409` → **PASS**

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.10",
  "title": "Conflict",
  "status": 409,
  "detail": "Sorry, all seats in this class are currently taken. Please try again later or choose another class.",
  "code": "SEATS_FULL",
  "traceId": "00-54ec58b28397b928bb69fd7435bac8e5-0481ce185847ba72-00"
}
```

Waiting 14 seconds **without any API call**, then reading the stored row straight from PostgreSQL:

```console
$ psql -c "select h.status, c.held_seats from holds h join classes c on c.id = h.class_id where h.id = '01a1caff-7486-7338-af32-5c98ff3139a8'"
EXPIRED | 0
```
- **Check 10.3a** – Stored status and held_seats after expiry (released by the background sweeper, no API call): expected `EXPIRED | 0`, got `EXPIRED | 0` → **PASS**

#### 10.4 · Hold status now EXPIRED

```http
GET /holds/h_01a1caff74867338af325c98ff3139a8 HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "holdId": "h_01a1caff74867338af325c98ff3139a8",
  "classId": "c_01a1caff74247139a821de579643c246",
  "status": "EXPIRED",
  "expiresAt": "2026-11-11T14:25:11.57208Z"
}
```

- **Check 10.4a** – Status: expected `EXPIRED`, got `EXPIRED` → **PASS**
#### 10.5 · Seat is back in the pool

```http
GET /classes/c_01a1caff74247139a821de579643c246 HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": "c_01a1caff74247139a821de579643c246",
  "name": "Class 9 - Expiry Demo",
  "totalSeats": 1,
  "heldSeats": 0,
  "confirmedSeats": 0,
  "availableSeats": 1
}
```

- **Check 10.5a** – held / confirmed / available: expected `0/0/1`, got `0/0/1` → **PASS**
#### 10.6 · Confirm the expired hold → 409

```http
POST /holds/h_01a1caff74867338af325c98ff3139a8/confirm HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567890
```
Response — expected `409`, got `409` → **PASS**

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.10",
  "title": "Conflict",
  "status": 409,
  "detail": "Your seat hold has expired, so admission can no longer be confirmed. Please apply again if seats are available.",
  "code": "HOLD_EXPIRED",
  "traceId": "00-17dce97461a8be1cd5f24429795b5206-b94e9b769d62997a-00"
}
```

#### 10.7 · Student 2 now gets the seat

```http
POST /classes/c_01a1caff74247139a821de579643c246/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567891
```
Response — expected `201`, got `201` → **PASS**

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Location: /holds/h_01a1caffacd972ff8fbf4571cf598c7e

{
  "holdId": "h_01a1caffacd972ff8fbf4571cf598c7e",
  "classId": "c_01a1caff74247139a821de579643c246",
  "studentId": "20152691234567891",
  "status": "HELD",
  "expiresAt": "2026-11-11T14:25:25.993421Z"
}
```

_Student 2 cancels this 10-second hold so it cannot expire during the persistence check in §12, which would change the numbers legitimately._

#### 10.8 · Student 2 cancels (keeps later snapshots stable)

```http
DELETE /holds/h_01a1caffacd972ff8fbf4571cf598c7e HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567891
```
Response — expected `204`, got `204` → **PASS**

```http
HTTP/1.1 204 No Content

(empty body)
```

### 6.11 Concurrency through the real API (BRD §5, §9.2)

Both instances recreated with the default 600 s hold. Requests are fired with `xargs -P 200`, alternating between instance A (:8080) and instance B (:8081).

#### 11.1 · Create a 5-seat class

```http
POST /classes HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{"name":"Class 10 - Concurrency Demo","totalSeats":5}
```
Response — expected `201`, got `201` → **PASS**

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Location: /classes/c_01a1caffb47976dcb21f1f0cfdeabb44

{
  "id": "c_01a1caffb47976dcb21f1f0cfdeabb44",
  "name": "Class 10 - Concurrency Demo",
  "totalSeats": 5,
  "heldSeats": 0,
  "confirmedSeats": 0,
  "availableSeats": 5
}
```

200 different students apply at once:

```console
5 http://localhost:8080 201
95 http://localhost:8080 409
100 http://localhost:8081 409
error codes of the 409s: 195 SEATS_FULL 
```
- **Check 11.1a** – 201 responses: expected `5`, got `5` → **PASS**
- **Check 11.1b** – 409 SEATS_FULL responses: expected `195`, got `195` → **PASS**
- **Check 11.1c** – Other responses: expected `0`, got `0` → **PASS**

#### 11.2 · Class stats on instance A

```http
GET /classes/c_01a1caffb47976dcb21f1f0cfdeabb44 HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": "c_01a1caffb47976dcb21f1f0cfdeabb44",
  "name": "Class 10 - Concurrency Demo",
  "totalSeats": 5,
  "heldSeats": 5,
  "confirmedSeats": 0,
  "availableSeats": 0
}
```

#### 11.3 · Class stats on instance B

```http
GET /classes/c_01a1caffb47976dcb21f1f0cfdeabb44 HTTP/1.1
Host: localhost:8081
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": "c_01a1caffb47976dcb21f1f0cfdeabb44",
  "name": "Class 10 - Concurrency Demo",
  "totalSeats": 5,
  "heldSeats": 5,
  "confirmedSeats": 0,
  "availableSeats": 0
}
```

- **Check 11.3a** – A and B agree: held / confirmed / available: expected `5/0/0 = 5/0/0`, got `5/0/0 = 5/0/0` → **PASS**
```console
$ psql -c "select total_seats, held_seats, confirmed_seats, (hold rows) from classes where id = '01a1caff-b479-76dc-b21f-1f0cfdeabb44'"
5 | 5 | 0 | 5
```
- **Check 11.3b** – Database: total | held | confirmed | hold rows: expected `5 | 5 | 0 | 5`, got `5 | 5 | 0 | 5` → **PASS**

Double-click storm: the same hold confirmed 20 times at once (10 per instance):

```console
10 http://localhost:8080 200
10 http://localhost:8081 200
```
- **Check 11.4a** – All 20 confirms return 200: expected `20`, got `20` → **PASS**
#### 11.4 · Class stats after the storm

```http
GET /classes/c_01a1caffb47976dcb21f1f0cfdeabb44 HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": "c_01a1caffb47976dcb21f1f0cfdeabb44",
  "name": "Class 10 - Concurrency Demo",
  "totalSeats": 5,
  "heldSeats": 4,
  "confirmedSeats": 1,
  "availableSeats": 0
}
```

- **Check 11.4b** – confirmedSeats counted once (held/confirmed/available): expected `4/1/0`, got `4/1/0` → **PASS**
#### 11.5 · Create a 10-seat class for the same-student race

```http
POST /classes HTTP/1.1
Host: localhost:8080
Content-Type: application/json

{"name":"Class 10 - Same Student Race","totalSeats":10}
```
Response — expected `201`, got `201` → **PASS**

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Location: /classes/c_01a1caffb956713498308245de051935

{
  "id": "c_01a1caffb956713498308245de051935",
  "name": "Class 10 - Same Student Race",
  "totalSeats": 10,
  "heldSeats": 0,
  "confirmedSeats": 0,
  "availableSeats": 10
}
```

One student applies 20 times at once across both instances:

```console
1 http://localhost:8080 201
9 http://localhost:8080 409
10 http://localhost:8081 409
```
- **Check 11.5a** – Exactly one hold created: expected `1`, got `1` → **PASS**
- **Check 11.5b** – Rejected with 409: expected `19`, got `19` → **PASS**

#### 11.6 · Repository multi-instance script

```console
$ scripts/multi-instance-check.sh 10 500
✔ both instances healthy: http://localhost:8080  http://localhost:8081
✔ class c_01a1caffb9c07c87bf844d9e6092e452 with 10 seats
… firing 500 simultaneous applies (even → A, odd → B)
  201 Created: 10 (instance A: 4, instance B: 6) | 409 Conflict: 490 | other: 0
✔ exactly 10 of 500 requests got a seat
✔ 20 confirm calls (2 per hold, one on each instance) all returned 200
  API http://localhost:8080 → total=10 held=0 confirmed=10 available=0
  API http://localhost:8081 → total=10 held=0 confirmed=10 available=0
✔ API: held + confirmed <= totalSeats on both instances; each confirm counted once
  DB → total=10 held_seats=0 confirmed_seats=10 | rows: HELD=0 CONFIRMED=10
✔ DB: held + confirmed <= total_seats and counters match the actual rows

PASS — 500 concurrent requests across 2 instances, 10 seats, no overbooking.
$ echo $?
0
```
- **Check 11.6** – scripts/multi-instance-check.sh 10 500 exit code: expected `0`, got `0` → **PASS**

### 6.12 Persistence across `docker compose down` / `up` (BRD §5)

Snapshot before: 7 classes; student 1 has 3 applications.

```console
$ docker compose --profile multi down
 Container sas-apitest-backend2-1 Stopping 
 Container sas-apitest-backend-1 Stopping 
 Container sas-apitest-backend2-1 Stopped 
 Container sas-apitest-backend2-1 Removing 
 Container sas-apitest-backend2-1 Removed 
 Container sas-apitest-backend-1 Stopped 
 Container sas-apitest-backend-1 Removing 
 Container sas-apitest-backend-1 Removed 
 Container sas-apitest-db-1 Stopping 
 Container sas-apitest-db-1 Stopped 
 Container sas-apitest-db-1 Removing 
 Container sas-apitest-db-1 Removed 
 Network sas-apitest_default Removing 
 Network sas-apitest_default Removed 
```

```console
$ docker compose --profile multi up -d   # same named volume, no -v
```

- **Check 12.1** – GET /classes identical after restart: expected `same`, got `same` → **PASS**
- **Check 12.2** – GET /me/holds identical after restart: expected `same`, got `same` → **PASS**
#### 12.3 · Rules still enforced on persisted data: student 1 re-applies to Class 7

```http
POST /classes/c_01a1caff67337900bdb42daf11412024/holds HTTP/1.1
Host: localhost:8080
X-Student-Id: 20152691234567890
```
Response — expected `409`, got `409` → **PASS**

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.10",
  "title": "Conflict",
  "status": 409,
  "detail": "You already have an active application for this class.",
  "code": "ALREADY_APPLIED",
  "traceId": "00-2273dc004099a7bd933471df62edd607-a703b4b494108cd1-00"
}
```

### 6.13 Database outage (BRD §8 "server down")

```console
$ docker compose stop db
 Container sas-apitest-db-1 Stopping 
 Container sas-apitest-db-1 Stopped 
```

#### 13.1 · List classes while the database is down → 503

```http
GET /classes HTTP/1.1
Host: localhost:8080
```
Response — expected `503`, got `503` → **PASS**

```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/problem+json

{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.6.4",
  "title": "Service unavailable",
  "status": 503,
  "detail": "The admission service is temporarily unavailable. Please try again in a moment.",
  "code": "SERVICE_UNAVAILABLE",
  "traceId": "00-9092e2c58c2bad0b97b35d6fe71bb0df-cc37ff923706d0f3-00"
}
```

#### 13.2 · Health check while the database is down → 503

```http
GET /health HTTP/1.1
Host: localhost:8080
```
Response — expected `503`, got `503` → **PASS**

```http
HTTP/1.1 503 Service Unavailable
Content-Type: text/plain

Unhealthy
```

```console
$ docker compose start db
```

#### 13.3 · Same call after the database is back (API not restarted)

```http
GET /classes HTTP/1.1
Host: localhost:8080
```
Response — expected `200`, got `200` → **PASS**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

[
  {
    "id": "c_01a1caff67167d9ca03a120f6c207e21",
    "name": "Class 6 - Morning Shift",
    "totalSeats": 120,
    "heldSeats": 1,
    "confirmedSeats": 0,
    "availableSeats": 119
  },
  {
    "id": "c_01a1caff67337900bdb42daf11412024",
    "name": "Class 7 - Day Shift",
… (truncated: 1033 bytes, 58 lines)
```

### 6.14 Final database invariant over every class

```console
$ psql  # name | total | held_seats | confirmed_seats | HELD rows | CONFIRMED rows
Class 6 - Morning Shift | 120 | 1 | 0 | 1 | 0
Class 7 - Day Shift | 3 | 0 | 1 | 0 | 1
Class 8 - Morning Shift | 1 | 1 | 0 | 1 | 0
Class 9 - Expiry Demo | 1 | 0 | 0 | 0 | 0
Class 10 - Concurrency Demo | 5 | 4 | 1 | 4 | 1
Class 10 - Same Student Race | 10 | 1 | 0 | 1 | 0
Multi-instance check 1794407119-18576 | 10 | 0 | 10 | 0 | 10
```
- **Check 14.1** – Classes violating held+confirmed<=total or counter≠rows: expected `0`, got `0` → **PASS**
