/**
 * Prompt and context builder helpers extracted from `agentOrchestrator.ts`
 * (FRE Roadmap F2.6). Behaviour-preserving — the orchestrator delegates
 * to these free functions via a {@link PromptBuilderDeps} context.
 */
import type {
  AccountingConceptKey,
  AppSettings,
  GeminiMessage,
  SchemaCatalogEntry
} from '../../../shared/contracts'
import { SYSTEM_PROMPT } from './prompts'
import type {
  ConversationMemorySnapshot,
  ConversationMemoryState,
  ExtractedConversationFacts
} from './conversationMemory'

export type PreferredMapping = {
  tableRef: string
  source: 'selected' | 'suggested'
}

export interface PromptBuilderDeps {
  compactText: (value: string, maxLength: number) => string
  pushConversationMemoryNote: (memory: ConversationMemoryState, note: string) => void
  findActiveSchemaCatalog: (settings: AppSettings) => SchemaCatalogEntry | null
  detectPromptConcepts: (prompt: string) => AccountingConceptKey[]
  resolvePreferredMapping: (
    activeCatalog: SchemaCatalogEntry,
    conceptKey: AccountingConceptKey,
    prompt?: string
  ) => PreferredMapping | null
  inferDateHintForTable: (
    activeCatalog: SchemaCatalogEntry,
    tableRef: string
  ) => string | null
  extractConversationFacts: (text: string) => ExtractedConversationFacts
  buildSchemaCatalogContext: (settings: AppSettings) => string | null
  schemaContextConceptLabels: Record<AccountingConceptKey, string>
}

const MAX_CHAT_HISTORY = 28
const MAX_HISTORY_SUMMARY_USERS = 6
const MAX_HISTORY_SUMMARY_ASSISTANT = 4

const REFINEMENT_INTENT_PATTERNS: RegExp[] = [
  /^(نه|نخیر|اصلاح|دقیقا|منظورم|همین|همان|فقط|با این تفاوت)/iu,
  /\b(قبلی|مثل قبل|همون قبلی|همان قبلی)\b/iu,
  /\b(instead|same as before|previous|correction|adjust)\b/i
]

export function compactHistory(
  deps: PromptBuilderDeps,
  history: GeminiMessage[],
  memory?: ConversationMemoryState
): GeminiMessage[] {
  const clean = history.filter((message) => message.role !== 'system')

  if (clean.length <= MAX_CHAT_HISTORY) {
    return clean
  }

  const tailCount = MAX_CHAT_HISTORY - 1
  const tail = clean.slice(-tailCount)
  const head = clean.slice(0, clean.length - tailCount)
  const summary = buildHistorySummary(deps, head)

  if (memory) {
    deps.pushConversationMemoryNote(
      memory,
      `Trimmed history summary: ${deps.compactText(summary.replace(/\s+/g, ' '), 220)}`
    )
  }

  return [
    {
      role: 'assistant',
      content: summary
    },
    ...tail
  ]
}

export function buildHistorySummary(
  deps: PromptBuilderDeps,
  messages: GeminiMessage[]
): string {
  if (messages.length === 0) {
    return 'Conversation summary: earlier context was trimmed.'
  }

  const userMessages = messages
    .filter((message) => message.role === 'user')
    .slice(-MAX_HISTORY_SUMMARY_USERS)
    .map((message) => deps.compactText(message.content, 160))

  const assistantMessages = messages
    .filter((message) => message.role === 'assistant' && !message.toolCalls)
    .slice(-MAX_HISTORY_SUMMARY_ASSISTANT)
    .map((message) => deps.compactText(message.content, 160))

  const lines = ['Conversation summary from earlier turns:']

  for (const userMessage of userMessages) {
    lines.push(`- User request: ${userMessage}`)
  }

  for (const assistantMessage of assistantMessages) {
    lines.push(`- Assistant insight: ${assistantMessage}`)
  }

  lines.push('Use this summary with the recent messages to continue accurately.')

  return lines.join('\n')
}

