import { writeFile } from 'node:fs/promises'

import { BrowserWindow, dialog, type SaveDialogOptions, type SaveDialogReturnValue } from 'electron'
import * as XLSX from 'xlsx'

import type {
  ReportExportEvidenceItem,
  ReportExportFormat,
  ReportExportRequest,
  ReportExportResult
} from '../../shared/contracts'

const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
const MULTISPACE_PATTERN = /\s+/g
const MAX_FILE_NAME_BASE_LENGTH = 80
const MAX_PDF_EVIDENCE_ROWS = 120
const MAX_PDF_COLUMNS = 12

type ExportSaveDialogInvoker = (
  ownerWindow: BrowserWindow | null,
  options: SaveDialogOptions
) => Promise<SaveDialogReturnValue>
type ExportFileWriter = (filePath: string, outputBuffer: Buffer) => Promise<void>
type ExportPdfBufferBuilder = (payload: ReportExportRequest) => Promise<Buffer>

interface ReportExportServiceDeps {
  showSaveDialog: ExportSaveDialogInvoker
  writeFile: ExportFileWriter
  createPdfBuffer: ExportPdfBufferBuilder
}

interface ReportEvidenceStats {
  blocks: number
  totalRows: number
  truncatedBlocks: number
}

export class ReportExportService {
  private readonly showSaveDialogInvoker: ExportSaveDialogInvoker
  private readonly fileWriter: ExportFileWriter
  private readonly pdfBufferBuilder: ExportPdfBufferBuilder

  constructor(deps: Partial<ReportExportServiceDeps> = {}) {
    this.showSaveDialogInvoker =
      deps.showSaveDialog ??
      (async (ownerWindow, options) => {
        return this.showSaveDialog(ownerWindow, options)
      })

    this.fileWriter =
      deps.writeFile ??
      (async (filePath, outputBuffer) => {
        await writeFile(filePath, outputBuffer)
      })

    this.pdfBufferBuilder =
      deps.createPdfBuffer ??
      (async (payload) => {
        return this.buildPdfBuffer(payload)
      })
  }

