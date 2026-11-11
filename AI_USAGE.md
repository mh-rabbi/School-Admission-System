# AI Usage

This document records how AI was used to build the backend and the frontend, where it went wrong, and how each problem was caught and corrected. The backend is described first; the [Frontend](#frontend) section is at the end.

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

---

# Frontend

## Tools

| Tool | Used for |
|---|---|
| **Free VS code Co-pilot & Antigravity & Codex (VS Code extension), model Claude Sonnet, Gemini, ChatGPT**| Pair programming on the web app: reviewing the design demo against the real API, planning, implementation, tests, Docker/nginx setup, documentation, and the final manual verification |
| **Headless Google Chrome** (driven over the DevTools protocol by scripts the AI wrote) and **Docker** | Not AI, but the AI's way of *looking at* the real product: screenshots and overflow measurements at 360 / 768 / 1280 px in both themes, and the end-to-end scenario below |

## How the AI was used

The same rules as for the backend, with the backend declared **frozen**:

1. **Read first, report problems, do not work around them.** The AI read the BRD, architecture, decisions, assumptions, README, compose file and the backend contract code, and reviewed the design demo against the real API *before* planning. Backend problems were reported to the developer; the AI never edited backend code.
2. **Plan, then approval.** A 12-step plan with the full API contract, the demo review and eight open questions ([`project_docs/fe_implementation_plan.md`](project_docs/fe_implementation_plan.md)). No application code was written until the developer approved it.
3. **One step at a time.** After every step: lint, build, tests with the output shown (`npm run lint && npm run build && npm test`, so tests never run on a stale build), progress log updated in [`AGENTS.md`](AGENTS.md), a suggested commit message, then stop and wait. Git commits were made by the developer.
4. **Mistakes logged as they happened** (the "Mistakes / corrections" list in `AGENTS.md`); the table below is built from it.

### What the review of the demo found before any code was written

The approved design demo was not trusted as-is. The AI listed these problems and asked before changing anything: class names were injected with `innerHTML` (an XSS hole, since admins type them), the whole page was re-rendered every second (breaks keyboard focus and screen readers), tabs lacked ARIA roles, amber *text* failed contrast, the headline promised "one minute" although hold length is configurable, and the page showed fake data (invented "other guardians", a fake 09:59 timer). It also found that the backend hides the `Date` header from browsers, which made clock-skew correction impossible. The developer then had that fixed on the backend side (D15).

### Decisions made by the developer, not the AI

- Approved the plan and the recommended answers to the open questions: Docker/nvm tooling, portal-first default page, TanStack Query for polling, English UI with the three Bangla action labels, a landing page that shows real data or nothing, bundled fonts.
- Exposed the `Date` response header in the backend (D15) after the AI reported the problem.
- Open suggestion left to the developer: Cancel has no "Are you sure?" step (as in the approved design).

## Where the AI failed and how it was corrected

### Design and correctness

| What went wrong | How it was caught | Correction |
|---|---|---|
| **The approved colour palette failed WCAG contrast.** In dark mode the glowing background sat under the cards and made secondary text unreadable (2.5–3.8 : 1); the light error red and the dark primary button were just under 4.5 : 1. | A contrast test the AI wrote that reads the *real* `tokens.css` and checks every text/background pair on the worst card surface in both themes. | Changed the minimum number of colour values (and wrote it down as a decision); the threshold and the test surfaces were not relaxed. |
| The countdown was shown **twice** for one hold (class card and application row). Both had a live region, so a screen reader would have announced every deadline twice. | First mobile screenshot, then reasoning about the live regions. | Kept one timer, in the application row. |
| A **test did not test what it claimed**: the double-click test passed even with the double-submit lock deleted, because a second UI layer also blocked the click. | Mutation check: deleted the lock, test still green. | Added a test of the lock itself; it fails when the lock is removed. |
| A test of the colour tokens loaded the CSS with `?raw`, which the test configuration turns into an empty string, so it **could have passed on nothing**. | It failed loudly ("no block :root") instead. | Read the file with `fs`; the lookup fails if the blocks are missing. |
| A header wider than the page content and the duplicated timer were invisible to jsdom tests. | Screenshots from real Chrome at three widths in both themes. | Aligned the header; layout is now checked in a real browser, not only in jsdom. |
| nginx dropped the security headers on `index.html`: a location that sets its own `add_header` discards the server-level ones. | `curl -D -` on every route (the AI had assumed they applied). | Repeated the headers in each location and re-checked all four routes. |
| The first expiry tests failed although the app was right: one big `act()` batches every tick's re-render to the end. | Measuring the timeline (requests and DOM at fixed instants) instead of changing the code. | Fixed the test helper to advance time in small steps like a real clock. |
| Several tests were **too broad or too tight**: a "never show raw detail" rule that the design deliberately breaks for validation errors; an exact `10:00` for a clock that is only accurate to ~0.5 s (the `Date` header has 1 s resolution); a "1 s re-check loop forever" assumption although the design stops after 15 tries. | Test failures analysed one by one. | In each case the *test* was corrected to state the real rule, and the design trade-off was written down; nothing was changed just to turn a test green. |

### Tooling and process

| What went wrong | How it was caught | Correction |
|---|---|---|
| A stray `cat > file` with no input hung the shell for 120 s and silently skipped later files. | Timeout, then listing which files existed. | Never assume a timed-out multi-file command ran; check the result. |
| The AI hid build output behind `>/dev/null`, so a TypeScript error showed only as `exit=2`. | Re-ran unfiltered. | Gate with `&&` but keep the failing step's output visible. |
| `nvm` is not remembered between shell calls, so `npm` was "not found". | Error message. | Every command sources nvm first. |
| An always-present *empty* alert region made `role="alert"` queries match the wrong element, and "no alert" assertions could never pass. | Test failures. | Content-aware test helpers; the component (correct for screen readers) was not weakened. |
| React 18 typings, unused exports (react-refresh warnings), providers missing in older tests, an ambiguous test selector. | Type checker, linter (zero-warning gate), test failures. | Fixed each; no warning was ever left in. |
| The AI almost trusted green results that arrived suspiciously fast. | Reading its own results critically. | Ran **mutation checks** after Steps 5, 6, 7, 8 and 10 (14 deliberate breakages, all caught). |
| To avoid touching the developer's running dev database, the AI verified Docker in a separate compose project (own volume and DB port) and removed only that project. | Planning before running. | No dev data touched. |
| In the final end-to-end run the AI's own check expected the first countdown reading to be 18–20 s for a 20 s hold; the page showed 00:21 (the `Date` header has 1 s resolution, so the clock estimate is good to about ±0.5 s). | The scripted run reported 22 of 23 checks. | Reported honestly with the cause, rather than loosening the check and re-running for a clean score. The expiry itself fired on time (19.9 s). |

## Verification practices (frontend)

- **A stateful fake of the backend** that follows the real contract and rules (effective status computed on read, no overbooking, one active application, idempotent confirm, cancel of a confirmed hold refused), with its own server clock, so skew, a wrong `Date` header and server outages can be simulated.
- **Whole-journey tests** (two guardians for the last seat, outage in the middle of a hold, refresh/restart) that also **fail on any console error or warning** and **audit every request** (paths, base URL, ID header only where needed, never a half-typed ID).
- **Mutation checks** on the critical behaviours: skew correction, the expiry watcher, the in-flight locks, the Pay guard, the refresh after actions, validation, persistence, polling in hidden tabs.
- **Coverage with regression thresholds**: 99 % lines, 93 % branches.
- **Real checks in real software**: Chrome screenshots at three widths in both themes, a Docker-only run of the whole quality gate (`docker build --target test`), and a scripted end-to-end run of the BRD scenario through the real UI against real containers: create a class, two guardians, one pays, one lets the 20 s hold expire, backend container stopped and restarted, `docker compose down`/`up` and a browser restart (22 of 23 checks passed; the deviation is explained in `AGENTS.md`).

## Takeaways (frontend)

- Again the AI was weakest at judging whether **its own tests could fail**, and strongest when it was forced to look at the real thing: a contrast test on the real tokens, real screenshots, `curl` on real headers.
- Reviewing the *design* against the *API* before coding found more problems than any later step: fake data, a false promise in the copy, an XSS hole, and a header the browser could not read.
- Process again did the heavy lifting: approval gates, build-then-test, one step at a time, and a written log of every wrong turn.

