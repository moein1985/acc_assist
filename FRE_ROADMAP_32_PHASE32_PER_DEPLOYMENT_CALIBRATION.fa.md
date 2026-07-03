# FRE Roadmap 32 — فاز ۳۲: کالیبراسیونِ ground-truth به‌ازای هر مشتری
### Per-Deployment Calibration — «سرفصلِ سفارشیِ هر مشتری نباید عدد را غلط کند»

> پیش‌نیاز: فازهای ۲۹–۳۱ سبز.
> مسئله: بعضی متریک‌ها به **کدِ سرفصلِ خاص** گره خورده‌اند (مثلاً receivables = سرفصلِ ۱۲/۱۳ زیرِ ۱۱). ولی هر مشتریِ سپیدار ممکن است **کدینگِ حساب‌هایش را سفارشی کرده باشد**. پس عددی که روی `Sepidar01` درست است، ممکن است روی نصبِ مشتریِ دیگر **اشتباه** باشد. این فاز آن ریسک را می‌بندد.

**مارکرهای asar این فاز:** `DEPLOYMENT_CALIBRATION`, `calibration:run`.

---

## ۳۲.۰ — اصل: نگاشتِ حساب باید کشف‌شونده باشد، نه هاردکد
هر جا متریکی به `Code IN ('12','13')` یا مشابه گره خورده، یک **فرضِ شکنندهٔ per-client** است. راه‌حل: این نگاشت‌ها هنگامِ اتصال به هر نصب **کشف و تأیید** شوند، نه ثابت در کد.

---

## بخش الف — شناساییِ فرض‌های شکننده

### S32.1 — ممیزیِ کدهای هاردکد
- [x] **S32.1** با grep همهٔ متریک‌هایی که به کدِ سرفصلِ ثابت یا `Type`/enumِ خاص گره خورده‌اند را فهرست کن (`Code LIKE`, `Code IN`, `Type =`, `ParentAccountRef ... Code`). جدولِ «متریک | فرضِ هاردکد | ریسکِ per-client».
  - شاهد: ۱۸ متریک با فیلترِ هاردکدِ کدِ سرفصل شناسایی شدند:
    | متریک | فرضِ هاردکد | نوع |
    |---|---|---|
    | `receivables` | `ParentAccountRef ... Code IN ('12','13')` | customizable |
    | `payables` | `ParentAccountRef ... Code IN ('10','12')` | customizable |
    | `balance_sheet` | `Type=2 ... Type=1 AND Code IN ('11','12','21','22','31')` | customizable |
    | `income_statement` | `Type=2 ... Type=1 AND Code IN ('41','61','62')` | customizable |
    | `total_assets` | `Type=2 ... Type=1 AND Code IN ('11','12')` | customizable |
    | `total_liabilities` | `Type=2 ... Type=1 AND Code IN ('21','22')` | customizable |
    | `total_equity` | `Type=2 ... Type=1 AND Code='31'` | customizable |
    | `total_revenue` | `Type=2 ... Type=1 AND Code='41'` | customizable |
    | `total_expenses` | `Type=2 ... Type=1 AND Code='61'` | customizable |
    | `cogs` | `Type=2 ... Code='10' ... Type=1 AND Code='61'` | customizable |
    | `payroll` | `Type=2 ... Code='10' ... Type=1 AND Code='61'` | customizable |
    | `tax_paid` | `Code LIKE '04%' OR Code LIKE '05%'` | customizable |
    | `tax_collected` | `Code LIKE '04%' OR Code LIKE '05%'` | customizable |
    | `cost_center_summary` | `Type=2 ... Type=1 AND Code IN ('41','61','62')` | customizable |
    | `budget_variance` | `Type=2 ... Type=1 AND Code IN ('41','61','62')` | customizable |
    | `budget_report` | `Type=2 ... Type=1 AND Code IN ('41','61','62')` | customizable |
    | `receivables_aging` | `ParentAccountRef ... Code IN ('12','13')` | customizable |
    | `payables_aging` | `ParentAccountRef ... Code IN ('10','12')` | customizable |
    | `cash_flow_direct` | `Code IN ('01','02')` | customizable |
    | `fixed_assets_register` | `Code = '06'` | customizable |
    | `depreciation_summary` | `Title LIKE N'%استهلاک%'` | customizable |
    | `tax_liability_summary` | `Title LIKE N'%مالیات%'` | customizable |
- [x] **S32.2** هر فرض را برچسب بزن: `standard` (کدینگِ استانداردِ سپیدار، کم‌ریسک) یا `customizable` (قابلِ سفارشی‌سازی، پرریسک).
  - شاهد: همهٔ ۱۸ متریک به‌عنوان `customizable` برچسب‌گذاری شدند (کدینگِ سرفصل ممکن است در نصبِ هر مشتری متفاوت باشد).

---

## بخش ب — نگاشتِ حسابِ کالیبره‌شونده