  async exportReport(
    ownerWindow: BrowserWindow | null,
    payload: ReportExportRequest
  ): Promise<ReportExportResult> {
    const format = this.normalizeFormat(payload.format)
    const saveDialogOptions: SaveDialogOptions = {
      title: format === 'pdf' ? 'Export Financial Report (PDF)' : 'Export Financial Report (Excel)',
      defaultPath: this.buildDefaultFileName(payload.defaultFileName, format),
      filters:
        format === 'pdf'
          ? [{ name: 'PDF file', extensions: ['pdf'] }]
          : [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    }

    const saveTarget = await this.showSaveDialogInvoker(ownerWindow, saveDialogOptions)

    if (saveTarget.canceled || !saveTarget.filePath) {
      throw new Error('Report export canceled by user.')
    }

    const targetFilePath = this.ensureFileExtension(saveTarget.filePath, format)
    const outputBuffer =
      format === 'pdf' ? await this.pdfBufferBuilder(payload) : this.buildExcelBuffer(payload)

    await this.fileWriter(targetFilePath, outputBuffer)

    return {
      filePath: targetFilePath,
      format,
      bytesWritten: outputBuffer.byteLength
    }
  }

  private normalizeFormat(format: ReportExportFormat): ReportExportFormat {
    if (format === 'pdf' || format === 'excel') {
      return format
    }

    throw new Error(`Unsupported report export format: ${String(format)}`)
  }

  private buildDefaultFileName(defaultFileName: string | undefined, format: ReportExportFormat): string {
    const base = this.sanitizeFileNameBase(defaultFileName || 'acc-assist-financial-report')
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    const extension = format === 'pdf' ? 'pdf' : 'xlsx'

    return `${base}-${timestamp}.${extension}`
  }

  private sanitizeFileNameBase(value: string): string {
    const normalized = value
      .replace(INVALID_FILE_NAME_CHARS, ' ')
      .replace(MULTISPACE_PATTERN, ' ')
      .trim()

    if (!normalized) {
      return 'acc-assist-financial-report'
    }

    const withoutExtension = normalized.replace(/\.(pdf|xlsx)$/i, '').trim()
    const clipped = withoutExtension.slice(0, MAX_FILE_NAME_BASE_LENGTH).trim()

    return clipped || 'acc-assist-financial-report'
  }

  private ensureFileExtension(filePath: string, format: ReportExportFormat): string {
    const extension = format === 'pdf' ? '.pdf' : '.xlsx'

    if (filePath.toLowerCase().endsWith(extension)) {
      return filePath
    }

    return `${filePath}${extension}`
  }

  private async showSaveDialog(
    ownerWindow: BrowserWindow | null,
    options: SaveDialogOptions
  ): Promise<SaveDialogReturnValue> {
    if (ownerWindow) {
      return dialog.showSaveDialog(ownerWindow, options)
    }

    return dialog.showSaveDialog(options)
  }

  private async buildPdfBuffer(payload: ReportExportRequest): Promise<Buffer> {
    const reportHtml = this.buildReportHtml(payload)

    const printWindow = new BrowserWindow({
      show: false,
      width: 1240,
      height: 1754,
      webPreferences: {
        sandbox: true,
        javascript: false,
        contextIsolation: true
      }
    })

    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(reportHtml)}`)
      const pdfData = await printWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: {
          top: 0.5,
          bottom: 0.5,
          left: 0.5,
          right: 0.5
        }
      })

      return Buffer.from(pdfData)
    } finally {
      if (!printWindow.isDestroyed()) {
        printWindow.destroy()
      }
    }
  }

  private buildReportHtml(payload: ReportExportRequest): string {
    const stats = this.calculateEvidenceStats(payload.evidence)
    const escapedTitle = this.escapeHtml(payload.title || 'Financial Report')
    const escapedPrompt = this.escapeHtml(payload.prompt || '-')
    const escapedGeneratedAt = this.escapeHtml(this.formatGeneratedAt(payload.generatedAt))
    const responseHtml = this.markdownToPdfHtml(payload.responseMarkdown || '-')
    const escapedStatsRows = this.escapeHtml(this.formatInteger(stats.totalRows))

    const evidenceBlocks = payload.evidence
      .map((item, index) => this.buildEvidenceHtmlBlock(item, index + 1))
      .join('')

    const evidenceContent = evidenceBlocks || '<p class="muted">No evidence rows were available for this report.</p>'

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapedTitle}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #1f2937;
        font-family: "Segoe UI", Tahoma, sans-serif;
        font-size: 12px;
        line-height: 1.55;
        background: #eef3f8;
      }
      .page {
        padding: 24px;
      }
      .card {
        background: #ffffff;
        border: 1px solid #d7e1ec;
        border-radius: 12px;
        box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
        padding: 14px 16px;
        margin-bottom: 14px;
      }
      .header {
        display: grid;
        gap: 8px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 9px;
        border-radius: 999px;
        border: 1px solid #c5d4e4;
        background: #edf5fc;
        color: #35506a;
        font-size: 11px;
        font-weight: 700;
        width: fit-content;
      }
      h1 {
        margin: 0;
        font-size: 21px;
        letter-spacing: 0.01em;
      }
      h2 {
        margin: 0 0 8px;
        font-size: 14px;
        color: #14344f;
      }
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .kpi {
        border: 1px solid #d4e0ec;
        border-radius: 10px;
        padding: 8px;
        background: #f8fbff;
      }
      .kpi-label {
        font-size: 11px;
        color: #51657a;
      }
      .kpi-value {
        font-size: 17px;
        font-weight: 700;
        color: #18344a;
      }
      .prompt {
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
      }
      .markdown-body p {
        margin: 0 0 8px;
      }
      .markdown-body p:last-child {
        margin-bottom: 0;
      }
      .markdown-body h1,
      .markdown-body h2,
      .markdown-body h3 {
        margin: 9px 0 7px;
        line-height: 1.3;
      }
      .markdown-body ul,
      .markdown-body ol {
        margin: 5px 0 8px 18px;
      }
      .markdown-body code {
        background: rgba(55, 85, 115, 0.13);
        border-radius: 4px;
        padding: 1px 4px;
        font-family: "Cascadia Mono", Consolas, monospace;
        font-size: 11px;
      }
      .markdown-body pre {
        margin: 8px 0;
        white-space: pre-wrap;
        word-break: break-word;
        border: 1px solid #d6e0e8;
        border-radius: 8px;
        padding: 10px;
        background: #f6f9fc;
      }
      .markdown-body pre code {
        background: transparent;
        padding: 0;
      }
      .markdown-body blockquote {
        margin: 8px 0;
        padding: 3px 0 3px 10px;
        border-left: 3px solid #9eb5ca;
        color: #3f5368;
      }
      .markdown-body a {
        color: #0d4f7f;
        text-decoration: underline;
      }
      .meta {
        display: grid;
        gap: 6px;
      }
      .meta div {
        border: 1px solid #d9e4ef;
        border-radius: 8px;
        padding: 8px;
        background: #f9fcff;
      }
      .label {
        font-weight: 700;
        color: #345064;
      }
      .evidence-block {
        border: 1px solid #d5e0ec;
        border-radius: 10px;
        margin-bottom: 14px;
        overflow: hidden;
        background: #ffffff;
      }
      .evidence-head {
        padding: 8px 10px;
        background: #edf4fb;
        border-bottom: 1px solid #d3deea;
      }
      table {
        border-collapse: collapse;
        width: 100%;
        table-layout: fixed;
      }
      th, td {
        border: 1px solid #d9e2ea;
        padding: 6px;
        text-align: left;
        vertical-align: top;
        word-break: break-word;
      }
      th {
        background: #eff5fb;
        color: #2d4a60;
      }
      tbody tr:nth-child(even) td {
        background: #fbfdff;
      }
      .small {
        font-size: 11px;
        color: #45627a;
      }
      .muted {
        color: #5f7384;
      }
      .footer {
        text-align: right;
        margin-top: 10px;
        color: #647487;
        font-size: 10px;
      }
    </style>
  </head>
  <body>
    <div class="page">
      <section class="card header">
        <span class="badge">ACC Assist Report Export</span>
        <h1>${escapedTitle}</h1>
        <div class="meta">
          <div><span class="label">Generated At:</span> ${escapedGeneratedAt}</div>
        </div>
      </section>

      <section class="card">
        <div class="kpi-grid">
          <div class="kpi">
            <div class="kpi-label">Evidence Blocks</div>
            <div class="kpi-value">${stats.blocks}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Evidence Rows</div>
            <div class="kpi-value">${escapedStatsRows}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Truncated Blocks</div>
            <div class="kpi-value">${stats.truncatedBlocks}</div>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Prompt</h2>
        <p class="prompt">${escapedPrompt}</p>
      </section>

      <section class="card">
        <h2>Assistant Response</h2>
        <div class="markdown-body">${responseHtml}</div>
      </section>

      <section class="card">
        <h2>Evidence</h2>
        ${evidenceContent}
      </section>

      <div class="footer">Generated by ACC Assist</div>
    </div>
  </body>
</html>`
  }

