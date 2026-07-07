/**
 * S41.1: Sepidar Version Detection
 *
 * Detects the Sepidar schema version/variant by probing key schema features.
 * Uses "schema fingerprinting" — checking existence of tables, columns, and
 * structural patterns that differ between Sepidar versions.
 *
 * Output: { versionId, schemaFingerprint, confidence }
 */

/** Result of version detection */
export interface SepidarVersionInfo {
  /** Detected version identifier (e.g., 'sepidar-v1', 'sepidar-v2') */
  versionId: string
  /** Human-readable label */
  versionLabel: string
  /** Schema fingerprint — hash of key feature checks */
  schemaFingerprint: string
  /** Confidence level: 'high' if ≥3 distinguishing features detected, 'medium' if 1-2, 'low' if 0 */
  confidence: 'high' | 'medium' | 'low'
  /** Raw feature probes for audit/debugging */
  features: SepidarVersionFeature[]
}

/** A single schema feature probe */
export interface SepidarVersionFeature {
  name: string
  detected: boolean
  /** Which version this feature indicates */
  indicatesVersion: string
}

/** SQL executor function type */
export type SqlExecutor = (query: string) => Promise<Record<string, unknown>[]>

/**
 * Probes for distinguishing schema features between Sepidar versions.
 *
 * Known differences (discovered S41.0):
 * - Sepidar01 (older): No CostCenterRef in AST tables
 * - Sepidar03 (newer): Has CostCenterRef in AST.Asset, AST.AcquisitionReceiptItem,
 *   AST.AssetTransaction, AST.TransferItem, AST.TransferItem.PreCostCenterRef
 *
 * Additional probes check for features that may exist in other versions.
 */
const VERSION_PROBES: Array<{
  name: string
  query: string
  indicatesVersion: string
  /** Returns true if the probe result indicates this feature is present */
  checkResult: (rows: Record<string, unknown>[]) => boolean
}> = [
  {
    name: 'AST.Asset.CostCenterRef',
    query: `SELECT COUNT(*) AS cnt FROM information_schema.columns
            WHERE table_schema='AST' AND table_name='Asset' AND column_name='CostCenterRef'`,
    indicatesVersion: 'sepidar-v2',
    checkResult: (rows) => Number(rows[0]?.['cnt'] ?? 0) > 0
  },
  {
    name: 'AST.AssetTransaction.CostCenterRef',
    query: `SELECT COUNT(*) AS cnt FROM information_schema.columns
            WHERE table_schema='AST' AND table_name='AssetTransaction' AND column_name='CostCenterRef'`,
    indicatesVersion: 'sepidar-v2',
    checkResult: (rows) => Number(rows[0]?.['cnt'] ?? 0) > 0
  },
  {
    name: 'AST.AcquisitionReceiptItem.CostCenterRef',
    query: `SELECT COUNT(*) AS cnt FROM information_schema.columns
            WHERE table_schema='AST' AND table_name='AcquisitionReceiptItem' AND column_name='CostCenterRef'`,
    indicatesVersion: 'sepidar-v2',
    checkResult: (rows) => Number(rows[0]?.['cnt'] ?? 0) > 0
  },
  {
    name: 'AST.TransferItem.CostCenterRef',
    query: `SELECT COUNT(*) AS cnt FROM information_schema.columns
            WHERE table_schema='AST' AND table_name='TransferItem' AND column_name='CostCenterRef'`,
    indicatesVersion: 'sepidar-v2',
    checkResult: (rows) => Number(rows[0]?.['cnt'] ?? 0) > 0
  },
  {
    name: 'AST.TransferItem.PreCostCenterRef',
    query: `SELECT COUNT(*) AS cnt FROM information_schema.columns
            WHERE table_schema='AST' AND table_name='TransferItem' AND column_name='PreCostCenterRef'`,
    indicatesVersion: 'sepidar-v2',
    checkResult: (rows) => Number(rows[0]?.['cnt'] ?? 0) > 0
  },
  {
    name: 'SLS.Invoice.OrderRef',
    query: `SELECT COUNT(*) AS cnt FROM information_schema.columns
            WHERE table_schema='SLS' AND table_name='Invoice' AND column_name='OrderRef'`,
    indicatesVersion: 'sepidar-v2',
    checkResult: (rows) => Number(rows[0]?.['cnt'] ?? 0) > 0
  },
  {
    name: 'SLS.Invoice.AgreementRef',
    query: `SELECT COUNT(*) AS cnt FROM information_schema.columns
            WHERE table_schema='SLS' AND table_name='Invoice' AND column_name='AgreementRef'`,
    indicatesVersion: 'sepidar-v2',
    checkResult: (rows) => Number(rows[0]?.['cnt'] ?? 0) > 0
  },
  {
    name: 'table_count',
    query: `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_type='BASE TABLE'`,
    indicatesVersion: 'any',
    checkResult: () => true
  },
  {
    name: 'FMK.FiscalYear.exists',
    query: `SELECT COUNT(*) AS cnt FROM information_schema.tables
            WHERE table_schema='FMK' AND table_name='FiscalYear'`,
    indicatesVersion: 'any',
    checkResult: (rows) => Number(rows[0]?.['cnt'] ?? 0) > 0
  },
  {
    name: 'SLS.InvoiceItem.exists',
    query: `SELECT COUNT(*) AS cnt FROM information_schema.tables
            WHERE table_schema='SLS' AND table_name='InvoiceItem'`,
    indicatesVersion: 'any',
    checkResult: (rows) => Number(rows[0]?.['cnt'] ?? 0) > 0
  },
  {
    name: 'ACC.Check.exists',
    query: `SELECT COUNT(*) AS cnt FROM information_schema.tables
            WHERE table_schema='ACC' AND table_name='Check'`,
    indicatesVersion: 'any',
    checkResult: (rows) => Number(rows[0]?.['cnt'] ?? 0) > 0
  },
  {
    name: 'GNR.Party.exists',
    query: `SELECT COUNT(*) AS cnt FROM information_schema.tables
            WHERE table_schema='GNR' AND table_name='Party'`,
    indicatesVersion: 'any',
    checkResult: (rows) => Number(rows[0]?.['cnt'] ?? 0) > 0
  }
]