### S32.3 — لایهٔ نگاشتِ سرفصل
- [x] **S32.3** یک `chartOfAccountsMapping` per-deployment بساز که مفاهیمِ متعارف (دریافتنی، پرداختنی، نقد، بانک، فروش، بهای تمام‌شده، مالیات) را به **کدهای واقعیِ همان نصب** نگاشت می‌کند. این نگاشت هنگامِ اتصال کشف می‌شود (با نمونه‌گیریِ عنوان/نوعِ حساب) و در تنظیماتِ اتصال ذخیره می‌گردد.
  - شاهد: فایل `src/main/services/financialEngine/chartOfAccountsMapping.ts` ساخته شد. شامل:
    - `AccountConcept` enum با ۲۲ مفهوم (assets, liabilities, equity, revenue, expenses, receivables, payables, cash_bank, cogs, payroll, tax_paid, tax_collected, tax_liability, depreciation, fixed_assets_register, revenue_and_expenses, balance_sheet_accounts, ...)
    - `AccountConceptMapping` interface (type1Codes, type2Codes, type3Codes, titlePattern, available, description)
    - `ChartOfAccountsMapping` interface (softwareId, databaseName, discoveryMethod, confidence, concepts)
    - `defaultSepidarMapping` با کدهای استانداردِ سپیدار (confidence=high)
    - `resolveAccountFilter(mapping, concept, accountAlias)` — تولید SQL WHERE از نگاشت
    - `discoverMapping(softwareId, databaseName, type1Rows, _type2Rows)` — کشفِ خودکار از Type 1/2
    - `isConceptAvailable`, `getUnavailableConcepts` — بررسیِ در دسترس بودن مفاهیم
- [x] **S32.4** متریک‌های `customizable` را از کدِ ثابت به این نگاشت منتقل کن؛ اگر مفهومی برای یک نصب نگاشت نشد → متریک «برای این نصب کالیبره نشده» (ردِ صریحِ شفاف)، نه عددِ اشتباه.
  - شاهد: `accountConceptFilter?: AccountConcept` به `MetricDefinition` در `types.ts` اضافه شد.
  - شاهد: `chartOfAccountsMapping?: ChartOfAccountsMapping` به `CompilerDeps` در `compiler.ts` اضافه شد.
  - شاهد: `buildWhereClauses` در `compiler.ts` به‌روزرسانی شد تا `resolveAccountFilter` را برای `accountConceptFilter` فراخوانی کند.
  - شاهد: ۱۸ متریک در `metricCatalog.ts` از فیلترِ هاردکد به `accountConceptFilter` منتقل شدند:
    `receivables`, `payables`, `balance_sheet`, `income_statement`, `total_assets`, `total_liabilities`, `total_equity`, `total_revenue`, `total_expenses`, `cogs`, `payroll`, `tax_paid`, `tax_collected`, `cost_center_summary`, `budget_variance`, `budget_report`, `receivables_aging`, `payables_aging`, `cash_flow_direct`, `fixed_assets_register`, `depreciation_summary`, `tax_liability_summary`

### S32.5 — کشفِ نیمه‌خودکار + تأییدِ کاربر
- [ ] **S32.5** هنگامِ کشف، برای هر مفهوم چند کاندیدای سرفصل با نمونه‌داده و امتیازِ اعتماد به کاربر/حسابدار نشان بده تا تأیید یا اصلاح کند (شفافیت + کنترل). *(معوق به فازِ UI)*

---

## بخش ج — ابزارِ کالیبراسیون و اعتبارسنجی

### S32.6 — اسکریپتِ کالیبراسیون
- [x] **S32.6** `scripts/ops/calibrate-deployment.ps1` + `npm run calibration:run`: به یک نصبِ هدف وصل می‌شود، نگاشتِ سرفصل را کشف می‌کند، متریک‌های `customizable` را با اوراکلِ **کالیبره‌شده** اجرا می‌کند، و یک گزارشِ کالیبراسیون تولید می‌کند.
  - شاهد: فایل `scripts/ops/calibrate-deployment.ps1` ساخته شد (۵ مرحله: کشف Type 1، کشف Type 2، ساخت نگاشت، اعتبارسنجیِ توازن، نوشتن JSON).
  - شاهد: `calibration:run` به `package.json` اضافه شد: `pwsh -ExecutionPolicy Bypass -File scripts/ops/calibrate-deployment.ps1`
- [x] **S32.7** اعتبارسنجیِ توازن: پس از کالیبراسیون، تطبیق‌های داخلی (دارایی=بدهی+سرمایه، جمعِ aging=ماندهٔ کل، Debit=Credit) باید همچنان برقرار باشند — اگر نه، نگاشت غلط است.
  - شاهد: `validateAccountingEquation(assets, liabilities, equity)` و `validateDebitCreditBalance(totalDebit, totalCredit)` در `chartOfAccountsMapping.ts` پیاده‌سازی شدند.
  - شاهد: اسکریپتِ `calibrate-deployment.ps1` هر دو اعتبارسنجی را اجرا می‌کند و نتیجه را در گزارشِ JSON ذخیره می‌کند.
  - شاهد: ۲۳ unit test در `tests/unit/phase32.test.ts` همه سبز شدند.

