# MVP Test Operating Model

## Goal

This playbook defines how to run ACC Assist MVP validation with a real tester, telemetry evidence, and batch-based fixes.

Core rule:

- Do not change the program after every single question.
- Collect a meaningful batch of evidence.
- Classify failures by root cause.
- Fix the highest-value classes of failure.
- Re-run the same benchmark set.

## Entry Criteria

Use this operating model only when all of the following are true:

- The Windows test build is deployed on the target machine.
- SQL connection and SSH tunnel work.
- Telemetry is enabled.
- Telemetry ingest health passes.
- A tester has access to the app and a fixed benchmark question set.

## Roles

### Tester

Responsible for:

- Asking benchmark questions exactly as written.
- Marking each response as `correct`, `partially-correct`, or `incorrect`.
- Writing a short human judgment note only when needed.

### Operator

Responsible for:

- Confirming build version and environment readiness.
- Exporting telemetry and audit evidence after each test session.
- Producing the defect batch for engineering.

### Engineer

Responsible for:

- Grouping failures by root cause.
- Adding regression tests for every accepted bug.
- Shipping fixes in batches, not one-by-one per question.

## Standard Test Session

Run each session in this order:

1. Confirm app version, SQL settings, telemetry enabled, and ingest URL.
2. Confirm telemetry collector health.
3. Start a fresh tester session.
4. Ask the benchmark questions in order.
5. Mark each answer with one outcome label.
6. Export telemetry and audit evidence.
7. Create a session summary.

## Benchmark Set Structure

Maintain a stable benchmark set with these columns:

| Case ID | Question | Expected Intent | Expected Mode | Expected Evidence Signal | Priority |
| --- | --- | --- | --- | --- | --- |
| FY-001 | در دیتابیس چند سال مالی وجود داره؟ | count_fiscal_years | deterministic | table/row-count/evidence | P0 |

Guidelines:

- Keep 15 to 30 benchmark questions for MVP.
- Mark each case as `P0`, `P1`, or `P2`.
- Never rewrite old benchmark questions silently.
- If a benchmark changes, increment its revision.

## Per-Question Result Form

Use this exact template per question:

| Field | Value |
| --- | --- |
| Session ID | |
| Case ID | |
| Asked At | |
| Exact Question | |
| Outcome | correct / partially-correct / incorrect |
| Human Note | |
| Request ID | |
| Conversation ID | |
| Intent Detected | |
| Tool Calls Used | |
| Final Evidence Quality | strong / medium / weak / missing |

## Outcome Definitions

### correct

Use when all conditions hold:

- The answer addresses the asked question.
- The numeric or factual answer is correct.
- The evidence is relevant and not contradictory.
- No major hallucination exists.

### partially-correct

Use when the answer is directionally useful but one of these is true:

- The answer is incomplete.
- The evidence is weak.
- The answer is correct but not scoped well.
- The wording is confusing but still mostly usable.

### incorrect

Use when any of these happens:

- The answer targets the wrong business question.
- The answer uses the wrong table/tool path.
- The result is unsupported by evidence.
- The answer is blocked by a preventable contract or routing failure.
- The app times out or fails to produce a usable answer.

## Telemetry Review Checklist

For every failed or partial case, review:

- Request ID
- Conversation ID
- Prompt text
- Detected intent
- Round count
- Tool-call count
- Final text
- Audit tool sequence
- Telemetry ingest success or failure

Minimum telemetry signals to inspect:

- `app.lifecycle`
- `agent.debug-server`
- `ipc.handler`
- `process.crash`
- `telemetry.ingest`

## Root Cause Taxonomy

Every defect must be classified into one primary bucket.

### INTENT

Examples:

- Wrong intent detected.
- Deterministic question falls into generic route.

### ROUTING

Examples:

- Correct intent but wrong tool path selected.
- Fallback path never triggered.

### SCHEMA

Examples:

- Needed table or column not discovered.
- Mapping assumptions do not match the target database.

### SQL_POLICY

Examples:

- Read-only guard blocks an otherwise valid query shape.
- Query needs ORDER BY or TOP and the generator omitted it.

### PROVIDER

Examples:

- 429, 504, timeout, aborted stream.
- Upstream model route instability.

### EVIDENCE_CONTRACT

Examples:

- Answer is mostly right but rejected because evidence format is insufficient.
- Final text misses the required sections.

### UX_PRESENTATION

Examples:

- Correct result but poor formatting.
- User cannot easily understand the answer.

### TELEMETRY_OPERATIONS

Examples:

- Event not flushed.
- Queue grows unexpectedly.
- Ingest endpoint or token mismatch.

## Batch Fix Policy

Never patch one question at a time unless the bug is a true blocker.

Use this rule:

- 1 isolated failure: observe until repeated.
- 2 or more failures with same root cause: create one batch fix.
- Any P0 wrong-answer failure: fix in the next engineering batch.

Each engineering batch must include:

- The root-cause note.
- The code change.
- A regression test.
- The benchmark cases expected to improve.

## Test Cadence

### Daily

- Run the benchmark set on the current build.
- Review new incorrect and partially-correct cases.
- Group by root cause.

### Every 2 to 3 Days

- Ship one engineering batch.
- Re-run the full benchmark set.
- Compare against the prior score.

### Weekly

- Produce trend metrics.
- Re-rank backlog based on frequency and impact.

## MVP Metrics

Track at least these metrics:

| Metric | Target |
| --- | --- |
| P0 benchmark pass rate | >= 95% |
| Overall benchmark pass rate | >= 85% |
| Partially-correct rate | <= 10% |
| Incorrect rate | <= 5% |
| P95 response time | <= 8s |
| Provider failure rate | <= 5% |
| Telemetry ingest success | >= 99% |
| Local queue stuck non-zero after session | 0 |

## Release Gate

Do not advance the MVP build unless all conditions pass:

1. `npm run typecheck`
2. `npm run build:win`
3. Golden/regression checks for touched cases
4. Telemetry smoke test
5. Benchmark P0 set

## Session Summary Template

Use this summary after every test session:

```md
Session ID: 2026-06-13-AM
Build: 1.0.0
Tester: <name>
Environment: Remote Windows host 192.168.85.56

Total Cases: 20
Correct: 14
Partially-Correct: 4
Incorrect: 2

Top Root Causes:
1. ROUTING - 3 cases
2. EVIDENCE_CONTRACT - 2 cases
3. PROVIDER - 1 case

P0 Failures:
- FY-001: none
- AR-002: wrong tool path

Engineering Batch Recommendation:
- Strengthen deterministic receivables routing
- Add regression for AR-002 and AR-004
- Reduce evidence rejection for tool-backed partial summaries
```

## Operational Notes

- Keep one stable remote environment for benchmark comparability.
- Avoid changing benchmark wording and infrastructure in the same session.
- If telemetry fails, stop the session and fix observability first.
- If provider instability dominates, separate provider incidents from product defects.
- Treat SSH headless checks as observability diagnostics only, not as the primary GUI acceptance flow.
- The `ask-ai` debug-only path can leave a small local telemetry queue behind; verify that the next interactive app start drains it before closing a telemetry incident.
