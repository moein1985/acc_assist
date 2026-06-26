# FRE Roadmap 05 — فاز ۷: مهاجرتِ ۹ intent باقی‌مانده به FRE
### هر متریک = یک تعریف + یک golden test — خروج نهایی از تردمیل

> پیش‌نیاز: فاز ۶ کامل و سبز. ۶ متریک در `engine` mode فعال. ۴ هندلر DEPRECATED. این فاز ۹ intent باقی‌مانده را به FRE مهاجرت می‌دهد تا **هیچ هندلرِ دست‌سازی باقی نماند.**

**مارکرهای asar این فاز:** `PARTY_BALANCE`, `RECEIVABLES`, `PAYABLES`, `CASHFLOW`, `ACCOUNT_TURNOVER`, `RECENT_DOCUMENTS`.

---

## ۰ — نقشهٔ فاز

| ترتیب | intent فعلی | MetricId جدید | پیچیدگی | تغییرِ شِما |
|---|---|---|---|---|
| ۱ | `count_fiscal_years` | `fiscal_year_count` | پایین | بدون تغییر |
| ۲ | `list_fiscal_years` | `fiscal_year_list` | پایین | `kind: 'list'` |
| ۳ | `get_party_balance` | `party_balance` | متوسط | بدون تغییر |
| ۴ | `get_receivables_summary` | `receivables` | متوسط | بدون تغییر |
| ۵ | `get_payables_summary` | `payables` | متوسط | بدون تغییر |
| ۶ | `get_cashflow_summary` | `cashflow` | متوسط | بدون تغییر |
| ۷ | `get_sales_summary_by_period` | `sales_by_period` | متوسط | `by_quarter` grain |
| ۸ | `get_account_turnover` | `account_turnover` | بالا | `op: 'between'` |
| ۹ | `get_recent_or_suspicious_documents` | `recent_documents` | بالا | `topN` + `orderBy` |

> **اصل:** اول شِما را گسترش بده، بعد compiler را به‌روز کن، بعد متریک را اضافه کن، بعد golden test را اضافه کن، بعد `eval:metrics` را سبز کن. **یک متریک در هر زمان.**

---

## بخش الف — گسترشِ شِما (types.ts)

### S7.1 — MetricId های جدید

- [ ] **S7.1** در `src/main/services/financialEngine/types.ts` خط ۳، `MetricId` را گسترش بده:
  ```ts
  export type MetricId =
    | 'net_sales' | 'purchases' | 'account_balance' | 'trial_balance'
    | 'cash_bank_balance' | 'sales_count'
    | 'fiscal_year_count' | 'fiscal_year_list'
    | 'party_balance' | 'receivables' | 'payables'
    | 'cashflow' | 'sales_by_period'
    | 'account_turnover' | 'recent_documents'
  ```
  - **معیارِ پذیرش:** `npm run typecheck:node` تمیز. (تست‌ها ممکن است fail شوند چون catalog هنوز این idها را نمی‌شناسد — فقط typecheck کافی است.)

### S7.2 — AggregateKind: `kind: 'list'`

- [ ] **S7.2** در `types.ts` خط ۱۳، `AggregateKind` را گسترش بده:
  ```ts
  export type AggregateKind =
    | { kind: 'sum'; column: string }
    | { kind: 'count' }
    | { kind: 'debit_minus_credit'; debitColumn: string; creditColumn: string }
    | { kind: 'list'; columns: string[] }
  ```
  - **معیارِ پذیرش:** `typecheck:node` تمیز.
  - **نکته:** `list` یعنی SELECT غیرتجمیتی با TOP. compiler در S7.11 آموزش می‌بیند.

### S7.3 — PlanFilter: `op: 'between'`

- [ ] **S7.3** در `types.ts` خط ۸۵، `PlanFilter.op` را گسترش بده:
  ```ts
  export interface PlanFilter {
    dimension: Grain
    op: 'eq' | 'in' | 'between'
    values: string[]    // between: values[0]=from, values[1]=to
  }
  ```
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S7.4 — MetricPlan: `topN` و MetricDefinition: `orderBy`

