# FRE Roadmap 10 — فاز ۱۲: Schema Abstraction Layer و پشتیبانی از نرم‌افزارهای حسابداری دیگر
### از hardcoded Sepidar به معماری multi-software — یک موتور، چندین schema adapter

> پیش‌نیاز: فاز ۱۱ کامل. ۱۰۰+ golden case سبز. صورت‌های مالی استاندارد پیاده‌سازی شده. Planner پیشرفته فعال. محصول روی سپیدار پخته و field-tested. پیش‌نویس نیازمندی‌های Schema Abstraction Layer در شاهد S11 مستند شده.

**مارکرهای asar این فاز:** `SCHEMA_ABSTRACTION`, `MULTI_SOFTWARE`, `HAMKARAN_ADAPTER`.

---

## ۰ — نقشهٔ فاز

| بخش | موضوع | اندازه |
|---|---|---|
| الف | طراحی و پیاده‌سازی SchemaAdapter interface | متوسط |
| ب | SepidarAdapter — refactor موجود به adapter | متوسط |
| ج | HamkaranAdapter — نرم‌افزار دوم | متوسط–بزرگ |
| د | تست و اعتبارسنجی multi-software | متوسط |

---

## ۱ — مسئله و انگیزه

### وضعیت فعلی
- `metricCatalog.ts` شامل ۱۵+ متریک با `softwareId: 'sepidar'` — تمام table/column references مستقیماً به schema سپیدار hardcode شده‌اند (`SLS.Invoice`, `ACC.VoucherItem`, `FMK.FiscalYear` و ...)
- `MetricDefinition.source.primaryTable` یک رشتهٔ ثابت مثل `'SLS.Invoice'` است
- Joins، filters، dimensions همگی به نام‌های فیزیکی سپیدار گره خورده‌اند
- افزودن نرم‌افزار جدید = بازنویسی کامل catalog

### هدف
- یک `SchemaAdapter` interface که نقشهٔ مفاهیم حسابداری (فروش، خرید، سند، حساب، سال مالی) را به schema فیزیکی هر نرم‌افزار تبدیل کند
- `MetricDefinition` به جای `SLS.Invoice` از `conceptRef('sales_invoice')` استفاده کند
- Adapter مسئول: table name, column name, join path, fiscal year mapping, voucher type enum, account classification
- افزودن نرم‌افزار جدید = فقط یک adapter جدید + golden test — بدون تغییر در catalog یا compiler

### نرم‌افزارهای هدف (اولویت‌بندی شده)
1. **سپیدار** (موجود — refactor به adapter)
2. **همکاران سیستم** (Hamkaran — پرکاربردترین بعد از سپیدار)
3. **پارسیان** (Persian — متوسط)
4. **رافع** (Rafe — متوسط)
5. **نوسا** (Nosa — کوچک)

---

## بخش الف — طراحی و پیاده‌سازی SchemaAdapter interface

### S12.1 — تحقیق schema نرم‌افزارهای دیگر

- [ ] **S12.1** schema نرم‌افزار همکاران را تحقیق کن:
  - آیا SQL Server است یا MySQL یا چیز دیگر؟
  - نام جداول فروش، خرید، سند، حساب، سال مالی چیست؟
  - ساختار fiscal year چگونه است؟ (FK؟ عنوان؟)
  - enum نوع سند چه تفاوتی با سپیدار دارد؟
  - دسته‌بندی حساب‌ها (دارایی/بدهی/حقوق) چگونه است؟
  - **خروجی:** جدول مقایسه‌ای schema در «شاهد S12».
  - **معیارِ پذیرش:** حداقل ۵ تفاوت کلیدی مستند شده.

### S12.2 — طراحی SchemaAdapter interface

- [ ] **S12.2** در `src/main/services/financialEngine/schemaAdapter.ts` یک interface طراحی کن:
  ```typescript
  interface SchemaAdapter {
    softwareId: string
    // نقشهٔ مفهوم به table فیزیکی
    resolveTable(concept: AccountingConcept): string
    // نقشهٔ مفهوم به column فیزیکی
    resolveColumn(concept: AccountingConcept, field: string): string
    // join path برای fiscal year
    getFiscalYearJoin(sourceAlias: string, sourceColumn: string): JoinSpec
    // enum نوع سند
    getVoucherTypeFilter(excludeClosing: boolean): string
    // دسته‌بندی حساب‌ها
    getAccountClassification(category: AccountCategory): string
    // collation و Persian text handling
    getPersianTextFoldExpression(column: string): string
    // اطلاعات اتصال (connection string builder)
    buildConnectionString(config: SoftwareConfig): string
  }
  ```
  - `AccountingConcept` = enum: `sales_invoice`, `purchase_invoice`, `voucher`, `voucher_item`, `account`, `fiscal_year`, `partner`, `cash_balance`, `bank_balance`
  - `AccountCategory` = enum: `asset`, `liability`, `equity`, `revenue`, `expense`
  - **معیارِ پذیرش:** `typecheck:node` تمیز. interface با حداقل ۸ متد.

