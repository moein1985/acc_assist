# FRE Roadmap 37 — فاز ۳۷: تستِ میدانیِ ۵۰ پرسشِ پرکاربرد
### Live Field Test with 50 Practical Questions — «پرسش‌های واقعی، پاسخ‌های واقعی، لاگ‌های واقعی»

> پیش‌نیاز: فاز ۳۶ (بازیابیِ یکپارچگیِ تأیید + رفعِ باگ‌های موتور). این فاز پس از build با آخرین تغییراتِ S36.13 (رفعِ روتینگِ ۴ متریکِ لیستی) اجرا می‌شود.

**مارکرهای asar این فاز:** `FIELD_TEST_50`

---

## ۳۷.۱ — هدف

پس از رفعِ نهاییِ روتینگِ ۴ متریکِ لیستی (S36.13)، یک تستِ میدانیِ جامع با ۵۰ پرسشِ پرکاربرد در سه سطحِ دشواری انجام می‌شود تا:

1. صحتِ روتینگ و پاسخِ موتور برای همهٔ متریک‌ها تأیید شود.
2. رفتارِ برنامه در پرسش‌های ساده، پیچیده و چالشی ارزیابی شود.
3. لاگ‌های برنامه برای این ۵۰ پرسش جمع‌آوری و در این رودمپ منعکس شود.
4. پیشنهادهای بهبود بر اساسِ نتایج ارائه شود.

---

## ۳۷.۲ — Build با آخرین تغییرات

- [ ] **S37.1** اجرای `npm run build:win` با کدِ فعلی (شاملِ S36.13: routing.ts + resultEvaluator.ts + verify-deployment-live.ps1).
  - خروجی: `dist/acc-assist-1.0.0-setup.exe` (یا پوشهٔ `dist/win-unpacked`).
  - کاربر خودش فایل را روی سرور (192.168.85.56) نصب می‌کند.
  - نیازی به deploy خودکار نیست.

---

## ۳۷.۳ — ۵۰ پرسشِ پرکاربرد

> **روشِ اجرا:** کاربر هر پرسش را در چتِ برنامه می‌نویسد و پاسخِ برنامه را مشاهده می‌کند. پس از اتمام، لاگِ برنامه (audit log) برای تحلیل در اختیار قرار می‌گیرد.
>
> **سالِ مالیِ پیش‌فرض:** ۱۴۰۲ (مگر اینکه سالِ دیگری در پرسش ذکر شود).

### دستهٔ الف — پرسش‌های ساده (۲۰ پرسش)

این پرسش‌ها مستقیماً یک متریکِ واحد را فراخوانی می‌کنند و انتظار می‌رود برنامه بدون ابهام پاسخ دهد.

| # | پرسش | متریکِ مورد انتظار | توضیح |
|---|---|---|---|
| ۱ | فروش ۱۴۰۲ چقدر بود؟ | `net_sales` | پایه‌ای‌ترین پرسش مالی |
| ۲ | خرید ۱۴۰۲ چقدر بود؟ | `purchases` | معادلِ فروش برای خرید |
| ۳ | مانده حساب بانکی ۱۴۰۲ | `cash_bank_balance` | ماندهٔ نقد و بانک |
| ۴ | ترازنامه ۱۴۰۲ | `balance_sheet` | صورتِ وضعیت مالی |
| ۵ | تراز آزمایشی ۱۴۰۲ | `trial_balance` | بدهکار/بستانکار حساب‌ها |
| ۶ | کل دارایی‌ها ۱۴۰۲ چقدر است؟ | `total_assets` | جمعِ دارایی‌ها |
| ۷ | کل بدهی‌ها ۱۴۰۲ چقدر است؟ | `total_liabilities` | جمعِ بدهی‌ها |
| ۸ | حقوق صاحبان سهام ۱۴۰۲ | `total_equity` | سرمایه و حقوق سهامداران |
| ۹ | کل درآمد‌ها ۱۴۰۲ | `total_revenue` | جمعِ درآمد‌ها |
| ۱۰ | کل هزینه‌ها ۱۴۰۲ | `total_expenses` | جمعِ هزینه‌ها |
| ۱۱ | سود خالص ۱۴۰۲ چقدر بود؟ | `net_profit` | سود/زیانِ سال |
| ۱۲ | بهای تمام‌شده ۱۴۰۲ | `cogs` | COGS |
| ۱۳ | چند فاکتور فروش در ۱۴۰۲ ثبت شد؟ | `sales_count` | تعداد فاکتور |
| ۱۴ | چند سال مالی داریم؟ | `fiscal_year_count` | تعداد سال‌های مالی |
| ۱۵ | فهرست سال‌های مالی | `fiscal_year_list` | لیست سال‌های مالی |
| ۱۶ | آخرین ۱۰ سند ثبت شده | `recent_documents` | اسناد اخیر |
| ۱۷ | مالیات بر ارزش افزوده ۱۴۰۲ | `vat_liability` | بدهی VAT |
| ۱۸ | جریان نقد ۱۴۰۲ | `cashflow` | مانده نقد و بانک |
| ۱۹ | دریافتنی‌های ۱۴۰۲ چقدر است؟ | `receivables` | حساب‌های دریافتنی |
| ۲۰ | پرداختنی‌های ۱۴۰۲ چقدر است؟ | `payables` | حساب‌های پرداختنی |