- [ ] **S7.4** در `types.ts`:
  - به `MetricPlan` (خط ۹۱) فیلدِ `topN?: number` اضافه کن.
  - به `MetricDefinition` (خط ۶۶) فیلدِ `orderBy?: { column: string; direction: 'ASC' | 'DESC' }` اضافه کن.
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S7.5 — به‌روزرسانیِ Zod schemas

- [ ] **S7.5** در `types.ts`:
  - `aggregateKindSchema` (خط ۱۲۳): `z.object({ kind: z.literal('list'), columns: z.array(z.string()) })` اضافه کن.
  - `planFilterSchema` (خط ۲۱۴): `op: z.enum(['eq', 'in', 'between'])`.
  - `metricPlanSchema` (خط ۲۲۰): `topN: z.number().optional()` اضافه کن.
  - `metricDefinitionSchema` (خط ۱۹۶): `orderBy: z.object({ column: z.string(), direction: z.enum(['ASC', 'DESC']) }).optional()` اضافه کن.
  - `metricPlanSchema.metricId` (خط ۲۲۱): همهٔ MetricIdهای جدید را اضافه کن.
  - `metricDefinitionSchema.id` (خط ۱۹۷): همهٔ MetricIdهای جدید را اضافه کن.
  - **معیارِ پذیرش:** `typecheck:node` تمیز + همهٔ تست‌های موجود سبز.

### S7.6 — Grain: `by_quarter`

- [ ] **S7.6** در `types.ts` خط ۱۱، `Grain` را گسترش بده:
  ```ts
  export type Grain = 'total' | 'by_year' | 'by_month' | 'by_quarter' | 'by_account' | 'by_branch' | 'by_customer'
  ```
  - در `dimensionBindingSchema` (خط ۱۳۹) و `planFilterSchema` و `metricPlanSchema` هم `'by_quarter'` را به enum اضافه کن.
  - **معیارِ پذیرش:** `typecheck:node` تمیز + تست‌ها سبز.

---

## بخش ب — متریک‌های ساده (۱-۲)

### S7.7 — `fiscal_year_count`

- [ ] **S7.7** در `metricCatalog.ts` بعد از `sales_count` (خط ۲۰۲)، این تعریف را اضافه کن:
  ```ts
  {
    id: 'fiscal_year_count',
    titleFa: 'تعداد سال‌های مالی',
    anchors: ['تعداد سال مالی', 'چند سال مالی', 'تعداد سال‌های مالی'],
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'FMK.FiscalYear', alias: 'fy' },
    measure: { kind: 'count' },
    dimensions: [],
    mandatoryFilters: []
  }
  ```
  - **معیارِ پذیرش:** `typecheck:node` تمیز. `routeMetric('تعداد سال‌های مالی')` باید `fiscal_year_count` برگرداند.

### S7.8 — golden test برای `fiscal_year_count`

- [ ] **S7.8** در `scripts/fixtures/golden-metrics.json` یک مورد اضافه کن:
  ```json
  {
    "prompt": "تعداد سال‌های مالی چقدر است؟",
    "expectedMetricId": "fiscal_year_count",
    "expectedGrain": "total",
    "expectedValue": null,
    "expect": "any_number",
    "tolerance": 0
  }
  ```
  - **معیارِ پذیرش:** `npm run eval:metrics` سبز (شاملِ مورد جدید).

### S7.9 — `fiscal_year_list` (نیازمند `kind: 'list'` در compiler)

- [ ] **S7.9** در `metricCatalog.ts` اضافه کن:
  ```ts
  {
    id: 'fiscal_year_list',
    titleFa: 'فهرست سال‌های مالی',
    anchors: ['فهرست سال مالی', 'سال‌های مالی', 'لیست سال‌های مالی', 'چه سال‌هایی'],
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز', 'تعداد'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'FMK.FiscalYear', alias: 'fy' },
    measure: { kind: 'list', columns: ['FiscalYearId', 'Title'] },
    dimensions: [],
    mandatoryFilters: [],
    orderBy: { column: 'Title', direction: 'DESC' }
  }
  ```

### S7.10 — compiler: پشتیبانی `kind: 'list'`