### S12.3 — refactor MetricDefinition برای استفاده از concept refs

- [ ] **S12.3** در `types.ts` و `metricCatalog.ts` ساختار `MetricDefinition` را refactor کن:
  - `source.primaryTable` از `'SLS.Invoice'` به `concept: 'sales_invoice'` تغییر کند
  - `requiredJoins` از table name فیزیکی به concept ref تغییر کند
  - `dimensions[].join.table` از `'FMK.FiscalYear'` به `concept: 'fiscal_year'` تغییر کند
  - `mandatoryFilters[].sql` از SQL خام به structured filter با concept refs تغییر کند
  - **معیارِ پذیرش:** `typecheck:node` تمیز. `metricCatalog.ts` بدون hardcoded table name.

### S12.4 — پیاده‌سازی SepidarAdapter

- [ ] **S12.4** در `src/main/services/financialEngine/adapters/sepidarAdapter.ts`:
  - implements `SchemaAdapter`
  - `resolveTable('sales_invoice')` → `'SLS.Invoice'`
  - `resolveTable('voucher_item')` → `'ACC.VoucherItem'`
  - `resolveTable('fiscal_year')` → `'FMK.FiscalYear'`
  - `getFiscalYearJoin(...)` → `{ table: 'FMK.FiscalYear', on: { sourceColumn, targetColumn: 'FiscalYearId' } }`
  - `getVoucherTypeFilter(true)` → `'v.Type NOT IN (3, 4)'`
  - تمام قواعد طلایی بخش ۰.۷ FRE_ROADMAP_00 را پیاده کند
  - **معیارِ پذیرش:** `typecheck:node` تمیز. تمام ۱۵+ متریک موجود با adapter جدید کار کنند.

### S12.5 — refactor compiler برای استفاده از adapter

- [ ] **S12.5** در `compiler.ts` تمام reference‌های مستقیم به table/column name را از طریق adapter عبور بده:
  - `quoteSqlTableRef` از adapter جدول را بگیرد
  - join construction از adapter join spec را بگیرد
  - filter construction از adapter filter را بگیرد
  - **معیارِ پذیرش:** `typecheck:node` تمیز. `npm test` سبز. `npm run eval:metrics` سبز (۴۲+ case).

### S12.6 — adapter registry و runtime selection

- [ ] **S12.6** در `src/main/services/financialEngine/adapterRegistry.ts`:
  - `getAdapter(softwareId: string): SchemaAdapter`
  - `registerAdapter(adapter: SchemaAdapter): void`
  - در startup، بر اساس `settings.softwareId` adapter مناسب انتخاب شود
  - **معیارِ پذیرش:** `typecheck:node` تمیز. `npm test` سبز.

### S12.7 — unit test برای SepidarAdapter

- [ ] **S12.7** unit test برای SepidarAdapter:
  - test `resolveTable` برای تمام concept‌ها
  - test `resolveColumn` برای تمام field‌ها
  - test `getFiscalYearJoin` با پارامترهای مختلف
  - test `getVoucherTypeFilter` با/بدون excludeClosing
  - test `getAccountClassification` برای asset/liability/equity
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۱۵ test جدید.

---

## بخش ب — refactor کامل به adapter model

### S12.8 — مهاجرت تمام متریک‌ها به concept refs

