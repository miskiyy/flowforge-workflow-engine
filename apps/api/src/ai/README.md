# AI subsystem — NL → proposed workflow version (Phase 5, backend only)

Full design: [`ai-subsystem-design.md`](../../../../ai-subsystem-design.md) at the repo root. This file covers what actually got built, what deviated from `Task.md`, and why.

**Thesis:** the LLM is an untrusted contributor. `/propose` writes nothing; the client saves the result through the existing `PATCH /workflows/:id`, which validates it identically to a hand-authored DAG. Delete `src/ai/` and the rest of the product still works — nothing outside `ai/` imports from inside it, except one registration line in `app.ts`.

## Deviations from `Task.md`'s Phase 5 spec

`Task.md:126-137` sketches a simpler feature than what's implemented; `ai-subsystem-design.md` is the authoritative, refined spec this code follows. Every place the two disagree:

| `Task.md` said | Built instead | Why |
|---|---|---|
| `POST /workflows/generate`, persisted via the existing `POST /workflows` | `POST /workflows/:id/propose` (`:id` = uuid or `new`), applied via the existing `PATCH /workflows/:id` | Supports iterating on an *existing* workflow (not just greenfield creation), with a reviewable diff and an optimistic-concurrency (`baseVersionId`) check — `ai-subsystem-design.md` §1, §4.3. Both still land through exactly one persistence path; the write endpoint just also handles updates, which `Task.md`'s sketch didn't cover at all. |
| "Use provider structured-output / tool-use mode, not parse-JSON-from-prose" (`Task.md:130`) | `response_format: { type: 'json_object' }` (JSON mode) + tolerant `parseDraft` (JSON.parse → fenced block → balanced-brace scan) | Strict `json_schema`/tool-calling is inconsistently supported across OpenRouter's free models, and the canonical `WorkflowDagDefinition` schema is strict-mode-*incompatible* anyway (optional fields, `minLength`, `format: 'uri'` aren't expressible/honored in strict mode). Adapting the schema to fit strict mode would create a second, lying source of truth — the one thing this design is built to avoid. JSON mode + the *real* validator as the enforcement path gets the same safety guarantee; strict mode would only raise the first-attempt hit rate, an efficiency gain, not a safety one. See `ai-subsystem-design.md` §0, §7. |
| "2–3 few-shot examples (linear/parallel/conditional)" | 2 examples: linear, and a parallel diamond (no dedicated `condition` example) | Free OpenRouter models have tight context budgets and no prompt caching; a third example costs tokens on every one of up to 3 attempts for marginal gain. `ai-subsystem-design.md` §6. |
| "cap at 2 retries" | Max 2 repairs, 3 calls total | Not a deviation — same number, restated for clarity. |
| "client-side input cap (~2k chars) with inline warning" | Server-enforced 2000-char cap via the route's TypeBox schema; a client-side counter is UX only | `Task.md` frames the cap as client-side; the design makes the *security* boundary server-side (rejected before any provider call, asserted in `ai-routes.test.ts`) and treats any client-side counter as a UX nicety, not the enforcement mechanism. Strictly a strengthening, not a weakening, of what was asked. |
| No mention of `baseVersionId` / diff / CAS | Present, both in `/propose`'s response and as an additive `baseVersionId` field on `PATCH /workflows/:id` | Net-new relative to `Task.md`, introduced by the design to make "two editors, one workflow" safe. Verified sound before building: `updateWorkflow` already ran its read (`for('update')` row lock) and write in one transaction, so the CAS can't race the write it guards. |
| No provider named | OpenRouter (OpenAI-compatible), official `openai` Node SDK, free models only | A concrete, deliberate choice `Task.md` left open — see `ai-subsystem-design.md` §0 for the reasoning (free-tier unreliability is treated as a hit-rate problem, not a safety problem, because the trust boundary is the validator, not the model). |

