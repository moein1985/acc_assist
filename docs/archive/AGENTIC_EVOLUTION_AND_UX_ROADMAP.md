# FILE 4 — Agentic Evolution & UX Roadmap

> Target executor: **Mia-code-flash-1**. Atomic, ordered phases. No code — operational blueprint, state-machine logic, and UX contracts only.
> Scope of change: orchestrator conversational loop (`src/main/services/agentOrchestrator.ts`), preload/IPC progress contracts (`src/shared/contracts.ts`, `src/preload`), and renderer UX (`src/renderer/src/managerUx.ts`, `src/renderer/src/errorLocalization.ts`, `src/renderer/src/renderer.ts`). Depends on Files 1–3.

## 0. Vision
Transition from isolated, one-shot tool execution into a resilient, autonomous **"CFO Agent"** conversational loop that: keeps context across turns, plans which financial tool to use, recovers gracefully from the Iran/AvalAI network reality, and always leaves the financial manager with a clear next action — never a spinner that hangs or a raw stack trace.

---

## Phase 1 — From Tool Executor to Conversational CFO Agent
**Goal:** a stateful, multi-turn agent loop that reasons over prior turns and accumulated evidence, not a stateless single tool call.

1. **Session conversation state:** maintain per-session memory of (a) prior user questions, (b) tool evidence already gathered (account balances, fiscal years, receivables/payables snapshots), and (c) the active financial scope (fiscal year, org/branch, currency, as-of date). Bound it with the existing history/memory caps so token cost stays controlled.
2. **Intent → plan mapping:** on each user turn, classify intent (lean on `financialIntentRegistry`), then select the smallest tool plan. For Golden-5 intents with cached schema, the plan is a **single** `fetch_financial_data` round (no discovery loop). For unknown/compound questions, allow the bounded discovery path within File 2's 4-round cap.
3. **Evidence-first answering:** the agent must answer from gathered evidence with explicit scope annotation ("بر اساس سال مالی ۱۴۰۳ ..."), never from model priors. Reuse the evidence contract enforced by `agentOrchestratorEvidenceContract.test.ts`.
4. **Context carry-over / follow-ups:** a follow-up like "و سال قبلش؟" must reuse the prior intent + scope, adjusting only the changed dimension (the fiscal year), and should hit the schema cache — ideally answerable without re-running discovery.
5. **Clarify instead of guessing:** when scope is ambiguous (no fiscal year given, multiple matching parties), the agent asks one targeted clarifying question rather than fabricating or scanning blindly. Cap clarifications to avoid loops.
6. Acceptance: a scripted two-turn conversation (balance query, then "previous year") resolves the second turn using carried scope + cached schema, within the round cap.

---

## Phase 2 — Unified Progress & Outcome Event Contract (main → renderer)
**Goal:** one structured, typed stream of agent states the renderer can render deterministically — the backbone for all graceful UX.

