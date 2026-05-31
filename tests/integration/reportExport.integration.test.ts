import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as XLSX from 'xlsx'

import { ReportExportService } from '../../src/main/services/reportExportService'
import type { ReportExportRequest } from '../../src/shared/contracts'

test('report export generates enriched excel workbook with evidence index', async () => {
  const payload = createPayload('excel')
  let writtenFilePath = ''
  let writtenBuffer: Buffer | null = null

  const service = new ReportExportService({
    showSaveDialog: async () => ({ canceled: false, filePath: 'C:/reports/monthly-financial-report' }),
    writeFile: async (filePath, outputBuffer) => {
      writtenFilePath = filePath
      writtenBuffer = outputBuffer
    }
  })

  const result = await service.exportReport(null, payload)

  assert.equal(result.format, 'excel')
  assert.equal(result.filePath, 'C:/reports/monthly-financial-report.xlsx')
  assert.equal(result.filePath, writtenFilePath)
  assert.ok(writtenBuffer !== null)
  const workbookBuffer = writtenBuffer as Buffer
  assert.equal(result.bytesWritten, workbookBuffer.byteLength)

  const workbook = XLSX.read(workbookBuffer, { type: 'buffer' })

  assert.ok(workbook.SheetNames.includes('Summary'))
  assert.ok(workbook.SheetNames.includes('EvidenceIndex'))
  assert.ok(workbook.SheetNames.includes('Evidence_1'))
  assert.ok(workbook.SheetNames.includes('Evidence_2'))

  const summarySheet = workbook.Sheets.Summary
  assert.ok(summarySheet)
  assert.equal(summarySheet.A3?.v, 'Title')
  assert.equal(summarySheet.B3?.v, payload.title)
  assert.equal(summarySheet.A6?.v, 'Evidence Blocks')
  assert.equal(summarySheet.B6?.v, payload.evidence.length)
  assert.equal(summarySheet.A10?.v, 'Assistant Response')
  assert.equal(summarySheet.B10?.v, payload.responseMarkdown)

  const evidenceIndexSheet = workbook.Sheets.EvidenceIndex
  assert.ok(evidenceIndexSheet)
  assert.equal(evidenceIndexSheet.A1?.v, '#')
  assert.equal(evidenceIndexSheet.B1?.v, 'Tool')
  assert.equal(evidenceIndexSheet.B2?.v, payload.evidence[0]?.toolName)
  assert.equal(evidenceIndexSheet.C3?.v, payload.evidence[1]?.rowCount)
  assert.equal(evidenceIndexSheet.F3?.v, payload.evidence[1]?.queryPreview)

  const evidenceSheetOne = workbook.Sheets.Evidence_1
  assert.ok(evidenceSheetOne)
  assert.equal(evidenceSheetOne.A7?.v, '#')
  assert.equal(evidenceSheetOne.B7?.v, 'doc_no')
  assert.equal(evidenceSheetOne.C7?.v, 'amount')
  assert.equal(evidenceSheetOne.A8?.v, 1)
  assert.equal(evidenceSheetOne.B8?.v, 'DOC-1403-0001')
  assert.equal(evidenceSheetOne.C8?.v, 1200000)

  const evidenceSheetTwo = workbook.Sheets.Evidence_2
  assert.ok(evidenceSheetTwo)
  assert.equal(evidenceSheetTwo.D8?.v, true)
})

test('report export writes pdf bytes using injected pdf builder', async () => {
  const payload = createPayload('pdf')
  const expectedPdfBuffer = Buffer.from('%PDF-1.4 test bytes%', 'utf-8')
  let createPdfBufferCalls = 0
  let writeFileCalls = 0

  const service = new ReportExportService({
    showSaveDialog: async () => ({ canceled: false, filePath: 'C:/reports/monthly-financial-report' }),
    createPdfBuffer: async (request) => {
      createPdfBufferCalls += 1
      assert.equal(request.format, 'pdf')
      assert.equal(request.title, payload.title)
      return expectedPdfBuffer
    },
    writeFile: async (filePath, outputBuffer) => {
      writeFileCalls += 1
      assert.equal(filePath, 'C:/reports/monthly-financial-report.pdf')
      assert.equal(outputBuffer, expectedPdfBuffer)
    }
  })

  const result = await service.exportReport(null, payload)

  assert.equal(createPdfBufferCalls, 1)
  assert.equal(writeFileCalls, 1)
  assert.equal(result.format, 'pdf')
  assert.equal(result.filePath, 'C:/reports/monthly-financial-report.pdf')
  assert.equal(result.bytesWritten, expectedPdfBuffer.byteLength)
})

test('report export throws when save dialog is canceled', async () => {
  const payload = createPayload('excel')
  let writeFileCalls = 0

  const service = new ReportExportService({
    showSaveDialog: async () => ({ canceled: true, filePath: '' }),
    writeFile: async () => {
      writeFileCalls += 1
    }
  })

  await assert.rejects(async () => {
    await service.exportReport(null, payload)
  }, /Report export canceled by user\./)

  assert.equal(writeFileCalls, 0)
})

function createPayload(format: 'pdf' | 'excel'): ReportExportRequest {
  return {
    format,
    title: 'Financial Health Snapshot',
    prompt: 'Compare overdue balances and latest cashflow records for branch Tehran.',
    responseMarkdown: [
      '### Summary',
      'Overall receivable pressure has increased by **12%** compared to the previous month.',
      '',
      '### Actions',
      '- Prioritize collection for high-balance overdue customers.',
      '- Validate cashflow source entries before week close.'
    ].join('\n'),
    generatedAt: '2026-06-01T08:15:00.000Z',
    evidence: [
      {
        toolName: 'fetch_financial_data',
        queryPreview: 'SELECT doc_no, amount, currency FROM dbo.ACC_Documents ORDER BY doc_no DESC',
        columns: ['doc_no', 'amount', 'currency'],
        rows: [
          { doc_no: 'DOC-1403-0001', amount: 1200000, currency: 'IRR' },
          { doc_no: 'DOC-1403-0002', amount: 980000, currency: 'IRR' }
        ],
        rowCount: 2,
        truncated: false
      },
      {
        toolName: 'fetch_financial_data',
        queryPreview: 'SELECT customer, balance, is_overdue FROM dbo.ACC_OpenItems',
        columns: ['customer', 'balance', 'is_overdue'],
        rows: [{ customer: 'Arian Trade Co', balance: 350000, is_overdue: true }],
        rowCount: 1,
        truncated: true
      }
    ],
    defaultFileName: 'branch-tehran-financial-health'
  }
}