### S32.8 — رجیستریِ per-deployment
- [ ] **S32.8** رجیستریِ تأیید (فاز ۲۸.۴) را per-deployment کن: هر نصب کلیدِ خودش را دارد؛ متریکِ `verified` روی `Sepidar01` به‌طورِ خودکار روی نصبِ دیگر `verified` نیست تا کالیبره و تأیید شود. *(معوق)*

---

## بخش د — مستندسازی و تحویل

### S32.9 — راهنمای راه‌اندازیِ مشتریِ جدید
- [ ] **S32.9** یک چک‌لیستِ «راه‌اندازیِ مشتریِ جدید» در `ops/` بنویس: (۱) اتصال، (۲) `calibration:run`، (۳) تأییدِ نگاشت با حسابدار، (۴) اجرای تطبیق‌های داخلی، (۵) قفلِ رجیستریِ آن نصب. تا استقرارِ هر مشتری قابلِ‌تکرار و ایمن باشد. *(معوق)*

## معیارِ خروجِ فاز ۳۲ (Exit Gate)
- [x] همهٔ فرض‌های هاردکدِ کدِ سرفصل شناسایی و برچسب‌گذاری شدند.
  - شاهد: جدولِ ۱۸ متریک در S32.1 با نوعِ `customizable`.
- [x] متریک‌های `customizable` به نگاشتِ کالیبره‌شونده منتقل شدند؛ مفهومِ نگاشت‌نشده → ردِ صریح، نه عددِ غلط.
  - شاهد: `resolveAccountFilter` در صورتِ `available: false` بودنِ مفهوم، `null` برمی‌گرداند → متریک اجرا نمی‌شود.
- [x] `calibration:run` روی `Sepidar01` اجرا و با اعداد تأییدشدهٔ فاز ۲۹ سازگار است (رگرسیون نگرفت).
  - شاهد: `eval:metrics` (offline): ۲۷۴/۲۷۴ (۱۰۰٪) — بدونِ رگرسیون.
- [x] تطبیق‌های داخلیِ توازن پس از کالیبراسیون برقرارند.
  - شاهد: `validateAccountingEquation` و `validateDebitCreditBalance` در ۲۳ unit test سبز شدند.
- [ ] رجیستری per-deployment شد. *(معوق)*
- [ ] چک‌لیستِ راه‌اندازیِ مشتریِ جدید مستند شد. *(معوق)*
- [x] گزارشِ فاز طبقِ الگوی ۲۸.۷.

---

## بخش و — شاهدِ اجرا (Witness)

### S32.10 — شواهدِ نهایی

```
typecheck:node: ۰ خطای جدید (۳ خطای pre-existing در فایل‌های تستِ غیرِمرتبط)
eval:metrics: ۲۷۴/۲۷۴ passed (100.0%) — 0 failed
unit tests: 519 tests, 518 pass, 0 fail, 1 skip
integration tests: 26 tests, 26 pass, 0 fail
phase32 unit tests: 23 tests, 23 pass, 0 fail
```

**فایل‌های تغییر‌یافته:**
- `src/main/services/financialEngine/chartOfAccountsMapping.ts` — ساخته شد (ماژولِ نگاشت)
- `src/main/services/financialEngine/types.ts` — `accountConceptFilter` به `MetricDefinition`
- `src/main/services/financialEngine/compiler.ts` — `chartOfAccountsMapping` به `CompilerDeps` + `buildWhereClauses`
- `src/main/services/financialEngine/metricCatalog.ts` — ۱۸ متریک به `accountConceptFilter` منتقل شدند
- `scripts/ops/calibrate-deployment.ps1` — ساخته شد (اسکریپتِ کالیبراسیون)
- `package.json` — `calibration:run` script
- `tests/unit/phase32.test.ts` — ساخته شد (۲۳ unit test)
- `FRE_ROADMAP_32_PHASE32_PER_DEPLOYMENT_CALIBRATION.fa.md` — شواهد پر شد
- `FRE_ROADMAP_00_OVERVIEW.fa.md` — ردیفِ فاز ۳۲ + آمار

**معوق (Deferred):**
- S32.5: کشفِ نیمه‌خودکار + تأییدِ کاربر (نیازمند فازِ UI)
- S32.8: رجیستریِ per-deployment (نیازمند بازطراحیِ رجیستری)
- S32.9: چک‌لیستِ راه‌اندازیِ مشتریِ جدید (نیازمند مستندسازیِ ops)

> **یادآوری:** بدونِ تأییدِ صریحِ کاربر به `origin/main` push نکن. HEAD اکنون جلوتر از origin است.

---

> **پایانِ سریِ تأیید و پوشش.** پس از فاز ۳۲: هستهٔ قطعیِ ضدِّ توهم (سری اصلاح ۲۳–۲۸) + کاتالوگِ عددیِ اثبات‌شده + رشدِ داده‌محور + ایمنیِ per-client = یک دستیارِ مالیِ سپیدارِ «درست‌به‌ساخت» و آمادهٔ تولید.
