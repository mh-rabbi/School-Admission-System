# Frontend Implementation Plan

Source of truth: [BRD.md](BRD.md) §4.1, §6, §8, §9 · API: [02-architecture.md](02-architecture.md) §6 · Decisions: [decisions.md](decisions.md) · Tracker: [/AGENTS.md](../AGENTS.md) ("Frontend progress log")

Status: **PLAN – awaiting approval. No application code written.** Backend is frozen; this plan never changes it (problems are reported in §7).

---

## 1. Requirements summary (BRD)

| BRD | Requirement | Frontend consequence |
|---|---|---|
| §4.1 | No login; 17-character Student Registration Number in a field at the top of the page = identity | `IdBar` always visible at top of the portal; sent as `X-Student-Id` |
| §4.1 | Admin: create class (Name + Total Seats); shifts are separate classes | Admin tab form → `POST /classes` |
| §4.1 | Class list with Total / Held / Confirmed / Available + "Apply" (আবেদন করুন) | `ClassCard` grid |
| §4.1 | Active applications with status, **countdown**, "Pay Fee / Confirm" (ভর্তি ফি দিন), "Cancel" (বাতিল) | `ApplicationRow` |
| §4.1 | "My Applications": all past + present with statuses | `GET /me/holds` |
| §4.1 | Real-time seats without reload (polling); expiry auto-flips to `EXPIRED` and disables Pay without reload; state survives refresh/restart | polling + countdown + localStorage ID; server is the source of truth |
| §6 | React 18+, JS/TS, Vite; API URL from env; root `docker-compose.yml` brings up DB + backend + frontend | `VITE_API_BASE_URL` build arg; `frontend` service enabled |
| §8 | Friendly errors for: seats full, hold expired, invalid input, server down. No blank page, no console-only errors | error mapping layer, error boundary, inline/banners/toasts |
| §9 | `/frontend` + Dockerfile; README, ASSUMPTIONS, AI_USAGE; **bonus** frontend tests | Vitest + RTL; docs updated |

---

## 2. API contract as the frontend consumes it

Base URL `VITE_API_BASE_URL` (default `http://localhost:8080`). `X-Student-Id` = 17 ASCII digits (Bengali digits converted first). Errors: `application/problem+json` `{status,title,detail,code}`.

| Endpoint | Header | Success shape | Error codes → UI behaviour |
|---|---|---|---|
| `GET /classes` (poll 3 s) | – | `[{id,name,totalSeats,heldSeats,confirmedSeats,availableSeats}]` | network/503/500 → "connection problem" banner above grid, keep last data, keep retrying with backoff |
| `POST /classes` | – | 201 same fields (+stats) | 400 `VALIDATION_FAILED` → inline field message; 409 `DUPLICATE_CLASS_NAME` → inline error on Name; 503/network → form error + keep input |
| `POST /classes/{id}/holds` | required | 201 `{holdId,classId,studentId,status:HELD,expiresAt}` (**no `className`**) | 400 `INVALID_STUDENT_ID` → focus ID field + hint; 404 `NOT_FOUND` → "class no longer exists", refetch; 409 `SEATS_FULL` → "all seats taken" toast, refetch (card flips to *Full*); 409 `ALREADY_APPLIED` → toast, refetch my holds; 503/network → toast "service unavailable, try again". On 201: refetch `/me/holds` + `/classes` immediately (className comes from the list) |
| `GET /me/holds` (poll 4 s, only with valid ID) | required | `[{holdId,classId,className,status,expiresAt}]` newest first | 400 → treat as invalid ID; network/503 → banner, keep last data |
| `POST /holds/{id}/confirm` | required | 200 `{holdId,status:CONFIRMED}` (repeat also 200) | 409 `HOLD_EXPIRED` → mark expired, message, refetch; 409 `HOLD_NOT_ACTIVE` → "was cancelled", refetch; 404 → "application not found for this ID", refetch; 400; 503/network → toast, button re-enabled |
| `DELETE /holds/{id}` | required | 204 (also for already cancelled/expired) | 409 `CANNOT_CANCEL_CONFIRMED` → show server message (contact school office), refetch; 404; 400; 503/network |
| `GET /holds/{id}` | optional | `{holdId,classId,status,expiresAt}` | **not used**: `/me/holds` covers every need and gives `className` |
| `GET /health` | – | 200 | not used by the UI |

Unmapped code → show server `detail` if status < 500, else generic "Something went wrong on our side." Raw JSON, status codes and stack traces are never shown. Non-JSON bodies (e.g. a proxy 502) → generic message.

