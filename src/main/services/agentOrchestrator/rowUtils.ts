/**
 * Row redaction, limiting, and evidence preview utilities extracted
 * from `agentOrchestrator.ts` (FRE Roadmap F2.6).
 */
import type { AgentEvidencePreview, SqlQueryRow } from '../../../shared/contracts'

export type RedactedRowsResult = {
  rows: SqlQueryRow[]
  redactedCells: number
}

export type LimitedRowsForModelResult = {
  rows: SqlQueryRow[]
  payloadTruncated: boolean
  valueTruncatedCells: number
}

const SENSITIVE_IDENTIFIER_FIELD_TOKENS = [
  'nationalid',
  'nationalcode',
  'melicode',
  'mobile',
  'mobileno',
  'phonenumber',
  'phone',
  'telephone',
  'tel',
  'cellphone',
  'cell',
  'accountnumber',
  'accountno',
  'bankaccountnumber',
  'cardnumber',
  'bankcardnumber',
  'iban',
  'sheba'
]

const SENSITIVE_IDENTIFIER_FIELD_TOKENS_FA = [
  'کدملی',
  'شمارهملی',
  'موبایل',
  'شمارهموبایل',
  'تلفن',
  'شمارهتلفن',
  'شمارهحساب',
  'حساببانکی',
  'شمارهکارت',
  'شبا',
  'شمارهشبا'
]

export function isSensitiveIdentifierField(columnName: string): boolean {
  const normalized = columnName.toLowerCase().replace(/[\s_.-]/g, '')

  if (SENSITIVE_IDENTIFIER_FIELD_TOKENS.some((token) => normalized.includes(token))) {
    return true
  }

  const normalizedFa = columnName.replace(/[\s_.-]/g, '')
  return SENSITIVE_IDENTIFIER_FIELD_TOKENS_FA.some((token) => normalizedFa.includes(token))
}

export function redactSensitiveIdentifiers(rows: SqlQueryRow[]): RedactedRowsResult {
  let redactedCells = 0

  const sanitizedRows = rows.map((row) => {
    const sanitizedRow: SqlQueryRow = {}

    for (const [columnName, value] of Object.entries(row)) {
      if (
        isSensitiveIdentifierField(columnName) &&
        value !== null &&
        value !== undefined &&
        `${value}`.trim()
      ) {
        sanitizedRow[columnName] = '[REDACTED]'
        redactedCells += 1
        continue
      }

      sanitizedRow[columnName] = value
    }

    return sanitizedRow
  })

  return {
    rows: sanitizedRows,
    redactedCells
  }
}

export function limitRowsForModel(
  rows: SqlQueryRow[],
  maxToolPayloadChars: number,
  maxToolValueChars: number
): LimitedRowsForModelResult {
  const limitedRows: SqlQueryRow[] = []
  let payloadSize = 2
  let payloadTruncated = false
  let valueTruncatedCells = 0

  for (const row of rows) {
    const normalizedRow: SqlQueryRow = {}

    for (const [columnName, value] of Object.entries(row)) {
      if (typeof value === 'string' && value.length > maxToolValueChars) {
        normalizedRow[columnName] = `${value.slice(0, maxToolValueChars - 1)}…`
        valueTruncatedCells += 1
        continue
      }

      normalizedRow[columnName] = value
    }

    const serializedRow = JSON.stringify(normalizedRow)
    const projectedPayloadSize =
      payloadSize + (limitedRows.length > 0 ? 1 : 0) + serializedRow.length

    if (projectedPayloadSize > maxToolPayloadChars) {
      payloadTruncated = true
      break
    }

    limitedRows.push(normalizedRow)
    payloadSize = projectedPayloadSize
  }

  return {
    rows: limitedRows,
    payloadTruncated,
    valueTruncatedCells
  }
}

export function rowsContainNonNullValue(rows: SqlQueryRow[]): boolean {
  return rows.some((row) =>
    Object.values(row).some((value) => value !== null && value !== undefined && value !== '')
  )
}

export function normalizeEvidenceCellValue(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 180) {
    return `${value.slice(0, 179)}…`
  }

  return value
}

export interface EvidencePreviewDeps {
  compactText: (value: string, maxLength: number) => string
}

export function createEvidencePreview(
  deps: EvidencePreviewDeps,
  sqlQuery: string,
  rows: SqlQueryRow[],
  rowCount: number,
  truncated: boolean
): AgentEvidencePreview {
  const columnNames = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 10)
  const previewRows = rows.slice(0, 10).map((row) => {
    const previewRow: SqlQueryRow = {}

    for (const columnName of columnNames) {
      const value = row[columnName]
      previewRow[columnName] = normalizeEvidenceCellValue(value)
    }

    return previewRow
  })

  return {
    queryPreview: deps.compactText(sqlQuery.replace(/\s+/g, ' '), 260),
    columns: columnNames,
    rows: previewRows,
    rowCount,
    truncated
  }
}

export { SENSITIVE_IDENTIFIER_FIELD_TOKENS, SENSITIVE_IDENTIFIER_FIELD_TOKENS_FA }
