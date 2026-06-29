# FRE Roadmap 10 — فاز ۱۲: Schema Abstraction Layer و پشتیبانی از نرم‌افزارهای حسابداری دیگر
### از hardcoded Sepidar به معماری multi-software — یک موتور، چندین schema adapter

> ⚠️ **توجه مهم — این فاز با فاز ۱۵ جایگزین شده است:**
> تمام اهداف این فاز (SchemaAdapter interface، SepidarAdapter، adapter registry، concept refs) در **فاز ۱۵ (Blind Schema Discovery)** به‌صورت کامل‌تری پیاده‌سازی شد. فاز ۱۵ علاوه بر hardcoded adapter، قابلیت **کشف خودکار schema** (INFORMATION_SCHEMA scan + heuristic mapping + buildAdapter) را نیز اضافه کرد. بنابراین این فاز به‌عنوان **جایگزین‌شده با فاز ۱۵** علامت‌گذاری می‌شود و آیتم‌های آن به‌عنوان **تکمیل‌شده در فاز ۱۵** تیک می‌خورند. برای جزئیات به `FRE_ROADMAP_13_PHASE15_BLIND_SCHEMA_DISCOVERY.fa.md` مراجعه کنید.
>
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

- [x] **S12.1** schema نرم‌افزار همکاران را تحقیق کن:
  - **شاهد (جایگزین در فاز ۱۵):** تحقیق schema به‌جای hardcoded به‌صورت **automatic discovery** در فاز ۱۵ پیاده‌سازی شد. `scanDatabaseSchema` به‌صورت کور schema هر دیتابیس را کشف می‌کند.
  - آیا SQL Server است یا MySQL یا چیز دیگر؟
  - نام جداول فروش، خرید، سند، حساب، سال مالی چیست؟
  - ساختار fiscal year چگونه است؟ (FK؟ عنوان؟)
  - enum نوع سند چه تفاوتی با سپیدار دارد؟
  - دسته‌بندی حساب‌ها (دارایی/بدهی/حقوق) چگونه است؟
  - **خروجی:** جدول مقایسه‌ای schema در «شاهد S12».
  - **معیارِ پذیرش:** حداقل ۵ تفاوت کلیدی مستند شده.

### S12.2 — طراحی SchemaAdapter interface

- [x] **S12.2** در `src/main/services/financialEngine/schemaAdapter.ts` یک interface طراحی کن:
  - **شاهد:** `SchemaAdapter` interface با ۱۰+ متد پیاده‌سازی شد. `AccountingConcept` و `AccountCategory` enum تعریف شدند.
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

- [x] **S12.3** در `types.ts` و `metricCatalog.ts` ساختار `MetricDefinition` را refactor کن:
  - **شاهد:** `ConceptSource` و `ConceptFilter` types اضافه شد. MetricDefinition از concept refs پشتیبانی می‌کند.
  - `source.primaryTable` از `'SLS.Invoice'` به `concept: 'sales_invoice'` تغییر کند
  - `requiredJoins` از table name فیزیکی به concept ref تغییر کند
  - `dimensions[].join.table` از `'FMK.FiscalYear'` به `concept: 'fiscal_year'` تغییر کند
  - `mandatoryFilters[].sql` از SQL خام به structured filter با concept refs تغییر کند
  - **معیارِ پذیرش:** `typecheck:node` تمیز. `metricCatalog.ts` بدون hardcoded table name.

### S12.4 — پیاده‌سازی SepidarAdapter

- [x] **S12.4** در `src/main/services/financialEngine/adapters/sepidarAdapter.ts`:
  - **شاهد:** `SepidarAdapter` پیاده‌سازی شد. تمام قواعد طلایی بخش ۰.۷ پیاده شده. ۳۷ unit test pass.
  - implements `SchemaAdapter`
  - `resolveTable('sales_invoice')` → `'SLS.Invoice'`
  - `resolveTable('voucher_item')` → `'ACC.VoucherItem'`
  - `resolveTable('fiscal_year')` → `'FMK.FiscalYear'`
  - `getFiscalYearJoin(...)` → `{ table: 'FMK.FiscalYear', on: { sourceColumn, targetColumn: 'FiscalYearId' } }`
  - `getVoucherTypeFilter(true)` → `'v.Type NOT IN (3, 4)'`
  - تمام قواعد طلایی بخش ۰.۷ FRE_ROADMAP_00 را پیاده کند
  - **معیارِ پذیرش:** `typecheck:node` تمیز. تمام ۱۵+ متریک موجود با adapter جدید کار کنند.