Statuses: `HELD`, `CONFIRMED`, `EXPIRED`, `CANCELLED`. Effective status is computed by the server on its DB clock, so a poll after `expiresAt` already returns `EXPIRED`.

---

## 3. Demo-design review (`School Admission System – Design Demo.html`)

**Kept (visual language):** glass cards, teal/amber palette and gradient orbs, light/dark via `prefers-color-scheme` + manual toggle, Bricolage Grotesque / Hind Siliguri fonts, pill buttons, landing + portal, tabs Classes / My Applications / Admin, stat grid with progress bar, status chips, toast, Bangla labels আবেদন করুন / ভর্তি ফি দিন / বাতিল, Bengali-digit conversion in the ID field, reduced-motion CSS, safe-area insets. CSS custom properties become `src/styles/tokens.css`.

**Changes forced by the real backend (all requested by you):**

| Demo | Real | Resolution |
|---|---|---|
| numeric class ids, in-memory arrays | `c_…`/`h_…` strings; server only | all data from `GET /classes`, `GET /me/holds`; no local-only state besides ID/theme/tab |
| hard-coded 2-min hold | duration is server config | countdown purely from `expiresAt` |
| expiry via browser clock | DB clock | countdown corrected by clock skew (see §4.4 and **Q2**); at 0 → show `EXPIRED`, disable Pay, refetch, and keep verifying until the server agrees |
| no loading/empty/error states | – | skeletons, empty states, banners, per-code messages, error boundary |
| fake "other guardians" timer + fake hero numbers (25 of 120, 09:59) | – | removed. Hero card shows **real** aggregate availability from `GET /classes`, hidden if it fails (**Q6**) |
| confirmed can't be cancelled | same | Cancel hidden unless `HELD`; 409 `CANNOT_CANCEL_CONFIRMED` still handled |
| "active" + "My Applications" from local list | `/me/holds` | both views are filters of one query; apply response has no `className`, so refetch `/me/holds` |
| landing page | not in BRD | kept, but must not delay the main flow (**Q3**) |
| client-side duplicate-name check | server decides (case-insensitive, trimmed) | removed; rely on 409 `DUPLICATE_CLASS_NAME` |

**Changes I propose for UX / accessibility / safety (not silently applied — object if you disagree):**

