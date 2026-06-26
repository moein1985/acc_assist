/**
 * Conversation memory state and helpers extracted from `agentOrchestrator.ts`
 * (FRE Roadmap F2.2). Behaviour-preserving — the orchestrator delegates to
 * these free functions via a {@link ConversationMemoryDeps} context.
 */
import type { AccountingConceptKey } from '../../../shared/contracts'
import { normalizePersianDigits } from '../textNormalization'

export type ConversationMemoryFacts = {
  companyNames: string[]
  fiscalYears: string[]
  branchNames: string[]
  dateRange: string | null
  confirmedMappings: Partial<Record<AccountingConceptKey, string>>
}

export type ConversationMemoryState = {
  conversationId: string
  notes: string[]
  facts: ConversationMemoryFacts
  lastUserPrompt: string | null
  lastAssistantOutcome: string | null
  lastToolTrace: string[]
  touchedAt: number
}

export type ConversationMemorySnapshot = {
  notes: string[]
  facts: ConversationMemoryFacts
  lastUserPrompt: string | null
  lastAssistantOutcome: string | null
  lastToolTrace: string[]
}

export type ExtractedConversationFacts = {
  companyNames: string[]
  fiscalYears: string[]
  branchNames: string[]
  dateRange?: string
}

const COMPANY_SCOPE_CAPTURE_PATTERNS: RegExp[] = [
  /شرکت(?:\s*های|\s*ها|‌های|‌ها)?\s*[:-]?\s*([^\n\r؛;:.!?]{2,120})/giu,
  /\bcompan(?:y|ies)\b\s*[:-]?\s*([^\n\r؛;:.!?]{2,120})/gi
]

const BRANCH_SCOPE_CAPTURE_PATTERNS: RegExp[] = [
  /شعبه(?:\s*های|\s*ها|‌های|‌ها)?\s*[:-]?\s*([^\n\r؛;:.!?]{1,120})/giu,
  /\bbranch(?:es)?\b\s*[:-]?\s*([^\n\r؛;:.!?]{1,120})/gi
]

const RUNTIME_SCOPE_STOP_PATTERNS: RegExp[] = [
  /\s+در\s+/iu,
  /\s+برای\s+/iu,
  /\s+از\s+/iu,
  /\s+تا\s+/iu,
  /\s+سال(?:\s*مالی)?\s+/iu,
  /\s+from\s+/i,
  /\s+to\s+/i,
  /\s+for\s+/i,
  /\s+fiscal\s*year\s+/i,
  /\s+where\s+/i,
  /\s+with\s+/i,
  /\s+(?:گزارش|تحلیل|مقایسه|نمایش|بررسی)(?=\s|$|[،؛,.!?])/iu,
  /\s+(?:بده|بدید|کن|کنید|بکن)(?=\s|$|[،؛,.!?])/iu,
  /\s+(?:report|show|compare|analy[sz]e)\b/i
]

const RUNTIME_SCOPE_SPLIT_PATTERN = /(?:\s*(?:,|،|;|؛|\/|\||&)\s*|\s+(?:and|و)(?:\s+|$))/iu

const RUNTIME_SCOPE_YEAR_CAPTURE_PATTERN = /\b((?:13|14|19|20)\d{2})\b/g
const RUNTIME_SCOPE_YEAR_CONTEXT_PATTERN =
  /(?:سال(?:\s*مالی)?(?:\s*های|\s*ها|\s*\(ها\))?|fiscal\s*year(?:s)?)\s*[:-]?\s*([^\n\r؛;:.!?]{1,120})/giu
const RUNTIME_SCOPE_YEAR_RANGE_PATTERN =
  /((?:13|14|19|20)\d{2})\s*(?:تا|to|-|–|—)\s*((?:13|14|19|20)\d{2})/giu

const MAX_SCOPE_VALUES_PER_DIMENSION = 8

export const MAX_CONVERSATION_MEMORY_NOTES = 12
export const MAX_CONVERSATION_MEMORY_SESSIONS = 24
export const MAX_CONVERSATION_TOOL_TRACES = 10

export interface ConversationMemoryDeps {
  compactText: (value: string, maxLength: number) => string
}

export function createInitialConversationMemory(conversationId: string): ConversationMemoryState {
  return {
    conversationId,
    notes: [],
    facts: {
      companyNames: [],
      fiscalYears: [],
      branchNames: [],
      dateRange: null,
      confirmedMappings: {}
    },
    lastUserPrompt: null,
    lastAssistantOutcome: null,
    lastToolTrace: [],
    touchedAt: Date.now()
  }
}