export function buildRuntimeSystemPrompt(
  deps: PromptBuilderDeps,
  settings: AppSettings,
  prompt: string,
  conversationMemory: ConversationMemoryState,
  previousMemorySnapshot: ConversationMemorySnapshot
): string {
  const schemaContext = deps.buildSchemaCatalogContext(settings)
  const isRefinementPrompt = isLikelyRefinementPrompt(previousMemorySnapshot, prompt)
  const historyWindowContext = buildHistoryWindowContext(isRefinementPrompt)
  const memoryContext = buildConversationMemoryContext(
    conversationMemory,
    isRefinementPrompt
  )
  const refinementContext = isRefinementPrompt
    ? buildRefinementContext(deps, previousMemorySnapshot, prompt)
    : null
  const freshContext = buildFreshConversationContext(previousMemorySnapshot, prompt)
  const intentContext = buildPromptIntentContext(deps, settings, prompt)

  const segments = [SYSTEM_PROMPT]

  if (schemaContext) {
    segments.push(schemaContext)
  }

  if (historyWindowContext) {
    segments.push(historyWindowContext)
  }

  if (memoryContext) {
    segments.push(memoryContext)
  }

  if (refinementContext) {
    segments.push(refinementContext)
  } else if (freshContext) {
    segments.push(freshContext)
  }

  if (intentContext) {
    segments.push(intentContext)
  }

  return segments.join('\n\n')
}

export function buildHistoryWindowContext(isRefinementPrompt: boolean): string {
  const modeLabel = isRefinementPrompt ? 'refinement' : 'fresh'

  return [
    'Effective history window:',
    `- Current mode: ${modeLabel}.`,
    '- Keep the latest 6 user turns and 4 assistant turns in the active working context.',
    '- Summarize earlier turns into compact context, and do not let stale prior-memory assumptions override a fresh prompt unless the user explicitly asks to continue.'
  ].join('\n')
}

export function buildConversationMemoryContext(
  memory: ConversationMemoryState,
  usePersistentHeader = true
): string | null {
  const mappingEntries = Object.entries(memory.facts.confirmedMappings)
    .filter(([, tableRef]) => typeof tableRef === 'string' && tableRef.trim())
    .slice(0, 6)
    .map(([conceptKey, tableRef]) => `${conceptKey}=${tableRef}`)

  const lines: string[] = []

  if (memory.facts.companyNames.length > 0) {
    lines.push(`- Company scope: ${memory.facts.companyNames.join(' | ')}`)
  }

  if (memory.facts.fiscalYears.length > 0) {
    lines.push(`- Fiscal year scope: ${memory.facts.fiscalYears.join(' | ')}`)
  }

  if (memory.facts.branchNames.length > 0) {
    lines.push(`- Branch scope: ${memory.facts.branchNames.join(' | ')}`)
  }

  if (
    memory.facts.companyNames.length > 1 ||
    memory.facts.fiscalYears.length > 1 ||
    memory.facts.branchNames.length > 1
  ) {
    lines.push(
      '- Multi-scope runtime policy: keep all scope values in SQL filters (prefer IN clauses) and label output rows by company/fiscal year/branch when available.'
    )
  }

  if (memory.facts.dateRange) {
    lines.push(`- Date range focus: ${memory.facts.dateRange}`)
  }

  if (mappingEntries.length > 0) {
    lines.push(`- Confirmed mappings: ${mappingEntries.join(' | ')}`)
  }

  if (memory.lastUserPrompt) {
    lines.push(`- Last user prompt: ${memory.lastUserPrompt}`)
  }

  if (memory.lastAssistantOutcome) {
    lines.push(`- Last assistant outcome: ${memory.lastAssistantOutcome}`)
  }

  if (memory.lastToolTrace.length > 0) {
    lines.push(`- Recent tool traces: ${memory.lastToolTrace.slice(-3).join(' || ')}`)
  }

  const memoryNotes = memory.notes.slice(-4)
  for (const note of memoryNotes) {
    lines.push(`- ${note}`)
  }

  if (lines.length === 0) {
    return null
  }

  if (!usePersistentHeader) {
    return lines.join('\n')
  }

  return ['Persistent conversation memory (survives trimmed history):', ...lines].join('\n')
}

export function buildFreshConversationContext(
  previousMemory: ConversationMemorySnapshot,
  prompt: string
): string | null {
  if (isLikelyRefinementPrompt(previousMemory, prompt)) {
    return null
  }

  const hasPriorContext = Boolean(
    previousMemory.lastUserPrompt || previousMemory.lastAssistantOutcome
  )

  if (!hasPriorContext) {
    return [
      'Fresh conversation mode is active:',
      '- Treat this prompt as a new analysis request unless the user explicitly says to reuse the previous answer.',
      '- Use only the current question, current schema catalog, and current tool outputs for planning.',
      '- Do not assume prior turn facts or KPI choices are still valid.'
    ].join('\n')
  }

  return [
    'Fresh conversation mode is active:',
    '- The current prompt is not a refinement request, so reset the working assumption set before planning.',
    '- Re-derive KPI intent and scope from the current question only.',
    '- Keep prior memory as fallback context only when the user explicitly references it.'
  ].join('\n')
}

