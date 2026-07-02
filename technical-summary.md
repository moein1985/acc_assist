## 1. Project Architecture & Stack Overview
- Electron app with main process in `src/main` and renderer in `src/renderer`; IPC is bridged through `src/preload`, with chat/UX rendered in the browser side and SQL/LLM orchestration executed in the main process.
- Core runtime stack: Electron + Vite, TypeScript, `mssql` for SQL Server, `ssh2` for SSH tunneling, `node-sql-parser` for read-only SQL validation, `ws` for mobile bridge, and Gemini/AvalAPIs orchestration via `AgentOrchestrator` and `GeminiClient`.
- Main folders: `src/main`, `src/preload`, `src/renderer`, `src/shared`, `scripts`, `tests`, `ops`, `build`.

## 1b. Financial Reasoning Engine (FRE) — Architecture Update

The orchestrator has been migrated from "weak model + N hand-coded deterministic handlers" to "strong model as Planner/Explainer + single semantic engine with deterministic SQL compilation."

**Core principle:** *deterministic core, probabilistic shell* — the model never produces numbers; it only plans (MetricPlan JSON) and explains. Numbers come exclusively from deterministic SQL execution and verification.

### FRE Pipeline
```
User question (Farsi)
  → Router (deterministic first-pass metric matching + LRU cache)
  → Planner (model produces MetricPlan/MultiMetricPlan JSON, validated by Zod)
  → Semantic Layer (MetricDefinition[] — declarative catalog, 15 metrics)
  → Compiler (deterministic: MetricPlan + Definition → safe SQL)
  → Executor (read-only SQL execution, 15s timeout via AbortController)
  → Verifier (reconciliation + intent-alignment + evidence contract)
  → Explainer (model produces Farsi narrative from verified numbers)
  → Final answer + Evidence + SQL
  → Smart Clarify (if confidence < 0.5: question + suggestions)
```

### Architecture (Phase 24 — engine-only)
- **Engine is the only entry point.** No legacy fallback, no shadow comparison, no three-mode switch.
- `financialEngineMode` field and `ACC_FINANCIAL_ENGINE_MODE` env var have been removed.
- Financial queries → engine (verified number or explicit refusal, never fabricated)
- Non-financial/guidance queries → text-only path with numeric guard (no SQL)

### FRE Metrics (73 — all served by engine)
| Metric | FRE MetricId | Ground-Truth (1402) |
|---|---|---|---|
| Net sales | `net_sales` | 64,252,437,897 |
| Purchases | `purchases` | 226,110,419,451 |
| Account balance | `account_balance` | 19,755,458,505 |
| Trial balance | `trial_balance` | 566,396,483,280 |
| Cash + bank balance | `cash_bank_balance` | 9,521,507,066 |
| Sales count | `sales_count` | — |
| Fiscal year count | `fiscal_year_count` | — |
| Fiscal year list | `fiscal_year_list` | — |
| Party balance | `party_balance` | — |
| Receivables | `receivables` | — |
| Payables | `payables` | — |
| Cashflow | `cashflow` | — |
| Sales by period | `sales_by_period` | — |
| Account turnover | `account_turnover` | — |
| Recent documents | `recent_documents` | — |
| ... + 58 more metrics (Phase 14-19) | | |

### Derived Metrics (DerivedMetric)
| Derived | Inputs | Formula |
|---|---|---|
| Sales-to-purchase ratio | `net_sales`, `purchases` | (sales / purchases) × 100 |
| Gross margin | `net_sales`, `purchases` | ((sales - purchases) / sales) × 100 |

### MultiMetricPlan
Supports multi-metric queries (e.g. "فروش و خرید ۱۴۰۲") with `joinMode`: `side_by_side`, `comparison`, `trend`.

### Planner Enhancements (Phase 10)
- **Few-shot examples:** 12+ examples in `buildPlannerPrompt` covering conversational, multi-metric, derived, topN, party_balance, comparison, and negative cases.
- **Smart Clarify:** When `confidence < 0.5`, `buildClarify` generates a clarification question + 3 metric suggestions from router scores.
- **Conversational language:** Auto-extracts current Persian year, entity patterns (حساب دریافتنی/پرداختنی/اسناد), and date ranges with Persian month names (فروردین تا تیر, نیمه اول, سه ماه اول).
- **LRU Cache:** Router and planner results cached (100 entries, 5min TTL).
- **Timeout:** Engine execution capped at 15s via `AbortController`.

### Key FRE Files
- `src/main/services/financialEngine/metricCatalog.ts` — declarative metric definitions
- `src/main/services/financialEngine/compiler.ts` — deterministic SQL compiler
- `src/main/services/financialEngine/planner.ts` — deterministic + model planner
- `src/main/services/financialEngine/verifier.ts` — post-execution verification
- `src/main/services/financialEngine/index.ts` — engine orchestration (run → plan → compile → exec → verify → explain)
- `src/main/services/financialEngine/types.ts` — Zod schemas and TypeScript types
- `scripts/fixtures/golden-metrics.json` — golden test fixtures
- `scripts/ops/goldenMetricEval.ts` — offline evaluation harness