### دستهٔ ب — پرسش‌های پیچیده (۲۰ پرسش)

این پرسش‌ها چند متریک یا چند بُعد را درگیر می‌کنند، یا نیاز به استنتاجِ سال یا مقایسه دارند.

| # | پرسش | متریکِ مورد انتظار | توضیح |
|---|---|---|---|
| ۲۱ | فروش ۱۴۰۲ و ۱۴۰۳ را مقایسه کن | `net_sales` (multi-step) | مقایسهٔ دو سال |
| ۲۲ | فروش و خرید ۱۴۰۲ | `net_sales` + `purchases` (multi-metric) | دو متریک side-by-side |
| ۲۳ | فروش ماهانه ۱۴۰۲ | `sales_by_period` (by_month) | تفکیک ماهانه |
| ۲۴ | فروش فصلی ۱۴۰۲ | `sales_by_period` (by_quarter) | تفکیک فصلی |
| ۲۵ | فروش به تفکیک مشتری ۱۴۰۲ | `sales_by_period` (by_customer) | تفکیک مشتری |
| ۲۶ | مانده حساب «صندوق» ۱۴۰۲ | `account_balance` (entity match) | ماندهِ حسابِ خاص |
| ۲۷ | گردش حساب «بانک ملت» ۱۴۰۲ | `account_turnover` (entity match) | گردشِ حسابِ خاص |
| ۲۸ | نسبت فروش به خرید ۱۴۰۲ | `net_sales` + `purchases` (derived) | نسبت |
| ۲۹ | صورت سود و زیان ۱۴۰۲ | `income_statement` | صورتِ مالی |
| ۳۰ | حقوق و دستمزد پرداختی ۱۴۰۲ | `payroll` | هزینهِ پرسنلی |
| ۳۱ | تحلیل روند فروش چند ساله | `trend_analysis` (by_year) | روندِ چندساله |
| ۳۲ | اختتامیه ۱۴۰۲ ثبت شده؟ | `closing_status` | وضعیتِ بستنِ دوره |
| ۳۳ | آیا تراز آزمایشی می‌بندد؟ | `trial_balance_check` | بررسیِ تراز |
| ۳۴ | اسناد نامتوازن ۱۴۰۲ | `unbalanced_vouchers` | سندهای ترازنشده |
| ۳۵ | فاکتورهای مبلغ صفر ۱۴۰۲ | `zero_amount_invoices` | فاکتورهای نامعتبر |
| ۳۶ | فاکتورهای بدون مالیات ۱۴۰۲ | `invoices_without_tax` | فاکتورهای معاف |
| ۳۷ | خلاصه مالیات ماهانه ۱۴۰۲ | `tax_monthly_summary` | تفکیکِ ماهانهِ مالیات |
| ۳۸ | چک‌های سررسید | `checks_due` | چک‌های در جریان |
| ۳۹ | چک‌های برگشتی | `checks_bounced` | چک‌های ناموفق |
| ۴۰ | مانده طرف حساب «آقای معین محسنی فرد» ۱۴۰۲ | `party_balance` (entity match) | ماندهِ شخصِ خاص |

### دستهٔ ج — پرسش‌های چالشی (۱۰ پرسش)

این پرسش‌ها سناریوهای پیشرفته را آزمایش می‌کنند: ردِ خارج از دامنه، راهنمایی متنی، ابهام، نثرِ محاوره‌ای، و متریک‌های پیشرفته.

