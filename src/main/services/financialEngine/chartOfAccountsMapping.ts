/**
 * Chart of Accounts Mapping — Per-Deployment Calibration (Phase 32)
 *
 * Maps accounting concepts (receivables, payables, cash, etc.) to actual
 * account codes in a specific deployment. This replaces hardcoded account
 * code filters in metricCatalog.ts with a calibratable layer.
 *
 * @see FRE_ROADMAP_32_PHASE32_PER_DEPLOYMENT_CALIBRATION.fa.md
 */

import { z } from 'zod'
import { existsSync, readFileSync } from 'fs'

// ─── Account Concepts ────────────────────────────────────────────────────────

/**
 * Fine-grained account concepts that can be mapped per deployment.
 * These extend the basic AccountCategory (asset/liability/equity/revenue/expense)
 * with sub-categories needed by specific metrics.
 */
export enum AccountConcept {
  // Basic categories (match AccountCategory)
  assets = 'assets',
  liabilities = 'liabilities',
  equity = 'equity',
  revenue = 'revenue',
  expenses = 'expenses',

  // Sub-categories
  current_assets = 'current_assets',
  fixed_assets_concept = 'fixed_assets_concept',
  current_liabilities = 'current_liabilities',

  // Specific account concepts
  receivables = 'receivables',
  payables = 'payables',
  cash_bank = 'cash_bank',
  cogs = 'cogs',
  payroll = 'payroll',
  tax_paid = 'tax_paid',
  tax_collected = 'tax_collected',
  tax_liability = 'tax_liability',
  depreciation = 'depreciation',
  fixed_assets_register = 'fixed_assets_register',

  // Combined concepts
  revenue_and_expenses = 'revenue_and_expenses',
  balance_sheet_accounts = 'balance_sheet_accounts',
}

// ─── Mapping Types ───────────────────────────────────────────────────────────

/**
 * How a concept is mapped to physical accounts.
 * A concept can use one or more of these strategies:
 * - type1Codes: Filter by Type 1 (root) account codes via hierarchy
 * - type2Codes: Further filter by Type 2 (sub-category) codes under Type 1
 * - type3Codes: Direct filter on Type 3 (leaf) account codes
 * - titlePattern: Filter by account title (Persian LIKE)
 */
export interface AccountConceptMapping {
  /** Type 1 (root) account codes — hierarchy-based filtering */
  type1Codes?: string[]
  /** Type 2 (sub-category) account codes — used with type1Codes for finer filtering */
  type2Codes?: string[]
  /** Direct Type 3 (leaf) account codes — bypasses hierarchy */
  type3Codes?: string[]
  /** Title pattern for Persian LIKE matching (without the % wildcards) */
  titlePattern?: string
  /** Whether this concept is available/mapped in this deployment */
  available: boolean
  /** Human-readable description of what this concept represents */
  description: string
}

/**
 * Per-deployment chart of accounts mapping.
 * Stored in connection settings and used by the compiler to resolve
 * account concept filters to SQL.
 */
export interface ChartOfAccountsMapping {
  /** Software ID this mapping is for (e.g., 'sepidar') */
  softwareId: string
  /** Database name this mapping was discovered on */
  databaseName: string
  /** Mapping for each account concept */
  concepts: Partial<Record<AccountConcept, AccountConceptMapping>>
  /** When the mapping was discovered/confirmed */
  discoveredAt?: string
  /** How the mapping was created */
  discoveryMethod: 'default' | 'auto' | 'manual' | 'confirmed'
  /** Confidence level of the mapping */
  confidence: 'high' | 'medium' | 'low'
}

// ─── Default Sepidar Mapping ─────────────────────────────────────────────────

/**
 * Standard Sepidar chart of accounts mapping.
 * Based on Sepidar's default coding convention:
 *   Type 1: 11=current assets, 12=fixed assets, 21=current liabilities,
 *           22=long-term liabilities, 31=equity, 41=revenue,
 *           61=expenses (incl. COGS), 62=other expenses
 *   Type 2: 12,13 under 11 = receivables; 10,12 under 21 = payables
 *   Type 3: 01=cash, 02=bank, 06=fixed assets
 *
 * This is the default for Sepidar deployments that haven't been calibrated.
 * Custom deployments may override any of these.
 */