1. **XSS:** the demo injects class names with `innerHTML`; names are admin-supplied. React escaping fixes this by construction.
2. **Whole-view re-render every second** (demo `draw()`) destroys focus and breaks screen readers. Only the countdown text re-renders (one shared 1 s ticker).
3. **Tabs** use `role="tablist"` but buttons lack `role="tab"`, `aria-selected`, `aria-controls`, arrow-key support → add.
4. **Contrast:** amber `--acc` (#f2a93b) used as *text* (timer) on a light glass background is ~2:1 (fails WCAG AA). Add `--accText` (darker amber in light mode); amber stays for fills/buttons.
5. **Toast** is `role="alert"` for everything and vanishes after 4 s → success: `aria-live="polite"`, errors: `assertive`; load/connection failures also get a **persistent** inline banner (a 4 s toast is easy to miss).
6. **Timer announcements:** `role="timer"` without per-second announcements; polite live announcements only at 60 s, 10 s and on expiry.
7. **Landing copy "One seat. One minute to claim it"** is false (hold length is configurable, default 10 min) → reword with no duration. Footer "design demo with sample data" removed.
8. **Seats input** (`type=number`) accepts decimals and `e` → validate integer 1–10,000 in code and show inline message; `maxlength` on the ID field is 20 in the demo → I will keep typing unrestricted up to 20 chars but show precise hints ("17 digits needed, you typed 15", "letters/spaces not allowed") because silently stripping characters could send the wrong ID.
9. **Hold time ≥ 1 h** displays `h:mm:ss` (demo only supports `mm:ss`).
10. Disabled **Apply** reasons are shown in text (*Full*, *Already applied*), not only by greyed-out styling; buttons also get `aria-busy` while a request is in flight.
11. Student-ID persistence + invalid-ID states (`aria-invalid`, `aria-describedby` hint, `inputmode="numeric"`).

---

## 4. Architecture

### 4.1 Stack
React 18 + TypeScript + Vite; **TanStack Query v5** for server state (justification: gives non-overlapping polling, pause-when-hidden, dedupe, mutation state and cache invalidation that I would otherwise hand-write and test — ~13 kB; see **Q4**); Vitest + React Testing Library + jsdom (dev). No router library (hash routing, ~20 lines), no UI kit, no state library, no CSS framework (plain CSS with tokens).

### 4.2 Folder layout
```
frontend/
  Dockerfile  nginx.conf  .dockerignore  .env.example
  index.html  vite.config.ts  tsconfig*.json  eslint.config.js
  src/
    main.tsx  App.tsx
    api/        client.ts (fetch wrapper) · types.ts · errors.ts (ApiError, NetworkError, parse) · classes.ts · holds.ts
    lib/        studentId.ts · countdown.ts (format) · clock.ts (skew + shared ticker) · storage.ts (safe localStorage)
    i18n/       messages.ts (code → friendly text; Bangla action labels)
    state/      StudentIdProvider.tsx · ThemeProvider.tsx · ToastProvider.tsx
    hooks/      useClasses · useMyHolds · useApply · useConfirm · useCancel · useCreateClass · useCountdown · useVisibleInterval
    components/ Header · IdBar · Tabs · ClassCard · ApplicationRow · StatusChip · SeatBar · Toast · ErrorBanner · Skeleton · ErrorBoundary
    pages/      Landing.tsx · Portal.tsx · tabs/{ClassesTab,MyApplicationsTab,AdminTab}.tsx
    styles/     tokens.css · base.css · components.css
    test/       setup.ts · fetchMock.ts · *.test.tsx
```
The demo file moves to `project_docs/design/` (reference only; **Q7**).

### 4.3 State and data fetching
- **Server state** = TanStack Query only: keys `['classes']`, `['holds', studentId]`. Nothing server-derived is copied into component state.
- **Client state**: student ID (context + `localStorage` `sas.studentId`, normalised text, try/catch around storage), theme, active tab (URL hash). Switching ID changes the query key, so old data is never shown for a new ID.
- **Mutations** (`apply`, `confirm`, `cancel`, `create`): on success **and** on any 409/404 → invalidate `['classes']` and `['holds', id]` so the UI converges to server truth. No optimistic updates (a wrong optimistic seat count is worse than 200 ms of latency).
- **Double-submit protection:** button disabled + `aria-busy` while the mutation for that class/hold is pending, plus a synchronous per-key lock (ref) so two clicks inside one render tick cannot both fire. Backend idempotency is the backstop.
- Derived UI per class: *Full* when `availableSeats == 0`; *Already applied* when `/me/holds` has a `HELD`/`CONFIRMED` (not locally expired) entry for that `classId`.

### 4.4 Polling and timers
| Item | Strategy |
|---|---|
| `GET /classes` | `refetchInterval` 3 s |
| `GET /me/holds` | 4 s, `enabled` only when the ID is valid |
| Overlap / hidden tab | TanStack never starts a new fetch while one is in flight; `refetchIntervalInBackground:false` pauses when the tab is hidden; `refetchOnWindowFocus` + `visibilitychange` refetch immediately on return |
| Failures | interval backs off to 10 s while erroring; stale data stays visible, dimmed, with "Connection lost – retrying…" banner; recovers silently |
| Countdown | **one** shared 1 s ticker (`useSyncExternalStore`); `remaining = expiresAt − (Date.now() + skew)`; timestamps, not decrementing counters, so background-tab throttling and sleep never drift |
| Clock skew | each response's HTTP `Date` header → `skew = serverDate − clientNow` (1 s resolution; keep latest sample). **If the header is unreadable (CORS) skew = 0** — see §7/**Q2** |
| Hitting zero | row shows `EXPIRED` (provisional), Pay disabled, immediate refetch of `/me/holds` + `/classes`; if the server still says `HELD` (our clock ran early) show "Verifying…" with Pay disabled and refetch every 1 s until the server answers; the server's status always wins |
| Live announcements | polite live region at 60 s, 10 s, and on expiry |

### 4.5 Error handling
- `api/client.ts` returns typed results or throws `ApiError{status, code, detail}` / `NetworkError` (fetch rejection, timeout via `AbortController` 10 s).
- `i18n/messages.ts` maps `code` → friendly text (English; Bangla only for the primary action labels, **Q5**); fallback to server `detail` (<500) or generic.
- Surfaces: **toast** (outcome of an action), **inline** (form fields, ID hint), **banner** (list-load failures, persistent), **ErrorBoundary** (render crash → friendly page with Reload button). Every failure path has a visible message; `console.error` only as extra.
- Client-side validation first (ID, class name 1–100, seats integer 1–10,000) so obvious mistakes never hit the API; server validation still handled.

---

## 5. Implementation steps

Per-step gate for all steps: **build + lint + tests all pass (shown), `AGENTS.md` updated, suggested commit message, then STOP.** Commands run via the runner chosen in **Q1** (`npm run lint && npm run build && npm test`).

| # | Goal | Files | Acceptance criteria | Verify |
|---|---|---|---|---|
| 1 | **Scaffold & tooling** | `frontend/` Vite+React+TS, ESLint, Vitest/RTL setup, `tokens.css` + `base.css`, theme provider, `.env.example`; demo file → `project_docs/design/` | app renders an empty shell with theme toggle; strict TS; 1 smoke test | `npm run lint && npm run build && npm test`; dev server shows page |
| 2 | **API layer + error mapping** | `api/*`, `i18n/messages.ts`, `lib/storage.ts`, `test/fetchMock.ts` | every §2 row typed; problem+json parsed; network/timeout/non-JSON → `NetworkError`/generic; every backend code mapped; header `X-Student-Id` only when given | unit tests: each code → message, 503, offline, non-JSON, header injection |
| 3 | **Student identity** | `lib/studentId.ts`, `StudentIdProvider`, `IdBar` | Bengali→ASCII, trim, 17 digits; precise hints; persisted; restored on reload; invalid → no API calls | tests: valid/invalid/Bengali/whitespace/persist/storage-blocked |
| 4 | **Shell: header, routing, tabs, toasts, boundary** | `Header, Tabs, Toast, ErrorBoundary, Portal/Landing stubs` | hash routing; ARIA tabs w/ arrow keys; toast live regions; boundary shows friendly page | RTL tests for tabs keyboard, toast roles, boundary |
| 5 | **Classes tab + Apply** | `useClasses`, `useMyHolds`, `useApply`, `ClassCard`, `SeatBar`, skeleton/empty/error | live stats polling 3 s; Full / Already-applied / needs-ID states; apply → refetch; 409/404/503 messages; in-flight lock | tests with mocked fetch: render, poll update (fake timers), apply success, SEATS_FULL, ALREADY_APPLIED, double-click = 1 request |
| 6 | **Clock + countdown** | `lib/clock.ts`, `lib/countdown.ts`, `useCountdown` | skew from `Date`; mm:ss / h:mm:ss; zero → EXPIRED + Pay disabled + refetch + "Verifying…" loop; announcements | fake-timer tests incl. skewed server clock, tab sleep jump, server-disagrees case |
| 7 | **My Applications + active strip + Pay/Cancel** | `MyApplicationsTab`, `ApplicationRow`, `useConfirm`, `useCancel` | active strip = HELD + just-expired; full history newest first; Cancel only for HELD; Pay only for unexpired HELD; 409 HOLD_EXPIRED / HOLD_NOT_ACTIVE / CANNOT_CANCEL_CONFIRMED handled; idempotent repeat OK | tests for each status/code; apply→pay→CONFIRMED flow |
| 8 | **Admin tab** | `AdminTab`, `useCreateClass` | client validation; 201 → list updates; 409 inline on Name; 400/503 handled; form keeps input on failure | tests: valid, empty, 0/10001/1.5 seats, duplicate, offline |
| 9 | **Landing page + a11y/responsive pass** | `Landing.tsx`, CSS | per **Q3**; hero uses real data or hides; contrast fix; reduced motion; 360 px width no horizontal scroll; light/dark | manual at 360/768/1280 px + axe-style checklist; tests for hero fallback |
| 10 | **Flow & resilience tests** | `test/*.test.tsx` | end-to-end (mocked API): ID → apply → countdown → pay → CONFIRMED; expiry path; server-down banner + recovery; refresh keeps ID | full suite green; coverage report of `api/`, `lib/`, `hooks/` |
| 11 | **Docker & docs** | `frontend/Dockerfile` (node build → nginx, `VITE_API_BASE_URL` arg; optional `test` stage), `nginx.conf` (SPA fallback, gzip, hashed-asset cache), `.dockerignore`, compose `frontend` service (`3000:80`, depends_on backend healthy), README, ASSUMPTIONS, `.env.example` | `docker compose up --build` serves UI at :3000 with no local installs | `docker compose build frontend`, `up -d`, curl `/` and a deep link returns `index.html` |
| 12 | **Final manual verification + AI_USAGE** | `AGENTS.md`, `AI_USAGE.md` "Frontend" | scenario in the brief (§5): create class, 2 IDs, confirm one, expire one with `HOLD_DURATION_SECONDS=20`, stop backend → friendly message, `down`/`up` keeps data + ID | results written to `AGENTS.md`; evidence of each check |

---

## 6. Open questions / decisions (batch 1 — needed before Step 1)

**Q1. Tooling: Node is not installed on this machine (`node`/`npm` not found).**
- A) **Docker-only runner** (`docker run node:22-alpine …` with `--user` mapping; plus a Dockerfile `test` stage). Pros: matches the project's "no local installs" stance, reproducible. Cons: slower loop, no local HMR for you unless you also install Node.
- B) You install Node 22 LTS locally. Pros: fast `npm`/Vite dev, normal workflow. Cons: you have to install it; I still can't until you do.
- **Recommendation: A for my verification (works now), and B optional for your own dev.** The README documents both.