- [ ] **S7.10** در `compiler.ts` تابعِ `buildMeasureExpr` (خط ۱۸)، case جدید اضافه کن:
  ```ts
  case 'list': {
    return measure.columns.map(c => `${alias}.${deps.quoteSqlIdentifier(c)}`).join(', ')
  }
  ```
  - در `buildStandardQuery` (خط ۲۱۷)، وقتی `measure.kind === 'list'`:
    - `result_value` alias نگذار — ستون‌ها خودشان نام دارند.
    - اگر `plan.topN` وجود دارد، `SELECT TOP(n)` تولید کن.
    - اگر `definition.orderBy` وجود دارد، `ORDER BY` اضافه کن.
    - `GROUP BY` نگذار.
  - **معیارِ پذیرش:** `typecheck:node` تمیز. یک unit test در `financialEngineCompiler.test.ts` اضافه کن که `compileMetricPlan` برای `fiscal_year_list` SQLِ `SELECT TOP(100) fy.FiscalYearId, fy.Title FROM [FMK].[FiscalYear] AS fy ORDER BY fy.Title DESC` تولید می‌کند.

### S7.11 — golden test برای `fiscal_year_list`

- [ ] **S7.11** در `golden-metrics.json` اضافه کن:
  ```json
  {
    "prompt": "فهرست سال‌های مالی چیست؟",
    "expectedMetricId": "fiscal_year_list",
    "expectedGrain": "total",
    "expect": "any_rows"
  }
  ```
  - **معیارِ پذیرش:** `eval:metrics` سبز.

---

## بخش ج — متریک‌های متوسط (۳-۷)

### S7.12 — `party_balance`

- [ ] **S7.12** در `metricCatalog.ts` اضافه کن. منطقِ legacy را از `deterministicTools.ts` بخوان (intent `get_party_balance`). تعریفِ اعلانی:
  - `source`: `ACC.VoucherItem vi` با `requiredJoins: [ACC.Voucher v ON vi.VoucherRef=v.VoucherId]`
  - `measure`: `debit_minus_credit` با `Debit`/`Credit`
  - `entityNameMatch`: روی ستونِ طرف‌حساب (مثلاً `p.Title` با JOIN به `ACC.Partner` یا جدولِ متناظر)
  - `mandatoryFilters`: `v.Type NOT IN (3, 4)` (همان R-اختتامیه)
  - `dimensions`: `by_year` (JOIN FiscalYear روی `v.FiscalYearRef`)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. `routeMetric('مانده طرف حساب')` باید `party_balance` برگرداند.

### S7.13 — golden test برای `party_balance`

- [ ] **S7.13** در `golden-metrics.json` اضافه کن. ابتدا با sqlcmd روی DB واقعی عددِ مرجع بگیر:
  ```sql
  SELECT SUM(vi.Debit) - SUM(vi.Credit) FROM [ACC].[VoucherItem] AS vi
  JOIN [ACC].[Voucher] AS v ON vi.VoucherRef = v.VoucherId
  WHERE v.Type NOT IN (3, 4)
  ```
  - عدد را در `expectedValue` ثبت کن.
  - **معیارِ پذیرش:** `eval:metrics` سبز.

### S7.14 — `receivables`

- [ ] **S7.14** در `metricCatalog.ts` اضافه کن. منطقِ legacy را از `deterministicTools.ts` بخوان (intent `get_receivables_summary`). تعریف:
  - `source`: `ACC.VoucherItem vi` + `requiredJoins: [ACC.Voucher v, ACC.Account a]`
  - `measure`: `sum` روی `Debit` (یا `debit_minus_credit` — بسته به منطقِ legacy)
  - `mandatoryFilters`: `v.Type NOT IN (3, 4)` + فیلترِ نوعِ حسابِ دریافتنی (مثلاً `a.Type = N'دریافتنی'` یا کدِ نوع)
  - `dimensions`: `by_year`
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S7.15 — golden test برای `receivables`

- [ ] **S7.15** در `golden-metrics.json` اضافه کن. عددِ مرجع را با sqlcmd بگیر و ثبت کن.
  - **معیارِ پذیرش:** `eval:metrics` سبز.

### S7.16 — `payables`

- [ ] **S7.16** در `metricCatalog.ts` اضافه کن. قرینهٔ `receivables`:
  - همان source و joins
  - `measure`: `sum` روی `Credit` (یا `debit_minus_credit` معکوس)
  - `mandatoryFilters`: `v.Type NOT IN (3, 4)` + فیلترِ نوعِ حسابِ پرداختنی
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S7.17 — golden test برای `payables`