  private buildEvidenceHtmlBlock(item: ReportExportEvidenceItem, index: number): string {
    const boundedColumns = item.columns.slice(0, MAX_PDF_COLUMNS)
    const boundedRows = item.rows.slice(0, MAX_PDF_EVIDENCE_ROWS)
    const wasTrimmedInPdf = item.columns.length > boundedColumns.length || item.rows.length > boundedRows.length

    const head = `<div class="evidence-head"><strong>Evidence ${index}:</strong> ${this.escapeHtml(item.toolName)} <span class="small">(rows=${item.rowCount}, truncated=${item.truncated ? 'yes' : 'no'})</span></div>`
    const queryHtml = item.queryPreview
      ? `<div class="small" style="padding:8px 10px; border-bottom:1px solid #d6e0e8;"><span class="label">Query:</span> ${this.escapeHtml(item.queryPreview)}</div>`
      : ''
    const trimHtml = wasTrimmedInPdf
      ? `<div class="small" style="padding:6px 10px; border-bottom:1px solid #d6e0e8;">PDF preview trimmed to ${boundedRows.length} rows and ${boundedColumns.length} columns.</div>`
      : ''

    if (boundedColumns.length === 0 || boundedRows.length === 0) {
      return `<section class="evidence-block">${head}${queryHtml}${trimHtml}<div style="padding:10px;" class="muted">No evidence rows available.</div></section>`
    }

    const headerCells = ['<th>#</th>', ...boundedColumns.map((column) => `<th>${this.escapeHtml(column)}</th>`)].join('')
    const bodyRows = boundedRows
      .map((row, rowIndex) => {
        const cells = [
          `<td>${rowIndex + 1}</td>`,
          ...boundedColumns.map((column) => `<td>${this.escapeHtml(this.toPdfCellText(row[column]))}</td>`)
        ].join('')

        return `<tr>${cells}</tr>`
      })
      .join('')

    return `<section class="evidence-block">${head}${queryHtml}${trimHtml}<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></section>`
  }

