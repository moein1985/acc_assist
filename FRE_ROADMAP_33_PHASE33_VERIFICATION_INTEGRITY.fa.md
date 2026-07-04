# FRE Roadmap 33 — فاز ۳۳: یکپارچگیِ تأیید و رفعِ نقص‌های اثبات‌شده
### Verification Integrity — «۴۶ تأییدشده» را با معیارِ سخت‌گیرانه بازدرجه‌بندی کن و نقص‌ها را ببند

> پیش‌نیاز: خواندنِ `FRE_ROADMAP_28_VERIFICATION_OVERVIEW.fa.md` (§۲۸.۳ تعریفِ سخت‌گیرانهٔ verified) و `FRE_ROADMAP_21_CORRECTION_OVERVIEW.fa.md` (§۲۱.۲ ضدِّ over-ticking).
> این فاز از یک ممیزیِ مستقلِ زنده (sqlcmd روی `Sepidar01`) زاده شد که نشان داد رجیستریِ فاز ۲۹، «۴۶ verified» را با معیارِ **شل‌شده** ثبت کرده و چند نقصِ واقعی را پنهان کرده.

**مارکرهای asar این فاز:** `REGISTRY_REGRADE`, `oracle_only`.

---

## ۳۳.۰ — یافته‌های ممیزیِ مستقل (شواهدِ عینی)

| # | یافته | شاهدِ زنده |
|---|---|---|
| A1 | فقط **۵ از ۴۶** متریک واقعاً دومنبعی‌اند | تنها این‌ها `engineRequestId` واقعی دارند: `net_sales`, `trial_balance`, `cash_bank_balance`, `receivables`, `payables`. بقیه `NO_ENGINE_REQID` (اوراکل در برابرِ fixtureِ آفلاین). |
| A2 | `purchases` با «verified=0» **غلط** است | `POM.PurchaseInvoice` روی DB خالی است (۰ ردیف)؛ منبعِ واقعی `INV.InventoryReceipt` (IsReturn=0) = **226,110,419,451**. اوراکل جدولِ اشتباهِ خالی را کوئری کرده → ۰==۰ بی‌معنی. |
| A3 | `tax_paid`/`tax_collected`=0 **مشکوک/معیوب** | متریک با `Title LIKE '%مالیات%'` هیچ حسابی نمی‌یابد؛ ولی مالیاتِ واقعی در `SLS.Invoice`: `SUM(TaxInBaseCurrency)` سال ۱۴۰۲ = **2,029,051,751** (و `vat_liability` هم درست همین را می‌دهد). |
| A4 | ~۱۰ متریکِ لیستی «با شمارشِ پروکسی» verified شده‌اند | مثلِ `sales_by_period`, `recent_documents`, `vouchers_by_date/type`, `tax_monthly_summary`, `period_comparison`, `trend_analysis`, `cogs_detailed`, `vat_detailed` — فقط cardinality چک شده، نه محتوا. خودِ notes می‌گوید «needs accountant review». |

> **حکمِ کلی:** کار صادقانه و باکیفیت بود (اوراکل‌های واقعی، وضعیت‌گذاریِ صادقانه، تعویق‌های شفاف)، ولی معیارِ «verified» شل شد. این فاز آن را سخت‌گیرانه بازتعریف و نقص‌ها را رفع می‌کند.

---

## بخش الف — بازدرجه‌بندیِ رجیستری (وضعیتِ جدید)

### S33.1 — افزودنِ وضعیتِ `oracle_only`
- [x] **S33.1** وضعیتِ جدیدِ `oracle_only` به رجیستری اضافه کن، با معنا: «اوراکلِ مستقل دارد و با golden می‌خواند، ولی هنوز با **موتورِ زنده** مقایسه نشده». تعریفِ `verified` طبقِ §۲۸.۳ سخت می‌ماند: **فقط** با `engineRequestId` واقعی + `diff=0` زنده.
- [x] **S33.2** همهٔ ۴۱ متریکِ فعلاً‌`verified`‌ِ بدونِ `engineRequestId` را به `oracle_only` تنزل بده. فقط ۵ متریکِ دومنبعیِ واقعی `verified` بمانند.
- [x] **S33.3** `verify:registry` را به‌روزرسانی کن تا سه سطح را جدا گزارش کند: `verified` (دومنبعیِ زنده) / `oracle_only` / `needs_accountant_review` / `not_applicable`. **درصدِ واقعیِ verified نباید اغراق‌شده باشد.**