**Q2. Clock-skew correction needs the HTTP `Date` header, but the backend CORS policy does not expose it.** Browsers hide every response header not CORS-safelisted unless `Access-Control-Expose-Headers` lists it, so `fetch` from `localhost:3000` → `:8080` cannot read `Date`. (`Program.cs:46` sets no `WithExposedHeaders`.)
- A) One-line backend change `.WithExposedHeaders("Date")` — you approve/make it as a separate backend change (I will not touch backend code). Pros: tiny, contract-neutral, exact fix.
- B) Serve the API through the nginx container (same origin, `/api` proxy). Pros: no CORS at all. Cons: changes the `VITE_API_BASE_URL` default and adds moving parts.
- C) No skew correction. Pros: nothing to change. Cons: with a wrong device clock the countdown is off until the next poll (≤ 4 s) flips the status; Pay may be enabled slightly late/early (a late click gets a friendly 409).
- **Recommendation: A, with C built in as the automatic fallback** (code uses skew when readable, 0 otherwise), so the frontend works either way.

**Q3. What does `http://localhost:3000/` open?** (BRD wants the ID field at the top of "the page".)
- A) Landing page first, portal via button (as in the demo). Pros: matches design. Cons: extra click; ID field not on first screen.
- B) **Portal first** (ID bar at the top, Classes tab), landing available from a "How it works" link in the header. Pros: main flow in zero clicks, BRD-literal. Cons: first impression less showy.
- C) Single page: slim hero above the ID bar. Pros: one screen. Cons: pushes the ID field down on mobile.
- **Recommendation: B.**