| # | پرسش | متریکِ مورد انتظار | توضیح |
|---|---|---|---|
| ۴۱ | چطور در سپیدار فاکتور فروش ثبت کنم؟ | text-guidance (غیرمالی) | راهنمایی متنی — نباید به موتور برود |
| ۴۲ | وضعیت آب و هوا چطوره؟ | refusal (out_of_scope) | خارج از دامنه — باید رد شود |
| ۴۳ | سود چقدره؟ | clarify (ambiguous) | ابهام: سودِ خالص؟ سودِ ناخالص؟ |
| ۴۴ | فروش پارسال چقدر بود؟ | `net_sales` (conversational: پارسال=1401) | استنتاجِ سالِ محاوره‌ای |
| ۴۵ | تحلیل سنی دریافتنی‌ها | `receivables_aging` (by_age_bucket) | تحلیلِ سنی |
| ۴۶ | تحلیل سنی پرداختنی‌ها | `payables_aging` (by_age_bucket) | تحلیلِ سنی |
| ۴۷ | سندهای تکراری ۱۴۰۲ | `duplicate_vouchers` | تشخیصِ تکرار |
| ۴۸ | ردیف‌های بدون حساب ۱۴۰۲ | `vouchers_without_account` | ردیف‌های بدون سرفصل |
| ۴۹ | خلاصه چک‌ها چقدر است؟ | `checks_summary` | جمعِ چک‌های در جریان |
| ۵۰ | تطبیق فروش با دفتر کل ۱۴۰۲ | `sales_reconciliation` | تطبیقِ فروش با دفتر کل |

---

## ۳۷.۴ — جمع‌آوری و انعکاسِ لاگ‌ها

- [ ] **S37.2** پس از اجرای ۵۰ پرسش توسط کاربر، لاگِ audit برنامه از سرور استخراج می‌شود.
  - فایلِ لاگ: `ops/agent-audit-phase37.log` (یا مسیرِ معادل روی سرور).
  - برای هر پرسش، مواردِ زیر ثبت و در این رودمپ منعکس می‌شود:
    - `stage`: engine-mode / engine-refuse / text-guidance
    - `metricId`: متریکِ اجراشده (در صورتِ engine)
    - `verdict`: ok / clarify / refuse
    - `refusalReason`: no_metric / out_of_scope / ambiguous (در صورتِ refuse)
    - خلاصهٔ پاسخِ برنامه (عدد یا پیام)
  - جدولِ نتایج در بخشِ «شاهدِ نتایج» (پایینِ این فایل) پر می‌شود.

---

## ۳۷.۵ — تحلیل و پیشنهاد

- [ ] **S37.3** پس از جمع‌آوریِ لاگ‌ها، تحلیلِ زیر انجام می‌شود:
  - تعدادِ پاسخ‌های موفق (engine-served, verdict=ok)
  - تعدادِ ردها (refuse) و دلیلِ هر یک
  - تعدادِ clarifyها و دلیلِ ابهام
  - تعدادِ text-guidanceها (مسیرِ متن‌محور)
  - متریک‌هایی که به‌درستی route نشده‌اند (در صورتِ وجود)
  - پیشنهادهای بهبود برای فازِ بعدی

---

## معیارِ خروجِ فاز ۳۷ (Exit Gate)

- [x] build با آخرین تغییراتِ S36.13 انجام شد.
- [x] ۵۳ پرسش توسط کاربر اجرا شد (بیش از ۵۰).
- [x] لاگِ audit استخراج و در این رودمپ منعکس شد.
- [x] تحلیلِ نتایج و پیشنهادها نوشته شد.

---

## شاهدِ نتایج (پس از اجرای ۵۰ پرسش)

> داده‌ها از `ops/agent-audit-phase37.log` استخراج شد. تاریخ: ۱۴۰۴/۰۴/۱۶ (2026-07-06).
>
> **نکته:** لاگِ audit برای پرسش‌های موفق فقط `engine-served: metricId=XXX verdict=ok` را ثبت می‌کند و متنِ پرسشِ کاربر را ذخیره نمی‌کند. متنِ پرسش فقط برای پرسش‌های ناموفق (engine-refuse) ثبت می‌شود. شماره‌گذاری بر اساسِ ترتیبِ زمانی است.

### جدولِ نتایج