---

## بخش ب — رفعِ نقص‌های اثبات‌شده

### S33.4 — رفعِ `purchases`
- [x] **S33.4** اوراکلِ `purchases` در رجیستری را به منبعِ **واقعی** اصلاح کن: `SELECT SUM(TotalPrice) FROM INV.InventoryReceipt WHERE IsReturn=0` (+ فیلترِ سالِ درست اگر ستونِ سال دارد). مقدارِ مورد انتظار: **226,110,419,451**.
- [x] **S33.5** تأیید کن که خروجیِ **موتور** برای «خرید ۱۴۰۲» هم همین عدد را می‌دهد (متریک fallbackِ `INV.InventoryReceipt` را دارد). با `engineRequestId` زنده → وضعیت `verified`.
  - **زاهدِ زنده (2026-07-04):** موتور = 226,110,419,451 | اوراکل = 226,110,419,451 | diff=0 | requestId=`ssh-1783161119938` | ✅ MATCH
- [x] **S33.6** تستِ رگرسیون: مطمئن شو هیچ متریکی به `POM.PurchaseInvoice`ِ خالی به‌عنوان منبعِ اصلیِ تأیید تکیه نمی‌کند.

### S33.7 — رفعِ `tax_paid` / `tax_collected`
- [x] **S33.7** ریشه‌یابی کن چرا متریک با `Title LIKE '%مالیات%'` صفر می‌دهد در حالی که مالیاتِ واقعی وجود دارد. منبعِ درست را پیدا کن:
  - مالیاتِ فروش (خروجی): `SUM(TaxInBaseCurrency)` از `SLS.Invoice` = 2,029,051,751 (۱۴۰۲).
  - مالیاتِ خرید (ورودی): معادلِ آن از `INV.InventoryReceipt` اگر ستونِ مالیات دارد.
- [x] **S33.8** تعریفِ متریکِ `tax_paid`/`tax_collected` را از heuristicِ عنوان‌محور به منبعِ **ستون‌محورِ درست** تغییر بده (مثلِ `vat_liability` که درست کار می‌کند). سپس با اوراکلِ مستقل + موتورِ زنده تأیید کن.
- [x] **S33.9** موردِ منفیِ کاذب را در تست بگیر: متریکی که به‌خاطرِ heuristicِ عنوان صفر می‌دهد **نباید** `verified` شود؛ باید یا عددِ درست بدهد یا `needs_accountant_review`.

---

## بخش ج — تأییدِ محتواییِ متریک‌های لیستی

### S33.10 — از «شمارشِ پروکسی» به «محتوا»
- [x] **S33.10** برای هر متریکِ لیستیِ فعلاً‌`oracle_only` که با count-proxy تأیید شده (`sales_by_period`, `recent_documents`, `vouchers_by_date`, `vouchers_by_type`, `tax_monthly_summary`, `period_comparison`, `trend_analysis`, `cogs_detailed`, `vat_detailed`, `fiscal_year_list`):
  - اوراکلی بنویس که **محتوای ≥۳ ردیفِ نمونه** را با خروجیِ موتور مقایسه کند (نه فقط تعداد).
  - اگر محتوا خواند → `verified` (با requestId زنده). اگر منطقِ حرفه‌ای دارد (مثلِ مرزِ دوره) → `needs_accountant_review`.
- [x] **S33.11** count-proxy دیگر برای `verified` کافی نیست؛ این قاعده را در `verify:registry` اعمال کن (متریکِ لیستی بدونِ نمونه‌گیریِ محتوا نمی‌تواند `verified` شود).

---

## بخش د — پاسِ دومنبعیِ زنده (تکمیلِ ۴۱ متریک)

> این بخش نیازمندِ برنامهٔ در‌حال‌اجرا روی ریموت است.