export function getOrCreateConversationMemory(
  map: Map<string, ConversationMemoryState>,
  conversationId: string
): ConversationMemoryState {
  const existing = map.get(conversationId)

  if (existing) {
    existing.touchedAt = Date.now()
    return existing
  }

  const created = createInitialConversationMemory(conversationId)
  map.set(conversationId, created)
  return created
}

export function createConversationMemorySnapshot(
  memory: ConversationMemoryState
): ConversationMemorySnapshot {
  return {
    notes: [...memory.notes],
    facts: {
      companyNames: [...memory.facts.companyNames],
      fiscalYears: [...memory.facts.fiscalYears],
      branchNames: [...memory.facts.branchNames],
      dateRange: memory.facts.dateRange,
      confirmedMappings: {
        ...memory.facts.confirmedMappings
      }
    },
    lastUserPrompt: memory.lastUserPrompt,
    lastAssistantOutcome: memory.lastAssistantOutcome,
    lastToolTrace: [...memory.lastToolTrace]
  }
}

export function pruneConversationMemory(map: Map<string, ConversationMemoryState>): void {
  if (map.size <= MAX_CONVERSATION_MEMORY_SESSIONS) {
    return
  }

  const overflowCount = map.size - MAX_CONVERSATION_MEMORY_SESSIONS
  const staleConversationIds = [...map.values()]
    .sort((left, right) => left.touchedAt - right.touchedAt)
    .slice(0, overflowCount)
    .map((memory) => memory.conversationId)

  for (const conversationId of staleConversationIds) {
    map.delete(conversationId)
  }
}

export function pushConversationMemoryNote(memory: ConversationMemoryState, note: string): void {
  const normalizedNote = note.trim()

  if (!normalizedNote) {
    return
  }

  const existingIndex = memory.notes.findIndex((entry) => entry === normalizedNote)
  if (existingIndex >= 0) {
    memory.notes.splice(existingIndex, 1)
  }

  memory.notes.push(normalizedNote)

  if (memory.notes.length > MAX_CONVERSATION_MEMORY_NOTES) {
    memory.notes.splice(0, memory.notes.length - MAX_CONVERSATION_MEMORY_NOTES)
  }
}

export function rememberToolTrace(
  deps: ConversationMemoryDeps,
  memory: ConversationMemoryState,
  trace: string
): void {
  const normalizedTrace = deps.compactText(trace.replace(/\s+/g, ' ').trim(), 220)

  if (!normalizedTrace) {
    return
  }

  const existingIndex = memory.lastToolTrace.findIndex((entry) => entry === normalizedTrace)
  if (existingIndex >= 0) {
    memory.lastToolTrace.splice(existingIndex, 1)
  }

  memory.lastToolTrace.push(normalizedTrace)

  if (memory.lastToolTrace.length > MAX_CONVERSATION_TOOL_TRACES) {
    memory.lastToolTrace.splice(0, memory.lastToolTrace.length - MAX_CONVERSATION_TOOL_TRACES)
  }

  pushConversationMemoryNote(memory, `Tool trace: ${normalizedTrace}`)
}

export function updateConversationMemoryFromAssistant(
  deps: ConversationMemoryDeps,
  memory: ConversationMemoryState,
  finalText: string
): void {
  memory.touchedAt = Date.now()

  if (!finalText.trim()) {
    return
  }

  memory.lastAssistantOutcome = deps.compactText(finalText, 280)
  pushConversationMemoryNote(
    memory,
    `Latest assistant outcome: ${deps.compactText(finalText, 220)}`
  )
}