- [ ] **S12.8** تمام `MetricDefinition` entries در `metricCatalog.ts` را به concept refs مهاجرت بده:
  - `net_sales`: `source.primaryTable` → `concept: 'sales_invoice'`
  - `purchases`: `source.primaryTable` → `concept: 'purchase_invoice'` + fallback
  - `account_balance`: `source.primaryTable` → `concept: 'voucher_item'` + join `concept: 'voucher'`
  - `trial_balance`: همانند `account_balance` + join `concept: 'account'`
  - `cash_bank_balance`: `concept: 'cash_balance'` + composite `concept: 'bank_balance'`
  - `party_balance`: + join `concept: 'partner'`
  - `sales_by_period`: + dimension `concept: 'party'` (customer)
  - `account_turnover`: + join `concept: 'account'`
  - `recent_documents`: `concept: 'voucher'`
  - `balance_sheet`, `income_statement`, `cashflow_detailed` (از فاز ۱۱)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. `npm run eval:metrics` سبز با ۱۰۰+ case.

### S12.9 — مهاجرت router و planner به adapter-aware

- [ ] **S12.9** در `router.ts` و `planner.ts`:
  - anchors و excludeSignals به `softwareId` گره نخورند — یا per-adapter anchors یا generic anchors
  - `buildDeterministicPlan` از adapter برای parse کردن fiscal year استفاده کند
  - **معیارِ پذیرش:** `typecheck:node` تمیز. `npm test` سبز.

### S12.10 — typecheck + test + eval کامل پس از refactor

- [ ] **S12.10** `npm run typecheck:node` + `npm test` + `npm run eval:metrics` — همه سبز.
  - **انتظار:** typecheck ۰ خطا، test ۲۸۰+ pass ۰ fail، eval ۱۰۰+ case سبز.
  - **شاهد:** خروجی در «شاهد S12».

---

## بخش ج — HamkaranAdapter (نرم‌افزار دوم)

### S12.11 — تحقیق عمیق schema همکاران

- [ ] **S12.11** با دسترسی به یک دیتابیس نمونه همکاران:
  - تمام جداول اصلی را list کن
  - ساختار fiscal year را بررسی کن
  - enum نوع سند را استخراج کن
  - ساختار account را بررسی کن (دسته‌بندی؟)
  - ساختار partner/customer را بررسی کن
  - ساختار sales invoice و purchase invoice را بررسی کن
  - **خروجی:** جدول کامل schema همکاران در «شاهد S12».
  - **معیارِ پذیرش:** schema مستند شده. حداقل ۱۰ تفاوت با سپیدار شناسایی شده.

### S12.12 — پیاده‌سازی HamkaranAdapter

- [ ] **S12.12** در `src/main/services/financialEngine/adapters/hamkaranAdapter.ts`:
  - implements `SchemaAdapter`
  - تمام concept‌ها را به table/column همکاران map کن
  - `getFiscalYearJoin` مخصوص همکاران
  - `getVoucherTypeFilter` مخصوص همکاران
  - `getAccountClassification` مخصوص همکاران
  - `buildConnectionString` مخصوص همکاران (اگر DB engine متفاوت است)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. adapter با mock data کار کند.

### S12.13 — golden cases برای همکاران

- [ ] **S12.13** golden cases برای همکاران در `golden-metrics.json`:
  - فروش خالص سال جاری
  - خرید سال جاری
  - مانده حساب
  - تراز آزمایشی
  - دریافتنی/پرداختنی
  - **معیارِ پذیرش:** `npm run eval:metrics` با `--software=hamkaran` سبز. حداقل ۲۰ case.

### S12.14 — unit test برای HamkaranAdapter

- [ ] **S12.14** unit test برای HamkaranAdapter:
  - test `resolveTable` برای تمام concept‌ها
  - test `resolveColumn` برای تمام field‌ها
  - test `getFiscalYearJoin`
  - test `getVoucherTypeFilter`
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۱۰ test جدید.

### S12.15 — field test با دیتابیس واقعی همکاران

- [ ] **S12.15** field test با دیتابیس نمونه همکاران:
  - حداقل ۱۰ سؤال مالی روی همکاران
  - مقایسه با sqlcmd ground-truth
  - **معیارِ پذیرش:** حداقل ۸/۱۰ verdict=ok. `requestId`‌ها ثبت شود.

---

## بخش د — تست و اعتبارسنجی multi-software

### S12.16 — multi-software eval harness

- [ ] **S12.16** در `goldenMetricEval.ts` پشتیبانی از multi-software eval:
  - `--software=sepidar` → SepidarAdapter + Sepidar golden cases
  - `--software=hamkaran` → HamkaranAdapter + Hamkaran golden cases
  - `--software=all` → هر دو به ترتیب اجرا شوند
  - **معیارِ پذیرش:** `npm run eval:metrics -- --software=all` سبز.