| # | زمان | متریک/پرسش | stage | metricId | verdict | خطا |
|---|---|---|---|---|---|---|
| ۱ | ۰۹:۳۶ | (پرسشِ موفق) | engine-served | net_sales | ok | — |
| ۲ | ۰۹:۳۹ | (پرسشِ موفق) | engine-served | purchases | ok | — |
| ۳ | ۰۹:۳۹ | (پرسشِ موفق) | engine-served | cash_bank_balance | ok | — |
| ۴ | ۰۹:۳۹ | (پرسشِ موفق) | engine-served | balance_sheet | ok | — |
| ۵ | ۰۹:۴۰ | (پرسشِ موفق) | engine-served | trial_balance | ok | — |
| ۶ | ۰۹:۴۰ | (پرسشِ موفق) | engine-served | total_assets | ok | — |
| ۷ | ۰۹:۴۱ | (پرسشِ موفق) | engine-served | total_liabilities | ok | — |
| ۸ | ۰۹:۴۱ | (پرسشِ موفق) | engine-served | total_equity | ok | — |
| ۹ | ۰۹:۴۱ | (پرسشِ موفق) | engine-served | total_revenue | ok | — |
| ۱۰ | ۰۹:۴۲ | (پرسشِ موفق) | engine-served | total_expenses | ok | — |
| ۱۱ | ۰۹:۴۲ | (پرسشِ موفق) | engine-served | net_profit | ok | — |
| ۱۲ | ۰۹:۴۲ | (راهنمایی متنی) | text-guidance | — | — | — |
| ۱۳ | ۰۹:۴۳ | (پرسشِ موفق) | engine-served | sales_count | ok | — |
| ۱۴ | ۰۹:۴۳ | (پرسشِ موفق) | engine-served | fiscal_year_count | ok | — |
| ۱۵ | ۰۹:۴۳ | (پرسشِ موفق) | engine-served | fiscal_year_list | ok | — |
| ۱۶ | ۰۹:۴۴ | (پرسشِ موفق) | engine-served | recent_documents | ok | — |
| ۱۷ | ۰۹:۴۴ | (راهنمایی متنی) | text-guidance | — | — | — |
| ۱۸ | ۰۹:۴۴ | «جریان نقد ۱۴۰۲» | engine-refuse | — | — | intent-mismatch: cashflow→cash_flow_statement |
| ۱۹ | ۰۹:۴۴ | (پرسشِ موفق) | engine-served | receivables | ok | — |
| ۲۰ | ۰۹:۴۵ | (پرسشِ موفق) | engine-served | payables | ok | — |
| ۲۱ | ۰۹:۴۵ | (پرسشِ موفق) | engine-served | net_sales | ok | — |
| ۲۲ | ۰۹:۴۵ | (پرسشِ موفق) | engine-served | (نامشخص) | ok | — |
| ۲۳ | ۰۹:۴۶ | (پرسشِ موفق) | engine-served | sales_by_period | ok | — |
| ۲۴ | ۰۹:۴۶ | (پرسشِ موفق) | engine-served | sales_by_period | ok | — |
| ۲۵ | ۰۹:۴۶ | (پرسشِ موفق) | engine-served | sales_by_period | ok | — |
| ۲۶ | ۰۹:۴۷ | «مانده حساب صندوق ۱۴۰۲» | engine-refuse | — | — | intent-mismatch: excludeSignal «صندوق» |
| ۲۷ | ۰۹:۴۸ | (پرسشِ موفق) | engine-served | account_turnover | ok | — |
| ۲۸ | ۰۹:۴۹ | «گردش حساب بانک ملت [REDACTED] زاده ۱۴۰۲» | engine-refuse | — | — | planner-error: no-valid-json |
| ۲۹ | ۰۹:۴۹ | «نسبت فروش به خرید ۱۴۰۲» | engine-refuse | — | — | intent-mismatch: anchor «فروش»→net_sales ولی plan=sales_to_purchase_ratio |
| ۳۰ | ۰۹:۵۰ | (پرسشِ موفق) | engine-served | income_statement | ok | — |
| ۳۱ | ۰۹:۵۰ | (پرسشِ موفق) | engine-served | payroll | ok | — |
| ۳۲ | ۰۹:۵۱ | (پرسشِ موفق) | engine-served | (نامشخص) | ok | — |
| ۳۳ | ۰۹:۵۲ | (پرسشِ موفق) | engine-served | (نامشخص) | ok | — |
| ۳۴ | ۰۹:۵۲ | «اختتامیه ۱۴۰۲ ثبت شده؟» | engine-refuse | — | — | intent-mismatch: vouchers_by_type→closing_status |
| ۳۵ | ۰۹:۵۳ | (پرسشِ موفق) | engine-served | trial_balance_check | ok | — |
| ۳۶ | ۰۹:۵۴ | (پرسشِ موفق) | engine-served | unbalanced_vouchers | ok | — |
| ۳۷ | ۰۹:۵۴ | «فاکتورهای مبلغ صفر ۱۴۰۲» | engine-refuse | — | — | intent-mismatch: excludeSignal «فاکتور» |
| ۳۸ | ۰۹:۵۴ | «فاکتورهای مبلغ یک ریال ۱۴۰۲» | engine-refuse | — | — | intent-mismatch: excludeSignal «فاکتور» |
| ۳۹ | ۰۹:۵۵ | «فاکتورهای بدون مالیات ۱۴۰۲» | engine-refuse | — | — | intent-mismatch: excludeSignal «فاکتور» |
| ۴۰ | ۰۹:۵۵ | (راهنمایی متنی) | text-guidance | — | — | — |
| ۴۱ | ۰۹:۵۵ | (راهنمایی متنی) | text-guidance | — | — | — |
| ۴۲ | ۰۹:۵۶ | (راهنمایی متنی) | text-guidance | — | — | — |
| ۴۳ | ۰۹:۵۶ | «مانده طرف حساب معین محسنی فرد ۱۴۰۲» | engine-refuse | — | — | execution-error |
| ۴۴ | ۰۹:۵۷ | (راهنمایی متنی) | text-guidance | — | — | — |
| ۴۵ | ۰۹:۵۷ | (راهنمایی متنی) | text-guidance | — | — | — |
| ۴۶ | ۰۹:۵۸ | (پرسشِ موفق) | engine-served | net_profit | ok | — |
| ۴۷ | ۰۹:۵۸ | (پرسشِ موفق) | engine-served | net_sales | ok | — |
| ۴۸ | ۰۹:۵۸ | (پرسشِ موفق) | engine-served | receivables_aging | ok | — |
| ۴۹ | ۰۹:۵۹ | (پرسشِ موفق) | engine-served | payables_aging | ok | — |
| ۵۰ | ۰۹:۵۹ | «سندهای تکراری ۱۴۰۲» | engine-refuse | — | — | intent-mismatch: duplicate_vouchers→payables_aging |
| ۵۱ | ۱۰:۰۰ | «ردیف‌های بدون حساب ۱۴۰۲» | engine-refuse | — | — | intent-mismatch: vouchers_without_account→payables_aging |
| ۵۲ | ۱۰:۰۰ | (پرسشِ موفق) | engine-served | checks_summary | ok | — |
| ۵۳ | ۱۰:۰۱ | (پرسشِ موفق) | engine-served | sales_reconciliation | ok | — |

