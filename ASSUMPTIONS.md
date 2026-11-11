# Assumptions

Where the [BRD](project_docs/BRD.md) was silent or ambiguous, these are the interpretations this implementation follows. Each was agreed during planning; the full options and reasoning are in [project_docs/decisions.md](project_docs/decisions.md) (decision numbers in brackets).

## Identity and access

1. **No authentication.** As required (BRD §2.2), the `X-Student-Id` header is the user's identity. Anyone who knows a student's registration number can act as that student. This is inherent to the specified design.
2. **Class creation is unprotected.** The BRD has an Admin role but no login, so `POST /classes` is open to any caller. A real deployment would put it behind authentication.
3. **Student ID format** is exactly **17 ASCII digits** (`0-9`), matching the BRD example `20152691234567890`. Surrounding whitespace is trimmed. Letters, other lengths, and Bengali numerals (`০`–`৯`) are rejected with `400 INVALID_STUDENT_ID`. The frontend should convert Bengali digits before sending. [D9]
4. **Where the header is required:** apply, confirm, cancel and `GET /me/holds` require it (missing or invalid → `400`). For **`GET /holds/{holdId}`** it is **optional**, because the BRD lists no header there. If it is sent, it must match the hold's owner. [D9]
5. **Other students' holds:** reading, confirming or cancelling a hold that belongs to someone else returns **`404`**, not `403`, so the existence of other students' applications is not revealed. [D9]
6. `GET /holds/{holdId}` does not return `studentId`, since it may be called without the header.

## Application lifecycle

7. **One active application per class.** A student may have at most one `HELD` or `CONFIRMED` application per class (BRD §4.2). Morning and Day shifts count as separate classes, so a student **may hold seats in several classes at once**. [D8]
8. **Re-applying** after an application `EXPIRED` or was `CANCELLED` is allowed. The old record stays in the history. [D8]
9. **Confirmed admissions are final.** `DELETE /holds/{id}` on a `CONFIRMED` application returns **`409 CANNOT_CANCEL_CONFIRMED`**, and the seat is not released. Withdrawals and refunds are handled offline by the school office. [D8, user decision]
10. **Payment is simulated.** Calling confirm counts as a successful payment (BRD §4.1).
11. **Expiry moment:** a hold is expired when the database clock reaches `expiresAt`. From that instant it is reported as `EXPIRED` and cannot be confirmed or cancelled, even if the background sweeper has not processed it yet. All time comparisons use the **database clock**, never the API server's clock, so several instances always agree. Every response carries the server's `Date` header, which is exposed to browsers via CORS, so the frontend countdown can correct for a wrong client clock. [D15]
12. **Hold duration** (`HOLD_DURATION_SECONDS`) is fixed when a hold is created. Changing the setting does not affect existing holds.
13. **`heldSeats`** counts only holds that have not yet expired, so seat numbers are correct to the second. The background sweeper (every `EXPIRY_SWEEP_INTERVAL_SECONDS`, default 5 s) then makes the release permanent.

## Status codes the BRD does not specify [D10]

| Situation | Response |
|---|---|
| Apply while already holding/confirmed in that class | `409 ALREADY_APPLIED` |
| Apply to a full class | `409 SEATS_FULL` (as BRD) |
| Confirm an expired hold | `409 HOLD_EXPIRED` |
| Confirm a cancelled hold | `409 HOLD_NOT_ACTIVE` |
| Confirm an already confirmed hold | `200` with the same body (idempotent; counted once) |
| Cancel an already cancelled or expired hold | `204` (idempotent no-op) |
| Cancel a confirmed admission | `409 CANNOT_CANCEL_CONFIRMED` |
| Unknown or malformed class/hold ID | `404 NOT_FOUND` |
| Database unreachable | `503 SERVICE_UNAVAILABLE` (friendly message; the API recovers automatically) |
| Non-JSON body / body over 64 KB / wrong HTTP method | `415` / `413` / `405` |

## Classes

14. **Class name:** required, trimmed, 1–100 characters, and **unique ignoring case** (`409 DUPLICATE_CLASS_NAME`). [D10]
15. **Total seats:** a whole number from **1 to 10,000**. [D10]
16. Classes cannot be edited or deleted. The BRD defines no such endpoints.
17. `POST /classes` also returns `heldSeats`, `confirmedSeats` and `availableSeats` (all zero, all seats available), in addition to the contract fields.

## Data formats

18. **IDs** look like the BRD examples: `c_` or `h_` followed by 32 hexadecimal characters (a time-ordered UUID v7). [D4]
19. **Timestamps** are UTC ISO-8601 with a trailing `Z`, with microsecond precision (e.g. `2026-11-11T04:10:00.123456Z`).
20. **Errors** use RFC 7807 Problem Details: `status`, `title`, a user-friendly `detail`, and a machine-readable `code` the frontend can map to its own wording (Bangla or English). [D12]
21. `GET /me/holds` returns the full history (every status), newest first, without pagination. A student only ever has a handful of applications.
22. `GET /classes` lists classes in creation order.

## Scope and operations

23. **Single school** (BRD §2.2): no tenant separation.
24. **Several API instances** may run against one database (BRD §5). Each opens at most `DB_POOL_SIZE` (50) connections, and PostgreSQL allows 200 in total, so three or more instances fit with headroom. [D14]
25. The development credentials in `docker-compose.yml` and `.env.example` are **for local use only**.
26. **Swagger UI** is enabled in every environment to make the API easy to review.
