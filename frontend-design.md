# FlowForge — Frontend Engineering Design

**Status:** Design, pre-implementation. Hand to an implementer one phase at a time.
**Constraint:** Backend API contracts are **frozen**. Architecture is fixed. No backend changes except §0 blockers.
**Register:** Product UI (design serves the task). Not a landing page. The tool disappears into the work.

---

## 0. Blockers — the only backend changes proposed

I inspected every registered route. Two assignment requirements are **not buildable** against the frozen surface. Both are in `Task.md`, not invented by me.

### 🔴 B1 — Health panel has no data source

`Task.md:117` requires: *"Health panel: active runs, 24h success/failure rate, avg duration — computed via aggregate query, polled ~30s. Not hand-maintained counters."*

The only health route is `GET /health → { status: 'ok' }`. There is no aggregate endpoint.

- **Rejected:** compute client-side from `GET /runs`. It's cursor-paginated; a 24h rate would mean walking every page, and `Task.md` explicitly forbids exactly this shape of answer.
- **Recommended:** add `GET /stats` — one `SELECT` with `count(*) FILTER (WHERE …)` and `avg(finished_at - started_at)` over `runs`, tenant-scoped, ~20 lines in `execution/routes.ts` + repository. Reuses the existing guard/limiter/envelope. It's the smallest possible unblock and the requirement literally names the implementation.
- **Fallback if you refuse the change:** cut the health panel and say so in the README. Losing it costs a named requirement; I'd spend the 20 minutes.

### 🔴 B2 — Per-step logs have no endpoint

`Task.md:116` requires *"per-step logs on row expand (server-paginated, lazy log fetch)."*

`listStepLogs` **exists** in `execution/repository.ts:196` and no route calls it. `serializeStepRun` also omits `output`.

- **Recommended:** add `GET /runs/:runId/steps/:stepRunId/logs`, paginated, reusing `listStepLogs`. ~15 lines.
- **⚠️ Do NOT expose `step_runs.output` — and this is not a style opinion.** Per [audit-2026-07-16.md](audit-2026-07-16.md) C1, `output` holds the raw body of whatever URL the `http` handler fetched, and that handler has **no SSRF guard**. Today the only thing preventing exfiltration is that `serializeStepRun` forgets to serialize the field. Exposing `output` in the UI converts a proven blind SSRF into a full credential-read primitive.
  **`step_logs` carries error strings (`HTTP 500 …`), not response bodies — it is safe to expose. `output` is not, until C1 lands.** Ship logs now, `output` after the guard.

**Everything else in this document is buildable against the frozen API.** If both blockers are refused: cut the health panel, cut log expansion, keep everything else, document both.

---

## 1. Current frontend — what actually exists

753 LOC, fully tested, and **better than a typical Phase-4 stub.** Read this before assuming a greenfield.

| File | State | Plan |
|---|---|---|
| `realtime/useRunStream.ts` (230) | **Excellent.** Generation counters, gap→resync, capped backoff, permanent-error classification, terminal REST resync | **Reuse untouched.** Do not rewrite. Do not move into React Query |
| `layout.ts` (70) | dagre wrapper, pure, tested | Reuse |
| `components/WorkflowGraph.tsx` (70) | SVG + dagre | Reuse, **fix a11y** (P1) |
| `statusColor.ts` (26) | Single source of truth for status→color | Keep the seam, **fix values** (P1) |
| `api.ts` (39) | `fetchRun` + `FetchRunError` carrying HTTP status | **Extend this pattern** |
| `components/{StatusBadge,ProgressBar,Timeline,ConnectionStatusIndicator}.tsx` | Small, tested | Reuse |
| `LiveRunPage.tsx` (60) | Works; inline styles | Restyle + move to a route (P7) |
| `App.tsx` (25) | **Query-param routing, token in URL** | Replace (P2) |
| `HealthCheck.tsx` (36) | Phase 0 leftover | Delete (P2) |

**Three real defects in existing code** (fix in P1, before building on them):

1. **Status colors fail WCAG AA.** `WorkflowGraph` renders 13px white text on `#22c55e` (≈2.1:1) and `#9ca3af` (≈2.2:1). Required: 4.5:1. This is the single most visible a11y failure in the repo.
2. **Status is encoded by color alone** — WCAG 1.4.1 fail. A red/green colorblind reviewer cannot distinguish `succeeded` from `failed`. In a monitoring tool that is the *entire* signal.
3. **`ff-pulse` animation has no `prefers-reduced-motion` alternative** (`WorkflowGraph.tsx`, inline `<style>`). Infinite pulsing, unconditionally.

**Deps today:** `react`, `react-dom`, `@dagrejs/dagre`. No router, no query lib, no CSS framework, no CSS file at all.

---

## 2. Dependencies — two additions, justified

