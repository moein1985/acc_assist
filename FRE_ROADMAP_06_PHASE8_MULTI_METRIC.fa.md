# FRE Roadmap 06 — فاز ۸: سؤال‌های چند-متریکی، Grains پیچیده و متریک‌های مشتق
### از سؤالِ تک‌متریکی به سؤالِ آزادِ مالی

> پیش‌نیاز: فاز ۷ کامل و سبز. همهٔ ۱۵ متریک در FRE فعال. این فاز Planner و Engine را برای سؤال‌های پیچیده‌تر گسترش می‌دهد: چند متریک در یک سؤال، grains واقعی روی DB، و متریک‌های مشتق (نسبت، رشد).

**مارکرهای asar این فاز:** `MULTI_METRIC_PLAN`, `DERIVED_METRIC`, `SALES_TO_PURCHASE_RATIO`.

---

## ۰ — نقشهٔ فاز

| بخش | موضوع | تغییرِ اصلی |
|---|---|---|
| الف | `MultiMetricPlan` | types.ts + planner.ts + index.ts |
| ب | Grains واقعی روی DB | field test با by_month, by_quarter, by_customer |
| ج | متریک‌های مشتق | `DerivedMetric` در types.ts + catalog |

---

## بخش الف — MultiMetricPlan

> تا اینجا هر سؤال = یک `MetricPlan`. حالا سؤال‌هایی مثل «فروش و خرید ۱۴۰۲» یا «روند ماهانهٔ فروش» را پشتیبانی می‌کنیم.

### S8.1 — نوعِ `MultiMetricPlan`

- [ ] **S8.1** در `types.ts` بعد از `MetricPlan` (خط ۱۰۲)، این نوع را اضافه کن:
  ```ts
  export type JoinMode = 'side_by_side' | 'comparison' | 'trend'

  export interface MultiMetricPlan {
    plans: MetricPlan[]          // ۱ تا N متریک
    joinMode: JoinMode
    confidence: number
  }
  ```
  - `side_by_side`: هر متریک جدا اجرا، خروجی‌ها کنار هم (مثلاً «فروش و خرید ۱۴۰۲»).
  - `comparison`: مقایسهٔ دو متریک (مثلاً «فروش در برابر خرید»).
  - `trend`: یک متریک در چند grain (مثلاً «روند ماهانهٔ فروش ۱۴۰۲»).
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S8.2 — Zod schema برای `MultiMetricPlan`

- [ ] **S8.2** در `types.ts` بعد از `metricPlanSchema` (خط ۲۴۰)، این schema را اضافه کن:
  ```ts
  export const multiMetricPlanSchema = z.object({
    plans: z.array(metricPlanSchema).min(1).max(5),
    joinMode: z.enum(['side_by_side', 'comparison', 'trend']),
    confidence: z.number()
  })
  ```
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S8.3 — Router: تشخیص سؤالِ چند-متریکی

- [ ] **S8.3** در `router.ts` تابعِ جدید `routeMultiMetric(prompt) → { metricIds: MetricId[], joinMode, confidence }`:
  - متن را برای کلمهٔ «و» / «مقایسه» / «در برابر» / «همراه» بررسی کن.
  - اگر دو یا بیشتر metric match شد، `joinMode` را تعیین کن:
    - «و» / «همراه» → `side_by_side`
    - «مقایسه» / «در برابر» / «نسبت» → `comparison`
    - «روند» / «تفکیک» / «ماهانه» → `trend`
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: `routeMultiMetric('فروش و خرید ۱۴۰۲')` باید `['net_sales', 'purchases']` با `joinMode='side_by_side'` برگرداند.

### S8.4 — Planner: ساختِ MultiMetricPlan

- [ ] **S8.4** در `planner.ts` تابعِ `buildDeterministicMultiPlan(prompt) → MultiMetricPlan | null`:
  - از `routeMultiMetric` استفاده کن.
  - برای هر metricId، `buildDeterministicPlan` را صدا بزن.
  - اگر هیچ metric پیدا نشد یا فقط یکی پیدا شد، `null` برگردان (این سؤال تک‌متریکی است).
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test برای «فروش و خرید ۱۴۰۲».

### S8.5 — Engine: اجرای MultiMetricPlan

- [ ] **S8.5** در `financialEngine/index.ts` تابعِ `runMultiMetric(plan: MultiMetricPlan) → MultiMetricResult`:
  ```ts
  export interface MultiMetricResult {
    results: EngineResult[]
    verdicts: EngineVerdict[]
    plan: MultiMetricPlan
  }
  ```
  - برای هر `MetricPlan` در `plan.plans`: `compileMetricPlan` → `executeReadOnlySql` → `verifyResult`.
  - اگر هر کدام fail شد، verdict را ثبت کن ولی ادامه بده.
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S8.6 — Engine: سیم‌کشی در `run`