export const defaultSepidarMapping: ChartOfAccountsMapping = {
  softwareId: 'sepidar',
  databaseName: 'Sepidar01',
  discoveryMethod: 'default',
  confidence: 'high',
  concepts: {
    [AccountConcept.assets]: {
      type1Codes: ['11', '12'],
      available: true,
      description: 'کل دارایی‌ها (دارایی جاری + دارایی ثابت)',
    },
    [AccountConcept.current_assets]: {
      type1Codes: ['11'],
      available: true,
      description: 'دارایی‌های جاری',
    },
    [AccountConcept.fixed_assets_concept]: {
      type1Codes: ['12'],
      available: true,
      description: 'دارایی‌های ثابت',
    },
    [AccountConcept.liabilities]: {
      type1Codes: ['21', '22'],
      available: true,
      description: 'کل بدهی‌ها (بدهی جاری + بلندمدت)',
    },
    [AccountConcept.current_liabilities]: {
      type1Codes: ['21'],
      available: true,
      description: 'بدهی‌های جاری',
    },
    [AccountConcept.equity]: {
      type1Codes: ['31'],
      available: true,
      description: 'حقوق صاحبان سهام',
    },
    [AccountConcept.revenue]: {
      type1Codes: ['41'],
      available: true,
      description: 'درآمدها',
    },
    [AccountConcept.expenses]: {
      type1Codes: ['61'],
      available: true,
      description: 'هزینه‌ها',
    },
    [AccountConcept.receivables]: {
      type1Codes: ['11'],
      type2Codes: ['12', '13'],
      available: true,
      description: 'حساب‌های دریافتنی (سرفصل ۱۲ و ۱۳ تحت دارایی جاری)',
    },
    [AccountConcept.payables]: {
      type1Codes: ['21'],
      type2Codes: ['10', '12'],
      available: true,
      description: 'حساب‌های پرداختنی (سرفصل ۱۰ و ۱۲ تحت بدهی جاری)',
    },
    [AccountConcept.cash_bank]: {
      type3Codes: ['01', '02'],
      available: true,
      description: 'حساب‌های نقدی و بانکی (کد ۰۱ و ۰۲)',
    },
    [AccountConcept.cogs]: {
      type1Codes: ['61'],
      available: true,
      description: 'بهای تمام‌شده (زیرمجموعه هزینه‌ها)',
    },
    [AccountConcept.payroll]: {
      type1Codes: ['61'],
      type2Codes: ['10'],
      available: true,
      description: 'حقوق و دستمزد (سرفصل ۱۰ تحت هزینه‌ها)',
    },
    [AccountConcept.tax_paid]: {
      type1Codes: ['11', '12'],
      titlePattern: 'مالیات',
      available: true,
      description: 'مالیات پرداختی (دارایی با عنوان مالیات)',
    },
    [AccountConcept.tax_collected]: {
      type1Codes: ['21', '22'],
      titlePattern: 'مالیات',
      available: true,
      description: 'مالیات دریافتی (بدهی با عنوان مالیات)',
    },
    [AccountConcept.tax_liability]: {
      titlePattern: 'مالیات',
      available: true,
      description: 'حساب‌های بدهی مالیاتی',
    },
    [AccountConcept.depreciation]: {
      titlePattern: 'استهلاک',
      available: true,
      description: 'حساب‌های استهلاک تجمعی',
    },
    [AccountConcept.fixed_assets_register]: {
      type3Codes: ['06'],
      available: true,
      description: 'دارایی‌های ثابت (کد ۰۶)',
    },
    [AccountConcept.revenue_and_expenses]: {
      type1Codes: ['41', '61', '62'],
      available: true,
      description: 'درآمد و هزینه‌ها',
    },
    [AccountConcept.balance_sheet_accounts]: {
      type1Codes: ['11', '12', '21', '22', '31'],
      available: true,
      description: 'حساب‌های ترازنامه (دارایی، بدهی، حقوق صاحبان سهام)',
    },
  },
}

// ─── SQL Resolution ──────────────────────────────────────────────────────────

/**
 * Resolve an account concept to a SQL WHERE clause fragment.
 *
 * @param mapping - The chart of accounts mapping for this deployment
 * @param concept - The account concept to resolve
 * @param accountAlias - SQL alias for the Account table (default: 'a')
 * @returns SQL fragment string, or null if concept is not mapped/available
 */
