export type UnsupportedSqlFunctionCheck = {
  found: boolean
  functionName?: string
  correction?: string
}

const COMMENT_NORMALIZATION_PATTERN = /\/\*[\s\S]*?\*\//g
const LINE_COMMENT_NORMALIZATION_PATTERN = /--[^\r\n]*/g

const UNSUPPORTED_FUNCTION_RULES: Array<{
  pattern: RegExp
  functionName: string
  correction: string
}> = [
  {
    pattern: /\bFORMAT\s*\(/i,
    functionName: 'FORMAT',
    correction:
      'این SQL Server FORMAT ندارد. برای گروه‌بندی ماهانه از YEAR(col) و MONTH(col) یا DATEPART(year, col)/DATEPART(month, col) استفاده کن؛ برای بازهٔ تاریخ از شرط col >= \'<start>\' AND col <= \'<end>\' استفاده کن.'
  },
  {
    pattern: /\bSTRING_AGG\s*\(/i,
    functionName: 'STRING_AGG',
    correction: 'این SQL Server STRING_AGG را پشتیبانی نمی‌کند. برای ادغام متن از روش جایگزین در سطح برنامه یا کوئری‌های چندمرحله‌ای استفاده کن.'
  },
  {
    pattern: /\bGregorianToShamsi\b/i,
    functionName: 'GregorianToShamsi',
    correction: 'این SQL Server تابع dbo.GregorianToShamsi را پشتیبانی نمی‌کند. برای تبدیل تاریخ از میلادی به شمسی از منطق برنامه یا توابع جایگزین استفاده کن.'
  },
  {
    pattern: /\bFOR\s+JSON\b/i,
    functionName: 'FOR JSON',
    correction: 'این SQL Server FOR JSON را پشتیبانی نمی‌کند. خروجی را به‌صورت ردیف/ستون معمولی بازگردان و در سطح برنامه پردازش کن.'
  },
  {
    pattern: /\bFOR\s+XML\b/i,
    functionName: 'FOR XML',
    correction: 'این SQL Server FOR XML را پشتیبانی نمی‌کند. خروجی را به‌صورت ردیف/ستون معمولی بازگردان.'
  },
  {
    pattern: /\bDATEFROMPARTS\s*\(/i,
    functionName: 'DATEFROMPARTS',
    correction: 'این SQL Server DATEFROMPARTS را پشتیبانی نمی‌کند. برای ساخت تاریخ از اجزای جداگانه از ترکیب dateadd و cast استفاده کن.'
  },
  {
    pattern: /\bEOMONTH\s*\(/i,
    functionName: 'EOMONTH',
    correction: 'این SQL Server EOMONTH را پشتیبانی نمی‌کند. برای پایان ماه از بازهٔ تاریخ واضح یا محاسبهٔ دستی استفاده کن.'
  }
]

export function detectUnsupportedSqlFunctions(sql: string): UnsupportedSqlFunctionCheck {
  const normalized = sql
    .replace(COMMENT_NORMALIZATION_PATTERN, ' ')
    .replace(LINE_COMMENT_NORMALIZATION_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return { found: false }
  }

  for (const rule of UNSUPPORTED_FUNCTION_RULES) {
    if (rule.pattern.test(normalized)) {
      return {
        found: true,
        functionName: rule.functionName,
        correction: rule.correction
      }
    }
  }

  return { found: false }
}