- [ ] **S8.6** در `financialEngine/index.ts` تابعِ `run` (خط ۲۳۷)، قبل از `routeMetric`، `routeMultiMetric` را امتحان کن:
  - اگر `MultiMetricPlan` ساخته شد → `runMultiMetric` را اجرا کن.
  - اگر نه → مسیرِ تک‌متریکیِ فعلی.
  - **معیارِ پذیرش:** `typecheck:node` تمیز + تست‌های موجود سبز (رفتارِ سؤال‌های تک‌متریکی نباید تغییر کند).

### S8.7 — Explainer: رندرِ MultiMetricPlan

- [ ] **S8.7** در `financialEngine/index.ts` (یا فایلِ explainer اگر جدا است)، تابعِ `composeMultiMetricMarkdown(result: MultiMetricResult) → string`:
  - `side_by_side`: جدول با دو ستون (مثلاً: متریک | مقدار).
  - `comparison`: جدول با ستون‌های مقایسه + درصدِ تفاوت.
  - `trend`: جدول با ستونِ period + مقدار.
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: خروجیِ markdown شاملِ اعدادِ هر دو متریک است.

### S8.8 — تستِ یکپارچهٔ MultiMetric

- [ ] **S8.8** در `tests/integration/financialEngine.integration.test.ts` یک تست اضافه کن:
  - پرامپت: «فروش و خرید ۱۴۰۲»
  - assert: مسیر=engine، دو `EngineResult`، هر دو verdict=ok.
  - **معیارِ پذیرش:** تست سبز.

---

## بخش ب — Grains واقعی روی DB

> تا اینجا `by_month` و `by_quarter` تعریف شده‌اند ولی روی DB واقعی تست نشده‌اند. این بخش اطمینان می‌دهد که compiler SQLِ درست تولید می‌کند.

### S8.9 — field test: `by_month` روی DB واقعی

- [ ] **S8.9** روی remote (192.168.85.56) با `DebugToken=fretok` سؤالِ «فروش به تفکیک ماه ۱۴۰۲» را بپرس:
  - انتظار: ۱۲ ردیف (یک به ازای هر ماه).
  - SQLِ تولیدشده را از audit log استخراج کن و با sqlcmd اجرا کن.
  - **معیارِ پذیرش:** ۱۲ ردیف با اعدادِ غیرصفر. `requestId` و اعداد در «شاهد S8» ثبت شود.

### S8.10 — field test: `by_quarter` روی DB واقعی

- [ ] **S8.10** سؤالِ «فروش به تفکیک فصل ۱۴۰۲» را بپرس:
  - انتظار: ۴ ردیف.
  - **معیارِ پذیرش:** ۴ ردیف. `requestId` و اعداد در «شاهد S8».

### S8.11 — `by_customer`: تعریف و field test

- [ ] **S8.11** در `metricCatalog.ts` به تعریفِ `net_sales` (یا `sales_by_period`) dimensionِ `by_customer` اضافه کن:
  ```ts
  {
    dimension: 'by_customer',
    join: {
      table: 'SLS.Customer',  // یا جدولِ مشتریِ متناظر در schema
      alias: 'cust',
      on: { sourceColumn: 'CustomerRef', targetColumn: 'CustomerId' }
    },
    labelColumn: 'cust.Title',
    labelType: 'nstring'
  }
  ```
  - اگر جدولِ مشتری در schema متفاوت است، با `get_database_schema` کشف کن.
  - `grainSupported` را به‌روز کن و `'by_customer'` اضافه کن.
  - field test: «فروش به تفکیک مشتری ۱۴۰۲» → انتظار: چند ردیف با نامِ مشتری.
  - **معیارِ پذیرش:** `typecheck:node` تمیز + field test با ردیف‌های نامِ مشتری.

### S8.12 — `by_branch`: تعریف و field test (اگر شعبه وجود دارد)

- [ ] **S8.12** بررسی کن آیا جدولِ شعبه در schema وجود دارد (با `get_database_schema`). اگر بله:
  - dimensionِ `by_branch` اضافه کن (JOIN به جدولِ شعبه).
  - field test: «فروش به تفکیک شعبه ۱۴۰۲».
  - اگر جدولِ شعبه وجود ندارد، این گام را با `[x]` و یادداشتِ «جدول شعبه در schema نیست» ببند.
  - **معیارِ پذیرش:** `typecheck:node` تمیز + field test (یا یادداشتِ عدمِ وجود).

### S8.13 — golden tests برای grains جدید

- [ ] **S8.13** در `golden-metrics.json` مواردِ زیر را اضافه کن:
  - «فروش به تفکیک ماه ۱۴۰۲» → `expectedGrain: 'by_month'`, `expect: 'any_rows'`
  - «فروش به تفکیک فصل ۱۴۰۲» → `expectedGrain: 'by_quarter'`, `expect: 'any_rows'`
  - «فروش به تفکیک مشتری ۱۴۰۲» → `expectedGrain: 'by_customer'`, `expect: 'any_rows'`
  - **معیارِ پذیرش:** `eval:metrics` سبز.

---

## بخش ج — متریک‌های مشتق

