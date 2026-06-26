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
  → Router (deterministic first-pass metric matching)
  → Planner (model produces MetricPlan JSON, validated by Zod)
  → Semantic Layer (MetricDefinition[] — declarative catalog)
  → Compiler (deterministic: MetricPlan + Definition → safe SQL)
  → Executor (read-only SQL execution)
  → Verifier (reconciliation + intent-alignment + evidence contract)
  → Explainer (model produces Farsi narrative from verified numbers)
  → Final answer + Evidence + SQL
```

### Feature Flag (`ACC_FINANCIAL_ENGINE_MODE`)
- `legacy` — only legacy deterministic handlers (pre-FRE behavior)
- `shadow` — both paths run; user gets legacy output, engine output is compared and logged
- `engine` — engine serves user; legacy is fallback only

### Migrated Metrics (6 — served by FRE in engine mode)
| Metric | FRE MetricId | Legacy Handler (DEPRECATED) | Ground-Truth (1402) |
|---|---|---|---|
| Net sales | `net_sales` | (model-assisted) | 64,252,437,897 |
| Purchases | `purchases` | `get_purchase_summary` | 226,110,419,451 |
| Account balance | `account_balance` | `get_account_balance` | 19,755,458,505 |
| Trial balance | `trial_balance` | `get_trial_balance` | 566,396,483,280 |
| Cash + bank balance | `cash_bank_balance` | `get_cash_bank_balance` | 9,521,507,066 |
| Sales count | `sales_count` | (new — definition only) | — |

### Still Legacy-Only (9 intents)
`count_fiscal_years`, `list_fiscal_years`, `get_party_balance`, `get_account_turnover`, `get_sales_summary_by_period`, `get_receivables_summary`, `get_payables_summary`, `get_cashflow_summary`, `get_recent_or_suspicious_documents`

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

## 2. Inventory of the 30 Financial Tools
| Tool Name | Core Purpose / Target User | Main DB Tables Interacted With | Primary LLM Prompt Objective |
|---|---|---|---|
| count_fiscal_years | Finance admin; fiscal-year count | fiscal metadata / year fields | Detect number of fiscal years in DB |
| list_fiscal_years | Finance admin; year discovery | fiscal metadata / year fields | List available fiscal years |
| get_party_balance | Controller; counterparty balance | parties, ledger, transactions | Resolve counterparty/manufacturer/customer balance |
| get_account_balance | Accountant; account balance | accounts, ledger, balances | Resolve chart/account balance |
| get_account_turnover | Analyst; account movement | ledger, transactions, documents | Compute turnover over date range |
| get_sales_summary_by_period | Sales manager; KPI reporting | documents, documentLines, sales facts | Summarize gross/net/booked sales by month/quarter/year |
| get_receivables_summary | AR manager; debtors overview | documents, balances, parties | Summarize receivables/debtors |
| get_payables_summary | AP manager; creditors overview | documents, balances, parties | Summarize payables/creditors |
| get_cashflow_summary | CFO; cash movement | cash transactions, ledger, accounts | Summarize operating/inflow/outflow cashflow |
| get_recent_or_suspicious_documents | Auditor; anomaly review | documents, documentLines, status fields | Find recent or suspicious vouchers/documents |
| gross_sales_kpi | Sales KPI; annual revenue view | sales facts, documents | Return gross sales KPI |
| net_sales_kpi | Sales KPI; net revenue view | sales facts, documents | Return net sales KPI |
| booked_sales_kpi | Finance ops; booked revenue view | documents, documentLines | Return booked sales KPI |
| year_over_year_growth | CFO; growth analysis | sales facts, fiscal periods | Compare current vs prior year sales |
| monthly_sales_variance | Analyst; variance tracking | sales facts, periods | Compute monthly sales variance |
| quarterly_sales_summary | Finance manager; quarter rollup | documents, sales facts | Summarize quarterly revenue |
| fiscal_year_balance_check | Controller; year-end check | balances, accounts, parties | Verify year-end balances |
| debtor_age_summary | AR analyst; aging view | debtors, documents, due dates | Segment receivables by age bucket |
| creditor_age_summary | AP analyst; aging view | creditors, documents, due dates | Segment payables by age bucket |
| cash_inflow_breakdown | Treasury; inflow detail | cash transactions, accounts | Break down cash inflows |
| cash_outflow_breakdown | Treasury; outflow detail | cash transactions, accounts | Break down cash outflows |
| account_movement_detail | Accountant; line-item drill-down | ledger, documentLines | Show transactional movement detail |
| document_anomaly_scan | Auditor; exception scan | documents, status, parties | Flag unusual documents/amounts |
| journal_entry_summary | Controller; ledger summary | documents, journal lines | Summarize journal activity |
| branch_performance_summary | Ops manager; branch KPI | documents, branches, accounts | Compare performance by branch |
| cost_center_summary | Controller; cost analysis | documentLines, cost centers | Summarize cost-center spending |
| tax_summary | Finance ops; tax review | documents, tax fields | Summarize VAT/tax amounts |
| invoice_collection_status | AR ops; collection status | documents, receivables | Check collection status of invoices |
| payment_due_report | AP ops; payment schedule | documents, payable dates | List due payments |
| month_end_reconciliation | Controller; close process | ledger, cash, balances | Reconcile month-end balances |
| suspicious_amount_flag | Auditor; threshold review | documents, amounts | Flag outlier or suspicious amounts |

## 3. Telemetry Logs Summary
- High-frequency telemetry is centered on `ipc.handler`, tool execution, SQL validation, and provider/LLM response errors; the collector is active and drains queue on restart.
- The most active execution path is the tool loop around `list_database_tables → get_database_schema → fetch_financial_data`, with schema discovery and SQL execution dominating the expensive steps.
- Performance bottlenecks are concentrated in provider/network retries (20–110 s failure windows), schema lookups repeated across loops, and SQL parser fallback/validation overhead when queries are non-trivial or malformed.

## 4. Active Bugs & Errors Matrix
| Error Signature / Exception Type | Affected Module/Tool | Frequency | Root Cause / Context from Logs |
|---|---|---:|---|
| Gemini 502/504 upstream errors; stream termination | `GeminiClient` / provider path | High | Provider-side 5xx and streaming timeout; retries amplify delay and garble HTML error bodies |
| Loop exceeded / tool-loop restart | `AgentOrchestrator` | High | Multi-step financial queries exceed tool-call limits; schema/SQL loop restarts before final answer |
| Invalid column / schema mismatch | SQL generation + schema mapping | Medium | LLM-generated column names do not match actual schema (`Name` vs `Title`); validation path is too late |
| SQL parser fallback: `SyntaxError` in `node-sql-parser` | `SqlConnectionManager` read-only validation | Medium | Parser fails on complex SQL fragments and falls back to regex; this is a reliability and performance hotspot |
| Unsupported SQL constructs / window functions | `fetch_financial_data` + SQL policy | Medium | Queries using unsupported functions or non-portable patterns fail after tool loop progression |
| Telemetry redaction / garbled error text | telemetry ingest path | Medium | Upstream HTML/garbage error payloads are logged without clean normalization |

## 5. MVP Candidates Identification
1. `count_fiscal_years` — deterministic, low-risk, strong regression coverage, minimal SQL complexity.
2. `list_fiscal_years` — deterministic, stable, high-value baseline query for finance users.
3. `get_account_balance` — core finance use case with clear schema mapping and strong evidence-first contract fit.
4. `get_receivables_summary` — practical AR/finance summary path with good business value and moderate complexity.
5. `get_payables_summary` — same stability profile as receivables, useful for early MVP validation.