| Add | Why not hand-roll |
|---|---|
| `react-router-dom` | 8 routes with params and guards. `App.tsx` already hand-rolls query-param routing and it's already the weakest file. Hand-rolling history, params, and guards is more code than the dep. |
| `@tanstack/react-query` | `Task.md:118` already committed to it. Gives caching, invalidation, `staleTime`, retry policy, and request dedup. Hand-rolling `useEffect` fetches across 7 screens is strictly more code and worse. |

**Deliberately NOT added:**
- **Zustand** — nothing needs it. See §6. Adding a global store here would be the thing a reviewer calls out.
- **Tailwind / CSS-in-JS** — CSS Modules are native to Vite, zero deps, zero config, scoped by default.
- **Icon library** — ~6 icons needed. Inline SVG.
- **Web fonts** — `system-ui` stack. No network, no layout shift, no license question.
- **Form library** — one JSON textarea and one login form. `useState`.

---

## 3. Information architecture

| Screen | Route | Purpose | Primary user | Entry | Key interactions |
|---|---|---|---|---|---|
| Login | `/login` | Exchange credentials for JWT | Any | Direct / 401 redirect | Submit; error inline |
| Workflows | `/workflows` | Inventory + jump-off | Editor | Nav, post-login | Filter by name, paginate, open, New |
| Workflow detail | `/workflows/:id` | Understand one workflow | Editor/Viewer | List, post-save | View DAG, trigger, versions, rollback, recent runs, delete |
| Workflow editor | `/workflows/:id/edit`, `/workflows/new` | Author the DAG | Editor | Detail → Edit, New | Edit JSON, validate, **AI propose**, save |
| Run detail (live) | `/runs/:id` | Watch execution | Editor/Viewer | Trigger, history | Live graph, timeline, logs, reconnect |
| Run history | `/runs` | Audit across workflows | Viewer | Nav | Filter status/workflow, paginate |
| Health | `/health` | Ops at a glance | Admin | Nav | Poll 30s (**needs B1**) |
| Not found | `*` | — | — | — | Back to workflows |

**Deliberately not built:** user admin (no endpoint), tenant switching (JWT-scoped, by design), dark mode (§11), workflow search beyond name (backend supports name only).

---

## 4. Navigation

**Flat top bar. No sidebar.**

```
┌──────────────────────────────────────────────────────────┐
│ FlowForge   Workflows   Runs   Health          editor@… ▾ │
└──────────────────────────────────────────────────────────┘
```

Three destinations. A sidebar for three items is chrome that costs horizontal space the DAG graph actually needs. Breadcrumb-in-title on detail pages (`← Workflows / nightly-etl`) rather than a persistent breadcrumb bar.

Hierarchy: `Workflows → detail → edit` and `Runs → detail`, with `workflow detail → run detail` as the cross-link that matters (trigger → watch). The user menu holds email, role badge, and Log out.

**Why:** the product register permits standard nav and rewards familiarity. Three top-level nouns map exactly to the three backend resources. Anything more is invented structure.

---

## 5. User flows

**Login.** `/login` → POST `/auth/login` → store token + decoded claims → redirect to intended route (or `/workflows`). Failure → inline error above the form, focus returns to email, password cleared. **No token → any protected route redirects to `/login?next=…`.**

**Auth expiry.** `JWT_EXPIRES_IN=15m` and **there is no refresh endpoint.** A reviewer *will* hit this mid-demo. Any 401 from any query/mutation → clear auth → redirect to `/login?next=<current>` with "Your session expired. Sign in to continue." Handled once, globally, in the React Query client — never per-screen.

**Workflow CRUD.** List → New → editor (empty DAG scaffold) → validate → POST `/workflows` → redirect to detail. Edit → editor prefilled from `version.dag` → PATCH with `baseVersionId` → new version → detail. Delete → confirm dialog naming the workflow → DELETE → back to list. **Never optimistic on delete** (`Task.md:119`).

**Version history.** Detail → Versions panel lists `versionNumber`, `createdAt`, `createdBy`, current marker. Select → read-only DAG preview. Rollback → confirm ("Roll back to v2? This creates no new version; it repoints current.") → POST rollback → invalidate workflow + versions.

**Execution.** Detail → Trigger → POST `/workflows/:id/trigger` → 201 `{ run }` → navigate to `/runs/:id`. Run starts `pending`; the worker polls every 2s, so **the live view opens on a legitimately pending run** — the empty state must say "Waiting for a worker to pick this up", not spin silently.

**Live monitoring.** §9.

**AI generation.** §8.

**Run history.** `/runs` → filter status/workflow → cursor pages → row → `/runs/:id`.

**Health.** Poll `GET /stats` every 30s (**B1**). Stale-but-present data stays visible on refetch error with a "last updated" stamp.

---

## 6. State management — four tiers, no Zustand

