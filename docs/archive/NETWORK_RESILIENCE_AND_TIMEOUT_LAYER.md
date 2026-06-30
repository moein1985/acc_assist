# FILE 1 — Network Resilience & Timeout Layer

> Target executor: **Mia-code-flash-1**. Atomic, ordered phases. No code in this document — only algorithmic logic, structural steps, and architectural contracts.
> Scope of change: `src/main/services/geminiClient.ts` and a new sibling helper module. Do not touch orchestrator or SQL layers in this file's tasks.

## 0. Context & Current Baseline (read before editing)
- `GeminiClient` currently uses: `DEFAULT_TIMEOUT_MS = 60000`, `DEFAULT_RETRY_ATTEMPTS = 2`, `DEFAULT_RETRY_BASE_DELAY_MS = 600`.
- Retry decisioning lives in `isRetryableError()`; the loop lives in `withRetry()`; per-request abort/timeout lives in `createAbortRuntimeContext()`; upstream error text extraction lives in `extractProxyError()` and `tryJsonParse()`.
- Both `chatOpenAi()` (non-stream) and `chatOpenAiStream()` paths must share the same resilience policy. The streaming path is the one that currently hangs 20–110s on AvalAI 502/504 drops.
- Operating environment: Iran DPI/filtering, `avalai.ir` bridge, frequent silent socket stalls. The engine is Gemini 2.5 Flash, so per-call latency budgets must assume fast TTFT; a slow first token is itself a failure signal.

---

## Phase 1 — Centralize Resilience Constants
**Goal:** make every timeout/retry value a single source of truth so policy can be tuned without code archaeology.

1. Create one resilience-policy constant block (top of `geminiClient.ts` or a new `geminiResiliencePolicy.ts` imported by it). Define, as named constants:
   - `CONNECT_TIMEOUT_MS` = aggressive ceiling for establishing the request (target **12000–15000 ms**, default 13000).
   - `TIME_TO_FIRST_TOKEN_MS` = max wait for the first streamed byte/chunk (target **8000–10000 ms**). If no first token arrives in this window, abort as a stall — do not wait for `CONNECT_TIMEOUT_MS`.
   - `INTER_CHUNK_STALL_MS` = max gap allowed between two consecutive stream chunks (target **6000–8000 ms**). Resets on every received chunk.
   - `OVERALL_REQUEST_DEADLINE_MS` = hard wall-clock ceiling for a single attempt including streaming (target **25000–30000 ms**).
   - `RETRY_ATTEMPTS`, `RETRY_BASE_DELAY_MS`, `RETRY_MAX_DELAY_MS`, `RETRY_JITTER_RATIO`.
   - Circuit-breaker constants (see Phase 4).
2. Replace the single `DEFAULT_TIMEOUT_MS` usages with the specific timeout that fits each call site (connect vs first-token vs inter-chunk vs overall). Keep backward-compatible constructor options so tests can inject tiny values.
3. Acceptance: no literal millisecond numbers remain inline in the request/stream paths; all derive from the policy block.

---

## Phase 2 — Multi-Stage Timeout Engine (replace single 60s abort)
**Goal:** fail in ~12–15s on dead connections instead of 110s, without killing healthy slow-but-progressing streams.

1. Extend `createAbortRuntimeContext()` (or wrap it) into a **staged watchdog** with three independent timers feeding one `AbortController`:
   - **Connect/first-response timer:** armed at request start; fires at `CONNECT_TIMEOUT_MS` if no HTTP response headers received.
   - **First-token timer (stream only):** armed when headers arrive; fires at `TIME_TO_FIRST_TOKEN_MS` if zero content chunks consumed.
   - **Inter-chunk idle timer (stream only):** (re)armed on each consumed chunk; fires at `INTER_CHUNK_STALL_MS` of silence.
   - **Overall-deadline timer:** armed at request start; fires at `OVERALL_REQUEST_DEADLINE_MS` regardless of progress.
