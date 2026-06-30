# FRE Roadmap 17 — فاز ۱۹: متریک‌های مالی پیشرفته (Advanced Financial Metrics)
### صورت جریان وجوه نقد، نسبت‌های مالی گسترده، تحلیل روند، دارایی‌های ثابت، بهای تمام‌شده

> پیش‌نیاز: فاز ۱۸ کامل. Python Sandbox فعال. ۲۱۷ golden case سبز.

**مارکرهای asar:** `CASH_FLOW_STATEMENT`, `FINANCIAL_RATIOS_V2`, `TREND_ANALYSIS`, `FIXED_ASSETS`, `COST_ACCOUNTING`, `BANK_RECONCILIATION`.

---

## ۰ — نقشهٔ فاز

| بخش | موضوع | اندازه |
|---|---|---|
| الف | صورت جریان وجوه نقد (Cash Flow Statement) | متوسط |
| ب | نسبت‌های مالی گسترده (ROE، ROA، turnover ratios) | کوچک–متوسط |
| ج | تحلیل روند و نرخ رشد (Trend Analysis) | کوچک–متوسط |
| د | دارایی‌های ثابت و استهلاک | متوسط |
| هـ | بهای تمام‌شده تفصیلی (Cost Accounting) | متوسط |
| و | تطبیق حساب‌های بانکی (Bank Reconciliation) | کوچک–متوسط |
| ز | متریک‌های مالیات پیشرفته | کوچک |
| ح | تست و اعتبارسنجی | متوسط |

---

## ۱ — انگیزه و دامنه

### وضعیت پس از فاز ۱۸
- ۵۸ متریک فعال، Python Sandbox برای خروجی نمودار/اکسل/PDF ✅
- صورت‌های مالی پایه: ترازنامه، صورت سود و زیان ✅
- نسبت‌های پایه: net_margin، current_ratio، debt_to_equity ✅
- صورت جریان وجوه نقد وجود ندارد ❌
- تحلیل روند و نرخ رشد وجود ندارد ❌
- دارایی‌های ثابت و استهلاک پشتیبانی نمی‌شود ❌

### هدف
- پوشش کامل صورت‌های مالی استاندارد (ترازنامه + سود و زیان + جریان وجوه نقد)
- نسبت‌های مالی کلیدی برای تحلیل مدیریت
- تحلیل روند چندساله با محاسبه نرخ رشد
- پوشش حوزه‌های تخصصی: دارایی‌های ثابت، بهای تمام‌شده، تطبیق بانک

---

## بخش الف — صورت جریان وجوه نقد

### S19.1 — Cash Flow Statement (indirect method)

- [x] **S19.1** متریک `cash_flow_statement` در `metricCatalog.ts`:
  - **منطق:** روش غیرمستقیم (indirect method) — از سود خالص شروع، تعدیل‌های غیرنقدی
  - **سه بخش:**
    1. فعالیت‌های عملیاتی: سود خالص + استهلاک ± تغییرات دارایی‌های جاری و بدهی‌های جاری
    2. فعالیت‌های سرمایه‌ای: خرید/فروش دارایی‌های ثابت
    3. فعالیت‌های مالی: دریافت/پرداخت وام، سود سهام
  - **SQL:** کوئری‌های جداگانه برای هر بخش، تجمیع در Verifier
  - **grain:** `total`, `by_year`, `by_category` (operating/investing/financing)
  - **معیار:** `typecheck:node` تمیز. golden case با عدد مرجع دیتابیس تست.

### S19.2 — Cash Flow از سندها (direct method fallback)

- [x] **S19.2** متریک `cash_flow_direct` — روش مستقیم از سندهای نقدی:
  - **SQL:** فیلتر روی حساب‌های نقدی و بانکی (`a.Code LIKE '0101%' OR a.Code LIKE '0102%'`)
  - **تفکیک:** بر اساس نوع حساب طرف حساب (مشتری/تأمین‌کننده/بانک)
  - **معیار:** `typecheck:node` تمیز. مقایسه با indirect method در golden case.

---

## بخش ب — نسبت‌های مالی گسترده

### S19.3 — نسبت‌های سودآوری

- [x] **S19.3** متریک‌های مشتق جدید در `derivedCatalog.ts`:
  - `roe` (Return on Equity) = سود خالص / حقوق صاحبان سهام
  - `roa` (Return on Assets) = سود خالص / کل دارایی‌ها
  - `operating_margin` = سود عملیاتی / درآمد عملیاتی
  - `gross_margin` = (درآمد - بهای تمام‌شده) / درآمد
  - **معیار:** `typecheck:node` تمیز. ۴ golden case.

### S19.4 — نسبت‌های نقدی و گردش

