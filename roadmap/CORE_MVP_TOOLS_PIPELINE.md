# FILE 3 — Core MVP Tools Pipeline (The "Golden 5")

> Target executor: **Mia-code-flash-1**. Atomic, ordered phases. No code — algorithmic logic, prompt contracts, and architectural blueprints only.
> Scope of change: orchestrator system-prompt assembly (`src/main/services/agentOrchestrator.ts`), SQL validation (`src/main/services/sqlConnectionManager.ts`), and the financial intent registry (`src/main/services/financialIntentRegistry.ts`). Depends on File 2's schema cache.

## 0. Golden 5 Scope
Only these five foundational, deterministic, low-risk tools are in scope for the fast-path:
1. `count_fiscal_years`
2. `list_fiscal_years`
3. `get_account_balance`
4. `get_receivables_summary`
5. `get_payables_summary`

All five are read-only, single-statement, deterministic queries with stable schema mappings. They are the regression backbone and the fast-path candidates. Everything in this file applies **only** to these five; the general 30-tool path is untouched.

## 0.1 Current Baseline (read before editing)
- `SqlConnectionManager.validateReadOnlyQuery` validates via `node-sql-parser` (the `Parser` import) and, on parser failure for complex T-SQL, falls back to a regex pass built on `stripSqlCommentsAndLiterals`. That regex fallback is a documented reliability/perf hotspot.
- The orchestrator already advertises `list_database_tables`, `get_database_schema`, `fetch_financial_data` and a discovery strategy in its system prompt.

---

## Phase 1 — Strict System-Prompt Contract for the Golden 5
**Goal:** force the model to emit only simple, read-only, single-statement, ANSI-style SELECTs for these five intents, so they bypass the heavy parser path safely.

1. Add a **dedicated prompt section** (assembled only when the detected intent is one of the Golden 5) that imposes a hard SQL grammar contract. The contract must state, in imperative terms, that for these tools the query MUST:
   - Be a **single** statement; no semicolon-chained or batched statements.
   - Begin with `SELECT` only. Absolutely no `INSERT/UPDATE/DELETE/MERGE/EXEC/ALTER/DROP/CREATE/GRANT/TRUNCATE`, no CTEs that wrap DML, no temp-table creation.
   - Use **ANSI-portable constructs only**: plain `SELECT ... FROM ... WHERE ... GROUP BY ... ORDER BY`. No window functions, no `PIVOT/UNPIVOT`, no vendor-specific T-SQL (`TOP` is allowed only if you standardize on it; prefer documenting one canonical row-limit style), no stored-proc calls, no dynamic SQL.
   - Reference **only** columns confirmed present in the schema (cross-checked by File 2 Phase 3 before execution).
   - Always include the mandatory scope/tenant filters required by the safety validator (see Phase 3) — fiscal-year and any org/branch scoping the registry mandates.
2. Provide each Golden-5 intent with an **explicit expected shape**: target table(s), the canonical aggregate (e.g. `COUNT(DISTINCT fiscalYear)` for `count_fiscal_years`, `SUM(balance)` segmented for receivables/payables), the required `WHERE` scope, and the result columns the answer formatter expects. Keep this as structured prompt data, not free prose.
3. Encode a **negative contract**: explicitly forbid the model from calling `list_database_tables`/`get_database_schema` for the Golden 5 when the schema is already known/cached — these intents have fixed table targets, so the discovery loop should usually be skipped entirely (one tool round, not three).
4. Acceptance: golden-prompt harness (`scripts/fixtures/golden-prompts.json`, `tests/unit/goldenPromptHarness.test.ts`) shows each of the five producing a single-statement SELECT with the required scope filter and no forbidden constructs.

---

## Phase 2 — Intent Registry Binding for the Golden 5
**Goal:** make the five intents first-class, deterministic entries with fixed table/column targets so prompt assembly and validation are data-driven.

