# FlowForge — Frontend UX Revision

**Status:** Revision of the approved P1–P12 roadmap. Not a replacement.
**Trigger:** genuine user feedback — *"I feel like I couldn't do anything in this web. I'm confused as a user."*
**Method:** walked the real running app as a first-time reviewer (screenshots), not a code read.
**Constraint:** backend frozen; architecture fixed. One seed-data change proposed (data, not schema/API).

---

## 1. UX audit — I reproduced the confusion, screen by screen

The feedback is not vague. I logged in as `editor@acme.dev` and hit a wall at every step. Here is the exact first-run path.

### Screen 1 — Login. "What is this? What do I type?"
A bare "Sign in" with two fields. **No product name beyond the tab, no one-line description, and — for a take-home reviewer — no credentials.** The seeded logins live only in the README. A reviewer who opens the URL before reading the README is stuck at the gate with nothing to type. First friction before the app even loads.

### Screen 2 — Landing. "There's nothing here."
Login lands on `/workflows`. **The seed creates zero workflows** (`seed.ts` inserts tenants and users only — verified). So a fresh reviewer sees an **empty table**: heading "Workflows", a "New" button, a filter box, and an empty-state line. That's the entire application on first contact. It never says what FlowForge *is*, what a workflow *is*, or why anyone would click "New". The richest thing the backend does — execute a DAG and stream it live — is invisible and unreachable.