  private buildExcelBuffer(payload: ReportExportRequest): Buffer {
    const workbook = XLSX.utils.book_new()
    const stats = this.calculateEvidenceStats(payload.evidence)
    const safeGeneratedAt = this.toSafeDate(payload.generatedAt)

    workbook.Props = {
      Title: payload.title || 'ACC Assist Financial Report',
      Subject: 'Financial report export',
      Author: 'ACC Assist',
      CreatedDate: safeGeneratedAt
    }

    const summaryRows: unknown[][] = [
      ['ACC Assist Financial Report', ''],
      [],
      ['Title', payload.title || '-'],
      ['Generated At', this.formatGeneratedAt(payload.generatedAt)],
      ['Prompt', payload.prompt || '-'],
      ['Evidence Blocks', stats.blocks],
      ['Evidence Rows', stats.totalRows],
      ['Truncated Evidence Blocks', stats.truncatedBlocks],
      [],
      ['Assistant Response', payload.responseMarkdown || '-']
    ]

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows)
    summarySheet['!cols'] = [{ wch: 26 }, { wch: 120 }]
    summarySheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

    const evidenceIndexRows: unknown[][] = [['#', 'Tool', 'Rows', 'Truncated', 'Columns', 'Query Preview']]

    payload.evidence.forEach((item, index) => {
      evidenceIndexRows.push([
        index + 1,
        item.toolName,
        item.rowCount,
        item.truncated ? 'yes' : 'no',
        item.columns.join(', '),
        item.queryPreview || '-'
      ])
    })

    if (payload.evidence.length === 0) {
      evidenceIndexRows.push(['-', 'No evidence blocks were exported.', 0, 'no', '-', '-'])
    }

    const evidenceIndexSheet = XLSX.utils.aoa_to_sheet(evidenceIndexRows)
    evidenceIndexSheet['!cols'] = [
      { wch: 6 },
      { wch: 28 },
      { wch: 10 },
      { wch: 14 },
      { wch: 50 },
      { wch: 92 }
    ]
    evidenceIndexSheet['!autofilter'] = {
      ref: `A1:${XLSX.utils.encode_cell({ r: evidenceIndexRows.length - 1, c: evidenceIndexRows[0].length - 1 })}`
    }
    XLSX.utils.book_append_sheet(workbook, evidenceIndexSheet, 'EvidenceIndex')