1. Define a single **agent progress event union** in `src/shared/contracts.ts`, surfaced through preload. Each event carries `{ phase, detail, scope?, evidence?, recoverable, suggestedActions[] }`. Required phases at minimum:
   - `planning` — agent chose an intent/plan.
   - `tool-running` — a tool (schema/SQL) is executing (carry which tool + a short human label).
   - `evidence-ready` — partial evidence gathered.
   - `answer` — final answer.
   - `network-degraded` — provider slow/retrying (fed by File 1's retry/breaker telemetry).
   - `provider-circuit-open` — breaker open; include `msUntilRetry` (from File 1 Phase 4 snapshot).
   - `loop-aborted` — budget exhausted or unrecoverable tool failure (fed by File 2 Phase 1's `AGENT_LOOP_BUDGET_EXHAUSTED`).
   - `cancelled` — user aborted.
2. **Every** abort/exhaustion/failure path in the orchestrator must terminate by emitting exactly one of these terminal events (`answer`, `loop-aborted`, `provider-circuit-open`, `cancelled`) — never end silently and never throw an unhandled error across IPC.
3. `recoverable` + `suggestedActions[]` are the machine-readable instructions the renderer turns into buttons (retry, narrow scope, switch network, view partial evidence).
4. Acceptance: contract/integration test asserts that for each failure injected (timeout, breaker open, budget exhausted, user cancel) the renderer receives exactly one well-formed terminal event with appropriate `suggestedActions`.

---

## Phase 3 — Graceful Renderer Fallback (the financial manager's experience)
**Goal:** when a tool loop is aborted due to network failure or budget exhaustion, the CFO sees a calm, localized, actionable state — never a frozen spinner or a raw error.

1. **Renderer agent state machine** in `managerUx.ts` driven by Phase 2 events: `idle → thinking → running-tool → (answered | degraded | circuit-open | aborted | cancelled)`. Each non-idle state has a defined visual and a defined set of actions; no state is a dead end.
2. **State-specific fallback UX** (localized Persian via `errorLocalization.ts`, RTL):
   - `network-degraded`: keep the existing answer/spinner but overlay a non-blocking "اتصال کند است، در حال تلاش مجدد…" indicator with the attempt count. Do not block input.
   - `provider-circuit-open`: show "سرویس هوش مصنوعی موقتاً در دسترس نیست" with a **live countdown** from `msUntilRetry` and a disabled-then-auto-enabled "تلاش مجدد" button. Optionally surface a "بررسی وضعیت فیلترشکن/شبکه" hint, since this environment's failures are usually network-side.
   - `loop-aborted` (budget exhausted): present any **partial evidence already gathered** ("تا این مرحله این داده‌ها به‌دست آمد: …") plus clear next actions — "محدوده را کوچک‌تر کنید"، "دوباره تلاش کنید"، "سؤال را ساده‌تر بپرسید". Never discard partials collected before the abort.
   - `cancelled`: immediately return to `idle` with the input restored and the user's draft preserved.
3. **Action wiring:** each `suggestedAction` from Phase 2 maps to a concrete renderer handler — `retry` (re-issue same intent/scope), `narrow-scope` (open scope picker prefilled), `simplify` (let the user re-ask), `view-partial` (expand collected evidence). Buttons are generated from the event, not hardcoded per error.
4. **Anti-hang guarantee:** the renderer arms its own client-side watchdog; if no progress event arrives within a ceiling slightly above File 1's overall request deadline, it forces the state machine into `aborted` with a generic recoverable message. The send button's loading flag is cleared in a `finally`-equivalent path on every terminal state (mirrors the known "stuck spinner" failure mode — loading must always clear).
5. **Accessibility/i18n:** all states use static, lint-friendly attributes and localized strings; no raw English error text or HTML payloads ever reach the UI (File 1 Phase 3 guarantees the upstream side; the renderer must also never render an unrecognized error blob — fall back to a generic localized message).
6. Acceptance: renderer tests (extend `managerUx.test.ts`, `errorLocalization.test.ts`) assert each terminal event renders its state, shows the right actions, clears the loading flag, and never displays raw/garbled text.

---

## Phase 4 — Autonomous Recovery Behaviors
**Goal:** the agent self-heals where safe, escalating to the user only when judgment is required.

1. **Auto-retry policy (bounded):** on `network-degraded` the agent may transparently retry per File 1's budget. On `provider-circuit-open`, it does **not** auto-spam; it waits for the cooldown and offers the user the retry action (auto-enabled when cooldown elapses).
2. **Partial-answer escalation:** on `loop-aborted` with usable partial evidence, the agent composes a best-effort partial answer (clearly labeled as partial, with what's missing) instead of returning nothing — turning a failure into a degraded-but-useful result.
3. **Scope-narrowing suggestion engine:** when failures correlate with heavy/broad queries, the agent's `suggestedActions` proactively propose narrowing (single fiscal year, single party/branch) — the cheapest path to success under flaky network.
4. **No destructive autonomy:** the agent is read-only by construction (Files 2–3); recovery never mutates data, never broadens scope silently, never bypasses validation.
5. Acceptance: scripted flaky-network scenario (alternating 502/timeout/success) ends in either a successful answer or a labeled partial answer with actionable next steps — never an indefinite spinner.

---

## Phase 5 — Telemetry, Observability & Regression Gate
1. Emit a per-conversation-turn summary: `{ intent, plan, roundsUsed, schemaCacheHits, retries, breakerState, terminalPhase, partialAnswerServed }` (composes File 1 + File 2 metrics with the UX outcome).
2. Add integration coverage (extend `tests/integration/agentOrchestrator.integration.test.ts`) for: full Golden-5 happy path, degraded-but-recovered path, circuit-open path, budget-exhausted-with-partial path, and user-cancel path — each asserting the correct terminal event and renderer state.
3. Run `npm run typecheck` and the full unit + integration suites.
4. Definition of done: the app behaves as a coherent CFO Agent — multi-turn, scope-aware, evidence-first — and **every** network/budget failure resolves to a clear, localized, actionable UI state with no hangs and no raw error leakage.

---

## Dependency Notes for the Executor
- This file is the integration capstone; implement Files 1–3 first, then wire their events/snapshots into the Phase 2 contract.
- The progress-event union (Phase 2) is the contract boundary — get it right first; renderer (Phase 3) and recovery (Phase 4) both consume it.
- Reuse existing renderer modules (`managerUx.ts`, `errorLocalization.ts`); do not introduce a parallel error-handling path.
