/**
 * Evidence-First Contract primitives.
 *
 * These structured types replace prose-heuristic reasoning in the orchestrator's
 * evidence gate. The core defect they fix: a query that runs successfully within
 * scope but legitimately returns 0 rows (e.g. `WHERE FiscalYearRef = 1403` on a
 * database where that surrogate key has no records) must be treated as a real,
 * answerable fact (`VALID_EMPTY`) — NOT conflated with an execution failure
 * (`INSUFFICIENT`) that should trigger the defensive "cannot answer" state.
 */

/** A single tool execution's structured outcome, independent of rendered prose. */
export type ToolEvidence = {
  /** Tool name, e.g. `fetch_financial_data`, `list_database_tables`. */
  tool: string
  /** Whether the tool executed (`ok`), failed (`error`), or was not run (`skipped`). */
  status: 'ok' | 'error' | 'skipped'
  /** Optional machine-readable error code from the tool layer. */
  errorCode?: string
  /** Optional human-readable error message from the tool layer. */
  errorMessage?: string
  /** Number of rows the query returned. `0` is a valid, answerable result. */
  rowsReturned: number
  /**
   * Whether the returned rows contained at least one non-null/non-empty value.
   * `false` for a single aggregate row whose total is NULL.
   */
  nonNullValue: boolean
  /**
   * Whether the executed query satisfied the required runtime scope filters
   * (company / fiscal year / branch). Metadata tools set this to `false` since
   * they do not produce scoped financial facts.
   */
  scopeApplied: boolean
  /** Optional compacted SQL text for diagnostics. */
  query?: string
}

/** The full structured trace of a single orchestration request. */
export type ExecutionTrace = {
  intentId: string | null
  toolCallsUsed: number
  rounds: number
  evidence: ToolEvidence[]
}

/**
 * Deterministic classification of the most relevant failure mode for a request.
 */
export type ToolFailureKind =
  | 'NO_FETCH'
  | 'EMPTY_RESULT'
  | 'POLICY_ERROR'
  | 'NOT_IN_CATALOG'
  | 'UNKNOWN_OBJECT'
  | 'UNSUPPORTED_FUNCTION'
  | 'PROVIDER_ERROR'
  | 'NONE'

/**
 * Pure classifier for request failures based on structured evidence and the last
 * tool error code, if one exists.
 */
export function classifyToolFailure(
  evidence: ToolEvidence[],
  lastErrorCode?: string,
  lastErrorMessage?: string
): ToolFailureKind {
  const scopedSuccesses = evidence.filter((entry) => entry.status === 'ok' && entry.scopeApplied)

  if (scopedSuccesses.some((entry) => entry.rowsReturned > 0 && entry.nonNullValue)) {
    return 'NONE'
  }

  const errorText = [lastErrorCode, lastErrorMessage].filter(Boolean).join(' | ')

  if (errorText) {
    if (/SQL_POLICY/i.test(errorText)) {
      return 'POLICY_ERROR'
    }

    if (/NOT_IN_CATALOG|CATALOG/i.test(errorText)) {
      return 'NOT_IN_CATALOG'
    }

    if (/invalid object name|invalid column name/i.test(errorText)) {
      return 'UNKNOWN_OBJECT'
    }

    if (/not a recognized built-in function|built-in function|gregoriantoshamsi|format\s*\(/i.test(errorText)) {
      return 'UNSUPPORTED_FUNCTION'
    }

    if (/TIMEOUT|PROVIDER|NETWORK|CONNECT/i.test(errorText)) {
      return 'PROVIDER_ERROR'
    }
  }

  if (scopedSuccesses.some((entry) => entry.status === 'ok' && entry.scopeApplied)) {
    return 'EMPTY_RESULT'
  }

  return 'NO_FETCH'
}

/**
 * Tri-state verdict derived purely from an {@link ExecutionTrace}.
 * - `POSITIVE_DATA`: at least one scoped query returned non-null rows.
 * - `VALID_EMPTY`: a scoped query executed cleanly but returned 0 rows / NULL.
 * - `INSUFFICIENT`: no successfully executed, scoped query exists.
 */
export type EvidenceVerdict =
  | { kind: 'POSITIVE_DATA' }
  | { kind: 'VALID_EMPTY'; reason: string }
  | { kind: 'INSUFFICIENT'; reason: string }

/**
 * Pure, deterministic mapper from a structured execution trace to a verdict.
 * No LLM, no prose inspection — this is the authority for data sufficiency.
 */
export function evaluateEvidence(trace: ExecutionTrace): EvidenceVerdict {
  const scopedSuccesses = trace.evidence.filter((entry) => entry.status === 'ok' && entry.scopeApplied)

  if (scopedSuccesses.length === 0) {
    return { kind: 'INSUFFICIENT', reason: 'no successfully executed, scoped query' }
  }

  if (scopedSuccesses.some((entry) => entry.rowsReturned > 0 && entry.nonNullValue)) {
    return { kind: 'POSITIVE_DATA' }
  }

  return {
    kind: 'VALID_EMPTY',
    reason: 'query executed within scope but returned 0 rows / NULL'
  }
}

/**
 * S3: Explains WHY a result is empty with Persian context.
 * This is a layer on top of the verdict for user-facing explanations.
 * The verdict logic (POSITIVE_DATA/VALID_EMPTY/INSUFFICIENT) remains unchanged.
 */
export type EmptyStateExplanation =
  | { kind: 'EMPTY_TABLE'; message: string }
  | { kind: 'EMPTY_FILTERED'; message: string }
  | { kind: 'ALTERNATE_SOURCE_AVAILABLE'; message: string }
  | { kind: 'NOT_EMPTY' }

export function explainEmptyState(
  trace: ExecutionTrace,
  primaryTableEmpty: boolean,
  alternateTableHasData: boolean
): EmptyStateExplanation {
  const scopedSuccesses = trace.evidence.filter((entry) => entry.status === 'ok' && entry.scopeApplied)

  // S1 fallback case: primary empty but alternate has data (check this first)
  if (primaryTableEmpty && alternateTableHasData) {
    return {
      kind: 'ALTERNATE_SOURCE_AVAILABLE',
      message: 'منبع اصلی (فاکتور خرید) خالی است، اما داده از منبع جایگزین (رسید انبار) دریافت شد.'
    }
  }

  // If we have positive data, no empty state to explain
  if (scopedSuccesses.some((entry) => entry.rowsReturned > 0 && entry.nonNullValue)) {
    return { kind: 'NOT_EMPTY' }
  }

  // Check if any table has rows at all (regardless of scope)
  const anySuccesses = trace.evidence.filter((entry) => entry.status === 'ok')
  const tableHasRows = anySuccesses.some((entry) => entry.rowsReturned > 0)

  if (tableHasRows) {
    return {
      kind: 'EMPTY_FILTERED',
      message: 'جدول داده دارد، اما برای فیلتر سال/دامنه انتخابی رکوردی یافت نشد.'
    }
  }

  return {
    kind: 'EMPTY_TABLE',
    message: 'جدول هدف اصلاً رکورد ندارد (ماژول استفاده‌نشده).'
  }
}
