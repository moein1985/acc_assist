# FRE Roadmap 02 — فاز ۲ و ۳: لایهٔ معنایی، شِمای متریک و کامپایلرِ قطعی
### قلبِ معماری — «درست‌به‌ساخت»

> پیش‌نیاز: فاز ۱ کامل و سبز. این فاز دانشِ پراکنده در ۵ هندلر را به **تعریف‌های اعلانی (MetricDefinition)** + یک **کامپایلرِ قطعی** منتقل می‌کند. اصل: کد → داده. هر چیزی که در فاز ۰.۷ «قاعدهٔ طلایی» نامیده شد، اینجا تبدیل به **قاعدهٔ کامپایلر** می‌شود تا خودکار روی همهٔ متریک‌ها اعمال شود.

**مارکرهای asar این فاز:** `compileMetricPlan`, `METRIC_CATALOG`, `net_sales`.

---

## بخش الف — شِماها و انواع (Contracts)

### S2.1 — نوعِ `MetricDefinition`

- [ ] **S2.1** در `src/main/services/financialEngine/types.ts` نوع‌های زیر را به‌صورت کامل تعریف کن. (از Zod برای اعتبارسنجیِ runtime استفاده کن — در فاز ۴ برای خروجیِ مدل حیاتی می‌شود.)

```ts
export type MetricId =
  | 'net_sales'
  | 'purchases'
  | 'account_balance'
  | 'trial_balance'
  | 'cash_bank_balance'

export type Grain =
  | 'total'
  | 'by_year'
  | 'by_month'
  | 'by_account'
  | 'by_branch'
  | 'by_customer'

export type AggregateKind =
  | { kind: 'sum'; column: string }
  | { kind: 'count' }
  | { kind: 'debit_minus_credit'; debitColumn: string; creditColumn: string }

export interface MetricSource {
  /** جدولِ اصلی به‌صورت 'Schema.Table' (کامپایلر با quoteSqlTableRef نقل‌قول می‌کند) */
  primaryTable: string
  /** alias در SQL (مثلاً 'src' یا 'v') */
  alias: string
  /** جدول‌های جایگزین اگر اصلی خالی بود (مثل POM.PurchaseInvoice → INV.InventoryReceipt) */
  fallbackTables?: Array<{ table: string; alias: string; measure: AggregateKind; filters?: MetricFilter[] }>
}

export interface DimensionBinding {
  dimension: Grain                 // مثلاً 'by_year'
  /** نوعِ پیوند: ستونِ مستقیم یا join به جدولِ بُعد */
  join?: {
    table: string                  // 'FMK.FiscalYear'
    alias: string                  // 'fy'
    on: { sourceColumn: string; targetColumn: string } // FiscalYearRef = FiscalYearId
  }
  /** ستونی که برچسب/فیلتر روی آن اعمال می‌شود (مثلاً fy.Title) */
  labelColumn: string
  /** نوعِ دادهٔ برچسب برای نقل‌قولِ درست */
  labelType: 'nstring' | 'int'
}

export interface MetricFilter {
  /** SQLِ خامِ از-پیش-امنِ ثابت (بدونِ ورودیِ کاربر) — مثل "v.Type NOT IN (3, 4)" یا "IsReturn = 0" */
  sql: string
  description: string
}

export interface ReconciliationRule {
  id: string
  description: string
  /** تابعی که روی نتیجه اجرا می‌شود و true/false می‌دهد (مثلاً تراز آزمایشی باید نزدیکِ صفر باشد) */
  // پیاده‌سازی در verifier.ts؛ اینجا فقط شناسه و آستانه
  kind: 'sum_of_parts_equals_total' | 'balanced_to_zero' | 'non_negative' | 'custom'
  toleranceAbs?: number
}

export interface MetricDefinition {
  id: MetricId
  titleFa: string
  /** عبارت‌های لنگر برای روتینگِ first-pass (وزن‌دار در router) */
  anchors: string[]
  supportSignals?: string[]
  excludeSignals?: string[]
  softwareId: 'sepidar' | 'mahak' | 'generic'
  grainSupported: Grain[]
  source: MetricSource
  measure: AggregateKind
  dimensions: DimensionBinding[]
  /** فیلترهای اجباریِ پیش‌فرض (همیشه اعمال) */
  mandatoryFilters: MetricFilter[]
  reconciliations?: ReconciliationRule[]
  /** برای متن‌کاوی روی نامِ موجودیت (مثل نامِ حساب) */
  entityNameMatch?: {
    /** ستونی که LIKE روی آن اجرا می‌شود (مثل a.Title) */
    column: string
    /** آیا فولدِ کاراکترِ فارسی/عربی لازم است */
    foldPersian: boolean
  }
}
```