| Tier | Tool | What lives there | Why |
|---|---|---|---|
| **Server state** | React Query | workflows, versions, runs, stats, propose mutation | It's a cache of someone else's data, not app state. `staleTime`, dedup, invalidation for free |
| **Session** | React Context (`AuthProvider`) | `{ token, user, login, logout }` | Read by nearly every component, changes ~twice per session. Context's re-render cost is irrelevant at that frequency |
| **Realtime** | `useReducer` inside `useRunStream` | live run/step/event state | **Already built and excellent. Keep it out of React Query** — `Task.md:118`: "don't conflate live overlay with cached request/response." A push stream with seq/gap semantics is not a cache entry |
| **Local** | `useState` | form fields, panel open, selected version, confirm dialogs | Never leaves the component |

**No Zustand. No global store.** Nothing in this app is client state shared across distant components that isn't already covered above. Adding a store would create a second source of truth next to React Query — the exact thing a reviewer flags. If a future need appears, the honest answer is Context first.

**Token storage: `localStorage`.** XSS-readable, and I'd normally push for an httpOnly cookie — but the backend is frozen and issues a bearer token, **and the WS gateway already requires the token in the query string** (`gateway.ts`, `?token=`), so the posture is already set by the server contract. `localStorage` + one honest README paragraph. Do not pretend `sessionStorage` fixes it.

---

## 7. API integration

**Layer:** `src/api/client.ts` extends the existing `FetchRunError` idea into `ApiError { status, code, message, details }`, parsing the frozen `{ error: { code, message, details? } }` envelope once, centrally. Per-resource modules (`workflows.ts`, `runs.ts`, `ai.ts`) export typed functions. Hooks (`useWorkflows`, `useWorkflow`, …) wrap them in React Query. Components never call `fetch`.

**Query keys:** `['workflows', {cursor,name}]`, `['workflow', id]`, `['versions', id]`, `['runs', {…}]`, `['run', id]`, `['stats']`.

**Caching / retry:**
```
staleTime: 30s (lists), 0 (run detail — WS owns freshness)
retry: never on 4xx. 2x exponential on 5xx/network.
```
Retrying a 422 or 403 is nonsense and burns rate-limit budget against a **per-tenant token bucket** — a stampede of retries can 429 the user's own session.

**429 handling:** the AI bucket is `capacity 5, refill 0.05/s`. Show "Too many requests — try again in a moment", disable submit briefly. Don't auto-retry into the wall.

**Mutations & invalidation:** create/update → invalidate `['workflows']` + `['workflow', id]` + `['versions', id]`. Rollback → same. Trigger → invalidate `['runs']`, navigate.

**Optimistic updates: rollback only.** `Task.md:119` — optimistic where trivially reversible, with reconcile-or-revert + toast. **Not** on delete, **not** on save (a new version number is server-assigned; guessing it is a lie).

**WS synchronization:** `useRunStream` owns it. One rule: **on terminal event, invalidate `['runs']`** so history reflects the finished run. The hook already does its own terminal REST resync — don't duplicate that in React Query.

---

## 8. AI UX — the LLM is an untrusted contributor

**The UI is where that philosophy is legible.** A reviewer sees the sentence in the README and looks for it here. Three properties carry it:

1. **The AI cannot write.** The panel calls `POST /workflows/:id/propose`, which persists nothing. Saving is the *same* `PATCH` a human uses. The UI must make this visible, not just true.
2. **The diff is the review.** Never auto-apply. The human is the merge button.
3. **The draft is editable before saving.** The proposal lands in the same JSON editor as hand-authoring — one editor, one save path.

```
┌─ Propose a change ─────────────────────────────┐
│ ┌────────────────────────────────────────────┐ │
│ │ Add a step that notifies Slack after the   │ │
│ │ nightly export finishes.                   │ │
│ └────────────────────────────────────────────┘ │
│ 68 / 2000                        [ Propose ]   │
└────────────────────────────────────────────────┘
┌─ Proposed  ·  v3 → draft  ·  2 attempts ───────┐
│  + notify        added                         │
│  ~ export        url, method                   │
│  − legacy_ping   removed                       │
│    seed          unchanged                     │
│                                                │
│  ⚠ /steps/notify — retried POST; ensure the    │
│    endpoint is idempotent                      │
│                                                │
│  Review the JSON below before applying.        │
│         [ Discard ]   [ Apply → creates v4 ]   │
└────────────────────────────────────────────────┘
```