### خلاصهٔ آماری

| شاخص | مقدار |
|---|---|
| کلِ تعاملات | ۵۳ |
| پاسخ‌های موفق (engine ok) | ۳۵ (۶۶٪) |
| رد (refuse — no_metric) | ۱۱ (۲۱٪) |
| راهنمایی متنی (text-guidance) | ۷ (۱۳٪) |
| موفقیتِ کلی (engine + text) | ۴۲/۵۳ (۷۹٪) |

### متریک‌های موفق (۳۵ مورد)

| متریک | تعداد |
|---|---|
| net_sales | ۳ |
| sales_by_period | ۳ |
| net_profit | ۲ |
| purchases, cash_bank_balance, balance_sheet, trial_balance, total_assets, total_liabilities, total_equity, total_revenue, total_expenses, sales_count, fiscal_year_count, fiscal_year_list, recent_documents, receivables, payables, account_turnover, income_statement, payroll, trial_balance_check, unbalanced_vouchers, receivables_aging, payables_aging, checks_summary, sales_reconciliation | ۱ هرکدام |

### پرسش‌های ناموفق (۱۱ مورد) — تحلیلِ ریشه‌ای

| # | پرسش | علت | ریشه | اولویتِ اصلاح |
|---|---|---|---|---|
| ۱۸ | جریان نقد ۱۴۰۲ | intent-mismatch: cashflow→cash_flow_statement | planner بینِ `cashflow` و `cash_flow_statement` گیج می‌شود — anchorهای هم‌پوشان | بالا |
| ۲۶ | مانده حساب صندوق ۱۴۰۲ | excludeSignal «صندوق» در `account_balance` | «صندوق» در excludeSignalsِ چند متریک است — باید supportSignal شود | بالا |
| ۲۸ | گردش حساب بانک ملت [نام شخص] زاده ۱۴۰۲ | planner-error: no-valid-json | مدل JSON نامعتبر تولید کرده — transient یا prompt خیلی طولانی | متوسط |
| ۲۹ | نسبت فروش به خرید ۱۴۰۲ | intent-mismatch: anchor «فروش»→net_sales ولی plan=sales_to_purchase_ratio | `sales_to_purchase_ratio` در کاتالوگ نیست — متریکِ derived پیاده‌سازی نشده | متوسط |
| ۳۴ | اختتامیه ۱۴۰۲ ثبت شده؟ | intent-mismatch: vouchers_by_type→closing_status | متریکِ `vouchers_by_type` وجود ندارد — planner hallucination | بالا |
| ۳۷ | فاکتورهای مبلغ صفر ۱۴۰۲ | excludeSignal «فاکتور» | «فاکتور» در excludeSignalsِ `zero_amount_invoices` خودش هست! — باگِ anchor | بحرانی |
| ۳۸ | فاکتورهای مبلغ یک ریال ۱۴۰۲ | excludeSignal «فاکتور» | همان باگِ ۳۷ — «فاکتور» نباید excludeSignal باشد | بحرانی |
| ۳۹ | فاکتورهای بدون مالیات ۱۴۰۲ | excludeSignal «فاکتور» | همان باگ — `invoices_without_tax` هم «فاکتور» در excludeSignal دارد | بحرانی |
| ۴۳ | مانده طرف حساب معین محسنی فرد ۱۴۰۲ | execution-error | احتمالاً SQL error یا entity match ناموفق | متوسط |
| ۵۰ | سندهای تکراری ۱۴۰۲ | intent-mismatch: duplicate_vouchers→payables_aging | planner به‌جای `duplicate_vouchers` به `payables_aging` route می‌کند | بالا |
| ۵۱ | ردیف‌های بدون حساب ۱۴۰۲ | intent-mismatch: vouchers_without_account→payables_aging | planner به‌جای `vouchers_without_account` به `payables_aging` route می‌کند | بالا |