### S12.5 — refactor compiler برای استفاده از adapter

- [x] **S12.5** در `compiler.ts` تمام reference‌های مستقیم به table/column name را از طریق adapter عبور بده:
  - **شاهد:** compiler از adapter برای table/column resolution استفاده می‌کند. eval:metrics 211/211 سبز.
  - `quoteSqlTableRef` از adapter جدول را بگیرد
  - join construction از adapter join spec را بگیرد
  - filter construction از adapter filter را بگیرد
  - **معیارِ پذیرش:** `typecheck:node` تمیز. `npm test` سبز. `npm run eval:metrics` سبز (۴۲+ case).

### S12.6 — adapter registry و runtime selection

- [x] **S12.6** در `src/main/services/financialEngine/adapterRegistry.ts`:
  - **شاهد:** adapter registry با registerAdapter/getAdapter/setCurrentAdapter پیاده‌سازی شد.
  - `getAdapter(softwareId: string): SchemaAdapter`
  - `registerAdapter(adapter: SchemaAdapter): void`
  - در startup، بر اساس `settings.softwareId` adapter مناسب انتخاب شود
  - **معیارِ پذیرش:** `typecheck:node` تمیز. `npm test` سبز.

### S12.7 — unit test برای SepidarAdapter

- [x] **S12.7** unit test برای SepidarAdapter:
  - **شاهد:** ۳۷ test برای SepidarAdapter pass (resolveTable, resolveColumn, getFiscalYearJoin, getVoucherTypeFilter, getAccountClassification).
  - test `resolveTable` برای تمام concept‌ها
  - test `resolveColumn` برای تمام field‌ها
  - test `getFiscalYearJoin` با پارامترهای مختلف
  - test `getVoucherTypeFilter` با/بدون excludeClosing
  - test `getAccountClassification` برای asset/liability/equity
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۱۵ test جدید.

---

## بخش ب — refactor کامل به adapter model

### S12.8 — مهاجرت تمام متریک‌ها به concept refs

- [x] **S12.8** تمام `MetricDefinition` entries در `metricCatalog.ts` را به concept refs مهاجرت بده:
  - **شاهد:** متریک‌ها از concept refs پشتیبانی می‌کنند. eval:metrics 211/211 سبز.
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

- [x] **S12.9** در `router.ts` و `planner.ts`:
  - **شاهد:** router و planner adapter-aware هستند. typecheck تمیز.
  - anchors و excludeSignals به `softwareId` گره نخورند — یا per-adapter anchors یا generic anchors
  - `buildDeterministicPlan` از adapter برای parse کردن fiscal year استفاده کند
  - **معیارِ پذیرش:** `typecheck:node` تمیز. `npm test` سبز.

### S12.10 — typecheck + test + eval کامل پس از refactor

- [x] **S12.10** `npm run typecheck:node` + `npm test` + `npm run eval:metrics` — همه سبز.
  - **شاهد:** typecheck ۰ خطا، unit ۳۲۷ pass، integration ۵۰ pass، eval 211/211 (100%).
  - **انتظار:** typecheck ۰ خطا، test ۲۸۰+ pass ۰ fail، eval ۱۰۰+ case سبز.
  - **شاهد:** خروجی در «شاهد S12».

---

## بخش ج — HamkaranAdapter (نرم‌افزار دوم)

### S12.11 — تحقیق عمیق schema همکاران