- **`meta.attempts: 2` is shown, not hidden.** "Valid on attempt 2" is the repair loop admitting the model got it wrong first — that honesty *is* the feature. `meta.cached` shows as a "cached" chip.
- **Diff semantics come from the server** (`diff.added/removed/modified/unchanged`). Do not recompute client-side; that's a second source of truth.
- **`+ − ~` glyphs, not color alone.**
- **422 `AI_DRAFT_INVALID`** → keep the prompt, render `details.errors` as a list anchored to `path`, and **load `details.lastDraft` into the editor**. A partly-right draft beats a blank textarea. Copy: "The model couldn't produce a valid workflow after 3 attempts. Its last try is loaded below — fix it by hand or rephrase."
- **503 `AI_UNAVAILABLE`** → "AI is unavailable right now. You can still edit by hand." Panel collapses; **the editor keeps working.** The additive architecture must be visible in the failure mode.
- **Mock provider** (`AI_PROVIDER=mock`) → a visible "mock" chip. Labeled, therefore honest.
- **409 `BASE_VERSION_STALE`** → "This workflow changed while you were drafting. Reload to get the latest version." Reload button refetches and clears the proposal.

**Not built:** streaming, multi-turn chat, inline graph preview of the proposal (diff list + JSON is enough), prompt history.

---

## 9. Realtime UX — the run detail screen

```
← nightly-etl                          ● Live      Run 6e45a793
Status: running · started 12s ago
[██████████████░░░░░░░░░░]  3 / 5 steps

┌─ Graph ────────────────────┐  ┌─ Timeline ──────────────┐
│   ┌────────┐               │  │ 12:04:01 run started    │
│   │✓ seed  │               │  │ 12:04:02 seed ✓         │
│   └───┬────┘               │  │ 12:04:03 export running │
│   ┌───▼────┐  ┌─────────┐  │  │ 12:04:09 export ✗ HTTP  │
│   │⟳ export│  │· notify │  │  │          500            │
│   └────────┘  └─────────┘  │  └─────────────────────────┘
└────────────────────────────┘
┌─ Steps ────────────────────────────────────────────────┐
│ ▸ seed     ✓ Succeeded              1 attempt    1.2s  │
│ ▾ export   ✗ Failed                 1 attempt    6.1s  │
│     HTTP 500 Internal Server Error                     │
│     [logs, lazily fetched — B2]                        │
│ ▸ notify   · Pending                                   │
└────────────────────────────────────────────────────────┘
```

**Node status visualization.** Fill = status color (fixed for contrast, P1). **Plus a glyph** (`✓ ✗ ⟳ · ⊘`) inside every node — the non-color channel. `skipped` also keeps its dashed stroke. `statusColor.ts` stays the single source of truth so badge and node can never disagree — extend it with `STEP_STATUS_GLYPH`.

**Progress.** `ProgressBar` exists. Denominator = `dag.steps.length` (authoritative), not `Object.keys(steps).length` (grows as events arrive — a bar that moves because the denominator changed is lying).

**Timeline.** Exists. Append-only from `events`. Cap the rendered list at the most recent 200 with a "showing last 200" note — an unbounded array of DOM nodes is the one real perf risk here.

**Logs.** Lazy, on row expand, only for the expanded step (**B2**).

**Reconnect.** `ConnectionStatusIndicator` already maps all five states. Copy: `connecting` → "Connecting…"; `open` → "● Live"; `reconnecting` → "Reconnecting…" *(keep the last known state visible — do not blank the graph)*; `closed` → "Finished"; `error` → "Couldn't load this run."

**The subtle one:** on gap detection the hook discards and REST-resyncs. The UI must not flash empty during that. Render from last-known state and overlay a thin "resyncing" hint. **Never** unmount the graph on a transient state.

**Pending runs are normal.** The worker polls every 2s. `/runs/:id` opened immediately after trigger shows `pending` with "Waiting for a worker to pick this up" — not a spinner implying breakage.

---

## 10. Error UX

One rule: **errors appear where the user can act on them.** Field errors inline; screen errors in place; session errors globally.

| Error | Surface | Copy / behavior |
|---|---|---|
| `VALIDATION_ERROR` (400) | Inline, under the field | Fastify's field path → the input |
| `INVALID_DAG` (422) | Editor, per-step | Map `details[].path` (`/steps/x/dependsOn`) to a line marker + list. **The engine's `path`/`message` is already precise — render it verbatim, don't paraphrase** |
| `AI_DRAFT_INVALID` (422) | AI panel | §8 — keep prompt, load `lastDraft`, list errors |
| `AI_UNAVAILABLE` (503) | AI panel only | Panel collapses; editor unaffected |
| `BASE_VERSION_STALE` (409) | Editor / AI panel | "Changed while you were editing" + Reload |
| `RATE_LIMITED` (429) | Toast | "Too many requests." Disable submit ~3s. No auto-retry |
| `UNAUTHORIZED` (401) | **Global** | Clear auth → `/login?next=…` + "Session expired" |
| `FORBIDDEN` (403) | Inline | Viewers: hide write controls *and* handle 403 — never rely on hiding alone |
| `NOT_FOUND` (404) | Full page | "Workflow not found — it may have been deleted" + back |
| `INTERNAL_ERROR` (500) | Inline + Retry | Generic; never echo raw server text |
| WS disconnect | Status chip | §9. Non-blocking |
| Execution failure | Run page | **Not a UI error.** `failed` is a legitimate outcome. Render as data — red node, glyph, error string. Never a toast |

