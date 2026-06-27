/**
 * Evidence validation, numeric claim checking, and financial response template
 * methods extracted from `agentOrchestrator.ts` (FRE Roadmap F2.6).
 */
import type { ConversationMemoryState } from './conversationMemory'
import { evaluateEvidence, type ExecutionTrace } from '../evidenceContract'
import { appearsToContainFinancialClaim } from './routing'
import type { DeterministicFinancialIntent } from './intentRouting'
import type { FinancialTemplateSections } from './responseContract'

export interface EvidenceValidationDeps {
  normalizePersianDigits: (value: string) => string
  compactText: (value: string, maxLength: number) => string
  detectDeterministicFinancialIntent: (prompt: string) => DeterministicFinancialIntent | null
}

export function requiresStrictFinancialDataFetch(
  deps: EvidenceValidationDeps,
  prompt: string,
  narrative: string
): boolean {
  const normalizedPrompt = deps.normalizePersianDigits(prompt)
  const normalizedNarrative = deps.normalizePersianDigits(narrative)
  const hasFinancialContext =
    appearsToContainFinancialClaim(normalizedPrompt) ||
    appearsToContainFinancialClaim(normalizedNarrative)

  if (!hasFinancialContext) {
    return false
  }

  const hasQuantOrComparativeSignal =
    /(?:درصد|percent|percentage|رشد|کاهش|افزایش|افت|change|growth|decline|نسبت\s*به|مقایسه|year\s*over\s*year|yoy|total|sum|avg|average|min|max|top|rank|count|تعداد|جمع|مجموع|میانگین|حداقل|حداکثر|بیشترین|کمترین|چه\s*قدر|چقدر|how\s*much)/iu.test(
      normalizedPrompt
    ) || /(?:\b\d[\d,.]*\b|[+-]?\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*درصد)/iu.test(normalizedNarrative)

  return hasQuantOrComparativeSignal
}

export function requiresStrictQuantitativeDataFetch(
  deps: EvidenceValidationDeps,
  prompt: string
): boolean {
  const normalized = deps.normalizePersianDigits(prompt)

  return /(?:درصد|percent|percentage|رشد|کاهش|افزایش|افت|change|growth|decline|نسبت\s*به|مقایسه|year\s*over\s*year|yoy)/iu.test(
    normalized
  )
}

export function hasQuantitativeResultSignal(deps: EvidenceValidationDeps, text: string): boolean {
  const normalized = deps.normalizePersianDigits(text)

  return /(?:[+-]?\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*درصد|درصد\s*[+-]?\d+(?:\.\d+)?)/iu.test(
    normalized
  )
}

export function appearsToBeNoDataResult(deps: EvidenceValidationDeps, text: string): boolean {
  const normalized = deps.normalizePersianDigits(text)

  return /(?:یافت\s*نشد|داده(?:\s*ای)?\s*وجود\s*ندارد|اطلاعات\s*کافی\s*وجود\s*ندارد|نتیجه\s*خالی|رکوردی\s*ثبت\s*نشده|هیچ\s*داده(?:\s*ای)?|no\s*data|insufficient\s*data|no\s+records)/iu.test(
    normalized
  )
}

export function hasRequiredFinancialResponseSections(sections: FinancialTemplateSections): boolean {
  return Boolean(
    sections.summary.trim() &&
    sections.findings.trim() &&
    sections.evidence.trim() &&
    sections.assumptions.trim() &&
    sections.actions.trim()
  )
}

export function hasStructuredEvidence(
  deps: EvidenceValidationDeps,
  evidenceSection: string
): boolean {
  const normalized = deps.normalizePersianDigits(evidenceSection)

  return /(?:query|tool|read-only|table|column|row|runtime\s*scope|catalog_scan|list_database_tables|get_database_schema|fetch_financial_data|کوئری|ابزار|جدول|ستون|ردیف|شواهد|شاهد)/iu.test(
    normalized
  )
}