### S2.2 — نوعِ `MetricPlan` (IR خروجیِ Planner)

- [ ] **S2.2** تعریفِ `MetricPlan` + شِمای Zod متناظر (`metricPlanSchema`) برای اعتبارسنجیِ runtime:

```ts
export interface PlanFilter {
  dimension: Grain
  op: 'eq' | 'in'
  values: string[]                 // مقادیر همیشه رشته؛ کامپایلر طبق labelType نقل‌قول می‌کند
}

export interface MetricPlan {
  metricId: MetricId
  grain: Grain
  filters: PlanFilter[]
  /** برای سؤال‌های مقایسه‌ای دو-دوره‌ای */
  comparison?: {
    dimension: Grain               // معمولاً 'by_year'
    baseValue: string              // '1402'
    targetValue: string            // '1403'
  }
  /** نامِ موجودیت برای متریک‌هایی مثل account_balance */
  entityName?: string
  /** اطمینانِ Planner؛ زیر آستانه → Clarify */
  confidence: number
}
```

### S2.3 — انواعِ خروجی

- [ ] **S2.3** `CompiledQuery { sql: string; bindingsDescription: string }`، `EngineResult { rows: SqlQueryRow[]; plan: MetricPlan; compiled: CompiledQuery }`، `EngineVerdict { ok: boolean; reason?: string; reconciliations: Array<{id:string; passed:boolean}> }`.

---

## بخش ب — کاتالوگِ متریک (دادهٔ اعلانی)

> هر متریک با عددِ ground-truthِ فاز ۰.۷ به‌عنوان اوراکل آزمایش می‌شود. ابتدا **فقط `net_sales`** را تعریف و کامل تست کن (vertical slice)، سپس بقیه.

### S2.4 — متریکِ `net_sales` (اول — vertical slice)

- [ ] **S2.4** در `metricCatalog.ts` تعریفِ `net_sales`:
```ts
{
  id: 'net_sales',
  titleFa: 'فروش خالص',
  anchors: ['فروش', 'مبلغ فروش', 'درآمد فروش'],
  excludeSignals: ['خرید', 'هزینه'],
  softwareId: 'sepidar',
  grainSupported: ['total', 'by_year', 'by_month'],
  source: { primaryTable: 'SLS.Invoice', alias: 'src' },
  measure: { kind: 'sum', column: 'NetPriceInBaseCurrency' },   // R-KPI قفل‌شده
  dimensions: [
    { dimension: 'by_year',
      join: { table: 'FMK.FiscalYear', alias: 'fy',
              on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' } },
      labelColumn: 'Title', labelType: 'nstring' },             // R-سال
    { dimension: 'by_month',
      labelColumn: 'MONTH(src.Date)', labelType: 'int' },
  ],
  mandatoryFilters: [],
}
```
- معیارِ پذیرش: کامپایلرِ `net_sales` با `{grain:'by_year', comparison:{by_year,1402,1403}}` باید SQLی بسازد که اعدادِ `64,252,437,897` و `57,023,796,065` و `-11.25%` را بدهد (تأیید با sqlcmd و سپس field).

### S2.5 — متریکِ `purchases` (با fallback)

- [ ] **S2.5** تعریفِ `purchases`: منبعِ اصلی `POM.PurchaseInvoice` (خالی) با `fallbackTables: [{ table:'INV.InventoryReceipt', alias:'src', measure:{kind:'sum',column:'TotalPrice'}, filters:[{sql:'src.IsReturn = 0', description:'حذف مرجوعی'}] }]`. اوراکل: `226,110,419,451`.
- نکته: «خرید» با «فروش» اشتباه نشود — `excludeSignals` و router مراقبت کنند.

### S2.6 — متریکِ `account_balance`

- [ ] **S2.6** تعریفِ `account_balance` روی `ACC.Voucher v` JOIN `ACC.VoucherItem vi` JOIN `ACC.Account a`:
  - `measure: { kind:'debit_minus_credit', debitColumn:'vi.Debit', creditColumn:'vi.Credit' }`
  - `dimensions`: `by_year` (join `FMK.FiscalYear` on `v.FiscalYearRef=FiscalYearId`), `by_account`.
  - `mandatoryFilters: [{ sql:'v.Type NOT IN (3, 4)', description:'حذف اسناد اختتامیه/بستن' }]`  ← R-اختتامیه
  - `entityNameMatch: { column:'a.Title', foldPersian:true }`  ← R-collation
  - joinها: `vi.VoucherRef=v.VoucherId`, `vi.AccountSLRef=a.AccountId` (تنها ستونِ ارجاعِ حساب AccountSLRef است).
  - اوراکل: دریافتنیِ ۱۴۰۲ = `19,755,458,505`.