    if (payload.evidence.length === 0) {
      const noEvidenceSheet = XLSX.utils.aoa_to_sheet([['No evidence rows were available for this report.']])
      noEvidenceSheet['!cols'] = [{ wch: 60 }]
      XLSX.utils.book_append_sheet(workbook, noEvidenceSheet, 'Evidence')
    } else {
      payload.evidence.forEach((item, index) => {
        const sheetName = this.toExcelSheetName(`Evidence_${index + 1}`)
        const sheetRows: unknown[][] = [
          ['Tool', item.toolName],
          ['Query', item.queryPreview || '-'],
          ['Generated At', this.formatGeneratedAt(payload.generatedAt)],
          ['Row Count', item.rowCount],
          ['Truncated', item.truncated ? 'yes' : 'no'],
          []
        ]

        let tableHeaderRowIndex: number | null = null
        let tableColumnCount = 0

        if (item.columns.length === 0 || item.rows.length === 0) {
          sheetRows.push(['No evidence rows available.'])
        } else {
          const tableHeader = ['#', ...item.columns]
          const tableRows = item.rows.map((row, rowIndex) => {
            return [
              rowIndex + 1,
              ...item.columns.map((column) => this.toExcelCellValue(row[column]))
            ]
          })

          tableHeaderRowIndex = sheetRows.length
          tableColumnCount = tableHeader.length
          sheetRows.push(tableHeader)
          sheetRows.push(...tableRows)
        }

        const evidenceSheet = XLSX.utils.aoa_to_sheet(sheetRows)

        if (tableHeaderRowIndex !== null && tableColumnCount > 0) {
          const tableHeader = sheetRows[tableHeaderRowIndex]?.map((value) => String(value ?? '')) ?? []
          const tableRows = sheetRows.slice(tableHeaderRowIndex + 1)

          evidenceSheet['!cols'] = this.computeExcelTableColumnWidths(tableHeader, tableRows)
          evidenceSheet['!autofilter'] = {
            ref: `${XLSX.utils.encode_cell({ r: tableHeaderRowIndex, c: 0 })}:${XLSX.utils.encode_cell({ r: sheetRows.length - 1, c: tableColumnCount - 1 })}`
          }
        } else {
          evidenceSheet['!cols'] = [{ wch: 24 }, { wch: 96 }]
        }

        XLSX.utils.book_append_sheet(workbook, evidenceSheet, sheetName)
      })
    }

    const rawOutput = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