export function buildRefinementContext(
  deps: PromptBuilderDeps,
  previousMemory: ConversationMemorySnapshot,
  prompt: string
): string | null {
  if (!isLikelyRefinementPrompt(previousMemory, prompt)) {
    return null
  }

  const extractedFacts = deps.extractConversationFacts(prompt)
  const lines = [
    'Multi-turn refinement mode is active:',
    '- Treat this prompt as an incremental correction to the previous answer, not a brand-new analysis.',
    '- Preserve prior assumptions/tables unless user explicitly changes them.'
  ]

  if (previousMemory.lastUserPrompt) {
    lines.push(`- Previous user prompt: ${previousMemory.lastUserPrompt}`)
  }

  if (previousMemory.lastAssistantOutcome) {
    lines.push(`- Previous assistant outcome: ${previousMemory.lastAssistantOutcome}`)
  }

  if (previousMemory.lastToolTrace.length > 0) {
    lines.push(`- Previous tool traces: ${previousMemory.lastToolTrace.slice(-3).join(' || ')}`)
  }

  const overrides: string[] = []

  if (extractedFacts.companyNames.length > 0) {
    overrides.push(`companies=${extractedFacts.companyNames.join(',')}`)
  }

  if (extractedFacts.fiscalYears.length > 0) {
    overrides.push(`fiscal_years=${extractedFacts.fiscalYears.join(',')}`)
  }

  if (extractedFacts.branchNames.length > 0) {
    overrides.push(`branches=${extractedFacts.branchNames.join(',')}`)
  }

  if (extractedFacts.dateRange) {
    overrides.push(`date_range=${extractedFacts.dateRange}`)
  }

  if (overrides.length > 0) {
    lines.push(`- Explicit user overrides in this turn: ${overrides.join(' | ')}`)
  }

  return lines.join('\n')
}

export function isLikelyRefinementPrompt(
  previousMemory: ConversationMemorySnapshot,
  prompt: string
): boolean {
  const normalizedPrompt = prompt.replace(/\s+/g, ' ').trim()

  if (!normalizedPrompt) {
    return false
  }

  const hasPriorContext = Boolean(
    previousMemory.lastUserPrompt || previousMemory.lastAssistantOutcome
  )
  if (!hasPriorContext) {
    return false
  }

  if (REFINEMENT_INTENT_PATTERNS.some((pattern) => pattern.test(normalizedPrompt))) {
    return true
  }

  if (
    normalizedPrompt.length <= 90 &&
    /^(برای|فقط|با|بدون|روی|نه|این|آن|همین|همان|and|only|for)\b/iu.test(normalizedPrompt)
  ) {
    return true
  }

  return false
}

export function buildPromptIntentContext(
  deps: PromptBuilderDeps,
  settings: AppSettings,
  prompt: string
): string | null {
  const activeCatalog = deps.findActiveSchemaCatalog(settings)
  if (!activeCatalog) {
    return null
  }

  const detectedConcepts = deps.detectPromptConcepts(prompt)
  if (detectedConcepts.length === 0) {
    return null
  }

  const lines = [
    'Prompt intent context derived from Persian/English finance synonyms:',
    `- Detected concepts: ${detectedConcepts.map((concept) => deps.schemaContextConceptLabels[concept]).join(', ')}`,
    '- Tool planning policy for this request:',
    '  - Prefer mapped tables for detected concepts.',
    '  - Call get_database_schema on mapped tables first before writing final SELECT when possible.',
    '  - Use list_database_tables only if mapped tables are missing or do not contain required fields.',
    '- Concept-to-table runtime hints:'
  ]

  let hasPreferredMapping = false

  for (const conceptKey of detectedConcepts) {
    const preferredMapping = deps.resolvePreferredMapping(activeCatalog, conceptKey, prompt)

    if (!preferredMapping) {
      lines.push(`  - ${deps.schemaContextConceptLabels[conceptKey]}: no mapped table available.`)
      continue
    }

    hasPreferredMapping = true
    const dateHint = deps.inferDateHintForTable(activeCatalog, preferredMapping.tableRef)
    const dateText = dateHint ? `; date_hint=${dateHint}` : ''

    lines.push(
      `  - ${deps.schemaContextConceptLabels[conceptKey]}: ${preferredMapping.tableRef} (source=${preferredMapping.source}${dateText})`
    )
  }

  if (!hasPreferredMapping) {
    lines.push(
      '  - No preferred mappings for detected concepts; proceed with standard discovery flow.'
    )
  }

  return lines.join('\n')
}