/**
 * Detect the Sepidar schema version by probing key schema features.
 *
 * @param executeSql - Function to execute a SQL query and return rows
 * @returns Version detection result with fingerprint and confidence
 */
export async function detectSepidarVersion(executeSql: SqlExecutor): Promise<SepidarVersionInfo> {
  const features: SepidarVersionFeature[] = []

  for (const probe of VERSION_PROBES) {
    try {
      const rows = await executeSql(probe.query)
      const detected = probe.checkResult(rows)
      features.push({
        name: probe.name,
        detected,
        indicatesVersion: probe.indicatesVersion
      })
    } catch {
      features.push({
        name: probe.name,
        detected: false,
        indicatesVersion: probe.indicatesVersion
      })
    }
  }

  // Count v2-specific features
  const v2FeatureCount = features.filter(
    (f) => f.detected && f.indicatesVersion === 'sepidar-v2'
  ).length

  // Determine version
  let versionId: string
  let versionLabel: string

  if (v2FeatureCount >= 3) {
    versionId = 'sepidar-v2'
    versionLabel = 'سپیدار نسخهٔ ۲ (جدیدتر — با CostCenterRef در دارایی‌ها)'
  } else if (v2FeatureCount === 0) {
    versionId = 'sepidar-v1'
    versionLabel = 'سپیدار نسخهٔ ۱ (استاندارد)'
  } else {
    versionId = 'sepidar-v1-transitional'
    versionLabel = `سپیدار نسخهٔ گذار (${v2FeatureCount} ویژگیِ v۲ یافت شد)`
  }

  // Build fingerprint from feature detection pattern
  const fingerprintParts = features.map((f) => `${f.name}:${f.detected ? '1' : '0'}`)
  const schemaFingerprint = fingerprintParts.join('|')

  // Confidence: high if ≥3 v2 features or 0 v2 features (clear classification)
  // medium if 1-2 v2 features (ambiguous)
  let confidence: 'high' | 'medium' | 'low'
  if (v2FeatureCount === 0 || v2FeatureCount >= 3) {
    confidence = 'high'
  } else {
    confidence = 'medium'
  }

  return {
    versionId,
    versionLabel,
    schemaFingerprint,
    confidence,
    features
  }
}