**Q4. Data-fetching approach.**
- A) **TanStack Query v5.** Pros: polling/pause/dedupe/mutations/invalidation tested upstream. Cons: +1 runtime dependency (~13 kB).
- B) Hand-written hooks (`useEffect` + `setTimeout`). Pros: zero dependencies. Cons: ~100 more lines of subtle code (races on ID change, overlap, unmount) that I'd have to test myself.
- **Recommendation: A.**

**Q5. Language scope.**
- A) **English UI/messages + Bangla for the three primary actions (as in the demo)**; all texts in one `messages.ts` so Bangla can be added later. Pros: small, consistent with demo/BRD labels.
- B) Full English/Bangla toggle. Pros: real localisation. Cons: translations I can't verify for tone; ~2× text to test.
- **Recommendation: A.**

### Batch 2 (can wait until Step 5 / 9 — my defaults apply unless you say otherwise)
- **Q6. Landing hero card:** (a) live aggregate "seats available now" from the API, hidden on failure **(default)**; (b) static illustration with no numbers; (c) remove.
- **Q7. Demo HTML:** (a) move to `project_docs/design/` in Step 1 **(default)**; (b) leave in `/frontend` and exclude via `.dockerignore`.
- **Q8. Fonts:** (a) keep Google Fonts `<link>` (needs internet; falls back to system fonts, Bangla may render in a fallback face); (b) self-host with `@fontsource` packages **(default; works offline in Docker, no third-party requests, +2 dev-time deps)**.

---

## 7. Backend / contract observations (reported, not worked around)

1. **`Date` header not exposed through CORS** → skew correction impossible from the browser (see Q2). Suggested: `.WithExposedHeaders("Date")` in `Program.cs`.
2. **Preflight cost (optional):** every `GET /me/holds` and every JSON `POST` sends a CORS preflight (custom `X-Student-Id` header). No `Access-Control-Max-Age` is set, so browsers cache preflights only ~5 s, roughly doubling requests at a 4 s poll. Suggested: `.SetPreflightMaxAge(TimeSpan.FromMinutes(10))`. Not required for correctness.
3. **Origin must match exactly:** CORS allows `http://localhost:3000` but not `http://127.0.0.1:3000`; opening the UI via 127.0.0.1 makes every call fail. the browser cannot tell a CORS rejection from a server outage, so I will only document this in README troubleshooting.
4. `expiresAt` is returned for `CONFIRMED`/`CANCELLED` holds too (in the past); the UI ignores it for non-`HELD` statuses.
5. Contract otherwise matches BRD §7 and the code I read (`Classes/*`, `Holds/*`, `ErrorCodes.cs`, `ProblemMapper.cs`, `StudentIds.cs`). No blocker.