export function containsUnsupportedNumericClaim(
  deps: EvidenceValidationDeps,
  narrative: string,
  evidence: string,
  sections: FinancialTemplateSections
): boolean {
  const normalizedNarrative = deps.normalizePersianDigits(narrative)
  const normalizedEvidence = deps.normalizePersianDigits(evidence)
  const hasNumericSignal = /(?:[+-]?\d+(?:[.,]\d+)?(?:\s*%|\s*درصد)|\b\d+(?:[.,]\d+)?\b)/u.test(
    normalizedNarrative
  )
  const hasPositiveEvidenceSignal =
    /(?:tool:|read-only\s+query|query\s+executed|query\s+used|scope\s+applied|table\s+name|column\s+name|row\s+count|schema\s+check|via\s+read-only|via\s+query|ابزار\s+اجرایی|کوئری\s+اجرا|کوئری\s+read-only|executed|used)/iu.test(
      normalizedEvidence
    )
  const hasExplicitNoEvidenceSignal =
    /(?:بدون\s+(?:اجرای|استفاده\s+از|شواهد|کوئری|ابزار|داده|تأیید)|without\s+(?:evidence|tool|query|data)|no\s+(?:evidence|tool|query|data|financial\s+data\s+fetch)|هیچ\s+(?:fetch_financial_data|کوئری|ابزار|داده|شواهد)|not\s+executed|didn['']?t\s+run|not\s+run|حدس|برآورد|model\s+assumption|assumption)/iu.test(
      normalizedEvidence
    )
  const hasExplicitNoData = appearsToBeNoDataResult(deps, normalizedNarrative)
  const hasRequiredSections = hasRequiredFinancialResponseSections(sections)

  return Boolean(
    hasNumericSignal &&
    !hasPositiveEvidenceSignal &&
    (hasExplicitNoEvidenceSignal || !normalizedEvidence.trim()) &&
    !hasExplicitNoData &&
    hasRequiredSections
  )
}

export function containsFinancialMarkedNumericClaim(
  deps: EvidenceValidationDeps,
  narrative: string
): boolean {
  const normalized = deps.normalizePersianDigits(narrative)

  if (/[+-]?\d+(?:[.,]\d+)?\s*(?:%|درصد)/iu.test(normalized)) {
    return true
  }

  if (/\d[\d,]*\s*(?:تومان|ریال|IRR|USD|EUR|\$)/iu.test(normalized)) {
    return true
  }

  const financialNoun = '(?:مبلغ|موجودی|مانده|جمع|مجموع|سهم|نسبت|amount|balance|total)'
  const adjacencyPattern = new RegExp(
    `(?:${financialNoun}[^\\n]{0,40}?\\d[\\d,]*(?:[.,]\\d+)?|\\d[\\d,]*(?:[.,]\\d+)?[^\\n]{0,40}?${financialNoun})`,
    'iu'
  )
  return adjacencyPattern.test(normalized)
}

export function extractNumericClaims(deps: EvidenceValidationDeps, text: string): string[] {
  const normalized = deps.normalizePersianDigits(text)
  const matches =
    normalized.match(/(?:[+-]?\d+(?:[.,]\d+)?(?:\s*%|\s*درصد)|\b\d+(?:[.,]\d+)?\b)/gu) ?? []

  return matches.map((value) => value.trim())
}

export function traceSupportsNumericClaim(trace: ExecutionTrace | undefined): boolean {
  if (!trace) {
    return false
  }

  const verdict = evaluateEvidence(trace)
  return verdict.kind === 'POSITIVE_DATA'
}

export function enforcePromptIntentAlignment(
  _deps: EvidenceValidationDeps,
  _prompt: string,
  finalText: string
): string {
  // LEGACY_REMOVED: deterministic intent alignment removed (Phase 9). FRE engine handles response validation.
  return finalText
}

export function mapFinancialSectionHeading(
  heading: string
): 'summary' | 'findings' | 'evidence' | 'assumptions' | 'actions' | null {
  const normalized = heading.toLowerCase().replace(/[:：]/g, '').trim()

  if (/^(summary|خلاصه|جمع\s*بندی)$/iu.test(normalized)) {
    return 'summary'
  }

  if (/^(findings?|یافته\s*ها|یافته‌ها|نتایج)$/iu.test(normalized)) {
    return 'findings'
  }

  if (/^(evidence|evidences|شواهد|مدارک)$/iu.test(normalized)) {
    return 'evidence'
  }

  if (/^(assumptions?|فرض\s*ها|فرضیات)$/iu.test(normalized)) {
    return 'assumptions'
  }

  if (/^(actions?|اقدامات|پیشنهادها|گام\s*های\s*بعدی|گامهای\s*بعدی)$/iu.test(normalized)) {
    return 'actions'
  }

  return null
}