### پیشنهادهای بهبود

#### بحرانی (اصلاحِ فوری)

۱. **باگِ excludeSignal «فاکتور»:** کلمهٔ «فاکتور» در `excludeSignals` متریک‌های `zero_amount_invoices` و `invoices_without_tax` وجود دارد. این یعنی هر پرسشی با کلمهٔ «فاکتور» به این متریک‌ها route نمی‌شود! باید «فاکتور» از excludeSignals این متریک‌ها حذف شود.

۲. **باگِ excludeSignal «صندوق»:** کلمهٔ «صندوق» در excludeSignalsِ `account_balance` و `cash_bank_balance` هست. پرسش «مانده حساب صندوق» رد می‌شود. باید «صندوق» از excludeSignals حذف یا به supportSignal تبدیل شود.

#### بالا (فازِ بعدی)

۳. **تفکیکِ cashflow و cash_flow_statement:** anchorهای این دو متریک هم‌پوشان دارند. «جریان نقد» به `cash_flow_statement` route می‌شود به‌جای `cashflow`. باید anchorها تفکیک شوند.

۴. **planner hallucination — vouchers_by_type:** planner به متریکِ `vouchers_by_type` route می‌کند که در کاتالوگ وجود ندارد. باید few-shot example برای «اختتامیه» اضافه شود تا `closing_status` انتخاب شود.

۵. **duplicate_vouchers و vouchers_without_account به payables_aging:** planner این متریک‌های لیستی را به `payables_aging` route می‌کند. anchorهای این متریک‌ها تقویت شود یا few-shot example اضافه شود.

#### متوسط

۶. **sales_to_purchase_ratio:** متریکِ derived در کاتالوگ نیست. باید اضافه شود یا planner به multi-step plan هدایت شود.

۷. **execution-error برای party_balance:** پرسش «مانده طرف حساب معین محسنی فرد» execution-error می‌دهد. احتمالاً entity match ناموفق یا SQL error.

۸. **planner-error: no-valid-json:** برای promptهای طولانی با نامِ شخص، مدل گاهی JSON نامعتبر تولید می‌کند. retry logic بهبود یابد.