### Scalability Proof
Adding a new metric requires only: (1) one `MetricDefinition` in `metricCatalog.ts`, (2) one golden test case. No new TypeScript handler, no router change, no compiler change. Proven with `sales_count` metric.

### Roadmap Documents
- `FRE_ROADMAP_00_OVERVIEW.fa.md` — root document, architecture, working agreement
- `FRE_ROADMAP_01_FOUNDATION_AND_MODULE_SPLIT.fa.md` — Phase 1: module split + flag
- `FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md` — Phase 2-3: semantic layer + compiler
- `FRE_ROADMAP_03_PLANNER_AND_VERIFIER.fa.md` — Phase 4-5: planner + verifier
- `FRE_ROADMAP_04_EVAL_DEPLOY_AND_CUTOVER.fa.md` — Phase 6: eval, cutover, rollback
- `FRE_ROADMAP_05_PHASE7_LEGACY_MIGRATION.fa.md` — Phase 7: legacy migration (9 metrics)
- `FRE_ROADMAP_06_PHASE8_MULTI_METRIC.fa.md` — Phase 8: MultiMetric + derived metrics
- `FRE_ROADMAP_07_PHASE9_PRODUCTION.fa.md` — Phase 9: production hardening, legacy removal
- `FRE_ROADMAP_08_PHASE10_PLANNER.fa.md` — Phase 10: advanced planner, smart clarify, conversational
- Phases 11-23: Sepidar depth, schema abstraction, SSH, Python sandbox, advanced metrics, multi-step planner, UX, agentic loop, anti-hallucination
- `FRE_ROADMAP_23_PHASE24_LEGACY_REMOVAL.fa.md` — Phase 24: complete legacy removal, engine-only architecture
- `FRE_ROADMAP_24_PHASE25_PARTY_TURNOVER.fa.md` — Phase 25: party turnover, resolvePartyByName, multi-token matching
- `FRE_ROADMAP_25_PHASE26_INVESTIGATOR_LOOP.fa.md` — Phase 26: investigator loop, schema scan, clusterLedgers, budget bounded
- `FRE_ROADMAP_26_PHASE27_BLIND_DISCOVERY.fa.md` — Phase 27: blind discovery, canonicalConceptMap, discoveryPipeline, audit stages
- `FRE_ROADMAP_27_PHASE28_TEST_TRUTH_AND_CUTOVER.fa.md` — Phase 28: test truth, live benchmark, field test, cutover gate

## 2. Legacy Tool Inventory (REMOVED in Phase 24)
All 30 legacy deterministic tools have been physically removed. The engine now serves all financial queries via declarative `MetricDefinition` entries in `metricCatalog.ts` (73 metrics). No LLM-generated SQL, no tool loop, no legacy handlers.

## 3. Telemetry Logs Summary
- Engine-mode audit entries (`stage=engine-mode`, `stage=engine-refuse`, `stage=text-guidance`) are the primary log sources.
- No tool loop, no schema-discovery loop — engine compiles SQL deterministically from `MetricPlan`.
- Performance bottleneck: planner model call (Gemini) — mitigated by 15s timeout + retry loop (MAX_RETRIES=2).

## 4. Active Bugs & Errors Matrix
| Error Signature / Exception Type | Affected Module/Tool | Frequency | Root Cause / Context from Logs |
|---|---|---:|---|
| Gemini 502/504 upstream errors; stream termination | `GeminiClient` / provider path | Medium | Provider-side 5xx and streaming timeout; mitigated by retry loop |
| Planner timeout | `FinancialEngine` | Low | 15s AbortController fires on slow planner calls; engine retries with hint or refuses explicitly |
| SQL parser fallback: `SyntaxError` in `node-sql-parser` | `SqlConnectionManager` read-only validation | Low | Parser fails on complex SQL fragments and falls back to regex; engine generates simpler SQL |

## 5. Current Architecture (Phase 27)
- **73 metrics** served by engine via declarative `MetricDefinition`
- **274 golden cases** (100% pass)
- **490 unit tests + 26 integration tests** (0 fail, 1 skip)
- **typecheck:** 0 errors
- **Engine-only:** no legacy, no shadow, no three-mode switch
- **Two paths:** financial → engine (verified number or explicit refusal), non-financial → text-only with numeric guard
- **Agentic loop:** MAX_RETRIES=2 with result evaluation and retry hints
- **Python sandbox:** embedded Python 3.12 for chart/excel/pdf output
- **Investigator loop (Phase 26):** schema scan + heuristic mapping + probe loop + clusterLedgers + multi-ledger clarify + budget bounded + read-only SQL + SchemaCache
- **Blind discovery (Phase 27):** canonicalConceptMap with confidence scoring, discoveryPipeline (scan → sample → heuristic → relationships → enums → concept map → cache), conceptSource in metric definitions, 5 audit stages (discovery-scan/map/relationships/enums/confidence), adapter registry for known software (sepidar) skips blind discovery
- **Party turnover (Phase 25):** resolvePartyByName with multi-token matching, year-scoped clarify
