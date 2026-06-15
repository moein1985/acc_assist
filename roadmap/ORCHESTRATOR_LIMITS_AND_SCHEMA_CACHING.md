# FILE 2 — Orchestrator Limits & Schema Caching

> Target executor: **Mia-code-flash-1**. Atomic, ordered phases. No code — algorithmic logic, structural steps, and contracts only.
> Scope of change: `src/main/services/agentOrchestrator.ts`, `src/main/services/schemaDiscoveryService.ts`, and the schema-tool handler path. Depends on File 1 being in place for provider calls.

## 0. Context & Current Baseline (read before editing)
- Orchestrator constants today: `MAX_TOOL_CALL_ROUNDS = 8`, `MAX_TOOL_CALLS_PER_ROUND = 4`, `MAX_TOTAL_TOOL_CALLS = 15`.
- The tool loop is `for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round += 1)`.
- Registered tools: `list_database_tables(table_pattern?)`, `get_database_schema(table_name, schema_name?)`, `fetch_financial_data(sql_query)`.
- Telemetry shows the expensive hot loop is `list_database_tables → get_database_schema → fetch_financial_data`, with `get_database_schema` repeated across loops (the caching target).
- Failure mode: multi-step queries blow the round budget and restart; LLM emits a non-existent column (`Name` vs `Title`) and only fails *after* the SQL validator rejects it — wasting a full provider round-trip.

---

## Phase 1 — Hard Loop Execution Cap (token-bleed guard)
**Goal:** cap autonomous turns to **3–4** to stop infinite loops and runaway token spend, while still allowing the canonical 3-step discovery path to finish.

1. Lower `MAX_TOOL_CALL_ROUNDS` from 8 to a configurable **`MAX_TOOL_CALL_ROUNDS = 4`** (default 4, minimum viable 3). Keep it a named constant; expose it through agent debug config if one exists.
2. Reconcile the budgets so the happy path (`list_database_tables` → `get_database_schema` → `fetch_financial_data`) always fits: with 4 rounds and `MAX_TOOL_CALLS_PER_ROUND = 4`, recompute `MAX_TOTAL_TOOL_CALLS` to a value that the cap can actually reach (e.g. ≤ rounds × per-round but tuned down, target **8**). Document the arithmetic in a comment.
3. Introduce an explicit **terminal round behavior**: on the final allowed round, the system prompt and the loop must force the model toward a *final answer*, not another tool call. Algorithm:
   - Before issuing the last round's request, inject a transient system directive: "This is the final tool round; if you still lack data, answer with the best available partial result and state what is missing." (no tool schema offered, or `tool_choice` forced to none on the last round).
4. **Graceful exhaustion**, not a thrown crash: when rounds/total-calls are exhausted without a final answer, emit a typed `AGENT_LOOP_BUDGET_EXHAUSTED` progress event carrying: rounds used, tool calls used, last tool error, and any partial evidence collected. This event is the contract the renderer (File 4) renders as a graceful fallback — it must never surface as an unhandled exception.
5. Keep the existing per-round (`AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED`) and total (`MAX_TOTAL_TOOL_CALLS`) guards; just retune their constants and ensure all three guards emit the same structured shape so the UX has one fallback contract.
6. Acceptance: a mocked model that always asks for one more tool call terminates at exactly `MAX_TOOL_CALL_ROUNDS` and emits the exhaustion event with collected partials.

---

## Phase 2 — Session-Scoped Schema Cache
**Goal:** eliminate repeated `get_database_schema` and `list_database_tables` IPC/DB round-trips within a session.

1. Introduce a **`SchemaCache`** owned at session scope (keyed by an identity that uniquely binds a connection + database, e.g. `host:port:database`). Never key by prompt or round. Store it where `SchemaDiscoveryService` is constructed/held so its lifetime equals the connected session.
2. Cache entry shape (logical, not literal): `{ tables: TableListSnapshot, schemasByTable: Map<normalizedTableName, ColumnSchemaSnapshot>, fetchedAt, ttl }`.
3. **Read path algorithm** for `get_database_schema(table_name, schema_name?)`:
   1. Normalize the requested table name (case-fold, trim, strip brackets/schema qualifier into canonical form).
   2. Cache hit and not expired → return cached snapshot, emit a `schema.cache.hit` telemetry counter, **skip DB/IPC entirely**.
   3. Miss/expired → call the real discovery once, store the result, emit `schema.cache.miss`, return it.
4. Same algorithm for `list_database_tables` (cache the table list per database; honor an optional `table_pattern` by filtering the cached list in-memory rather than re-querying when the full list is already cached).
5. **Invalidation policy:**
   - TTL-based (target **10–15 minutes**) — accounting schemas are effectively static within a session.
   - Hard invalidate on connection change / reconnect / database switch / explicit user "refresh schema".
   - No write-through concerns (read-only app), so no mutation-based invalidation needed.