export function resolveAccountFilter(
  mapping: ChartOfAccountsMapping | undefined,
  concept: AccountConcept,
  accountAlias: string = 'a'
): string | null {
  // If no mapping provided, fall back to default Sepidar mapping
  const m = mapping ?? defaultSepidarMapping
  const cm = m.concepts[concept]

  if (!cm || !cm.available) {
    return null
  }

  const parts: string[] = []

  // Type 3 direct code filter (highest priority — bypasses hierarchy)
  if (cm.type3Codes && cm.type3Codes.length > 0) {
    if (cm.type3Codes.length === 1) {
      parts.push(`${accountAlias}.Code = '${cm.type3Codes[0]}'`)
    } else {
      parts.push(`${accountAlias}.Code IN (${cm.type3Codes.map(c => `'${c}'`).join(',')})`)
    }
  }

  // Hierarchy-based filter (Type 1 → Type 2 → Type 3 via ParentAccountRef)
  if (cm.type1Codes && cm.type1Codes.length > 0) {
    if (cm.type2Codes && cm.type2Codes.length > 0) {
      // Type 1 + Type 2 filter
      parts.push(
        `${accountAlias}.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND Code IN (${cm.type2Codes.map(c => `'${c}'`).join(',')}) AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code IN (${cm.type1Codes.map(c => `'${c}'`).join(',')})))`
      )
    } else {
      // Type 1 only filter
      parts.push(
        `${accountAlias}.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code IN (${cm.type1Codes.map(c => `'${c}'`).join(',')})))`
      )
    }
  }

  // Title pattern filter
  if (cm.titlePattern) {
    parts.push(`${accountAlias}.Title LIKE N'%${cm.titlePattern}%'`)
  }

  if (parts.length === 0) {
    return null
  }

  return parts.join(' AND ')
}

/**
 * Check if a concept is available in the mapping.
 */
export function isConceptAvailable(
  mapping: ChartOfAccountsMapping | undefined,
  concept: AccountConcept
): boolean {
  const m = mapping ?? defaultSepidarMapping
  const cm = m.concepts[concept]
  return !!(cm && cm.available)
}

/**
 * Get all unavailable concepts from a list.
 */
export function getUnavailableConcepts(
  mapping: ChartOfAccountsMapping | undefined,
  concepts: AccountConcept[]
): AccountConcept[] {
  return concepts.filter(c => !isConceptAvailable(mapping, c))
}

// ─── Discovery ───────────────────────────────────────────────────────────────

/**
 * SQL queries for discovering account structure.
 * These are used by the calibration script to semi-automatically
 * discover the chart of accounts mapping for a new deployment.
 */
export const discoveryQueries = {
  type1Accounts: `SELECT Code, Title FROM ACC.Account WHERE Type = 1 ORDER BY Code`,
  type2Accounts: `SELECT Code, Title, ParentAccountRef FROM ACC.Account WHERE Type = 2 ORDER BY Code`,
  type3Sample: `SELECT TOP 5 Code, Title, ParentAccountRef FROM ACC.Account WHERE Type = 3 ORDER BY Code`,
  accountCount: `SELECT Type, COUNT(*) as cnt FROM ACC.Account GROUP BY Type`,
  titleSearch: (pattern: string) =>
    `SELECT Code, Title, Type FROM ACC.Account WHERE Title LIKE N'%${pattern}%' AND Type = 3`,
}

/**
 * Heuristic discovery of chart of accounts mapping from a database.
 * Returns a mapping with confidence scores for each concept.
 *
 * @param softwareId - The software identifier
 * @param databaseName - The database name
 * @param type1Rows - Rows from discoveryQueries.type1Accounts
 * @param type2Rows - Rows from discoveryQueries.type2Accounts
 * @returns A discovered ChartOfAccountsMapping with confidence levels
 */