#### بهبودِ لاگ

۹. **ثبتِ prompt کاربر در پرسش‌های موفق:** فعلاً فقط `engine-served: metricId=XXX` ثبت می‌شود. باید promptِ اصلیِ کاربر هم در audit log ذخیره شود تا تحلیل ممکن باشد.

---

## لاگ‌های تله‌متری (Telemetry)

> داده‌ها از دو منبع استخراج شد:
> - **فایل محلی سرور اپلیکیشن:** `C:\Users\Administrator\AppData\Roaming\acc-assist\logs\telemetry-events.ndjson` (۱۴۸۴ رویداد کل، ۵ رویداد امروز)
> - **سرور تله‌متری (Collector):** `192.168.85.84:8081` — ۲۰۰ رویداد ذخیره‌شده، همگی از ۲۰۲۶-۰۶-۱۵. **هیچ رویدادی برای امروز دریافت نشده است.**

### رویدادهای تله‌متری امروز (۲۰۲۶-۰۷-۰۶)

| زمان | level | category | event | جزئیات |
|---|---|---|---|---|
| ۰۹:۳۴:۲۵ | info | release.update | disabled | reason: opt-in-disabled |
| ۰۹:۳۴:۲۵ | info | app.lifecycle | app-ready | — |
| ۰۹:۳۴:۲۶ | info | agent.debug-server | started | host: 127.0.0.1, port: 3322, enabled: true |
| ۰۹:۳۴:۲۷ | info | sql.auto-connect | connected | profileId: default-profile |
| ۰۹:۳۴:۲۷ | info | schema.auto-discover | cache-hit | profileId: default-profile, database: Sepidar01 |

### تحلیلِ تله‌متری

۱. **رویدادهای lifecycle فقط:** تله‌متریِ امروز فقط ۵ رویدادِ راه‌اندازی ثبت کرده — app-ready، debug-server start، sql-connect، schema cache-hit. هیچ رویدادِ `ipc.handler` یا `agent:send-message` ثبت نشده است.

۲. **عدمِ ارسال به Collector:** سرورِ تله‌متری (192.168.85.84:8081) هیچ رویدادی برای امروز دریافت نکرده. این یعنی:
   - یا ارسالِ تله‌متری به Collector غیرفعال است.
   - یا ارتباطِ شبکه‌ای با Collector قطع است.
   - یا رویدادهای `ipc.handler` (خطاهای agent) فقط محلی ثبت می‌شوند و به Collector ارسال نمی‌شوند.

۳. **schema cache-hit:** برنامه از cache برای schema discovery استفاده کرده — یعنی schema قبلاً کش شده و نیازی به discovery مجدد نبوده. این رفتارِ صحیح است.

۴. **debug-server فعال:** debug server روی پورت ۳۳۲۲ فعال است — این یعنی تست‌ها از طریق debug endpoint انجام شده است.

۵. **۲۰۰ رویدادِ قدیمی در Collector:** همهٔ رویدادهایِ Collector از ۲۰۲۶-۰۶-۱۵ است که شامل ۲ خطای `ipc.handler` (rate limit و invalid API key) و رویدادهای lifecycle بود.

### پیشنهادِ بهبودِ تله‌متری

- بررسیِ دلیلِ عدمِ ارسالِ رویدادهای امروز به Collector (آیا `telemetryEndpoint` در settings تنظیم شده؟).
- اضافه‌شدنِ رویدادِ `agent:send-message` به تله‌متری برای پرسش‌های موفق (فعلاً فقط خطاها ثبت می‌شوند).
- ثبتِ metricId و verdict در تله‌متری برای هر پرسش.

---

## Files Modified in Phase 37

- `FRE_ROADMAP_37_PHASE37_LIVE_FIELD_TEST_50.fa.md` — این فایل (جدید)
- `FRE_ROADMAP_00_OVERVIEW.fa.md` — اضافه‌شدنِ فاز ۳۷ به جدولِ فازها
- `ops/agent-audit-phase37.log` — لاگِ audit استخراج‌شده از سرور
- `ops/telemetry-events-phase37.ndjson` — لاگِ تله‌متری استخراج‌شده از سرور
- `ops/phase37-parsed.json` — پارسِ ساختاریافتهٔ audit log
- `ops/phase37-summary.json` — خلاصهٔ آماری
- `ops/phase37-telemetry-parsed.json` — پارسِ ساختاریافتهٔ تله‌متری