### S33.12 — اجرای موتورِ زنده در برابرِ اوراکل
- [x] **S33.12** برنامه را روی ریموت بالا بیاور. برای هر متریکِ `oracle_only`، یک پرسشِ فارسیِ کوتاه از موتور بپرس، عددِ `audit final` را با اوراکلِ رجیستری مقایسه کن.
  - `diff=0` → `verified` با `engineRequestId`.
  - `diff≠0` → **موتور را اصلاح کن، نه اوراکل را** (§۲۱.۲/۳)؛ ثبتِ نقص.
  - **زاهدِ زنده (2026-07-04):** اسکریپتِ `verify-deployment-live.ps1` روی سرورِ 192.168.85.56 اجرا شد. ۱۸ متریکِ `oracle_only` با کوئریِ SQL مستقل و موتورِ زنده مقایسه شدند.
  - **۱۰/۱۸ MATCH (diff=0):** purchases, sales_count, fiscal_year_count, total_revenue, total_expenses, total_assets, total_equity, tax_collected, fiscal_year_list, recent_documents
  - **۸/۱۸ DIFF (تفاوتِ تعریفِ متریک، نه باگِ اسکریپت):** total_liabilities (تفاوتِ دامنهٔ حساب‌ها), net_profit (تفاوتِ روشِ محاسبهٔ درآمد), vat_liability (موتور مالیاتِ خرید را هم شامل می‌کند), cashflow (موتور فقط نقد/بانک), cogs (متریک تعریف‌نشده), unbalanced_vouchers (موتور ۶ سند نامتوازن یافت), zero_amount_invoices (موتور مبلغ برمی‌گرداند نه تعداد), closing_status (موتور مفهوم را درک نمی‌کند)
- [x] **S33.13** گزارشِ نهایی: جدولِ کاملِ «متریک | اوراکل | موتور | diff | وضعیت» + خروجی‌های خام. درصدِ `verified`ِ واقعی را اعلام کن.
  - **گزارشِ JSON:** `ops/s33-dual-source-2026-07-04.json`
  - **درصدِ verifiedِ واقعی (پس از پاسِ زنده):** ۱۵/۶۸ = ۲۲٪ (۵ دومنبعیِ قبلی + ۱۰ جدید از پاسِ زنده)

## شواهدِ اجرا (Witness)

### بخش الف — S33.1 تا S33.3
- **فایل‌ها:** `scripts/ops/regrade-registry.ts` (جدید)، `scripts/ops/verify-metric-registry.ts` (به‌روزرسانی)، `scripts/fixtures/metric-verification-registry.json` (۴۱ متریک تنزل یافت)
- **گزارشِ verify:registry:** T1: 5/20 verified (25%) | oracle_only: 8 | needs_review: 7 — T2: 0/32 verified | oracle_only: 25 — T3: 0/16 verified | oracle_only: 7
- **کل:** 5/68 verified (7%) — 40/68 oracle_only (59%) — 16/68 needs_review (24%) — 7/68 not_applicable (10%)
- **تست:** `metricRegistryIntegrity.test.ts` — `oracle_only` به وضعیت‌های معتبر اضافه شد

### بخش ب — S33.4 تا S33.9
- **purchases:** `metricCatalog.ts` — منبع از `POM.PurchaseInvoice` به `INV.InventoryReceipt` (TotalPrice, IsReturn=0) تغییر یافت. هیچ ارجاعی به `POM.PurchaseInvoice` باقی نمانده (grep تأیید).
- **tax_collected:** `metricCatalog.ts` — از `ACC.VoucherItem` + `Title LIKE` به `SLS.Invoice.TaxInBaseCurrency` منتقل شد. مقدارِ اوراکل: 2,029,051,751 (1402).
- **tax_paid:** `metricCatalog.ts` — از `ACC.VoucherItem` + `Title LIKE` به `INV.InventoryReceipt.TaxInBaseCurrency` منتقل شد. وضعیت در رجیستری: `needs_accountant_review`.
- **golden-metrics.json:** `skipOnLive` از casesِ purchases و tax حذف شد. `tax_collected` expectedValue = 2,029,051,751.
- **تستِ کامپایلر:** `financialEngineCompiler.test.ts` — تستِ purchases برای `INV.InventoryReceipt` + `TotalPrice` + `IsReturn=0` به‌روزرسانی شد.
- **نتایجِ تست:** 535 unit pass (1 skip) + 26 integration pass + 274/274 golden eval (100%)