export function parseFinancialTemplateSections(text: string): FinancialTemplateSections {
  const sections: FinancialTemplateSections = {
    summary: '',
    findings: '',
    evidence: '',
    assumptions: '',
    actions: '',
    freeform: ''
  }

  if (!text) {
    return sections
  }

  let activeSection: keyof FinancialTemplateSections = 'freeform'

  for (const rawLine of text.split('\n')) {
    const headingMatch = rawLine.trim().match(/^#{1,4}\s*(.+?)\s*$/u)

    if (headingMatch) {
      const mappedSection = mapFinancialSectionHeading(headingMatch[1] ?? '')

      if (mappedSection) {
        activeSection = mappedSection
        continue
      }

      activeSection = 'freeform'
    }

    const previous = sections[activeSection]
    sections[activeSection] = previous ? `${previous}\n${rawLine}` : rawLine
  }

  return {
    summary: sections.summary.trim(),
    findings: sections.findings.trim(),
    evidence: sections.evidence.trim(),
    assumptions: sections.assumptions.trim(),
    actions: sections.actions.trim(),
    freeform: sections.freeform.trim()
  }
}

export function buildFinancialEvidenceFallback(
  conversationMemory: ConversationMemoryState,
  totalToolCallCount: number
): string {
  const lines: string[] = []

  if (conversationMemory.lastToolTrace.length > 0) {
    for (const trace of conversationMemory.lastToolTrace.slice(-3)) {
      lines.push(`- ${trace}`)
    }
  }

  const scopeParts: string[] = []
  if (conversationMemory.facts.companyNames.length > 0) {
    scopeParts.push(`company=${conversationMemory.facts.companyNames.join('|')}`)
  }
  if (conversationMemory.facts.fiscalYears.length > 0) {
    scopeParts.push(`fiscal_year=${conversationMemory.facts.fiscalYears.join('|')}`)
  }
  if (conversationMemory.facts.branchNames.length > 0) {
    scopeParts.push(`branch=${conversationMemory.facts.branchNames.join('|')}`)
  }

  if (scopeParts.length > 0) {
    lines.push(`- Runtime scope: ${scopeParts.join(' ; ')}`)
  }

  if (totalToolCallCount === 0) {
    lines.push('- ابزار مالی اجرا نشد؛ پاسخ باید با احتیاط بازبینی شود.')
  }

  if (lines.length === 0) {
    lines.push('- شواهد ابزاری در این مرحله ثبت نشده است.')
  }

  return lines.join('\n')
}

export function ensureFinancialResponseTemplate(
  deps: EvidenceValidationDeps,
  rawText: string,
  conversationMemory: ConversationMemoryState,
  totalToolCallCount: number
): string {
  const normalizedText = rawText.replace(/\r\n?/g, '\n').trim()
  const sections = parseFinancialTemplateSections(normalizedText)
  const hasAllSections =
    sections.summary.length > 0 &&
    sections.findings.length > 0 &&
    sections.evidence.length > 0 &&
    sections.assumptions.length > 0 &&
    sections.actions.length > 0

  if (hasAllSections) {
    return normalizedText
  }

  const summarySource = sections.summary || sections.freeform || normalizedText
  const summaryText = summarySource.trim()
    ? deps.compactText(
        summarySource
          .replace(/[`*_>#]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
        420
      )
    : 'پاسخ مدل خالی بود.'

  const findingsText =
    sections.findings ||
    (totalToolCallCount > 0
      ? '- تحلیل بر پایه داده واقعی ابزارها انجام شد.'
      : '- این پاسخ بدون اجرای ابزار مالی تولید شده است و باید با احتیاط بازبینی شود.')

  const evidenceText =
    sections.evidence || buildFinancialEvidenceFallback(conversationMemory, totalToolCallCount)
  const assumptionsText =
    sections.assumptions ||
    '- فرض اصلی: پاسخ بر پایه داده و شواهد ابزارهای read-only است و در صورت نبود mapping دقیق، نتیجه قابل اتکا نیست.'

  const actionsText =
    sections.actions ||
    '- در صورت نیاز، بازه زمانی یا scope شرکت/سال مالی/شعبه را دقیق‌تر مشخص کنید تا تحلیل بهینه‌تر شود.'

  return [
    '### Summary',
    summaryText,
    '',
    '### Findings',
    findingsText,
    '',
    '### Evidence',
    evidenceText,
    '',
    '### Assumptions',
    assumptionsText,
    '',
    '### Actions',
    actionsText
  ]
    .join('\n')
    .trim()
}