6. **Cache warming (optional, recommended):** on first successful connection, pre-fetch and cache the table list and the schemas of the known MVP tables (fiscal-year, accounts, parties, documents) so the very first user query often hits cache for `get_database_schema`.
7. Concurrency: guard against duplicate in-flight discovery for the same key with a single-flight promise map (a second request for the same table while the first is loading awaits the same promise instead of issuing a parallel DB call).
8. Acceptance tests:
   - Two `get_database_schema` calls for the same table within a session → exactly **one** underlying discovery call.
   - Connection switch between calls → second call re-fetches (cache invalidated).
   - `table_pattern` variants against an already-cached full list → zero new DB calls.

---

## Phase 3 — Column-Mapping Pre-Validation (fail before SQL validation, not after)
**Goal:** when the LLM references a non-existent column, repair or reject it *using the cached schema* before the query is sent to `SqlConnectionManager`, saving a wasted provider round.

1. After the model emits a `fetch_financial_data(sql_query)` call, run a **lightweight column/table resolver** against the Phase 2 cache *before* executing or even before deep SQL validation:
   1. Extract referenced identifiers (tables and columns) from the candidate SQL with a shallow tokenizer — this is a best-effort lexical pass, NOT full parsing (full parsing stays in `SqlConnectionManager`).
   2. For each referenced table, confirm it exists in the cached table list; for each referenced column, confirm it exists in that table's cached column set (case-insensitive).
2. **Mapping-mismatch fallback ladder** (apply in order, stop at first success):
   1. **Case/whitespace normalization:** match ignoring case and surrounding brackets/quotes; if the only difference is casing, rewrite to the canonical schema spelling.
   2. **Known-synonym map:** maintain a small curated alias table for this accounting domain (e.g. `Name → Title`, `Date → DocDate`, common Sepidar/accounting field aliases). If a referenced column matches a known alias whose canonical form exists in the cached schema, substitute it.
   3. **Fuzzy nearest-column:** compute a cheap edit-distance/similarity between the unknown column and the table's real columns; if a single candidate is within a tight threshold, substitute it and annotate the substitution.
   4. **No confident match:** do **not** silently guess. Instead of forwarding a broken query, return a **structured tool-error back to the model** that names the invalid identifier AND lists the *actual available columns* for that table (sourced from cache, zero extra DB cost). This turns a wasted validation failure into a cheap, single, well-targeted correction round.
3. Telemetry: emit `schema.mapping.autofixed` (with from/to) or `schema.mapping.unresolved` (with the available-columns hint returned). These metrics reveal which aliases to add to the curated synonym map over time.
4. **Guardrails:** the resolver must never *broaden* the query (never add columns, never change filters/scope, never alter table joins beyond name correction). It only corrects identifier spelling against the real schema. Any structural ambiguity → return the error-with-hints path, not a rewrite.
5. Ordering contract: this pre-validation runs **before** `SqlConnectionManager.validateReadOnlyQuery`; it does not replace it. The read-only/scope/safety validation in File 3 remains the final authority.
6. Acceptance tests:
   - SQL referencing `Name` when schema has `Title` → autofixed via synonym map, executes once, no provider re-round.
   - SQL referencing a genuinely unknown column → tool-error returned to model containing the real column list; no DB execution attempted.
   - Resolver never alters WHERE-clause scope values.

---

## Phase 4 — Integration, Metrics & Regression Gate
1. Order of operations inside a round: model response → tool-call budget check (Phase 1) → for `fetch_financial_data`, run column pre-validation (Phase 3) using the schema cache (Phase 2) → then SQL safety validation (File 3) → execute.
2. For schema/table tools, the cache (Phase 2) intercepts before any IPC/DB call.
3. Emit a per-request summary event: `{ roundsUsed, toolCallsUsed, schemaCacheHits, schemaCacheMisses, mappingAutofixes, terminatedReason }`.
4. Update `tests/unit/agentOrchestrator*.test.ts` and `schemaDiscoveryService.test.ts` for the new caps, cache, and resolver. Run `npm run typecheck` plus the orchestrator + schema-discovery suites.
5. Definition of done: canonical 3-step query completes within the 4-round cap; identical schema lookups hit cache; a `Name`/`Title` style mismatch is auto-corrected or returned with actionable hints without burning an extra provider round; budget exhaustion produces a structured event (consumed by File 4), never a crash.

---

## Dependency Notes for the Executor
- Phase 3's synonym map should start small and be data-driven from `schema.mapping.unresolved` telemetry; do not over-engineer a giant alias dictionary up front.
- The schema cache is the shared substrate for both performance (Phase 2) and correctness (Phase 3) — implement Phase 2 fully before Phase 3.
- Keep all caps as named constants reachable from one config surface so MVP tuning needs no code spelunking.