1. In `financialIntentRegistry.ts`, ensure each Golden-5 intent declares (as structured metadata): canonical target table(s), required scope dimensions (fiscal year, org/branch as applicable), the expected aggregate/projection, and the synonym hints (feeding File 2 Phase 3's alias map for that table).
2. Add an `isGoldenFastPath: true` marker (or equivalent) on these five so the orchestrator and the SQL validator can branch into the fast-path deterministically.
3. The registry entry is the **single source of truth** consumed by: (a) Phase 1 prompt assembly, (b) Phase 3 fast-path validation, (c) File 2's mapping resolver synonyms. No duplication of table/column knowledge across modules.
4. Acceptance: registry unit test asserts all five intents carry complete metadata (table, scope, aggregate, projection) and the fast-path marker.

---

## Phase 3 — Fast-Path SQL Validation (bypass the node-sql-parser regex fallback)
**Goal:** for the Golden 5's constrained grammar, validate read-only safety with a fast, deterministic check and never enter the expensive parser-fallback-regex path.

1. Add a **`validateGoldenFastPath(sql, intentMeta, scope)`** branch invoked *only* when the active intent is a Golden-5 fast-path entry. If the query satisfies all fast-path predicates, it is accepted without invoking `node-sql-parser` at all. If any predicate fails, **fall through to the existing `validateReadOnlyQuery`** (safety must never be weakened — the fast path can only *accept faster*, never accept something the full validator would reject).
2. Fast-path predicate checklist (all must hold), evaluated on a comment/literal-stripped normalization (reuse `stripSqlCommentsAndLiterals`, then collapse whitespace):
   - Exactly one statement (no unescaped statement separator outside literals).
   - First keyword is `SELECT`.
   - Contains **none** of the forbidden keyword set (DML/DDL/EXEC/MERGE/temp-table/`INTO`/etc.) — match on tokenized word boundaries against the stripped text, not raw text, to avoid false hits inside string literals.
   - No multiple-statement constructs, no `;` separators, no comment-injection remnants after stripping.
   - Every referenced table ∈ the intent's declared target tables (from Phase 2 registry).
   - **Mandatory scope filter present:** the required fiscal-year / org filter VALUES are present. NOTE: per repo guidance, value-aware scope enforcement must run on a **comments-only** normalization pass (literals preserved), because the literal-stripping pass removes the very values being checked. Use the comments-only pass for value checks and the literal-stripped pass for keyword checks.
   - Only allowed clause shapes appear (`SELECT/FROM/WHERE/GROUP BY/HAVING/ORDER BY` and the standardized row-limit form). Reject window/PIVOT/proc tokens.
3. **Why this is safe to bypass the parser:** the Golden 5 are generated under the Phase 1 strict grammar contract and target known tables; the predicate set above is a strict *superset* of the safety properties the parser would enforce for this grammar subset, evaluated in linear time. Anything outside the narrow grammar deterministically falls back to the full validator — so the parser-fallback-regex hotspot is only avoided for queries that provably don't need it.
4. **Performance contract:** the fast path must be allocation-light and single-pass where possible; it must not call into `node-sql-parser` and must not trigger the regex fallback branch. Telemetry: emit `sql.fastpath.accepted`, `sql.fastpath.fellthrough`, with timing, so you can prove the parser is being skipped for the Golden 5.
5. **Defense-in-depth:** the database connection itself must remain read-only (least-privilege account / read-only transaction). The fast path is a guardrail, not the only line of defense.
6. Acceptance tests (extend `tests/unit/sqlPolicyValidator.test.ts` / `sqlConnectionManager` tests):
   - Each Golden-5 canonical query → accepted by fast path, asserts `node-sql-parser` was NOT invoked (spy/mock the parser).
   - A Golden-5 query missing its mandatory scope filter → fast path rejects (or falls through and the full validator rejects).
   - An injected DML/second-statement attempt disguised in a Golden-5 prompt → rejected; never reaches execution.
   - A legitimately complex query (non-Golden) → still uses the existing parser path unchanged.

---

## Phase 4 — Deterministic Result Contract & Regression Gate
1. Each Golden-5 tool must return a **stable, typed evidence shape** (the value plus the scope it was computed under: fiscal year(s), currency, as-of date). This feeds the evidence-first answer contract already exercised by `agentOrchestratorEvidenceContract.test.ts`.
2. Wire the fast path end-to-end: intent detected → Golden prompt contract (Phase 1) → model emits single SELECT → File 2 column pre-validation → `validateGoldenFastPath` (Phase 3) → execute on read-only connection → typed evidence → answer.
3. Add/extend golden-prompt regressions so all five have a pinned expected SQL shape and expected evidence fields, runnable via the existing harness.
4. Run `npm run typecheck` and the SQL + golden-prompt + intent-registry suites. Definition of done: all five execute in a single tool round (no discovery loop when schema cached), pass fast-path validation without invoking the parser, and emit deterministic evidence.

---

## Dependency Notes for the Executor
- Never weaken safety to gain speed: the fast path is **accept-faster-only**; any miss falls through to the full `validateReadOnlyQuery`.
- Keep keyword checks on the literal-stripped text and value/scope checks on the comments-only text — mixing these is the known failure mode that lets scope enforcement silently pass.
- The intent registry (Phase 2) is the single source of truth; do not hardcode table/column names in the validator or prompt assembler.