- [ ] **S7.17** در `golden-metrics.json` اضافه کن. عددِ مرجع با sqlcmd.
  - **معیارِ پذیرش:** `eval:metrics` سبز.

### S7.18 — `cashflow`

- [ ] **S7.18** در `metricCatalog.ts` اضافه کن. منطقِ legacy را از `deterministicTools.ts` بخوان (intent `get_cashflow_summary`). این متریک `compositeSources` دارد (مثل `cash_bank_balance`):
  - `source`: `RPA.CashBalance cb` با `compositeSources: [{ table: 'RPA.BankAccountBalance', alias: 'bb', measure: {kind:'sum', column:'Balance'} }]`
  - یا اگر منطقِ legacy متفاوت است (ورودی/خروجی جدا)، مطابقِ آن تعریف کن.
  - `dimensions`: `by_year` اگر جدول FiscalYearRef دارد.
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S7.19 — golden test برای `cashflow`

- [ ] **S7.19** در `golden-metrics.json` اضافه کن. عددِ مرجع با sqlcmd.
  - **معیارِ پذیرش:** `eval:metrics` سبز.

### S7.20 — `sales_by_period`

- [ ] **S7.20** در `metricCatalog.ts` اضافه کن. این متریک `net_sales` با grain ماهانه/فصلی است:
  - `source`: `SLS.Invoice src` (مثل net_sales)
  - `measure`: `sum` روی `NetPriceInBaseCurrency`
  - `grainSupported`: `['by_month', 'by_quarter', 'by_year']`
  - `dimensions`: `by_year` (JOIN FiscalYear), `by_month` (`MONTH(src.Date)`), `by_quarter` (`DATEPART(QUARTER, src.Date)`)
  - `anchors`: ['فروش ماهانه', 'فروش فصلی', 'فروش به تفکیک ماه', 'خلاصه فروش']
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S7.21 — compiler: پشتیبانی `by_quarter`

- [ ] **S7.21** در `compiler.ts` تابعِ `buildStandardQuery` (خط ۲۳۳)، وقتی `plan.grain === 'by_quarter'`:
  - `selectCols` باید `DATEPART(QUARTER, src.Date) AS period` اضافه کن.
  - `groupByCols` باید `DATEPART(QUARTER, src.Date)` اضافه کن.
  - این باید به‌صورت خودکار کار کند اگر `DimensionBinding` با `labelColumn: 'DATEPART(QUARTER, src.Date)'` و `labelType: 'int'` تعریف شده باشد. بررسی کن که compiler با این labelColumn درست رفتار می‌کند.
  - **معیارِ پذیرش:** unit test در `financialEngineCompiler.test.ts` که SQLِ `by_quarter` را assert می‌کند.

### S7.22 — golden test برای `sales_by_period`

- [ ] **S7.22** در `golden-metrics.json` اضافه کن. دو مورد: یکی `by_month` و یکی `by_quarter`.
  - **معیارِ پذیرش:** `eval:metrics` سبز.

---

## بخش د — متریک‌های پیچیده (۸-۹)

### S7.23 — compiler: پشتیبانی `op: 'between'`

- [ ] **S7.23** در `compiler.ts` تابعِ `buildWhereClauses` (خط ۱۴۲)، بعد از بلوکِ `pf.op === 'eq'`، else-if اضافه کن:
  ```ts
  } else if (pf.op === 'between') {
    const from = formatFilterValue(pf.values[0], dim.labelType)
    const to = formatFilterValue(pf.values[1], dim.labelType)
    where.push(`${labelCol} BETWEEN ${from} AND ${to}`)
  }
  ```
  - **معیارِ پذیرش:** unit test در `financialEngineCompiler.test.ts` که `BETWEEN` را assert می‌کند.

### S7.24 — planner: استخراج dateRange