- [x] **S19.4** متریک‌های مشتق:
  - `cash_ratio` = (نقد + بانک) / بدهی‌های جاری
  - `asset_turnover` = درآمد / کل دارایی‌ها
  - `inventory_turnover` = بهای تمام‌شده / میانگین موجودی
  - `receivables_turnover` = درآمد / میانگین دریافتنی‌ها
  - `accounts_payable_turnover` = خرید / میانگین پرداختنی‌ها
  - **معیار:** `typecheck:node` تمیز. ۵ golden case.

### S19.5 — نسبت‌های پوشش

- [x] **S19.5** متریک‌های مشتق:
  - `interest_coverage` = سود عملیاتی / هزینه مالی
  - `debt_service_coverage` = سود عملیاتی / (اقساط وام + هزینه مالی)
  - **نکته:** نیاز به شناسایی هزینه مالی از کدهای حساب (مثلاً `05xx` زیرگروه هزینه مالی)
  - **معیار:** `typecheck:node` تمیز. ۲ golden case.

---

## بخش ج — تحلیل روند و نرخ رشد

### S19.6 — Trend Analysis metric

- [x] **S19.6** متریک `trend_analysis` در `metricCatalog.ts`:
  - **منطق:** اجرای کوئری برای چند سال متوالی، محاسبه نرخ رشد سالانه و میانگین
  - **grain:** `by_year` با ۳+ سال
  - **خروجی:** جدول سال، مقدار، نرخ رشد درصد، میانگین رشد
  - **معیار:** `typecheck:node` تمیز. golden case با ۳ سال.

### S19.7 — Growth Rate derived metric

- [x] **S19.7** متریک مشتق `growth_rate`:
  - **ورودی:** هر متریک پایه + سال مبنا + سال مقایسه
  - **فرمول:** ((مقدار سال جدید - مقدار سال مبنا) / مقدار سال مبنا) × ۱۰۰
  - **نکته:** قابل اعمال روی هر متریک (فروش، خرید، سود، هزینه و غیره)
  - **معیار:** `typecheck:node` تمیز. ۳ golden case.

### S19.8 — Compound Annual Growth Rate (CAGR)

- [x] **S19.8** متریک مشتق `cagr`:
  - **فرمول:** (مقدار نهایی / مقدار اولیه)^(۱/تعداد سال‌ها) - ۱
  - **معیار:** `typecheck:node` تمیز. ۲ golden case.

---

## بخش د — دارایی‌های ثابت و استهلاک

### S19.9 — Fixed Assets Register

- [x] **S19.9** متریک `fixed_assets_register` در `metricCatalog.ts`:
  - **SQL:** فیلتر روی حساب‌های دارایی ثابت (`a.Code LIKE '0106%'` یا کشف خودکار)
  - **ستون‌ها:** حساب، مانده اول دوره، افزایشات، کاهشات، استهلاک، مانده پایان دوره
  - **grain:** `total`, `by_account`, `by_year`
  - **معیار:** `typecheck:node` تمیز. golden case.

### S19.10 — Depreciation Summary

- [x] **S19.10** متریک `depreciation_summary`:
  - **SQL:** فیلتر روی حساب‌های استهلاک تجمعی (`a.Code LIKE '0106xx%'` با نوع متمایز)
  - **خروجی:** استهلاک دوره، استهلاک تجمعی، خالص دفتری
  - **معیار:** `typecheck:node` تمیز. golden case.

---

## بخش هـ — بهای تمام‌شده تفصیلی

### S19.11 — Cost Center Detailed Analysis

- [x] **S19.11** متریک `cost_center_detailed` در `metricCatalog.ts`:
  - **SQL:** تجمیع هزینه‌ها بر اساس مرکز هزینه + نوع هزینه
  - **grain:** `by_cost_center`, `by_cost_type`, `by_month`
  - **خروجی:** ماتریکس مرکز هزینه × نوع هزینه
  - **معیار:** `typecheck:node` تمیز. golden case.

### S19.12 — Project Profitability

- [x] **S19.12** متریک `project_profitability`:
  - **SQL:** درآمد پروژه - هزینه پروژه = سود/زیان
  - **grain:** `by_project`, `by_month`
  - **معیار:** `typecheck:node` تمیز. golden case.

### S19.13 — COGS Detailed

- [x] **S19.13** متریک `cogs_detailed`:
  - **SQL:** بهای تمام‌شده کالای فروش‌رفته با تفکیک مواد، دستمزد، سربار
  - **grain:** `by_component` (materials/labor/overhead), `by_year`
  - **معیار:** `typecheck:node` تمیز. golden case.

---

## بخش و — تطبیق حساب‌های بانکی

### S19.14 — Bank Reconciliation