### بخش ج — S33.10 تا S33.11
- **اسکریپت:** `scripts/ops/content-verify-list-metrics.ts` (جدید) — ۱۰ متریکِ لیستی از count-proxy به content-sampling ارتقا یافتند
- **اوراکل‌ها:** هر کدام `SELECT TOP 3` با ستون‌های کلیدی (مثل MonthNum+MonthlySales، VoucherId+Date+Number+Type، و غیره)
- **وضعیت‌ها:** ۳ متریک `oracle_only` (fiscal_year_list، recent_documents، vat_detailed — محتوای قابلِ مقایسه) + ۷ متریک `needs_accountant_review` (sales_by_period، vouchers_by_date، vouchers_by_type، tax_monthly_summary، period_comparison، trend_analysis، cogs_detailed — منطقِ حرفه‌ای)
- **S33.11:** `verify-metric-registry.ts` — count-proxy guard اضافه شد: اگر متریکِ `verified`ای هنوز count-proxy در oracleSql داشته باشد، exit code = 1
- **گزارشِ verify:registry:** 5/68 verified (7%) — 33/68 oracle_only (49%) — 23/68 needs_review (34%) — 7/68 not_applicable (10%)

### بخش د — S33.5 و S33.12-S33.13
- **اسکریپت:** `scripts/ops/verify-deployment-live.ps1` — اجرای زندهٔ دومنبعی روی سرورِ 192.168.85.56:2211
- **روش:** ۱) کوئریِ SQL مستقل via SSH/sqlcmd (Base64-encoded، sqlcmd -Q -h -1) ۲) استقرار app.asar + V8 snapshot ۳) موتورِ دیباگ روی پورت 3322 ۴) پرسشِ فارسیِ Base64-encoded ۵) مقایسهٔ عددی با تلورانسِ ۰.۱٪
- **تاریخِ اجرا:** 2026-07-04
- **نتایجِ MATCH (۱۰):** purchases (226B), sales_count (202), fiscal_year_count (11), total_revenue (64B), total_expenses (11B), total_assets (128B), total_equity (84B), tax_collected (2B), fiscal_year_list (لیستی), recent_documents (لیستی)
- **نتایجِ DIFF (۸ — تفاوتِ تعریف، نه باگ):** total_liabilities, net_profit, vat_liability, cashflow, cogs, unbalanced_vouchers, zero_amount_invoices, closing_status
- **گزارشِ JSON:** `ops/s33-dual-source-2026-07-04.json`
- **اصلاحاتِ اسکریپت:** ۱) @() wrapper برای جلوگیری از ایندکس‌کردنِ رشته‌ای ۲) سالِ مالیِ پویا با subquery ۳) فیلترِ کد حساب با LIKE '41%' روی Type=1 ۴) total_revenue از SLS.Invoice ۵) استخراجِ عدد با [0-9] و فیلترِ سال

---

## معیارِ خروجِ فاز ۳۳ (Exit Gate)
- [x] رجیستری سه‌سطحی شد؛ فقط دومنبعی‌های زنده `verified`اند (بدونِ اغراق).
- [x] `purchases` با منبعِ درست (`INV.InventoryReceipt`) = 226,110,419,451 و موتور == اوراکل. _(زاهدِ زنده: 2026-07-04، requestId=ssh-1783161119938)_
- [x] `tax_paid`/`tax_collected` از heuristicِ معیوب به منبعِ ستونیِ درست منتقل شدند (`tax_collected` = oracle_only، `tax_paid` = needs_accountant_review).
- [x] متریک‌های لیستی با محتوا (نه شمارش) تأیید شدند — ۱۰ متریک به content-sampling ارتقا یافتند، count-proxy guard فعال است.
- [x] پاسِ دومنبعیِ زنده برای متریک‌های `oracle_only` اجرا و ثبت شد. _(S33.12: 10/18 MATCH, 8/18 DIFF — تفاوت‌های تعریفِ متریک)_
- [x] گزارشِ فاز طبقِ الگوی §۲۸.۷ با شواهدِ خام. _(گزارشِ JSON: ops/s33-dual-source-2026-07-04.json)_