### S2.7 — متریکِ `trial_balance`

- [ ] **S2.7** تعریفِ `trial_balance`: تجمیعِ `ACC.VoucherItem` با `GROUP BY a.Title`، فیلترِ سال، و TOP محدود. اوراکل: `5,426,804,727,946`. (منطقِ فعلیِ get_trial_balance را به این تعریف منتقل کن — این مسیر از قبل درست کار می‌کند، فقط اعلانی‌اش کن.)

### S2.8 — متریکِ `cash_bank_balance`

- [ ] **S2.8** تعریفِ `cash_bank_balance`: دو منبع `RPA.CashBalance.Balance` + `RPA.BankAccountBalance.Balance`. این متریک «چند-منبعی» است؛ کامپایلر باید جمعِ دو SUM را بدهد یا دو کوئریِ جدا با تجمیعِ کد. اوراکل: نقد `2,127,900,602` + بانک `7,393,606,464` = `9,521,507,066`.
- اگر مدلِ «چند-منبعی» شِما را پیچیده می‌کند، اجازه است این یک متریک از یک `compositeQueries: MetricDefinition[]` پشتیبانی کند (توسعهٔ کوچکِ شِما، مستند شود).

---

## بخش ج — کامپایلرِ قطعی

> کامپایلر یک تابعِ **خالص** است: `compileMetricPlan(plan, definition, catalog, deps) → CompiledQuery`. هیچ I/O ندارد؛ فقط رشتهٔ SQL می‌سازد. این، تستِ واحدِ آسان و قطعی می‌دهد.

### S3.1 — اسکلتِ کامپایلر و قواعد

- [ ] **S3.1** در `compiler.ts` تابعِ `compileMetricPlan` را بساز که این قواعد را **به‌صورت متمرکز** اعمال کند (همان «قواعد طلاییِ» فاز ۰.۷):

  - **C-quote:** هر جدول از طریقِ `deps.quoteSqlTableRef('Schema.Table')` نقل‌قول شود → `[Schema].[Table]`. هرگز `quoteSqlIdentifier` روی رشتهٔ نقطه‌دار.
  - **C-year (R-سال):** اگر plan فیلتر/مقایسهٔ `by_year` دارد، **همیشه** `JOIN <fyTable> fy ON src.<ref> = fy.FiscalYearId` و `WHERE fy.Title IN (N'…')`. هرگز CAST کلیدِ جانشین.
  - **C-closing (R-اختتامیه):** `mandatoryFilters` همیشه به WHERE اضافه شوند (شاملِ `v.Type NOT IN (3,4)` برای account/trial).
  - **C-fold (R-collation):** اگر `entityNameMatch.foldPersian`، هر دو طرفِ LIKE فولد شوند: نام از `deps.normalizePersianText(...)` + ستون با زنجیرهٔ `REPLACE(...NCHAR...)`. مقدار با `.replace(/'/g,"''")` و `N'%...%'`.
  - **C-inject:** مقادیرِ رشته‌ای `N'...'` با escapeِ `''`؛ مقادیرِ عددی فقط پس از `Number.isFinite` و بررسیِ integer.
  - **C-readonly:** خروجی باید با سیاستِ read-only سازگار باشد (SELECTِ تجمیعی مجاز بدونِ TOP؛ SELECTِ غیرتجمیعی الزاماً TOP/OFFSET).
  - **C-measure:** `debit_minus_credit` → `SUM(<debit>) - SUM(<credit>)`؛ `sum` → `SUM(CAST(<col> AS decimal(18,4)))`؛ `count` → `COUNT(*)`.
  - **C-comparison:** برای `comparison`، الگوی pivot دو-دوره‌ای + ستونِ درصد (`(target-base)*100.0/base`، با NULL-guard وقتی base صفر).

- [ ] **S3.2** تابعِ `deps` کامپایلر را تعریف کن (تزریقِ وابستگی، نه `this`): `{ quoteSqlTableRef, normalizePersianText, ... }`. این کامپایلر را **بدونِ نیاز به نمونهٔ ارکستریتر** قابلِ تست می‌کند.

### S3.3 — تست‌های واحدِ کامپایلر (قطعی، بدونِ DB)

- [ ] **S3.3** فایلِ `tests/unit/financialEngineCompiler.test.ts`:
  - برای هر متریک، `compileMetricPlan` را صدا بزن و **شکلِ SQL** را assert کن (نه اجرا). مثلِ تست‌های فعلیِ `agentOrchestratorDeterministicSql`.
  - assertهای کلیدی: وجودِ `JOIN [FMK].[FiscalYear]` و `fy.Title IN (N'1402'`، وجودِ `v.Type NOT IN (3, 4)` برای account/trial، نقل‌قولِ `[ACC].[VoucherItem]` (نه `[ACC.VoucherItem]`)، فولدِ `REPLACE(... NCHAR(1610)`، عدمِ وجودِ `CAST(FiscalYearRef AS int)`.
  - تستِ ضدِ-تزریق: `entityName: "x' OR '1'='1"` باید escape شود به `x'' OR ''1''=''1`.