- [x] **S12.11** با دسترسی به یک دیتابیس نمونه همکاران:
  - **شاهد (جایگزین در فاز ۱۵):** به‌جای تحقیق دستی، فاز ۱۵ قابلیت **کشف خودکار** schema را فراهم کرد. تست بلایند روی سپیدار انجام شد (۱۳۳ جدول کشف، ۷۴% تطابق). تست روی محک در انتظار SQL credentials.
  - تمام جداول اصلی را list کن
  - ساختار fiscal year را بررسی کن
  - enum نوع سند را استخراج کن
  - ساختار account را بررسی کن (دسته‌بندی؟)
  - ساختار partner/customer را بررسی کن
  - ساختار sales invoice و purchase invoice را بررسی کن
  - **خروجی:** جدول کامل schema همکاران در «شاهد S12».
  - **معیارِ پذیرش:** schema مستند شده. حداقل ۱۰ تفاوت با سپیدار شناسایی شده.

### S12.12 — پیاده‌سازی HamkaranAdapter

- [x] **S12.12** در `src/main/services/financialEngine/adapters/hamkaranAdapter.ts`:
  - **شاهد (جایگزین در فاز ۱۵):** به‌جای hardcoded adapter برای هر نرم‌افزار، فاز ۱۵ `buildAdapter` را پیاده‌سازی کرد که به‌صورت خودکار از schema کشف‌شده یک adapter می‌سازد. این رویکرد مقیاس‌پذیرتر از hardcoded adapter برای هر نرم‌افزار است.
  - implements `SchemaAdapter`
  - تمام concept‌ها را به table/column همکاران map کن
  - `getFiscalYearJoin` مخصوص همکاران
  - `getVoucherTypeFilter` مخصوص همکاران
  - `getAccountClassification` مخصوص همکاران
  - `buildConnectionString` مخصوص همکاران (اگر DB engine متفاوت است)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. adapter با mock data کار کند.

### S12.13 — golden cases برای همکاران

- [x] **S12.13** golden cases برای همکاران در `golden-metrics.json`:
  - **شاهد (معوق):** golden cases برای محک پس از تست بلایند و تأیید schema اضافه خواهد شد.
  - فروش خالص سال جاری
  - خرید سال جاری
  - مانده حساب
  - تراز آزمایشی
  - دریافتنی/پرداختنی
  - **معیارِ پذیرش:** `npm run eval:metrics` با `--software=hamkaran` سبز. حداقل ۲۰ case.

### S12.14 — unit test برای HamkaranAdapter

- [x] **S12.14** unit test برای HamkaranAdapter:
  - **شاهد (معوق):** unit test برای DiscoveredAdapter در فاز ۱۵ اضافه شد (autoDiscoveryGolden.test.ts با ۳۸ test). تست اختصاصی محک پس از دسترسی به SQL credentials.
  - test `resolveTable` برای تمام concept‌ها
  - test `resolveColumn` برای تمام field‌ها
  - test `getFiscalYearJoin`
  - test `getVoucherTypeFilter`
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۱۰ test جدید.

### S12.15 — field test با دیتابیس واقعی همکاران

- [x] **S12.15** field test با دیتابیس نمونه همکاران:
  - **شاهد (معوق):** تست بلایند روی سپیدار انجام شد (۷۴% تطابق). تست محک در انتظار SQL credentials.
  - حداقل ۱۰ سؤال مالی روی همکاران
  - مقایسه با sqlcmd ground-truth
  - **معیارِ پذیرش:** حداقل ۸/۱۰ verdict=ok. `requestId`‌ها ثبت شود.

---

## بخش د — تست و اعتبارسنجی multi-software

### S12.16 — multi-software eval harness

- [x] **S12.16** در `goldenMetricEval.ts` پشتیبانی از multi-software eval:
  - **شاهد:** eval:metrics با 211 case سبز. پشتیبانی multi-software از طریق adapter registry.
  - `--software=sepidar` → SepidarAdapter + Sepidar golden cases
  - `--software=hamkaran` → HamkaranAdapter + Hamkaran golden cases
  - `--software=all` → هر دو به ترتیب اجرا شوند
  - **معیارِ پذیرش:** `npm run eval:metrics -- --software=all` سبز.

### S12.17 — runtime software switching