> متریکِ مشتق = تابعی روی نتایجِ چند متریکِ پایه. مثلاً: نسبت فروش به خرید = net_sales / purchases * 100.

### S8.14 — نوعِ `DerivedMetric`

- [ ] **S8.14** در `types.ts` اضافه کن:
  ```ts
  export interface DerivedMetric {
    id: string
    titleFa: string
    inputs: MetricId[]                  // متریک‌های پایه
    formula: (results: Record<string, number>) => number
    description: string
    unit?: 'percent' | 'ratio' | 'currency'
  }
  ```
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S8.15 — کاتالوگِ متریک‌های مشتق

- [ ] **S8.15** در `metricCatalog.ts` (یا فایلِ جدید `derivedCatalog.ts`) چند متریکِ مشتق تعریف کن:
  ```ts
  export const derivedCatalog: DerivedMetric[] = [
    {
      id: 'sales_to_purchase_ratio',
      titleFa: 'نسبت فروش به خرید',
      inputs: ['net_sales', 'purchases'],
      formula: (r) => r['net_sales'] / r['purchases'] * 100,
      description: 'درصد فروش نسبت به خرید',
      unit: 'percent'
    },
    {
      id: 'gross_margin',
      titleFa: 'حاشیه سود ناخالص',
      inputs: ['net_sales', 'purchases'],
      formula: (r) => (r['net_sales'] - r['purchases']) / r['net_sales'] * 100,
      description: 'حاشیه سود ناخالص (فروش منهای خرید تقسیم بر فروش)',
      unit: 'percent'
    }
  ]
  ```
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S8.16 — Engine: اجرای متریکِ مشتق

- [ ] **S8.16** در `financialEngine/index.ts` تابعِ `runDerivedMetric(derived: DerivedMetric, plan: MetricPlan) → EngineResult`:
  - برای هر `input` metricId: `compileMetricPlan` → `executeReadOnlySql` → عدد را استخراج کن.
  - `derived.formula` را روی اعداد اجرا کن.
  - نتیجه را در یک `EngineResult` با `result_value` بگذار.
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S8.17 — Router: تشخیص متریکِ مشتق

- [ ] **S8.17** در `router.ts` تابعِ `routeDerivedMetric(prompt) → DerivedMetric | null`:
  - برای هر `DerivedMetric` در `derivedCatalog`: `titleFa` و `description` را با متنِ سؤال مقایسه کن.
  - اگر match شد، `DerivedMetric` برگردان.
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: `routeDerivedMetric('نسبت فروش به خرید')` باید `sales_to_purchase_ratio` برگرداند.

### S8.18 — golden test برای متریک‌های مشتق

- [ ] **S8.18** در `golden-metrics.json` اضافه کن:
  - «نسبت فروش به خرید ۱۴۰۲» → `expectedMetricId: 'sales_to_purchase_ratio'`, `expect: 'any_number'`
  - **معیارِ پذیرش:** `eval:metrics` سبز.

---

## بخش د — دروازهٔ خروجِ فاز ۸

- [ ] **S8.19** `npm run typecheck:node` تمیز + `npm test` سبز.
  - **شاهد:** خروجی در «شاهد S8».
- [ ] **S8.20** `npm run eval:metrics` سبز (همهٔ مواردِ قدیم + جدید).
  - **شاهد:** تعدادِ کل و pass rate.
- [ ] **S8.21** `npm run build:win` + asar-grep: `MULTI_METRIC_PLAN` و `DERIVED_METRIC` و `SALES_TO_PURCHASE_RATIO` در `app.asar` پیدا شوند.
  - **شاهد:** خروجیِ asar-grep.
- [ ] **S8.22** field test روی remote: «فروش و خرید ۱۴۰۲» (MultiMetric) + «فروش به تفکیک ماه ۱۴۰۲» (trend) + «نسبت فروش به خرید ۱۴۰۲» (derived).
  - **شاهد:** نتایج در «شاهد S8».
- [ ] **S8.23** ثبتِ شواهد در «شاهد S8».

---

## شاهد S8
```
<پس از تکمیل، این بخش پر شود>

MultiMetricPlan:
  "فروش و خرید ۱۴۰۲": net_sales=<value>, purchases=<value> — verdict=ok (requestId=<id>)
  joinMode=side_by_side

Grains on real DB:
  by_month: 12 rows for 1402 (requestId=<id>)
  by_quarter: 4 rows for 1402 (requestId=<id>)
  by_customer: <N> rows (requestId=<id>)
  by_branch: <N> rows or "not in schema" (requestId=<id>)

Derived metrics:
  sales_to_purchase_ratio: <value>% (requestId=<id>)
  gross_margin: <value>% (requestId=<id>)

eval:metrics: <N>/<N> (100%)
tests: <N> pass, 0 fail
typecheck: node + web clean
build:win: success
asar-grep: MULTI_METRIC_PLAN, DERIVED_METRIC, SALES_TO_PURCHASE_RATIO found
```

> قدمِ بعدی: `FRE_ROADMAP_07_PHASE9_PRODUCTION.fa.md`.