- [x] **S19.14** متریک `bank_reconciliation` در `metricCatalog.ts`:
  - **SQL:** مانده دفتری بانک (از سندها) در مقابل مانده بانک (از RPA.BankAccountBalance)
  - **خروجی:** مانده دفتری، مانده بانک، اختلاف، اقلام تطبیق‌نشده
  - **grain:** `by_account`, `by_month`
  - **معیار:** `typecheck:node` تمیز. golden case.

---

## بخش ز — مالیات پیشرفته

### S19.15 — VAT Detailed Breakdown

- [x] **S19.15** متریک `vat_detailed`:
  - **SQL:** فاکتورهای فروش + VAT تفصیلی (نرخ ۹٪، معاف، صفر)
  - **grain:** `by_rate`, `by_month`, `by_customer`
  - **معیار:** `typecheck:node` تمیز. golden case.

### S19.16 — Tax Liability Summary

- [x] **S19.16** متریک `tax_liability_summary`:
  - **SQL:** VAT پرداختنی - VAT قابل کسر = VAT علی‌الحساب/پرداختنی
  - **خروجی:** VAT فروش، VAT خرید، خالص قابل پرداخت
  - **معیار:** `typecheck:node` تمیز. golden case.

---

## بخش ح — تست و اعتبارسنجی

### S19.17 — Golden cases

- [x] **S19.17** golden cases جدید در `golden-metrics.json`:
  - ۲ case برای cash_flow_statement
  - ۴ case برای نسبت‌های سودآوری
  - ۵ case برای نسبت‌های نقدی و گردش
  - ۲ case برای نسبت‌های پوشش
  - ۳ case برای trend_analysis
  - ۲ case برای growth_rate
  - ۲ case برای CAGR
  - ۱ case برای fixed_assets_register
  - ۱ case برای depreciation_summary
  - ۱ case برای cost_center_detailed
  - ۱ case برای project_profitability
  - ۱ case برای cogs_detailed
  - ۱ case برای bank_reconciliation
  - ۲ case برای VAT detailed
  - ۱ case برای tax_liability_summary
  - **مجموع:** ۳۳ golden case جدید (۲۹ پایه + ۴ اضافی برای CAGR/growth)
  - **معیار:** eval سبز ۲۵۱/۲۵۱ (۱۰۰%). `typecheck:node` تمیز.

### S19.18 — Full Gate

- [ ] **S19.18** `typecheck:node` + `npm test` + `eval:metrics`:
  - **معیار:** ۰ خطای typecheck. تمام unit test pass. eval ۲۵۱/۲۵۱ (۲۱۸ + ۳۳ جدید).

### S19.19 — Build + asar-grep

- [ ] **S19.19** `npm run build:win` + asar-grep:
  - **مارکرها:** `CASH_FLOW_STATEMENT`, `FINANCIAL_RATIOS_V2`, `TREND_ANALYSIS`, `FIXED_ASSETS`, `COST_ACCOUNTING`, `BANK_RECONCILIATION`
  - **معیار:** build موفق. مارکرها در asar.

### S19.20 — Field test

- [ ] **S19.20** تست میدانی روی سرور ۱۹۲.۱۶۸.۸۵.۵۶:
  - ۱۰ پرسش از متریک‌های جدید
  - **معیار:** ۱۰/۱۰ پاسخ موفق.

### S19.21 — شاهد S19

- [ ] **S19.21** پر شدن بخش شاهد.

### S19.22 — به‌روزرسانی OVERVIEW

- [ ] **S19.22** فاز ۱۹ در OVERVIEW اضافه شود.

---

## شاهد S19
```
فاز ۱۹ — متریک‌های مالی پیشرفته
تاریخ: [پس از تکمیل پر شود]

S19.1 — Cash Flow Statement (indirect):
  - فایل: src/main/services/financialEngine/metricCatalog.ts
  - سه بخش: operating, investing, financing

S19.3-S19.5 — نسبت‌های مالی:
  - ROE, ROA, operating_margin, gross_margin
  - cash_ratio, asset_turnover, inventory_turnover, receivables_turnover
  - interest_coverage, debt_service_coverage
  - فایل: src/main/services/financialEngine/derivedCatalog.ts

S19.6-S19.8 — Trend Analysis:
  - trend_analysis, growth_rate, cagr
  - فایل: src/main/services/financialEngine/metricCatalog.ts + derivedCatalog.ts

S19.9-S19.10 — Fixed Assets:
  - fixed_assets_register, depreciation_summary

S19.11-S19.13 — Cost Accounting:
  - cost_center_detailed, project_profitability, cogs_detailed

S19.14 — Bank Reconciliation

S19.15-S19.16 — Tax:
  - vat_detailed, tax_liability_summary

S19.18 — Full Gate:
  - typecheck:node: [تعداد] errors
  - unit tests: [تعداد] pass
  - eval:metrics: [تعداد]/[تعداد] (X%)

S19.20 — Field test:
  - [تعداد]/[تعداد] OK
```