One additional implementation-level (not spec-level) deviation, noted for completeness: `ai-subsystem-design.md` §6 sketches `buildPromptMessages` as `(schemaJson, examples, baseDag, userText, priorErrors?)`. It's implemented as `(baseDag, userText, priorAttempt?)`, with the schema and few-shot examples as internal module constants rather than parameters — there's exactly one caller (`propose.ts`) and one real configuration of schema/examples, so parameterizing them added surface area without adding testability (the schema's presence is still asserted directly in `ai-prompt.test.ts` against the real import). Everything the design actually requires of this function — pure, schema from `@flowforge/shared-types` not hand-copied, examples typechecked as `WorkflowDagDefinition`, repair message carries `DagValidationError[]` verbatim — holds regardless of the parameter list shape.

## Folder structure

```
ai/
├── provider.ts   DagProposer interface, Usage, MockProposer
├── openrouter.ts OpenRouter impl via the `openai` SDK
├── prompt.ts     PURE: message composition + typechecked few-shots
├── diff.ts       PURE: base vs proposed DAG diff
├── propose.ts    orchestration: cache, repair loop, calls the EXISTING validateDag + checkGuards
├── errors.ts     AiUnavailableError, AiDraftInvalidError
└── routes.ts     POST /workflows/:id/propose
```

`BaseVersionStaleError` lives in `../lib/errors.ts`, not here — both the CRUD `PATCH` path and this subsystem throw it, and nothing outside `ai/` may import from inside it.

`checkGuards` (SSRF host check, script command allowlist, fan-out cap) lives
in `../workflows/guards.ts`, not here, next to `validateDag` — both are
DAG-safety checks, not AI concerns, and both the manual `POST/PATCH
/workflows` path and this subsystem call the exact same function
(`workflows/routes.ts`'s `validateAndGuardDag`, `propose.ts` below). It used
to live under `ai/` and be reachable only from `propose.ts`, which is why
the manual path had no SSRF/command/fan-out enforcement at all — see "The
SSRF guard" below.

## Prompt approach

`prompt.ts` embeds `JSON.stringify(WorkflowDagDefinition)` — the actual TypeBox schema Ajv compiles in `engine/dag.ts` — imported from `@flowforge/shared-types`, never hand-copied. If the schema changes, the prompt changes with it. This is an *advisory* rendering for the model; Ajv, via the existing `validateDag`, is the only enforcement path. Two few-shot examples are typed as `WorkflowDagDefinition` in source, so `tsc` fails the build if one drifts from the schema. The repair message carries the validator's own `DagValidationError[]` verbatim — no translation layer between what the engine's Kahn-cycle/shape checks produce and what the model sees to self-correct.

## Token handling

- 2000-char input cap, enforced server-side by the route schema — rejected before any provider call (`ai-routes.test.ts` asserts the mock is never invoked on a 400).
- `max_tokens: 1500` on every completion request.
- Repairs grow context (each carries the prior failed draft + its errors), which is the real reason the repair cap is 2, not just a liveness bound — it's a cost bound.
- No prompt caching: not available on OpenRouter free models, and provider-specific by definition.

## Malformed-output guarding

Ordered, fail-fast, cheapest first (auth → schema → tenant-scoped base-version load, all before a token is spent). Then: `parseDraft` (tolerant JSON extraction) → the **existing** `validateDag` (never reimplemented — same shape/duplicate-key/self-dep/dangling-ref/Kahn-cycle checks the manual API uses) → `workflows/guards.ts`'s `checkGuards` (SSRF/command/fan-out, same `DagValidationError[]` shape, same repair channel). Any failure at any stage feeds back into the repair loop, capped at 3 attempts total (1 generate + 2 repairs) — a hard bound, not extended by any condition. Exhaustion is `422 AI_DRAFT_INVALID` with `{ errors, lastDraft }`, never a 500, so the caller can hand-fix instead of starting over.

## The SSRF guard

`workflows/guards.ts`'s URL check is **lexical only** at the point this
subsystem calls it — it inspects the literal hostname string (rejecting
loopback, link-local/cloud-metadata, and RFC1918 ranges) and cannot by
itself stop DNS rebinding or a redirect into a private IP. Real enforcement
now also lives in `execution/step-handlers.ts`'s `runHttpStep`, re-checked
at fetch time on every redirect hop, which is the only place that can
actually catch either (audit finding: this used to be a documented but
unbuilt gap, closed by wiring the same check into the real `fetch` call).
The two checks are complementary, not redundant: this one rejects an
obviously-bad DAG before it's ever saved (fast, no network call); the
fetch-time one is what actually protects the request that leaves the
process.

## Why failure-analysis and smart-scheduling were not built

**Failure-analysis** (an AI feature that inspects failed runs and suggests fixes) needs a corpus of real failure data from a running engine to be more than a demo. This system's engine has executed nothing outside tests as of Phase 5 — there is no failure history to analyze, so the feature would have no real input and nothing to prove.

**Smart-scheduling** (AI-driven step ordering or concurrency tuning) optimizes a scheduler that's already deterministic and correct by construction (Kahn's algorithm, Phase 3). Optimizing before the manual scheduler has ever run a real workload is solving a problem that hasn't been measured yet, and it competes for the same 4-day budget as making the one shipped AI feature — plain NL→DAG — actually reliable.

## What's deliberately not tested

- **Real provider responses.** Non-deterministic, costs OpenRouter free-tier quota, would make CI flaky and network-dependent. `MockProposer` is injected at route registration; no test hits the network.
- **Prompt quality / hit rate.** Unmeasured. Measuring it needs an eval set and a harness, which is out of scope for this phase. `errorPaths[]` in the structured logs (`ai.propose.*` events) gives failure-*mode* visibility — which validator check trips most often — without claiming an accuracy number that was never computed.

## Configuration

`AI_PROVIDER` (`mock` default, or `openrouter`), `OPENROUTER_API_KEY` (optional — required only when `AI_PROVIDER=openrouter`), `AI_MODEL` (defaults to a placeholder free-tier model id). The key is deliberately **not** validated at config load (`config.ts`'s `required()` pattern) — a missing key with `AI_PROVIDER=openrouter` fails at *route registration* (`ai/routes.ts`'s `resolveProvider`), logging an error and skipping AI route registration, while the rest of the API boots normally. `AI_PROVIDER=mock` and CI need no key at all.

**Unverified in this phase:** the actual free-model choice (`ai-subsystem-design.md` §20's Step 0 "spike" — does a real free OpenRouter model reliably honor `json_object` and produce a schema-valid DAG). That needs a live `OPENROUTER_API_KEY` and network access, which this implementation phase didn't have. Everything here is built and tested correctly against `MockProposer`; the live model verification is a manual follow-up.