### S3.4 — اجرا و آشتیِ عددی با ground-truth (با sqlcmd)

- [ ] **S3.4** برای هر متریک، SQLِ کامپایل‌شده را با sqlcmd روی Sepidar01 اجرا کن و عدد را با اوراکلِ فاز ۰.۷ تطبیق بده. **هیچ متریکی** بدونِ تطابقِ دقیقِ sqlcmd جلو نرود. نتایج را در بخشِ «شاهد S3» ثبت کن.

---

## بخش د — سیم‌کشیِ `FinancialEngine` (بدونِ Planner واقعی هنوز)

> در این فاز، Planner هنوز مدلی نیست؛ یک **planner قطعیِ موقت** (rule-based) از router می‌سازیم تا بتوانیم engine را end-to-end در `shadow` تست کنیم. Planner مدلی در فاز ۴ می‌آید.

### S3.5 — Router (first-pass متریک‌یابی)

- [ ] **S3.5** در `router.ts`، `routeToMetric(prompt) → { metricId, confidence } | null` با امتیازدهیِ وزن‌دارِ `anchors/supportSignals/excludeSignals` (الگوی موجودِ `financialIntentRegistry`). سال‌ها و نامِ موجودیت را با regex و `normalizePersianDigits` استخراج کن.

### S3.6 — Planner موقتِ قطعی

- [ ] **S3.6** `buildDeterministicPlan(prompt, metricId) → MetricPlan`: از router + استخراجِ سال/مقایسه/نامِ موجودیت یک `MetricPlan` بساز. (همان منطقِ روتینگِ فعلی، اما خروجی‌اش حالا یک IR استاندارد است.)

### S3.7 — حلقهٔ engine

- [ ] **S3.7** در `financialEngine/index.ts`:
  ```ts
  async run(prompt): Promise<EngineResult | null> {
    const route = routeToMetric(prompt); if (!route) return null
    const plan = buildDeterministicPlan(prompt, route.metricId)
    const def = catalog.get(plan.metricId)
    const compiled = compileMetricPlan(plan, def, catalog, deps)
    let rows = await deps.executeReadOnlySql(compiled.sql, signal)
    if (rows are empty && def.source.fallbackTables) { /* تلاش fallback */ }
    return { rows, plan, compiled }
  }
  ```
  - خطاها → `safeAuditWrite({stage:'tool-error', errorCategory:'deterministic-tool-failure'})` + `return null` (degrade به legacy).

### S3.8 — سیم‌کشیِ Shadow

- [ ] **S3.8** در نقطهٔ تصمیمِ فاز ۱ (`financialEngineMode`):
  - `shadow`: ابتدا legacy را اجرا و به کاربر بده؛ سپس engine را اجرا و خروجی‌اش را **مقایسه** کن. اگر عددِ engine با legacy فرق داشت یا engine `null` داد، یک خطِ audit بنویس: `{stage:'engine-shadow-compare', metricId, legacyValue, engineValue, match:boolean}`. **هیچ تأثیری روی پاسخِ کاربر نگذار.**
  - `engine`: (هنوز فعال نکن؛ در فاز ۴ پس از Planner مدلی.)

---

## بخش ه — دروازهٔ خروجِ فاز ۲–۳

- [ ] **S3.9** typecheck تمیز + تستِ کامل سبز (شاملِ `financialEngineCompiler.test.ts` جدید).
- [ ] **S3.10** build + deploy + **asar-grep**: `compileMetricPlan` و `net_sales` پیدا شوند.
- [ ] **S3.11** اجرای `shadow` روی هر ۵ متریک از طریقِ field؛ بررسیِ خطوطِ `engine-shadow-compare`: همه باید `match:true` باشند (engine = legacy). هر mismatch ثبت و رفع شود.
- [ ] **S3.12** ثبتِ شواهد (sqlcmd + shadow-compare + audit) در «شاهد S3».

**دروازهٔ خروج:** vertical sliceِ `net_sales` در shadow کاملاً منطبق + بقیهٔ متریک‌ها منطبق، قبل از فاز ۳ (Planner مدلی).

---

## شاهد S3
```
(خالی — هنگام اجرای S3.4 و S3.11 پر شود: متریک، SQL فشرده، عددِ sqlcmd، عددِ engine، match)
```

> قدمِ بعدی: `FRE_ROADMAP_03_PLANNER_AND_VERIFIER.fa.md`.