- [ ] **S7.24** در `planner.ts` تابعِ `buildDeterministicPlan` (خط ۶)، regex برای بازهٔ تاریخ اضافه کن:
  ```ts
  const dateRangeMatch = normalized.match(/(?:از|بازه)\s*(\d{4}\/\d{1,2}\/\d{1,2})\s*(?:تا|الی)\s*(\d{4}\/\d{1,2}\/\d{1,2})/u)
  if (dateRangeMatch && def.grainSupported.includes('by_year')) {
    filters.push({ dimension: 'by_year', op: 'between', values: [dateRangeMatch[1], dateRangeMatch[2]] })
  }
  ```
  - **نکته:** اگر متریک `account_turnover` فیلتر تاریخ روی ستونِ `Date` دارد (نه `by_year`)، ممکن است نیاز به یک `DimensionBinding` با `dimension: 'by_date'` باشد. بررسی کن و در صورت نیاز `Grain` را گسترش بده.
  - **معیارِ پذیرش:** `typecheck:node` تمیز + unit test برای استخراجِ dateRange.

### S7.25 — `account_turnover`

- [ ] **S7.25** در `metricCatalog.ts` اضافه کن. منطقِ legacy را از `deterministicTools.ts` بخوان (intent `get_account_turnover` — model-assisted). تعریف:
  - `source`: `ACC.VoucherItem vi` + `requiredJoins: [ACC.Voucher v, ACC.Account a]`
  - `measure`: `sum` روی `Debit` (یا `debit_minus_credit` — بسته به منطقِ legacy)
  - `entityNameMatch`: روی `a.Title` با `foldPersian: true`
  - `mandatoryFilters`: `v.Type NOT IN (3, 4)`
  - `dimensions`: `by_year` + یک dimension برای تاریخ (مثلاً `by_date` اگر اضافه کردی)
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S7.26 — golden test برای `account_turnover`

- [ ] **S7.26** در `golden-metrics.json` اضافه کن. عددِ مرجع با sqlcmd:
  ```sql
  SELECT SUM(vi.Debit) FROM [ACC].[VoucherItem] AS vi
  JOIN [ACC].[Voucher] AS v ON vi.VoucherRef = v.VoucherId
  JOIN [ACC].[Account] AS a ON vi.AccountSLRef = a.AccountId
  WHERE v.Type NOT IN (3, 4) AND v.Date BETWEEN '1402-01-01' AND '1402-12-29'
  ```
  - **معیارِ پذیرش:** `eval:metrics` سبز.

### S7.27 — compiler: پشتیبانی `topN` + `orderBy`

- [ ] **S7.27** در `compiler.ts` تابعِ `buildStandardQuery` (خط ۲۱۷):
  - اگر `plan.topN` وجود دارد و `measure.kind === 'list'`: `SELECT TOP(${plan.topN})` تولید کن.
  - اگر `definition.orderBy` وجود دارد: `ORDER BY ${orderBy.column} ${orderBy.direction}` به انتهای SQL اضافه کن.
  - **معیارِ پذیرش:** unit test در `financialEngineCompiler.test.ts` که `TOP` و `ORDER BY` را assert می‌کند.

### S7.28 — `recent_documents`

- [ ] **S7.28** در `metricCatalog.ts` اضافه کن. منطقِ legacy را از `deterministicTools.ts` بخوان (intent `get_recent_or_suspicious_documents` — model-assisted). تعریف:
  - `source`: `ACC.Voucher v` (یا جدولِ سندِ متناظر)
  - `measure`: `{ kind: 'list', columns: ['VoucherId', 'Date', 'Description', 'Type'] }`
  - `orderBy`: `{ column: 'v.Date', direction: 'DESC' }`
  - `mandatoryFilters`: [] (یا فیلترِ `IsSuspicious = 1` اگر حالتِ suspicious خواسته شد)
  - `dimensions`: []
  - **نکته:** `topN` در `MetricPlan` توسط planner از متنِ سؤال استخراج می‌شود (مثلاً «۱۰ سند اخیر» → `topN: 10`). اگر عددی ذکر نشد، پیش‌فرض `topN: 20`.
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S7.29 — planner: استخراج `topN`

- [ ] **S7.29** در `planner.ts` تابعِ `buildDeterministicPlan`، regex برای تعداد اضافه کن:
  ```ts
  const topNMatch = normalized.match(/(\d+)\s*(?:سند|فاکتور|رکورد|ردیف)/u)
  if (topNMatch) {
    plan.topN = parseInt(topNMatch[1], 10)
  }
  ```
  - اگر عددی پیدا نشد و metric `recent_documents` است، `topN = 20` پیش‌فرض.
  - **معیارِ پذیرش:** `typecheck:node` تمیز + unit test.