### S12.17 — runtime software switching

- [ ] **S12.17** در `settings.json` و UI:
  - `softwareId: 'sepidar' | 'hamkaran'` قابل تنظیم
  - در startup، adapter مناسب load شود
  - اگر دیتابیس متفاوت است، connection string از adapter بیاید
  - **معیارِ پذیرش:** typecheck تمیز. UI نمایش دهد کدام adapter فعال است.

### S12.18 — typecheck + test + eval کامل

- [ ] **S12.18** `npm run typecheck:node` + `npm test` + `npm run eval:metrics -- --software=all` — همه سبز.
  - **شاهد:** خروجی در «شاهد S12».

### S12.19 — build + deploy + asar-grep

- [ ] **S12.19** `npm run build:win` + deploy + asar-grep:
  - `SCHEMA_ABSTRACTION` مارکر پیدا شود.
  - `MULTI_SOFTWARE` مارکر پیدا شود.
  - `HAMKARAN_ADAPTER` مارکر پیدا شود.
  - **شاهد:** خروجی asar-grep.

---

## بخش هـ — دروازهٔ خروجِ فاز ۱۲

- [ ] **S12.20** `SchemaAdapter` interface پیاده‌سازی شده و SepidarAdapter + HamkaranAdapter فعال.
  - **شاهد:** typecheck تمیز + test سبز.
- [ ] **S12.21** `metricCatalog.ts` بدون hardcoded table name — همه از طریق adapter.
  - **شاهد:** grep برای `SLS.Invoice` در `metricCatalog.ts` = ۰ match.
- [ ] **S12.22** eval سبز برای هر دو نرم‌افزار (sepidar + hamkaran).
  - **شاهد:** خروجی `eval:metrics -- --software=all`.
- [ ] **S12.23** field test همکاران حداقل ۸/۱۰ verdict=ok.
  - **شاهد:** `requestId`‌ها در «شاهد S12».
- [ ] **S12.24** `typecheck:node` + `npm test` + `eval:metrics` سبز.
  - **شاهد:** خروجی در «شاهد S12».
- [ ] **S12.25** `build:win` + deploy + asar-grep با مارکرهای فاز.
  - **شاهد:** خروجی asar-grep.
- [ ] **S12.26** ثبتِ شواهد در «شاهد S12».

---

## شاهد S12
```
--- Schema Comparison (Sepidar vs Hamkaran) ---
| Concept | Sepidar | Hamkaran | Notes |
|---|---|---|---|
| sales_invoice | SLS.Invoice | <table> | <notes> |
| purchase_invoice | POM.PurchaseInvoice | <table> | <notes> |
| voucher | ACC.Voucher | <table> | <notes> |
| voucher_item | ACC.VoucherItem | <table> | <notes> |
| account | ACC.Account | <table> | <notes> |
| fiscal_year | FMK.FiscalYear | <table> | <notes> |
| partner | ACC.Partner | <table> | <notes> |
| cash_balance | RPA.CashBalance | <table> | <notes> |
| bank_balance | RPA.BankAccountBalance | <table> | <notes> |

Key differences:
  1. <difference>
  2. <difference>
  ...

--- Adapters ---
SepidarAdapter: implemented ✅
HamkaranAdapter: implemented ✅

--- eval:metrics (multi-software) ---
Sepidar: <N>/<N> pass (100%)
Hamkaran: <N>/<N> pass (100%)

--- Field Test (Hamkaran) ---
Date: <date>
Results: <N>/10 verdict=ok
RequestIds: <list>

--- tests ---
Unit: <N> pass, 0 fail
Integration: <N> pass, 0 fail

--- typecheck ---
node: clean (0 errors)

--- build:win ---
Status: success
asar-grep: SCHEMA_ABSTRACTION found, MULTI_SOFTWARE found, HAMKARAN_ADAPTER found

--- Refactor Verification ---
grep "SLS.Invoice" in metricCatalog.ts: 0 matches ✅
grep "ACC.VoucherItem" in metricCatalog.ts: 0 matches ✅
grep "FMK.FiscalYear" in metricCatalog.ts: 0 matches ✅
```

> قدمِ بعدی: `FRE_ROADMAP_11_PHASE13_ADVANCED_MANAGEMENT.fa.md` (متریک‌های مدیریتی پیشرفته: COGS، موجودی، بودجه، مراکز هزینه، خروجی PDF/Excel).