2. Each timer that fires must set a **typed abort reason** (e.g. `connect-timeout`, `ttft-timeout`, `stall-timeout`, `deadline-timeout`, `user-abort`). The existing logic that distinguishes external/user abort from timeout must be preserved and extended to carry the specific reason.
3. In the stream consumer loop (`chatOpenAiStream` reader loop), after each successfully consumed SSE block, **reset the inter-chunk timer** and clear the first-token timer once the first real text/tool delta lands.
4. Ensure timers are always disposed in the `finally` block (no leaked handles), matching current `abortRuntime.dispose()` discipline.
5. Acceptance tests (mock `fetch`):
   - Headers never arrive → aborts at ~`CONNECT_TIMEOUT_MS`.
   - Headers arrive, no chunk → aborts at ~`TIME_TO_FIRST_TOKEN_MS`.
   - One chunk then silence → aborts at ~`INTER_CHUNK_STALL_MS` after last chunk.
   - Steady chunks under the gap threshold for 40s → completes successfully (proves slow-but-alive streams are not killed by a global 30s cap **when** progress continues; if business requires a true hard wall, the overall-deadline timer wins — document which policy is active).

---

## Phase 3 — 5xx / HTML Error Normalization (protect telemetry)
**Goal:** upstream HTML 502/504 bodies must never reach telemetry as garbled blobs and must never crash the pipeline.

1. Build a single **`normalizeUpstreamError(status, headers, rawBody)`** helper (extend/replace `extractProxyError` + `tryJsonParse`). Logic, in order:
   1. Capture `status`, `x-request-id`/`request-id`, and `content-type` first — these are always the primary telemetry fields.
   2. If body is JSON → extract the canonical `error.message`/`message`.
   3. If body is HTML or non-JSON (detected by `content-type` or a leading `<` after trim) → **do not log the body**. Produce a short synthetic descriptor like `upstream-html-error` plus the status and request id only.
   4. Hard-cap any retained body excerpt to a small length (e.g. 200 chars) and strip control/markup characters before it can be attached anywhere.
2. Guarantee the normalizer is **total** (never throws): wrap parsing in defensive handling so a malformed body yields a safe descriptor instead of propagating an exception into the telemetry writer.
3. Encoding fix: ensure the descriptor is UTF-8 clean so Persian error surfaces (`translateAiError`) are not corrupted downstream. The garbled-text defect originates from logging raw bytes — eliminate that path entirely.
4. Route both stream and non-stream `!response.ok` branches through this single normalizer (they currently duplicate the `extractProxyError` + requestId formatting logic).
5. Telemetry contract: emit a structured event with fields `{ status, requestId, contentType, errorClass, latencyMs }` — **never** the raw HTML. Verify with a test that feeds a 502 HTML page and asserts the recorded event contains the status code and request id but not the HTML markup.

---

## Phase 4 — Circuit Breaker for the AvalAI Bridge
**Goal:** after a short burst of upstream failures, stop hammering the gateway; fail fast and recover automatically.

1. Implement a **3-state breaker** (`CLOSED` → `OPEN` → `HALF_OPEN`) as a small stateful object owned by the `GeminiClient` instance (so its lifetime matches the app session). State must be in-memory only.
2. Counters & thresholds (all from the policy block):
   - `FAILURE_THRESHOLD` consecutive qualifying failures (target **3**) → trip to `OPEN`.
   - `OPEN_COOLDOWN_MS` (target **60000**) before allowing a probe.
   - In `HALF_OPEN`, allow exactly **one** probe request: success → `CLOSED` and reset counters; failure → back to `OPEN` and restart cooldown.