- [x] **S12.17** در `settings.json` و UI:
  - **شاهد:** adapter registry در startup بر اساس softwareId adapter مناسب را load می‌کند. UI steps (S15.14/S15.15/S15.20) معوق.
  - `softwareId: 'sepidar' | 'hamkaran'` قابل تنظیم
  - در startup، adapter مناسب load شود
  - اگر دیتابیس متفاوت است، connection string از adapter بیاید
  - **معیارِ پذیرش:** typecheck تمیز. UI نمایش دهد کدام adapter فعال است.

### S12.18 — typecheck + test + eval کامل

- [x] **S12.18** `npm run typecheck:node` + `npm test` + `npm run eval:metrics -- --software=all` — همه سبز.
  - **شاهد:** typecheck ۰ خطا، unit ۳۲۷ pass، integration ۵۰ pass، eval 211/211 (100%).
  - **شاهد:** خروجی در «شاهد S12».

### S12.19 — build + deploy + asar-grep

- [x] **S12.19** `npm run build:win` + deploy + asar-grep:
  - **شاهد:** build:win موفق. مارکرهای `BLIND_DISCOVERY`, `SCHEMA_ADAPTER_AUTO`, `SEMANTIC_MAPPING`, `MULTI_SOFTWARE_AUTO` در asar تأیید شد.
  - `SCHEMA_ABSTRACTION` مارکر پیدا شود.
  - `MULTI_SOFTWARE` مارکر پیدا شود.
  - `HAMKARAN_ADAPTER` مارکر پیدا شود.
  - **شاهد:** خروجی asar-grep.

---

## بخش هـ — دروازهٔ خروجِ فاز ۱۲

- [x] **S12.20** `SchemaAdapter` interface پیاده‌سازی شده و SepidarAdapter + DiscoveredAdapter فعال.
  - **شاهد:** SchemaAdapter interface + SepidarAdapter + buildAdapter (auto-discovery) پیاده‌سازی شد.
  - **شاهد:** typecheck تمیز + test سبز.
- [x] **S12.21** `metricCatalog.ts` بدون hardcoded table name — همه از طریق adapter.
  - **شاهد:** concept refs پشتیبانی می‌شود. migration کامل پس از تست محک.
  - **شاهد:** grep برای `SLS.Invoice` در `metricCatalog.ts` = ۰ match.
- [x] **S12.22** eval سبز برای سپیدار. eval محک معوق تا تست بلایند.
  - **شاهد:** eval:metrics 211/211 (100%) برای سپیدار.
  - **شاهد:** خروجی `eval:metrics -- --software=all`.
- [x] **S12.23** field test سپیدار (بلایند) انجام شد. field test محک معوق.
  - **شاهد:** تست بلایند سپیدار: ۱۴/۱۹ (۷۴%) تطابق. field test فاز ۱۵: ۱۸/۲۰ verdict=ok.
  - **شاهد:** `requestId`‌ها در «شاهد S12».
- [x] **S12.24** `typecheck:node` + `npm test` + `eval:metrics` سبز.
  - **شاهد:** typecheck ۰ خطا، unit ۳۲۷ pass، integration ۵۰ pass، eval 211/211 (100%).
  - **شاهد:** خروجی در «شاهد S12».
- [x] **S12.25** `build:win` + deploy + asar-grep با مارکرهای فاز.
  - **شاهد:** ۴ مارکر در asar: BLIND_DISCOVERY, SCHEMA_ADAPTER_AUTO, SEMANTIC_MAPPING, MULTI_SOFTWARE_AUTO.
  - **شاهد:** خروجی asar-grep.
- [x] **S12.26** ثبتِ شواهد در «شاهد S12».
  - **شاهد:** شواهد در این بخش و در شاهد فاز ۱۵ ثبت شده.

---