That last row is the one people get wrong: a failed run is the product working correctly.

**RBAC:** viewers get no Trigger/Edit/Delete/Propose buttons (role from JWT claims). Hiding is UX; the 403 handler is correctness. Do both.

---

## 11. Design system

**Scene sentence:** *a reviewer opening this on a laptop in a well-lit room, in daylight, to judge whether the engineering is sound.* That forces **light, single theme**. Dark mode is scope creep and ~1.5h of tokens and QA I'd rather spend on the AI panel. Say so in the README rather than half-shipping a toggle.

**Color — Restrained.** Neutral surfaces + one accent + semantic status. Note the surface is **true neutral (chroma 0)** — deliberately *not* the warm cream/sand that AI dashboards default to.

```css
--bg:      #ffffff;   --surface: #f9fafb;   /* panels, table headers */
--border:  #e5e7eb;   --ink:     #111827;   /* body: 16.1:1 */
--ink-mut: #4b5563;   /* secondary: 7.6:1 — NOT #9ca3af (2.5:1, fails) */
--accent:  #1d4ed8;   /* primary actions, focus, selection — 6.3:1 */
```

**Status colors — replacing the failing values.** Same seam (`statusColor.ts`), corrected shades. All ≥4.5:1 against white text:

| Status | Now | → | Contrast (white text) |
|---|---|---|---|
| pending | `#9ca3af` | `#6b7280` | 4.8:1 |
| queued | `#9ca3af` | `#6b7280` | 4.8:1 |
| running | `#3b82f6` | `#1d4ed8` | 6.3:1 |
| succeeded | `#22c55e` **2.1:1 ✗** | `#15803d` | 5.0:1 |
| failed | `#ef4444` | `#b91c1c` | 5.9:1 |
| skipped | `#6b7280` | `#4b5563` + dashed | 7.6:1 |

**Verify with a checker at implementation time — do not trust these numbers on faith.** Pair every color with `STEP_STATUS_GLYPH` so color is never the only channel.

**Typography.** One family: `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`. Fixed rem scale, ratio ~1.15 (product register — no fluid clamp; a heading that shrinks in a panel looks worse). `12 / 14 / 16 / 18 / 21 / 24px`. Body 16. Labels 14. Table data 14. **`ui-monospace, SFMono-Regular, Menlo, monospace` for the JSON editor, step keys, run IDs** — a genuine contrast axis, not a second sans.

**Spacing.** 4px base: `4 8 12 16 24 32 48`. One scale, no exceptions.

**Iconography.** ~6 inline SVGs (chevron, check, cross, spinner, plus, trash), 16px, `stroke-width: 1.5`, `currentColor`. Status glyphs are text, not SVG — they must survive in `<text>` inside the graph.

**z-index scale:** `--z-dropdown:10; --z-sticky:20; --z-modal-backdrop:30; --z-modal:40; --z-toast:50`. Never `9999`.

**Bans honored:** no gradient text, no glassmorphism, no side-stripe borders, no hero-metric template, no uppercase tracked eyebrows, no decorative motion. Motion is 150–250ms, state-conveying only.

---

## 12. Accessibility

Non-negotiable, and cheap if done in P1 rather than retrofitted.