export function discoverMapping(
  softwareId: string,
  databaseName: string,
  type1Rows: Array<{ Code: string; Title: string }>,
  _type2Rows: Array<{ Code: string; Title: string; ParentAccountRef: string | number }>
): ChartOfAccountsMapping {
  const concepts: Partial<Record<AccountConcept, AccountConceptMapping>> = {}
  const type1Codes = type1Rows.map(r => r.Code)

  // Helper: check if a Type 1 code exists
  const hasType1 = (code: string) => type1Codes.includes(code)

  // Map basic categories based on standard Sepidar coding
  const standardMappings: Array<[AccountConcept, string[], string]> = [
    [AccountConcept.assets, ['11', '12'], 'کل دارایی‌ها'],
    [AccountConcept.current_assets, ['11'], 'دارایی‌های جاری'],
    [AccountConcept.fixed_assets_concept, ['12'], 'دارایی‌های ثابت'],
    [AccountConcept.liabilities, ['21', '22'], 'کل بدهی‌ها'],
    [AccountConcept.current_liabilities, ['21'], 'بدهی‌های جاری'],
    [AccountConcept.equity, ['31'], 'حقوق صاحبان سهام'],
    [AccountConcept.revenue, ['41'], 'درآمدها'],
    [AccountConcept.expenses, ['61'], 'هزینه‌ها'],
    [AccountConcept.revenue_and_expenses, ['41', '61', '62'], 'درآمد و هزینه‌ها'],
    [AccountConcept.balance_sheet_accounts, ['11', '12', '21', '22', '31'], 'حساب‌های ترازنامه'],
  ]

  for (const [concept, codes, desc] of standardMappings) {
    const availableCodes = codes.filter(c => hasType1(c))
    concepts[concept] = {
      type1Codes: availableCodes,
      available: availableCodes.length > 0,
      description: desc,
    }
  }

  // Sub-categories with Type 2 codes
  concepts[AccountConcept.receivables] = {
    type1Codes: ['11'],
    type2Codes: ['12', '13'],
    available: hasType1('11'),
    description: 'حساب‌های دریافتنی',
  }

  concepts[AccountConcept.payables] = {
    type1Codes: ['21'],
    type2Codes: ['10', '12'],
    available: hasType1('21'),
    description: 'حساب‌های پرداختنی',
  }

  concepts[AccountConcept.cogs] = {
    type1Codes: ['61'],
    available: hasType1('61'),
    description: 'بهای تمام‌شده',
  }

  concepts[AccountConcept.payroll] = {
    type1Codes: ['61'],
    type2Codes: ['10'],
    available: hasType1('61'),
    description: 'حقوق و دستمزد',
  }

  concepts[AccountConcept.cash_bank] = {
    type3Codes: ['01', '02'],
    available: true,
    description: 'نقدی و بانکی',
  }

  concepts[AccountConcept.fixed_assets_register] = {
    type3Codes: ['06'],
    available: true,
    description: 'دارایی‌های ثابت',
  }

  // Title-based concepts — always available (will match if accounts exist)
  concepts[AccountConcept.tax_paid] = {
    type1Codes: ['11', '12'],
    titlePattern: 'مالیات',
    available: hasType1('11') || hasType1('12'),
    description: 'مالیات پرداختی',
  }

  concepts[AccountConcept.tax_collected] = {
    type1Codes: ['21', '22'],
    titlePattern: 'مالیات',
    available: hasType1('21') || hasType1('22'),
    description: 'مالیات دریافتی',
  }

  concepts[AccountConcept.tax_liability] = {
    titlePattern: 'مالیات',
    available: true,
    description: 'بدهی مالیاتی',
  }

  concepts[AccountConcept.depreciation] = {
    titlePattern: 'استهلاک',
    available: true,
    description: 'استهلاک تجمعی',
  }

  // Determine confidence
  const standardCodes = ['11', '12', '21', '22', '31', '41', '61']
  const matchedCodes = standardCodes.filter(c => hasType1(c))
  const confidence: 'high' | 'medium' | 'low' =
    matchedCodes.length >= 6 ? 'high' :
    matchedCodes.length >= 4 ? 'medium' : 'low'

  return {
    softwareId,
    databaseName,
    concepts,
    discoveryMethod: 'auto',
    confidence,
    discoveredAt: new Date().toISOString(),
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Balance checks that should hold after calibration.
 * These are run by the calibration script to validate the mapping.
 */
export const balanceChecks = {
  accountingEquation: `SELECT (SELECT ISNULL(SUM(Debit-Credit),0) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId WHERE v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=1 AND Code IN ('11','12')))) AS assets, (SELECT ISNULL(SUM(Credit-Debit),0) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId WHERE v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=1 AND Code IN ('21','22')))) AS liabilities, (SELECT ISNULL(SUM(Credit-Debit),0) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId WHERE v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=1 AND Code='31'))) AS equity`,
  debitCreditBalance: `SELECT SUM(Debit) as totalDebit, SUM(Credit) as totalCredit FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId WHERE v.Type NOT IN (3,4)`,
}

/**
 * Validate that the accounting equation holds: Assets = Liabilities + Equity
 */
export function validateAccountingEquation(
  assets: number,
  liabilities: number,
  equity: number
): { valid: boolean; difference: number; message: string } {
  const difference = assets - (liabilities + equity)
  const valid = Math.abs(difference) < 1 // Allow rounding difference < 1
  return {
    valid,
    difference,
    message: valid
      ? `Assets (${assets}) = Liabilities (${liabilities}) + Equity (${equity}) ✓`
      : `Assets (${assets}) ≠ Liabilities (${liabilities}) + Equity (${equity}), diff=${difference}`,
  }
}

/**
 * Validate that total debits equal total credits.
 */
export function validateDebitCreditBalance(
  totalDebit: number,
  totalCredit: number
): { valid: boolean; difference: number; message: string } {
  const difference = totalDebit - totalCredit
  const valid = Math.abs(difference) < 1
  return {
    valid,
    difference,
    message: valid
      ? `Debit (${totalDebit}) = Credit (${totalCredit}) ✓`
      : `Debit (${totalDebit}) ≠ Credit (${totalCredit}), diff=${difference}`,
  }
}

// ─── S34.1: Runtime Mapping Loader ──────────────────────────────────────────

const accountConceptMappingSchema = z.object({
  type1Codes: z.array(z.string()).optional(),
  type2Codes: z.array(z.string()).optional(),
  type3Codes: z.array(z.string()).optional(),
  titlePattern: z.string().optional(),
  available: z.boolean(),
  description: z.string(),
})

const chartOfAccountsMappingSchema = z.object({
  softwareId: z.string(),
  databaseName: z.string(),
  concepts: z.record(z.string(), accountConceptMappingSchema),
  discoveredAt: z.string().optional(),
  discoveryMethod: z.enum(['default', 'auto', 'manual', 'confirmed']),
  confidence: z.enum(['high', 'medium', 'low']),
})

export interface LoadMappingResult {
  mapping: ChartOfAccountsMapping
  source: 'config' | 'default'
  error?: string
}

/**
 * S34.1: Load chart of accounts mapping from config file.
 * If config/chartOfAccountsMapping.json exists and is valid, use it.
 * Otherwise, fall back to defaultSepidarMapping.
 *
 * S34.2: Invalid mapping → warning + fallback to default (no crash).
 *
 * @param configPath - Path to the mapping JSON file (default: config/chartOfAccountsMapping.json)
 * @param fallbackSoftwareId - Software ID to use for default mapping (default: 'sepidar')
 */
export function loadChartOfAccountsMapping(
  configPath?: string
): LoadMappingResult {
  const path = configPath ?? 'config/chartOfAccountsMapping.json'

  try {
    if (!existsSync(path)) {
      return {
        mapping: defaultSepidarMapping,
        source: 'default',
      }
    }

    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    const result = chartOfAccountsMappingSchema.safeParse(parsed)

    if (!result.success) {
      return {
        mapping: defaultSepidarMapping,
        source: 'default',
        error: `Invalid chartOfAccountsMapping.json: ${result.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; ')}`,
      }
    }

    // Convert validated plain object to ChartOfAccountsMapping with proper enum keys
    const concepts: Partial<Record<AccountConcept, AccountConceptMapping>> = {}
    for (const [key, value] of Object.entries(result.data.concepts)) {
      if (isAccountConcept(key)) {
        concepts[key as AccountConcept] = value as AccountConceptMapping
      }
    }

    return {
      mapping: {
        softwareId: result.data.softwareId,
        databaseName: result.data.databaseName,
        concepts,
        discoveredAt: result.data.discoveredAt,
        discoveryMethod: result.data.discoveryMethod,
        confidence: result.data.confidence,
      },
      source: 'config',
    }
  } catch (err) {
    return {
      mapping: defaultSepidarMapping,
      source: 'default',
      error: `Failed to load chartOfAccountsMapping.json: ${(err as Error).message}`,
    }
  }
}

function isAccountConcept(key: string): boolean {
  return Object.values(AccountConcept).includes(key as AccountConcept)
}