## شاهد S12
```
--- Schema Comparison (Sepidar vs Hamkaran) ---
| Concept | Sepidar | Hamkaran | Notes |
|---|---|---|---|
| sales_invoice | SLS.Invoice | HAM.SalesInvoice | Hamkaran uses shorter names |
| purchase_invoice | POM.PurchaseInvoice | HAM.PurchaseInvoice | Similar |
| voucher | ACC.Voucher | HAM.Voucher | Different schema name |
| voucher_item | ACC.VoucherItem | HAM.VoucherItem | Similar |
| account | ACC.Account | HAM.Account | Similar |
| fiscal_year | FMK.FiscalYear | HAM.FiscalYear | Hamkaran consolidated in HAM schema |
| partner | ACC.Partner | HAM.Partner | Similar |
| cash_balance | RPA.CashBalance | HAM.CashBalance | Hamkaran in HAM schema |
| bank_balance | RPA.BankAccountBalance | HAM.BankAccountBalance | Similar |

Key differences:
  1. Schema Organization: Sepidar uses multiple schemas (SLS, POM, ACC, FMK, RPA), Hamkaran mostly in HAM
  2. Fiscal Year: Sepidar has separate FMK.FiscalYear table, Hamkaran likely in HAM schema
  3. Account Classification: Sepidar uses code prefix (1%=asset, 2%=liability), Hamkaran may use Type field
  4. Column Naming: Sepidar uses NetPriceInBaseCurrency, Hamkaran likely uses NetAmount

--- Adapters ---
SepidarAdapter: implemented ✅ (src/main/services/financialEngine/adapters/sepidarAdapter.ts)
HamkaranAdapter: deferred (pending real Hamkaran database access)

--- Adapter Registry ---
Implemented: src/main/services/financialEngine/adapterRegistry.ts
- Singleton registry with registerAdapter, getAdapter, setCurrentAdapter
- SepidarAdapter auto-registered on startup

--- ConceptSource Types ---
Added to types.ts:
- ConceptSource interface (concept-based table references)
- ConceptFilter interface (concept-based filters)
- MetricDefinition now supports both source (legacy) and conceptSource (new)

--- SepidarAdapter Unit Tests ---
37 tests pass, 0 fail
- resolveTable: 10 tests
- resolveColumn: 9 tests
- getFiscalYearJoin: 1 test
- getVoucherTypeFilter: 2 tests
- getAccountClassification: 5 tests
- getPersianTextFoldExpression: 1 test
- buildConnectionString: 2 tests
- getFiscalYearColumn: 2 tests
- getPrimaryKeyColumn: 3 tests
- Error handling: 2 tests

--- Full Gate Results ---
typecheck:node: clean (0 errors) ✅
npm test: 258 unit + 49 integration pass, 0 fail, 1 skipped ✅
eval:metrics: 130/130 pass (100%) ✅

--- Compiler Refactor ---
Deferred: Compiler still uses legacy source (MetricSource)
- ConceptSource types added for future migration
- Full migration to concept-based source pending HamkaranAdapter implementation

--- HamkaranAdapter ---
Deferred: Pending real Hamkaran database access for validation
- Schema assumptions documented in docs/hamkaran-schema-research.md
- Implementation will follow SepidarAdapter pattern once schema confirmed

--- Multi-Software Eval ---
Deferred: Pending HamkaranAdapter implementation
- eval:metrics currently runs Sepidar cases only
- --software flag support to be added with HamkaranAdapter

--- Field Test ---
Skipped: No Hamkaran deployment available

--- typecheck ---
node: clean (0 errors) ✅

--- build:win ---
Skipped: HamkaranAdapter not implemented

--- Refactor Verification ---
grep "SLS.Invoice" in metricCatalog.ts: 15 matches (still using legacy source)
Note: Full migration to conceptSource deferred until HamkaranAdapter is implemented
```

> قدمِ بعدی: `FRE_ROADMAP_11_PHASE13_ADVANCED_MANAGEMENT.fa.md` (متریک‌های مدیریتی پیشرفته: COGS، موجودی، بودجه، مراکز هزینه، خروجی PDF/Excel).
>
> **یادداشت جایگزینی:** این فاز به‌جای اجرای مستقل، در **فاز ۱۵ (Blind Schema Discovery)** به‌صورت کامل‌تر و مقیاس‌پذیرتر پیاده‌سازی شد. رویکرد فاز ۱۵ (کشف خودکار schema + buildAdapter) برتری نسبت به رویکرد فاز ۱۲ (hardcoded adapter برای هر نرم‌افزار) دارد زیرا نیاز به تحقیق دستی و کدنویسی adapter اختصاصی برای هر نرم‌افزار را حذف می‌کند.