    return Buffer.isBuffer(rawOutput) ? rawOutput : Buffer.from(rawOutput)
  }

  private calculateEvidenceStats(evidence: ReportExportEvidenceItem[]): ReportEvidenceStats {
    return {
      blocks: evidence.length,
      totalRows: evidence.reduce((sum, item) => sum + item.rowCount, 0),
      truncatedBlocks: evidence.filter((item) => item.truncated).length
    }
  }

  private markdownToPdfHtml(markdown: string): string {
    const normalized = markdown.replace(/\r\n?/g, '\n').trim()

    if (!normalized) {
      return '<p>(No content)</p>'
    }

    const codeBlocks: string[] = []
    let source = this.escapeHtml(normalized)

    source = source.replace(/```([\s\S]*?)```/g, (_full, code: string) => {
      const index = codeBlocks.length
      const cleaned = code.replace(/^\n+|\n+$/g, '')
      codeBlocks.push(`<pre><code>${cleaned}</code></pre>`)
      return `@@PDF_CODE_BLOCK_${index}@@`
    })

    const lines = source.split('\n')
    const htmlParts: string[] = []
    let inUnorderedList = false
    let inOrderedList = false

    const closeLists = (): void => {
      if (inUnorderedList) {
        htmlParts.push('</ul>')
        inUnorderedList = false
      }

      if (inOrderedList) {
        htmlParts.push('</ol>')
        inOrderedList = false
      }
    }

    for (const rawLine of lines) {
      const line = rawLine.trim()

      if (!line) {
        closeLists()
        continue
      }

      const codeToken = line.match(/^@@PDF_CODE_BLOCK_(\d+)@@$/)
      if (codeToken) {
        closeLists()
        htmlParts.push(codeBlocks[Number(codeToken[1])] ?? '')
        continue
      }

      const unorderedMatch = line.match(/^[-*]\s+(.+)/)
      if (unorderedMatch) {
        if (inOrderedList) {
          htmlParts.push('</ol>')
          inOrderedList = false
        }

        if (!inUnorderedList) {
          htmlParts.push('<ul>')
          inUnorderedList = true
        }

        htmlParts.push(`<li>${this.formatInlineMarkdownForPdf(unorderedMatch[1])}</li>`)
        continue
      }

      const orderedMatch = line.match(/^\d+\.\s+(.+)/)
      if (orderedMatch) {
        if (inUnorderedList) {
          htmlParts.push('</ul>')
          inUnorderedList = false
        }

        if (!inOrderedList) {
          htmlParts.push('<ol>')
          inOrderedList = true
        }

        htmlParts.push(`<li>${this.formatInlineMarkdownForPdf(orderedMatch[1])}</li>`)
        continue
      }

      closeLists()

      if (line.startsWith('### ')) {
        htmlParts.push(`<h3>${this.formatInlineMarkdownForPdf(line.slice(4))}</h3>`)
        continue
      }

      if (line.startsWith('## ')) {
        htmlParts.push(`<h2>${this.formatInlineMarkdownForPdf(line.slice(3))}</h2>`)
        continue
      }

      if (line.startsWith('# ')) {
        htmlParts.push(`<h1>${this.formatInlineMarkdownForPdf(line.slice(2))}</h1>`)
        continue
      }

      if (line.startsWith('> ')) {
        htmlParts.push(`<blockquote>${this.formatInlineMarkdownForPdf(line.slice(2))}</blockquote>`)
        continue
      }

      htmlParts.push(`<p>${this.formatInlineMarkdownForPdf(line)}</p>`)
    }

    closeLists()

    return htmlParts.join('\n') || '<p>(No content)</p>'
  }

  private formatInlineMarkdownForPdf(text: string): string {
    let formatted = text

    formatted = formatted.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
    )

    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>')
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>')

    return formatted
  }

  private computeExcelTableColumnWidths(header: string[], tableRows: unknown[][]): Array<{ wch: number }> {
    const maxColumnLength = header.map((name) => Math.max(10, name.length + 2))

    for (const row of tableRows) {
      row.forEach((value, index) => {
        const asText = this.toExcelPreviewText(value)
        const boundedLength = Math.min(58, asText.length + 2)
        maxColumnLength[index] = Math.max(maxColumnLength[index] ?? 10, boundedLength)
      })
    }

    return maxColumnLength.map((width) => ({ wch: width }))
  }

  private toExcelPreviewText(value: unknown): string {
    if (value === null || value === undefined) {
      return ''
    }

    if (typeof value === 'string') {
      return value
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }

    if (typeof value === 'bigint') {
      return value.toString()
    }

    if (value instanceof Date) {
      return value.toISOString()
    }

    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  private toSafeDate(value: string): Date {
    const parsed = new Date(value)

    if (Number.isNaN(parsed.getTime())) {
      return new Date()
    }

    return parsed
  }

  private formatGeneratedAt(value: string): string {
    const date = this.toSafeDate(value)
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
  }

  private formatInteger(value: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
  }

  private toExcelSheetName(value: string): string {
    const cleaned = value.replace(/[\\/?*\[\]:]/g, '_').trim() || 'Sheet'
    return cleaned.slice(0, 31)
  }

  private toExcelCellValue(value: unknown): string | number | boolean {
    if (value === null || value === undefined) {
      return ''
    }

    if (typeof value === 'string') {
      return value
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value
    }

    if (typeof value === 'bigint') {
      const asNumber = Number(value)
      return Number.isSafeInteger(asNumber) ? asNumber : value.toString()
    }

    if (value instanceof Date) {
      return value.toISOString()
    }

    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  private toPdfCellText(value: unknown): string {
    if (value === null || value === undefined) {
      return ''
    }

    if (typeof value === 'number') {
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value)
    }

    if (typeof value === 'string') {
      return value
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false'
    }

    if (typeof value === 'bigint') {
      return value.toString()
    }

    if (value instanceof Date) {
      return value.toISOString()
    }

    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