export function extractConversationFacts(text: string): ExtractedConversationFacts {
  const normalizedText = text.replace(/\s+/g, ' ').trim()

  if (!normalizedText) {
    return {
      companyNames: [],
      fiscalYears: [],
      branchNames: []
    }
  }

  const normalizedDigitsText = normalizePersianDigits(normalizedText)
  const facts: ExtractedConversationFacts = {
    companyNames: extractNamedScopeValues(normalizedText, COMPANY_SCOPE_CAPTURE_PATTERNS),
    fiscalYears: extractFiscalYears(normalizedDigitsText),
    branchNames: extractNamedScopeValues(normalizedText, BRANCH_SCOPE_CAPTURE_PATTERNS)
  }

  const dateRangeFaMatch = normalizedText.match(/از\s+([^\n\r]{1,24})\s+تا\s+([^\n\r]{1,24})/u)
  if (dateRangeFaMatch?.[1] && dateRangeFaMatch?.[2]) {
    facts.dateRange = `از ${dateRangeFaMatch[1].trim()} تا ${dateRangeFaMatch[2].trim()}`
  } else {
    const dateRangeEnMatch = normalizedDigitsText.match(
      /\bfrom\s+([a-z0-9/-]{2,20})\s+to\s+([a-z0-9/-]{2,20})/i
    )
    if (dateRangeEnMatch?.[1] && dateRangeEnMatch?.[2]) {
      facts.dateRange = `from ${dateRangeEnMatch[1]} to ${dateRangeEnMatch[2]}`
    }
  }

  return facts
}

function extractNamedScopeValues(text: string, patterns: RegExp[]): string[] {
  const values: string[] = []

  for (const pattern of patterns) {
    pattern.lastIndex = 0

    for (const match of text.matchAll(pattern)) {
      const captured = match[1]

      if (typeof captured !== 'string' || !captured.trim()) {
        continue
      }

      const normalizedChunk = trimScopeChunk(captured)
      if (!normalizedChunk) {
        continue
      }

      const parts = normalizedChunk
        .split(RUNTIME_SCOPE_SPLIT_PATTERN)
        .map((part) => normalizeScopeToken(part))
        .filter((part) => isValidScopeToken(part))

      values.push(...parts)
    }
  }

  return uniqueScopeValues(values)
}

function trimScopeChunk(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()

  if (!compact) {
    return ''
  }

  let minStopIndex = compact.length

  for (const pattern of RUNTIME_SCOPE_STOP_PATTERNS) {
    const match = pattern.exec(compact)

    if (!match || match.index < 0) {
      continue
    }

    minStopIndex = Math.min(minStopIndex, match.index)
  }

  return compact.slice(0, minStopIndex).trim()
}

function normalizeScopeToken(value: string): string {
  return value
    .replace(/^['"""''()[]{}]+|['"""''()[]{}]+$/g, '')
    .replace(/^(?:شرکت|company|companies|شعبه|branch|branches)\s+/iu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isValidScopeToken(value: string): boolean {
  if (!value) {
    return false
  }

  if (value.length > 48) {
    return false
  }

  if (/^(?:and|و|or|یا)$/iu.test(value)) {
    return false
  }

  if (/^\d+$/u.test(value)) {
    return false
  }

  return true
}

function extractFiscalYears(text: string): string[] {
  const years: string[] = []

  RUNTIME_SCOPE_YEAR_RANGE_PATTERN.lastIndex = 0
  for (const rangeMatch of text.matchAll(RUNTIME_SCOPE_YEAR_RANGE_PATTERN)) {
    const startYear = Number.parseInt(rangeMatch[1] ?? '', 10)
    const endYear = Number.parseInt(rangeMatch[2] ?? '', 10)

    if (Number.isNaN(startYear) || Number.isNaN(endYear)) {
      continue
    }

    const delta = endYear - startYear
    if (delta >= 0 && delta <= 5) {
      for (let year = startYear; year <= endYear; year += 1) {
        years.push(String(year))
      }
    } else {
      years.push(String(startYear), String(endYear))
    }
  }

  RUNTIME_SCOPE_YEAR_CONTEXT_PATTERN.lastIndex = 0
  for (const contextMatch of text.matchAll(RUNTIME_SCOPE_YEAR_CONTEXT_PATTERN)) {
    const segment = contextMatch[1] ?? ''
    const segmentYears = segment.match(RUNTIME_SCOPE_YEAR_CAPTURE_PATTERN) ?? []
    years.push(...segmentYears)
  }

  return uniqueScopeValues(years)
}

export function mergeScopeValues(currentValues: string[], incomingValues: string[]): string[] {
  return uniqueScopeValues([...currentValues, ...incomingValues]).slice(
    0,
    MAX_SCOPE_VALUES_PER_DIMENSION
  )
}

function uniqueScopeValues(values: string[]): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const normalized = value.replace(/\s+/g, ' ').trim()

    if (!normalized) {
      continue
    }

    const key = normalized.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(normalized)
  }

  return deduped
}
