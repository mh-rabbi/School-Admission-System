# AI Usage

This document records how AI was used to build the backend, where it went wrong, and how each problem was caught and corrected.

## Tools

| Tool | Used for |
|---|---|
| **Free VS code Co-pilot & Antigravity & Codex** (VS Code extension), model **Claude Sonnet, Gemini, ChatGPT** | Pair programming on the backend: requirements analysis, design options, implementation, tests, Docker setup, documentation |

## How the AI was used

The developer did not let the AI write code freely. The workflow was fixed up front:

1. **Understand first.** The AI summarised the BRD and listed the ambiguities it found before anything else.
2. **Decisions stay with the developer.** Every choice with more than one reasonable answer was put to the developer as *question → options with pros and cons → recommendation*, a few questions at a time. Answers were recorded in [`project_docs/decisions.md`](project_docs/decisions.md) (14 decisions).
3. **Plan, then approval.** No application code was written until the developer approved the step-by-step plan ([`project_docs/01-backend-implementation-plan.md`](project_docs/01-backend-implementation-plan.md)) and the architecture ([`project_docs/02-architecture.md`](project_docs/02-architecture.md)).
4. **One step at a time.** After each of the 14 steps the AI had to build, run the tests, show the results, update the progress log ([`AGENTS.md`](AGENTS.md)) and wait for the developer's go-ahead. Git commits were made by the developer, not the AI.
5. **Mistakes logged as they happened.** Every course correction was written into `AGENTS.md` at the time; this document is built from that log.

### Decisions made by the developer, not the AI

- Asked whether **Redis** and **optimistic locking** were needed before accepting the concurrency design. Both were rejected: PostgreSQL row locks plus a `CHECK` constraint are enough, and optimistic locking would cause retry storms on a hot class row.
- **Confirmed admissions cannot be cancelled** (the AI had recommended allowing it).
- **Git is managed manually** by the developer.
- **Explicit database connection budget** for multi-instance deployments (raised by the AI after the concurrency tests).

## Where the AI failed and how it was corrected

### Design and correctness

| What went wrong | How it was caught | Correction |
|---|---|---|
| The developer's answer "Option B" to a three-part question was ambiguous, and the AI could have guessed. | The AI asked instead of assuming. | Clarified: only the "cancel a confirmed admission" sub-question was B. |
| A duplicate class name returned the correct 409, but EF Core logged **two error-level entries per duplicate**. Under load that floods the logs with false alarms. | Manual run in Production mode, then inspecting the log levels. | Switched to `INSERT … ON CONFLICT DO NOTHING` and a row count. "Expected conflicts are never exceptions" became a design rule, applied to the hold insert as well. |
| **A concurrency test was too weak to fail.** The first "each expired hold is released exactly once" test used 12 holds; one sweeper finished before the others started, so the test passed even with every protection removed. | A **mutation test** (deliberately breaking the code to see whether the test notices). | Rebuilt with 500 holds, 16 workers released at the same instant, and small batches. It now catches the broken code 3 times out of 3. From then on every concurrency test was checked this way. |
| Some tests left **inconsistent data** (hold rows without matching seat counters) in the shared test database. | A new "check every class in the database" assertion failed in an unrelated test. | Test setup now changes rows and counters in the same SQL statement. |
| Before Step 10, a database outage returned **500 "internal error"**, and a client closing the browser tab was logged as a server error. | Error-handling audit step. | Outage now returns **503** with a friendly message, and recovery is automatic (tested by dropping the database under a running API and by stopping the real container). Aborted requests are no longer logged as errors. |
| Two API instances could, by default, open more database connections than PostgreSQL allows. | Review after the multi-instance tests. | Raised as a decision. The developer chose an explicit pool size (50 per instance) and `max_connections=200`. |

### Tooling and process

| What went wrong | How it was caught | Correction |
|---|---|---|
| `dotnet add package` picked the newest packages, which target **.NET 11**, so the project would not restore. | Build error NU1202. | Pinned the Microsoft packages to 10.0.x. |
| FluentAssertions 8 requires a **commercial licence**. | AI checked the licence before adding it. | Pinned to 7.2.0 (Apache 2.0). |
| Twice, a build failure went unnoticed and **the old test DLL ran**, so a passing result was reported for code that did not compile (an obsolete Testcontainers constructor; a `.Result` call rejected by the xUnit analyzer). | The `Error(s)` line in the build output. | The test command was changed to `dotnet build && dotnet test`, so tests can never run on a stale build. |
| `pkill -f` matched the AI's own shell and killed it in the middle of a check. | Truncated command output. | Processes are now stopped by exact name or by listening port. |
| The compiled API was started from the wrong folder, so `appsettings.json` was ignored (port 5000 instead of 8080), leaving an orphaned process. | Connection refused, then `ss -ltnp`. | Started from the output folder and killed the stray process. Docker is not affected. |
| Test helpers were named `PostAsync`/`GetAsync`, overloading `HttpClient`'s own methods. | Code review during the step. | Renamed to unambiguous names. |
| `.env.example` had comments after values, which some dotenv parsers treat as part of the value. That would make the API refuse to start. | Review before running compose. | Comments moved to their own lines. |
| The container logged an "Overriding HTTP_PORTS" warning. | Log-level check after `docker compose up`. | Cleared the base image's variable in the Dockerfile. |
| The AI reported a failing script's exit code as 0. It had measured `tail`'s exit code in a pipeline, not the script's. | Re-reading its own command. | Re-measured correctly (exit code 1) and corrected the report. |

## Verification practices that made AI output trustworthy

- **Real PostgreSQL in every test** (Testcontainers). Nothing was mocked, because the concurrency guarantees live in the database.
- **Mutation testing of the critical guarantees.** Key protections were removed on purpose to prove the tests fail without them. The most important result: with both the conditional seat claim **and** the database `CHECK` removed, the mandatory concurrency test created 200 holds for 5 seats and failed, so it really does detect overbooking.
- **Checking the invariant during the run, not only after it.** The mixed-workload test samples the database about every 20 ms while 150 simultaneous students apply, confirm, cancel and let holds expire.
- **Proving races really race.** Race tests print how the outcomes split (for example 16 confirmed / 14 expired), to show both sides are exercised.
- **Repeated runs** (3–5 consecutive full-suite runs per step) to catch flaky tests.
- **Manual checks on the real server and containers** after each step: Production mode, log levels, `docker compose down`/`up`, stopping the database, and a two-instance script.

## Takeaways

- The AI was most valuable for exploring design options and for writing exhaustive tests. It was least reliable at judging **whether its own tests could actually fail**. Mutation testing was the decisive check.
- Most AI mistakes were caught by **process** (approval gates, build-then-test, mandatory verification per step) rather than by reading code. That process is the reason the result can be trusted.