- **Contrast:** §11. Fixes an existing AA failure.
- **Never color alone:** glyph on every status (graph node, badge, timeline, diff `+ − ~`).
- **Keyboard:** every action reachable and operable. Real `<button>`/`<a>`, never `<div onClick>`. Visible focus: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` — never `outline: none`. Logical tab order. `Esc` closes dialogs.
- **Focus management:** on route change move focus to the `<h1>` (`tabIndex={-1}`) — SPAs strand screen-reader focus otherwise. Confirm dialogs: `<dialog>` (native focus trap + `Esc`, zero deps), focus the safe action, restore on close.
- **ARIA:** `aria-live="polite"` on the connection chip and run status (announce transitions, don't spam per event). `role="alert"` on errors (already in `LiveRunPage`). Graph `role="img"` with an `aria-label` summarizing status counts — **an SVG DAG is not readable node-by-node; give the summary** ("Workflow graph: 5 steps, 3 succeeded, 1 failed, 1 pending"). Tables: real `<table>`/`<th scope>`. Icon buttons: `aria-label`.
- **Reduced motion:** wrap `ff-pulse` in `@media (prefers-reduced-motion: no-preference)`. Reduced-motion fallback = static fill + glyph, which already carries the meaning.
- **Zoom:** usable at 200%. rem units, no fixed-px containers.

---

## 13. Responsive

**Desktop-first, explicitly.** This is an authenticated ops tool for a reviewer on a laptop. Optimizing for phones would be theater.

- **Desktop ≥1024px — the target.** Two-column run view (graph | timeline). Full tables. Editor + AI panel side by side.
- **Tablet 640–1023px — usable.** Columns stack (graph over timeline). Editor full-width, AI panel below. Tables drop low-value columns (`createdBy`, `triggerType`).
- **Mobile <640px — read-only degradation, deliberate.** Nav collapses to a menu. Graph gets `overflow-x: auto` at min-width (never shrink a DAG to illegibility). Tables → stacked definition lists. **The JSON editor and AI panel show "Editing requires a larger screen."** Authoring a DAG on a phone is not a real job; a legible read-only run view is.

Structural breakpoints only (`640`, `1024`) — no fluid type. Grids use `repeat(auto-fit, minmax(280px, 1fr))` where they can.

---

## 14. Implementation roadmap

Each phase: <2h, cohesive files, one Conventional Commit, tests included. **In order** — later phases assume earlier ones. Vitest + RTL are already configured.

---

### P1 — Design tokens + fix existing a11y defects
**Goal:** a token layer and a compliant status vocabulary, before anything is built on top of the broken one.
**Scope:** tokens; corrected status colors; glyph channel; reduced motion. No new screens.
**Files:** `src/styles/tokens.css` (new), `src/styles/global.css` (new), `src/main.tsx`, `src/statusColor.ts`, `src/components/WorkflowGraph.tsx`, `src/components/StatusBadge.tsx`
**Deliverables:** full token set (§11); `STEP_STATUS_COLOR` corrected; `STEP_STATUS_GLYPH` added; glyph rendered in node + badge; pulse gated on `prefers-reduced-motion`; graph `aria-label` summary.
**Tests:** every status has a glyph; node renders glyph + `data-status`; snapshot of `STEP_STATUS_COLOR` pinning the AA-passing values (a regression guard with teeth); reduced-motion query present.
**DoD:** no white-on-light-fill anywhere; status legible greyscale; existing tests green.
`fix(dashboard): meet WCAG AA on status colors and honor reduced motion`

---

### P2 — Router, app shell, auth, login
**Goal:** real navigation and a real session. Kills token-in-URL.
**Scope:** `react-router-dom`; `AuthProvider`; `ProtectedRoute`; `LoginPage`; `AppShell`; delete `HealthCheck.tsx`.
**Files:** `package.json`, `src/App.tsx`, `src/main.tsx`, `src/auth/{AuthProvider,useAuth,ProtectedRoute}.tsx`, `src/pages/LoginPage.tsx`, `src/components/AppShell.tsx`, `src/HealthCheck.tsx` (delete)
**Deliverables:** routes per §3; token+claims in `localStorage`; role exposed; top nav; user menu w/ logout; `?next=` redirect.
**Tests:** login success stores token + redirects; failure shows inline error, clears password; protected route redirects anonymous → `/login?next=…`; logout clears + redirects.
**DoD:** no route reads a token from the URL; refresh preserves session.
`feat(dashboard): add routing, auth context, and login`

---

### P3 — API client + React Query
**Goal:** one typed way to call the backend; one place that handles 401.
**Scope:** `ApiError`; resource modules; `QueryClientProvider`; global 401.
**Files:** `package.json`, `src/api/{client,workflows,runs,ai}.ts`, `src/api.ts` (fold into `api/runs.ts`, keep `fetchRun` export for `useRunStream`), `src/main.tsx`
**Deliverables:** envelope parsed into `ApiError{status,code,message,details}`; retry never on 4xx, 2× on 5xx; `staleTime` per §7; 401 → logout+redirect.
**Tests:** envelope → `ApiError` fields; 4xx not retried (assert fetch call count); 5xx retried twice; 401 triggers logout; `fetchRun` still satisfies `useRunStream`.
**DoD:** no component calls `fetch`; `useRunStream` untouched.
`feat(dashboard): add typed API client and React Query setup`

---

### P4 — Workflows list
**Goal:** the landing screen.
**Files:** `src/pages/WorkflowsPage.tsx`, `src/hooks/useWorkflows.ts`, `src/components/{DataTable,EmptyState,ErrorState,Skeleton}.tsx`
**Deliverables:** table (name, current version, created, actions); debounced name filter; cursor pagination; New button (editors only); skeleton; **empty state that teaches** ("No workflows yet — create one, or describe one in plain English and let the AI draft it"); error + retry.
**Tests:** rows render; empty state on `[]`; error state + retry refetches; viewer sees no New.
**DoD:** all four states reachable in tests.
`feat(dashboard): add workflows list page`

---

### P5 — Workflow detail: graph, versions, rollback
**Goal:** understand and operate one workflow.
**Files:** `src/pages/WorkflowDetailPage.tsx`, `src/components/{VersionList,ConfirmDialog}.tsx`, `src/hooks/{useWorkflow,useVersions,useRollback}.ts`
**Deliverables:** static `WorkflowGraph` (all `pending` — reuse); version list w/ current marker; select → read-only preview; rollback w/ `ConfirmDialog` (native `<dialog>`), optimistic + revert-on-error + toast; recent runs (`GET /runs?workflowId=`, top 5); Delete (confirm, **not** optimistic); 404 page.
**Tests:** rollback confirm → POST + invalidate; rollback failure reverts + toasts; delete requires confirm; viewer sees no rollback/delete.
**DoD:** `ConfirmDialog` traps focus, `Esc` closes, focus restores.
`feat(dashboard): add workflow detail with version history and rollback`

---

### P6 — Workflow editor: create, update, delete
**Goal:** hand-authoring, and the save path the AI will reuse.
**Files:** `src/pages/WorkflowEditorPage.tsx`, `src/components/DagEditor.tsx`, `src/hooks/{useCreateWorkflow,useUpdateWorkflow}.ts`
**Deliverables:** monospace JSON textarea + line numbers; client-side `JSON.parse` check on blur (**syntax only — never reimplement `validateDag`; the server is the trust boundary**); create → POST → detail; edit → PATCH **with `baseVersionId`** → detail; 422 → per-step errors mapped from `details[].path`; 409 → stale banner + Reload; unsaved-changes guard.
**Tests:** 422 renders `path`-anchored errors; 409 shows stale banner; PATCH includes `baseVersionId`; malformed JSON blocks submit without a request.
**DoD:** no client-side DAG validation beyond `JSON.parse`.
`feat(dashboard): add workflow editor with create, update, and delete`

---

### P7 — Trigger + live run route
**Goal:** close the trigger → watch loop; retire the query-param page.
**Files:** `src/pages/RunDetailPage.tsx` (from `LiveRunPage.tsx`), `src/hooks/useTriggerRun.ts`, `src/components/ConnectionStatusIndicator.tsx`
**Deliverables:** Trigger → POST → navigate `/runs/:id`; token from `useAuth`, `runId` from route params; **pending empty state** ("Waiting for a worker…"); reconnect copy (§9); progress denominator = `dag.steps.length`; timeline capped at 200; terminal → invalidate `['runs']`; styled per tokens.
**Tests:** trigger navigates to run route; pending state renders; existing `useRunStream` tests still pass unmodified; reconnecting keeps last-known graph mounted.
**DoD:** `useRunStream.ts` diff is **zero lines**.
`feat(dashboard): wire manual trigger to the live run view`

---

### P8 — Run history
**Goal:** cross-workflow audit.
**Files:** `src/pages/RunsPage.tsx`, `src/hooks/useRuns.ts`
**Deliverables:** table (status, workflow, trigger, started, duration); status + workflow filters; cursor pagination; row → run detail; all four states.
**Tests:** status filter hits the query param; pagination advances cursor; empty state.
**DoD:** filters reflected in the URL (shareable, back-button correct).
`feat(dashboard): add run history with status and workflow filters`

---

### P9 — AI proposal panel
**Goal:** the differentiator, and the philosophy made visible.
**Files:** `src/components/{ProposePanel,DiffView}.tsx`, `src/hooks/usePropose.ts`, `src/pages/WorkflowEditorPage.tsx`
**Deliverables:** §8 in full — char counter (2000, client UX only); diff from server; `+ − ~` glyphs; `meta.attempts` + cached/mock chips; **draft loads into the editor, editable**; Apply → the **same** `PATCH` (P6), never a separate path; 422 loads `lastDraft`; 503 collapses panel, editor lives; 409 reload; 429 copy; loading state noting a free model can take 10s+.
**Tests:** success → diff renders + draft in editor; **Apply calls the same `useUpdateWorkflow` as manual save (assert one mutation path)**; 422 → errors + `lastDraft` editable + prompt retained; 503 → editor still functional; `meta.attempts: 2` visible.
**DoD:** the panel cannot write. Grep proves one save path.
`feat(dashboard): add AI workflow proposal with diff review`

---

### P10 — Health panel — **BLOCKED on B1**
**Goal:** ops at a glance.
**Do not start until `GET /stats` exists.** Do not fake it from `GET /runs`.
**Files:** `src/pages/HealthPage.tsx`, `src/hooks/useStats.ts`
**Deliverables:** active runs, 24h success/failure, avg duration; `refetchInterval: 30_000`; stale-data-visible on refetch error with "last updated".
**Tests:** renders stats; polls at 30s (fake timers); refetch error keeps stale data visible.
`feat(dashboard): add health panel with polled aggregate stats`

---

### P11 — Log expansion — **BLOCKED on B2 (and audit C1)**
**Goal:** per-step logs on expand.
**Do not start until the logs route exists. Expose `step_logs` only — never `step_runs.output` until the SSRF guard lands.**
**Files:** `src/components/StepLogList.tsx`, `src/hooks/useStepLogs.ts`, `src/pages/RunDetailPage.tsx`
**Tests:** logs fetched only on expand (assert no request while collapsed); pagination; empty state.
`feat(dashboard): add lazy per-step log expansion`

---

### P12 — Final hardening
**Goal:** the pass that separates "works" from "shipped".
**Files:** `src/components/{ErrorBoundary,Toast}.tsx`, `src/App.tsx`, `src/styles/global.css`
**Deliverables:** `ErrorBoundary` at route level; toast container; focus-to-`<h1>` on route change; 404 page; `:focus-visible` audit; 200% zoom pass; README frontend section (state tiers, no-Zustand rationale, `localStorage` posture, desktop-first, dark-mode cut).
**Tests:** boundary catches a throwing child; focus moves to `<h1>` on navigate.
**DoD:** keyboard-only walkthrough of login → create → propose → apply → trigger → watch, with no mouse.
`feat(dashboard): harden error boundaries, focus management, and empty states`

---

**Budget ≈ 16–18h.** Core = **P1–P9**. If time runs out, cut in this order: **P8** (fold recent-runs into P5) → **P12** partially → **P10/P11** (already blocked). **Never cut P1** — it's the cheapest phase and the most visible failure if skipped.

---

## 15. Engineering risks

**UI complexity.** The JSON editor is the sharp edge. The temptation is a visual DAG builder with drag-and-drop — 2+ days, and it competes with the AI panel for the same "authoring" story. **A monospace textarea + server-side validation is the lazy correct answer**: the schema is the contract, the errors are already field-pathed, and the AI panel is the interesting authoring path. Say this in the README before a reviewer asks.

**Performance.** Two real risks, both mitigated: an unbounded `events` array (cap at 200), and `computeLayout` re-running per render (already `useMemo`'d — don't regress it). Everything else is a handful of rows.

**Maintainability.** The one genuine trap: **`useRunStream` sitting outside React Query looks inconsistent** and someone will "fix" it. It's deliberate — a push stream with seq/gap semantics is not a request/response cache. Comment the seam and put it in the README.

**Technical debt, accepted and named:** no dark mode; no virtualized tables; no i18n; `localStorage` token; mobile is read-only; no visual DAG builder; no E2E (component tests only — Playwright is a day, and the backend already has a real E2E).

**Likely reviewer criticisms, with answers:**
- *"Why no Zustand/Redux?"* → Nothing needs it. Four tiers, each with a reason. Adding a store would duplicate React Query.
- *"Token in localStorage is XSS-vulnerable."* → Correct. The backend is frozen, issues a bearer token, and the WS gateway already requires `?token=`. httpOnly cookies would need a backend change. Named in the README, not hidden.
- *"Why a JSON textarea instead of a real builder?"* → Above.
- *"Why is the run stream not in React Query?"* → Above.
- *"You didn't build the health panel."* → **No aggregate endpoint exists, and faking it from paginated runs is what `Task.md:117` explicitly forbids.** Flagged as B1 with a 20-minute fix.
- *"Colors changed from the Phase-4 palette."* → The Phase-4 palette failed WCAG AA at 2.1:1 and encoded status by color alone. In a monitoring tool that's a functional defect, not a taste call.

---

## 16. Challenging my own plan

**The router is the weakest justification.** 8 routes vs. a ~15-line hash router. I'm keeping `react-router-dom` because `?next=` redirects, param typing, and route guards are exactly where a hand-rolled router quietly breaks — and `App.tsx` is already the file that proves it. But it's the one dep I'd drop first under pressure.

**React Query might be over-fetching abstraction for 7 screens.** Counter: `Task.md:118` already committed to it, and the 401-once-globally and no-retry-on-4xx behaviors are the difference between a demo and a product. Keep.

**12 phases is a lot of ceremony.** P10/P11 are blocked and P12 is polish, so it's really 9 building phases. If that still reads as over-planning, merge P4+P5. I would not merge P1 into anything — a11y retrofits are where this kind of plan dies.

**The strongest argument against this plan:** it's ~17h of frontend on a backend with a **proven, exploitable SSRF** ([audit C1](audit-2026-07-16.md)), no retry wiring, and no execution timeout. **If you have 20 hours left, spend the first 4 on C1–C4 and then run this plan.** Shipping P11 (log expansion) on top of an unfixed C1 is actively harmful — it builds the window into the hole. The UI does not become more impressive than the engine it displays; a reviewer who finds the SSRF stops reading the CSS.

**What I'd cut if this were 8 hours instead of 17:** P1, P2, P3, P6, P7, P9. That's login → edit → propose → apply → trigger → watch — the complete story, no list pages, no history. The demo path is worth more than coverage.