3. **What counts as a breaker failure** (qualifying): upstream 5xx, connect-timeout, ttft-timeout, stall-timeout, deadline-timeout, and hard network errors (`ECONNRESET`, `EHOSTUNREACH`, `fetch failed`). **What does NOT count:** 429 rate-limit (handled by retry/backoff), user-abort, and 4xx auth/validation (those are caller errors, not gateway health).
4. **Gate placement:** the breaker check wraps the *outermost* call entry (before `withRetry`). When `OPEN` and still cooling down, short-circuit immediately with a typed `provider-circuit-open` error — no socket opened, no retry loop entered.
5. Surface a localized, actionable Persian message when short-circuited (e.g. "سرویس هوش مصنوعی موقتاً در دسترس نیست؛ چند لحظه دیگر تلاش کنید") — distinct from a normal timeout so the UX layer (File 4) can render a "provider cooling down" state with a retry countdown.
6. Expose a read-only breaker snapshot (`state`, `failureCount`, `msUntilHalfOpen`) for telemetry and for the renderer status indicator.
7. Acceptance tests:
   - 3 consecutive mocked 502s → 4th call short-circuits in <50ms without calling `fetch`.
   - After `OPEN_COOLDOWN_MS` (injected small in tests) → one probe allowed; mocked success closes the breaker.
   - 429s alone never trip the breaker.

---

## Phase 5 — Retry Orchestration with Exponential Backoff + Jitter
**Goal:** retry only the transient classes, with jittered backoff tuned for the AvalAI bridge, and never fight the circuit breaker.

1. Refactor `withRetry()` to delegate the retry/no-retry decision to a **single classifier** (extend `isRetryableError`) returning an enum: `RETRYABLE_TRANSIENT`, `TERMINAL_UPSTREAM`, `TERMINAL_CLIENT`, `CIRCUIT_OPEN`, `USER_ABORT`.
   - `RETRYABLE_TRANSIENT`: 429, generic network/timeout/`ECONNRESET`/`ETIMEDOUT`/`fetch failed`/`EHOSTUNREACH`/`ECONNREFUSED`.
   - `TERMINAL_UPSTREAM`: 500/502/503/504 (keep current fast-fail — do **not** retry-cascade these; the breaker handles repetition).
   - `TERMINAL_CLIENT`: 4xx auth/validation.
   - `CIRCUIT_OPEN` and `USER_ABORT`: never retried.
2. Backoff formula per attempt `n` (0-based): `delay = min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2^n)`, then apply **full jitter**: multiply by a random factor in `[1 - RETRY_JITTER_RATIO, 1 + RETRY_JITTER_RATIO]`. Jitter is essential to avoid synchronized retry storms behind shared DPI/NAT.
3. Cap attempts at `RETRY_ATTEMPTS` (keep small, **2**) and ensure the *sum* of backoff + per-attempt timeouts stays within a sane bound (document the worst-case total; it must be well under the old 110s — target worst case ≈ 30–45s, not minutes).
4. On every failed attempt, feed the failure into the circuit breaker counter (Phase 4) so retries and breaker accounting stay consistent.
5. Preserve `decorateRetryFailureMessage()` semantics but make the final surfaced message carry: failure class, attempt count, and (if present) request id — routed through the Phase 3 normalizer so no raw HTML leaks.
6. Acceptance tests:
   - Two 429s then 200 → succeeds on 3rd, with measured jittered delays between attempts.
   - One 502 → fails fast (no retry), single `fetch`.
   - Backoff never exceeds `RETRY_MAX_DELAY_MS`.

---

## Phase 6 — Wiring, Telemetry & Regression Gate
1. Ensure both `chatOpenAi` and `chatOpenAiStream` enter through: **breaker gate → withRetry → staged-timeout request**. Single shared pipeline, no divergence.
2. Emit one structured telemetry event per attempt and one per final outcome: `{ attempt, failureClass, status, requestId, breakerState, latencyMs, abortReason }`. Never include raw bodies.
3. Update existing tests in `tests/unit/geminiClient.test.ts` to inject tiny timeout/backoff/breaker constants; add the new acceptance tests listed in Phases 2–5.
4. Run `npm run typecheck` and the geminiClient unit suite. Definition of done: dead-connection failures surface in ≤15s, 502 HTML never appears in telemetry, breaker opens after 3 failures and self-heals after cooldown.

---

## Dependency Notes for the Executor
- This file is **self-contained**; complete all six phases before integrating with File 2.
- Do not raise the global timeouts back up to "fix" a slow model — Gemini 2.5 Flash should be fast; persistent slowness is a network signal, not a budget problem.
- Keep all breaker/timeout state in-memory and session-scoped; no disk persistence in this layer.