### S7.30 — golden test برای `recent_documents`

- [ ] **S7.30** در `golden-metrics.json` اضافه کن:
  ```json
  {
    "prompt": "۱۰ سند اخیر چیست؟",
    "expectedMetricId": "recent_documents",
    "expectedGrain": "total",
    "expect": "any_rows"
  }
  ```
  - **معیارِ پذیرش:** `eval:metrics` سبز.

---

## بخش ه — DEPRECATED + دروازهٔ خروج

### S7.31 — DEPRECATED همهٔ ۹ intent باقی‌مانده

- [ ] **S7.31** در `financialIntentRegistry.ts` به descriptionِ این ۹ intent `[DEPRECATED: superseded by FRE metric <metric_id> — retained as rollback safety net]` اضافه کن:
  - `count_fiscal_years` → `fiscal_year_count`
  - `list_fiscal_years` → `fiscal_year_list`
  - `get_party_balance` → `party_balance`
  - `get_receivables_summary` → `receivables`
  - `get_payables_summary` → `payables`
  - `get_cashflow_summary` → `cashflow`
  - `get_sales_summary_by_period` → `sales_by_period`
  - `get_account_turnover` → `account_turnover`
  - `get_recent_or_suspicious_documents` → `recent_documents`
  - **معیارِ پذیرش:** `typecheck:node` تمیز + تست‌ها سبز.

### S7.32 — به‌روزرسانی legacy inventory

- [ ] **S7.32** در `deterministicTools.ts` بالای `resolveDeterministicFinancialTool` (خط ۶۴)، کامنتِ DEPRECATED را به‌روز کن و همهٔ ۱۳ intent را فهرست کن (۴ قبلی + ۹ جدید).
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S7.33 — دروازهٔ خروج

- [ ] **S7.33** `npm run typecheck:node` تمیز + `npm test` سبز (همهٔ تست‌های موجود + مواردِ جدید).
  - **شاهد:** خروجیِ `typecheck:node` و `npm test` در بخشِ «شاهد S7» ثبت شود.
- [ ] **S7.34** `npm run eval:metrics` سبز (همهٔ مواردِ قدیم + جدید).
  - **شاهد:** خروجیِ `eval:metrics` با تعدادِ کل و pass rate.
- [ ] **S7.35** `npm run build:win` + asar-grep: مارکرهای `PARTY_BALANCE`, `RECEIVABLES`, `PAYABLES`, `CASHFLOW`, `ACCOUNT_TURNOVER`, `RECENT_DOCUMENTS` در `app.asar` پیدا شوند.
  - **شاهد:** خروجیِ asar-grep.
- [ ] **S7.36** field test روی remote (192.168.85.56): ۳ متریکِ جدید با `DebugToken=fretok` در `engine` mode تست شود. برای هر کدام `requestId`، عدد، و `verdict` را ثبت کن.
  - **شاهد:** نتایجِ field test در بخشِ «شاهد S7».
- [ ] **S7.37** ثبتِ شواهد در «شاهد S7» زیر.

---

## شاهد S7
```
<پس از تکمیل، این بخش پر شود>

Schema changes:
  New MetricId values: 9
  New AggregateKind: kind='list'
  New PlanFilter op: 'between'
  New MetricPlan field: topN
  New MetricDefinition field: orderBy
  New Grain: by_quarter

Metrics added:
  fiscal_year_count: <sqlcmd value>
  fiscal_year_list: <rows count>
  party_balance: <sqlcmd value>
  receivables: <sqlcmd value>
  payables: <sqlcmd value>
  cashflow: <sqlcmd value>
  sales_by_period: <sqlcmd value>
  account_turnover: <sqlcmd value>
  recent_documents: <rows count>

eval:metrics: <N>/<N> (100%)
tests: <N> pass, 0 fail
typecheck: node + web clean
build:win: success
asar-grep: all markers found

Field test (engine mode, remote 192.168.85.56):
  <metric>: <value> — verdict=<ok> (requestId=<id>)
  ...

DEPRECATED: all 13 legacy intents marked
Legacy-only remaining: 0
```

> قدمِ بعدی: `FRE_ROADMAP_06_PHASE8_MULTI_METRIC.fa.md`.