*(In my screenshots one row appears, `ssrf-poc` — that's an artifact I created during the security audit. Delete it; the true first-run table is empty.)*

### Screen 3 — "New workflow." "I can't do anything."
The single path forward is "New" → `/workflows/new`, which is **a full-height raw JSON textarea pre-filled with `{"steps": []}`.** No example, no field hint, no notion of what a step looks like. A reviewer who doesn't have the DAG schema memorized is dead in the water. **This is the literal moment the feedback describes.**

### Screen 4 — The AI feature is below the fold, on the scary page.
The `ProposePanel` — the differentiator, the whole "describe it in English" story — is mounted *underneath* the JSON editor on that same `/workflows/new` page. On a 720px viewport it is scrolled off-screen. **The best feature in the product is invisible at the exact moment the user is most lost.** Nothing anywhere else in the app hints that AI generation exists.

### Screen 5 — "Health" nav → "Not found."
The top nav shows Workflows · Runs · **Health**. Health has no page (blocked on the missing `GET /stats`, [frontend-design.md](frontend-design.md) B1) and falls through to the catch-all. Clicking a primary nav item lands on **"Not found"** — with "Health" still highlighted as the active link. That single interaction makes the whole app read as broken.

### The ten evaluation questions, answered honestly

| Question | Verdict |
|---|---|
| Does navigation make sense? | Structure yes; **one of three items is a dead link** |
| Is the primary workflow obvious? | **No.** "New" → raw JSON is the only signposted path |
| Does the dashboard communicate what the app does? | **No.** There is no dashboard — the landing is an empty table |
| Can a new user understand the next action in 10s? | **No.** Empty table → "New" → JSON void |
| Are AI features discoverable? | **No.** Two levels deep, below the fold, on the intimidating page |
| Are important actions hidden? | **Yes.** Generate-with-AI and Trigger are both buried |
| Which screen should be the landing? | Not the raw table — an **overview with next actions** (§7) |
| Which pages need better empty states? | Workflows (teach + demo), Runs, the whole first-run |
| Which interactions take too many clicks? | Create-with-AI = login→Workflows→New→scroll→panel→propose→apply→save. **6+ steps to the headline feature** |
| Which screens should merge/simplify? | Split the editor into **AI-first vs. advanced JSON**; make Trigger reachable without reading JSON |

**Root cause, one sentence:** the app assumes you already know FlowForge and can hand-author a DAG in JSON — so a first-time reviewer, who knows neither, correctly concludes there is nothing they can do.

---

## 2. Recommended UX improvements (ranked by leverage)

Ordered by confusion-removed-per-hour. The first three fix ~80% of the feedback.

### R1 — 🥇 Seed 2–3 example workflows *(highest leverage; ~30 min; seed-data only)*
This one change rewrites the entire first run. Instead of an empty table, the reviewer lands on real workflows they can **open → trigger → watch light up** — the product's best moment — **without authoring a single line of JSON.** Suggested seeds, one per demo beat:
- `hello-http` — one `http` GET to a public endpoint (succeeds fast; clean green run)
- `parallel-fanout` — a diamond (`seed → {a,b} → join`), showing concurrent execution and the graph
- `retry-demo` — an `http` step to a flaky/404 URL, showing retry → failure → downstream `skipped`

**This is a seed-script addition, not a backend redesign** — no schema, migration, route, or contract changes. It writes rows through the *existing* create path. If you consider even seed data off-limits, the fallback is a client-side "Load example" button that POSTs a bundled DAG — but seed is cleaner and also feeds the run-history and (future) health views for free.

### R2 — 🥈 Replace the landing with an overview that orients + routes *(§7; part of Batch A)*
A real post-login home: one line saying what FlowForge does, three primary next-actions (**Generate with AI** · **Create manually** · **Browse examples**), and a compact "recent runs" strip so the live-monitoring capability is visible from second one. Answers "what is this / what do I do first" in the first 10 seconds.

### R3 — 🥉 Make AI a first-class entry point, above the fold *(Batch C)*
Promote generation out of the editor's basement:
- A primary **"Generate with AI"** button on the overview and on the Workflows empty state.
- Route it to the editor in an **AI-first layout**: prompt box and diff at the top, JSON editor collapsed into an "Advanced / edit JSON" disclosure below. Raw JSON becomes the escape hatch, not the front door.

### R4 — Fix the Health dead-link *(Batch A; tiny)*
Until `GET /stats` exists, the nav must not route to "Not found." Either **remove Health from the nav** (cleanest) or render a labeled "Coming soon — needs the stats endpoint" placeholder page. Never let a primary nav item 404.

### R5 — Give the JSON editor a starting shape + inline example *(Batch C)*
Even for manual authoring, `{"steps": []}` teaches nothing. Prefill a **one-valid-step scaffold** and show a collapsible "step reference" (the four step types with a minimal example each, derived from the shared schema). The server stays the trust boundary; this is only authoring assistance.

### R6 — Surface credentials + product identity on login *(Batch A; tiny)*
Add a one-line product descriptor under "Sign in", and — dev/demo only — a muted "Demo: `admin@acme.dev` / `password123`" hint (gated on `import.meta.env.DEV` or a `VITE_SHOW_DEMO_CREDS` flag so it never ships to a real deployment). Removes the very first point of friction for a reviewer.

### R7 — Make "Trigger + watch" reachable in one obvious click *(Batch B)*
On workflow detail, the **Trigger** button must be the visually primary action, and triggering should navigate straight to the live run view. The path from "I see a workflow" to "I'm watching it run" should be one click, no JSON.

---

## 3. Screens that need redesign (not rebuild)

Everything below reuses existing components and hooks — this is re-composition, not new architecture.

| Screen | Change | Reuses |
|---|---|---|
| **Login** | + product line, + dev credentials hint | `LoginPage` |
| **Overview (new)** | New `/` landing: intro + 3 CTAs + recent runs | `useRuns`, `useWorkflows`, `EmptyState`, `DataTable` |
| **Workflows** | Empty state → teaches + demo + AI CTA; header gets "Generate with AI" | `WorkflowsPage`, `EmptyState` |
| **Editor** | Split: AI-first (prompt+diff top) / JSON in disclosure; scaffold + step reference | `WorkflowEditorPage`, `ProposePanel`, `DagEditor` |
| **Workflow detail** | Trigger becomes primary action → navigates to live run | `WorkflowDetailPage`, `useTriggerRun` |
| **Health** | Remove from nav OR labeled placeholder (no 404) | `AppShell` |
| **Run detail** | Already good; ensure pending empty-state copy is reassuring | `RunDetailPage` |

---

## 4. Components to add or simplify

**Add (small, composed from existing tokens):**
- `PageIntro` — reusable heading + one-line description + optional primary action. Kills the "what is this" gap on Overview and empty states.
- `ActionCard` — icon + title + one-line + CTA, for the three overview choices. Flat, bordered, token-driven.
- `OverviewPage` — the new landing, assembling `PageIntro` + three `ActionCard`s + a recent-runs strip.
- `StepReference` — collapsible cheat-sheet of the four step types (derived from the shared schema, not hand-copied).

**Simplify:**
- `WorkflowEditorPage` — currently one intimidating stack. Split into an AI-first view with the JSON editor behind an "Advanced" disclosure. Fewer things visible at once, clearer default path.
- `AppShell` nav — drop the dead Health link (or make it a real, honest state).

**Explicitly do NOT add:** a visual drag-and-drop DAG builder (2+ days, competes with the AI story), a dashboard charting lib, or any new global state. The confusion is about orientation and discoverability, not missing power.

---

## 5. New navigation structure

Keep the flat top bar; fix its honesty and add a home.

```
┌───────────────────────────────────────────────────────────────┐
│ FlowForge   Home   Workflows   Runs           editor@acme.dev ▾ │
└───────────────────────────────────────────────────────────────┘
```

- **Home** (`/`) → the new Overview. The brand wordmark also links here.
- **Workflows** (`/workflows`) → list (unchanged route).
- **Runs** (`/runs`) → history (unchanged).
- **Health removed** until `GET /stats` lands, then re-added pointing at a real page. A nav item must never lead to "Not found."

Why: three honest destinations, plus a home that orients. Same low-chrome philosophy as [frontend-design.md](frontend-design.md) §4 — but the landing is now a place that answers "what do I do," not a database table.

---

## 6. Recommended landing / dashboard layout

`/` after login — the screen that must answer *what is this*, *what do I do first*, and *how do I see it work*, in ten seconds.

```
┌───────────────────────────────────────────────────────────────┐
│ FlowForge                                                      │
│ Build workflows as DAGs, run them, and watch each step         │
│ execute live. Describe one in plain English or author it       │
│ directly.                                                      │
│                                                                │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐         │
│ │ ✦ Generate    │ │ ⌨ Create      │ │ ▸ Browse       │         │
│ │   with AI     │ │   manually    │ │   examples     │         │
│ │ Describe it;  │ │ Author the    │ │ Open a sample, │         │
│ │ get a draft   │ │ DAG as JSON   │ │ run it, watch  │         │
│ │ [Generate →]  │ │ [New →]       │ │ [Examples →]   │         │
│ └───────────────┘ └───────────────┘ └───────────────┘         │
│                                                                │
│ Recent runs                                       View all →   │
│ ┌────────────────────────────────────────────────────────┐    │
│ │ hello-http        ✓ succeeded   2m ago      Open        │    │
│ │ parallel-fanout   ⟳ running     just now    Watch       │    │
│ │ retry-demo        ✗ failed      5m ago      Open        │    │
│ └────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────┘
```

- **Generate with AI is the primary (accent) action** — the differentiator leads.
- **Browse examples** only appears when seeds exist (R1); it's the zero-JSON path to the live-run demo.
- **Recent runs** makes execution + realtime visible immediately; each row deep-links to the live view. Empty (no seeds, no R1) → a single "Run an example to see it here" line, not a blank.
- Copy is sentence-case, no exclamation, per the product register.

---

## 7. Updated roadmap — P1–P12 merged into 5 batches

Per your request: keep every phase's intent, merge the tiny ones, reorder for first-run impact, land in **5 batches**. Each batch is a working, demoable, committable state (CLAUDE.md convention). **Most of P1–P12 is already built** — so this is stated as *keep / revise / add* against what exists, not a green-field rebuild.

Reordering principle: **the first-run experience is now built first**, because that is what the feedback is about. The old plan built list→detail→editor→AI bottom-up; a reviewer never got far enough to see the payoff.

---

### Batch A — Orientation & first-run *(the feedback fix)*
**Folds:** R2, R4, R6 + the seed change R1 · **new work + revises P2/P4**
**Goal:** a first-time user understands the app and reaches a runnable example within 10 seconds, with no dead links.
**Scope:**
- Seed 2–3 example workflows (`apps/api/src/db/seed.ts`) — the only backend-side file, seed data only.
- `OverviewPage` + `PageIntro` + `ActionCard`; route `/` → Overview (replaces the `Navigate` to `/workflows`).
- Remove Health from `AppShell` nav (re-add with P10 when `/stats` exists).
- Login: product line + dev-gated credentials hint.
- Workflows empty state: teach + "Generate with AI" + "Browse examples".
**Files:** `db/seed.ts`, `App.tsx`, `components/AppShell.tsx`, `components/{PageIntro,ActionCard,OverviewPage}.tsx`, `pages/LoginPage.tsx`, `pages/WorkflowsPage.tsx`
**Deliverables:** overview landing; honest nav; oriented login; example workflows visible on first login.
**Tests:** `/` renders Overview with three CTAs; nav has no Health link; Overview recent-runs empty state renders with no runs; seed inserts N example workflows (API-side seed test).
**DoD:** fresh clone → seed → login → the user can reach a running example without typing JSON.
`feat(dashboard): add overview landing, seed examples, and fix dead nav`

---

### Batch B — Browse, operate, watch *(the payoff path)*
**Folds:** P4 (revise), P5, P7, P8 · **mostly built — re-compose + wire**
**Goal:** from the overview, a user can open a workflow, trigger it, and watch it execute live — the core demo, one click at a time.
**Scope:**
- Workflow detail: **Trigger as the primary action**, navigating straight to the live run.
- Ensure Runs list + Workflow detail "recent runs" deep-link into the live view.
- Live run pending state: reassuring copy ("Waiting for a worker to pick this up — starts within a couple of seconds").
- Confirm the trigger→watch path is one obvious click with no JSON exposure.
**Files:** `pages/WorkflowDetailPage.tsx`, `pages/RunDetailPage.tsx`, `pages/RunsPage.tsx`, `hooks/useTriggerRun.ts`
**Deliverables:** open→trigger→watch in one click; live graph lights up; history reflects it.
**Tests:** Trigger navigates to `/runs/:id`; pending copy renders; `useRunStream` tests untouched (zero-line diff to the hook).
**DoD:** from Overview → Browse examples → open → Trigger → watch nodes recolor live, no JSON seen.
`feat(dashboard): make trigger-and-watch a one-click path from any workflow`

---

### Batch C — AI-first authoring *(discoverability of the differentiator)*
**Folds:** R3, R5, P6 (revise), P9 (revise) · **ProposePanel built — relayout + promote**
**Goal:** generating a workflow with AI is the obvious, prominent authoring path; raw JSON is the escape hatch.
**Scope:**
- Editor split into **AI-first layout**: prompt + diff at top, JSON editor inside an "Advanced — edit JSON" disclosure.
- "Generate with AI" entry from Overview + Workflows header route here in AI mode.
- JSON scaffold with one valid step + `StepReference` cheat-sheet (from shared schema).
- Preserve the invariants already in place: one save path (Apply === manual Save), `meta.attempts` shown, 422 loads `lastDraft`, 503 collapses the panel but the editor still works.
**Files:** `pages/WorkflowEditorPage.tsx`, `components/{ProposePanel,DiffView,DagEditor,StepReference}.tsx`, `pages/OverviewPage.tsx`, `pages/WorkflowsPage.tsx`
**Deliverables:** AI panel above the fold; describe→draft→diff→edit→save without ever starting from a blank JSON void.
**Tests:** editor opens in AI mode from the Generate CTA; Apply calls the same `useUpdateWorkflow` (assert one mutation path); JSON editor reachable via disclosure; `StepReference` renders four types.
**DoD:** a reviewer generates and saves a workflow from plain English without touching raw JSON first.
`feat(dashboard): promote AI generation to a first-class authoring path`

---

### Batch D — Error & empty-state polish *(the "never stranded" pass)*
**Folds:** P10 (Health placeholder only), P12 (error UX) · **components built — apply consistently**
**Goal:** the app never leaves the user wondering "what now" — every empty, error, and edge state teaches or routes.
**Scope:**
- Consistent empty states across Workflows, Runs, Overview recent-runs (invitation, not "nothing here").
- Health: honest labeled placeholder OR stays out of nav until `/stats` (decide per R4).
- Global error surfaces per [frontend-design.md](frontend-design.md) §10: 401→login, 409 stale, 429 copy, 503 AI-unavailable, failed-run-is-data-not-a-toast.
- ErrorBoundary + toast already exist — verify every listed error routes to the right surface.
**Files:** `pages/{WorkflowsPage,RunsPage,OverviewPage}.tsx`, `components/{EmptyState,ErrorState,Toast,ErrorBoundary}.tsx`, `App.tsx`
**Deliverables:** no dead ends; every error actionable where it occurs.
**Tests:** each empty state renders its teaching copy + CTA; 401 triggers logout+redirect; failed run renders as data, not a toast.
**DoD:** keyboard-only walkthrough of the full journey hits no dead end and no unhandled error.
`feat(dashboard): consistent empty and error states across the app`

---

### Batch E — A11y, responsive & final hardening *(the quality bar)*
**Folds:** P1 (verify — status colors/glyphs/reduced-motion), P11 (blocked), P12 (a11y/responsive remainder) · **verify + close gaps**
**Goal:** the polish that makes it read as production, and the honest documentation of what was cut.
**Scope:**
- Verify P1 landed: AA status colors, glyph-not-color-alone, reduced-motion. (Audit found these were the original defects — confirm they're fixed in the shipped `statusColor.ts`/`WorkflowGraph`.)
- Focus-to-`<h1>` on route change (present in `App.tsx` — verify it fires for the new Overview).
- Responsive: desktop-first; editor/AI panel "needs a larger screen" on mobile; graph `overflow-x` not shrink.
- P11 (per-step log expansion) stays **blocked** on the logs endpoint + audit C1 — do not expose `step_runs.output`. Document as a named cut.
- README frontend section: the UX-revision rationale, the seed-examples decision, Health/stats gap, dark-mode/mobile cuts.
**Files:** `styles/*`, `components/WorkflowGraph.tsx`, `statusColor.ts`, `App.tsx`, `README.md`
**Deliverables:** AA-clean, keyboard-complete, honestly-documented.
**Tests:** status colors pass a contrast assertion; every status has a glyph; focus moves to `<h1>` on navigate to `/`.
**DoD:** keyboard-only login→generate→save→trigger→watch; greyscale-legible statuses; README names every cut.
`feat(dashboard): finalize accessibility, responsive behavior, and docs`

---

### Phase → batch traceability

| Old phase | Lands in | Change |
|---|---|---|
| P1 tokens/a11y | E (verify) + A (uses) | Keep — verify shipped |
| P2 router/auth/login | A | Revise — login orientation |
| P3 API/query | (built) | Keep as-is |
| P4 workflows list | A + B | Revise — empty state, CTAs |
| P5 detail/versions/rollback | B | Keep — Trigger primary |
| P6 editor CRUD | C | Revise — AI-first split |
| P7 trigger/live run | B | Keep — one-click path |
| P8 run history | B | Keep |
| P9 AI panel | C | Revise — promote above fold |
| P10 health | A (nav fix) + D (placeholder) | Revise — no 404; page still blocked on `/stats` |
| P11 log expansion | E | Keep blocked (endpoint + audit C1) |
| P12 hardening | D + E | Split error-UX / a11y |
| — new — | A | Overview, seed examples, PageIntro, ActionCard |

---

## 8. Suggested implementation order

**A → B → C → D → E**, and the order is deliberate: it front-loads the fix for the actual feedback.

- **A alone resolves most of the complaint** — after Batch A a first-time user is oriented, has examples, and hits no dead links. Ship it first; it's also the cheapest (the seed change is 30 minutes and buys the most).
- **B** delivers the payoff (watch a run live) that the old plan buried at P7.
- **C** makes the differentiator discoverable.
- **D/E** are the quality passes.

If time runs out, **A + B + C is the complete demo story** (orient → run an example → generate with AI → save → trigger → watch). D and E are polish over a story that already lands. This mirrors the old plan's own fallback, re-cut so the first thing built is the first thing a reviewer sees.

---

## 9. Challenging my own revision

**"Seeding examples is scope creep / borderline backend change."** It touches `seed.ts`, which is dev tooling, and writes through the existing create path — no schema, migration, route, or contract change. And it's the single highest-leverage fix: it converts the empty-table dead-end into the product's best demo. If you still rule it out, R2's overview + a client-side "Load example" button recovers most of it. I'd take the seed.

**"An overview page is a fifth screen for a 4-day take-home."** It's ~40 lines assembling components that already exist (`PageIntro` + three `ActionCard`s + a `useRuns` strip). The cost is tiny and it's the direct answer to "what do I do now." Cheaper than leaving a reviewer confused.

**"AI-first editor is a bigger change than it sounds."** Fair — it's the one revise with real relayout risk, because the save-path and 422/503 invariants must survive. Mitigation: the split is presentational (disclosure around the existing `DagEditor`); `ProposePanel` and the single-save-path are untouched. If it gets hairy, the minimum viable version is just moving the panel *above* the editor and adding the "Generate with AI" CTA — that alone fixes discoverability without a full relayout.

**The strongest counter-argument:** none of this outranks the backend security work if it's still open. Per [audit-2026-07-16.md](audit-2026-07-16.md), C1–C4 were reportedly fixed in `4cc3c6e` — **verify that before polishing UI.** And do not build P11 (log expansion) until the logs endpoint exists and `step_runs.output` stays unexposed. A confused reviewer is a worse *first* impression than a rough edge; an exploitable SSRF is a worse *final* verdict. Fix confusion (Batch A) and confirm the security fixes in the same sitting.

**What I deliberately did not change:** the routing model, the state tiers (no Zustand), `useRunStream`, the API/query layer, the design tokens. The feedback is about orientation and discoverability — re-composition and one data change — not architecture. Rewriting the foundation would be the wrong response to "I was confused."
