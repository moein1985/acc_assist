# FRE Roadmap 12 — فاز ۱۴: ابزارهای حسابدار
### از گزارش‌های مدیریتی به کوئری‌های روزمرهٔ حسابدار — سند، تطبیق، کشف خطا، چک، مالیات

> پیش‌نیاز: فاز ۱۳ کامل. ۴۱ متریک فعال. ۱۴۷ golden case سبز. خروجی PDF/Excel/Chart/Print پیاده‌سازی شده. موتور FRE در حالت engine روی ریموت کار می‌کند.

**مارکرهای asar این فاز:** `ACCOUNTANT_TOOLS`, `DATE_RANGE_FILTER`, `ANOMALY_DETECTION`, `AGING_ANALYSIS`, `CHECK_MANAGEMENT`.

---

## ۰ — نقشهٔ فاز

| بخش | موضوع | اندازه |
|---|---|---|
| الف | فیلتر محدوده تاریخ (Date Range Filter) | متوسط |
| ب | کوئری‌های سند-محور (Document-level) | متوسط |
| ج | کشف خطا و ناهنجاری (Anomaly Detection) | متوسط |
| د | تحلیل سنی (Aging Analysis) | متوسط |
| هـ | گردش تفصیلی (Detailed Turnover) | کوچک–متوسط |
| و | گزارش‌های مالیاتی (Tax Reports) | متوسط |
| ز | مدیریت چک‌ها (Check Management) | متوسط |
| ح | بستن دوره (Period Closing) | کوچک–متوسط |
| ط | تطبیق بین‌ماژولی (Cross-module Reconciliation) | متوسط–بزرگ |
| ی | Drill-down مکالمه‌ای (Conversational Drill-down) | متوسط |
| ک | تست، اعتبارسنجی و پختگی نهایی | کوچک–متوسط |

---

## ۱ — انگیزه و دامنه

### وضعیت پس از فاز ۱۳
- ۴۱ متریک فعال (۳۶ پایه + ۵ مشتق)
- ۱۴۷ golden case سبز
- خروجی PDF/Excel/Chart/Print
- موتور FRE در حالت engine روی ریموت کار می‌کند
- تمام متریک‌ها روی **سال مالی** فیلتر می‌شوند (FiscalYearRef)
- کاربران فعلی: مدیران مالی و مدیران مجموعه‌ها

### شکاف‌های باقی‌مانده برای حسابداران
- **فیلتر تاریخ:** حسابدار می‌پرسد «فروش این ماه» نه «فروش ۱۴۰۳» — فعلاً فقط سال مالی پشتیبانی می‌شود
- **کوئری سند:** «سند شماره ۱۲۳۴ چیست؟» — فعلاً فقط `recent_documents` وجود دارد (آخرین N سند بدون فیلتر)
- **کشف خطا:** «کدام سندها تراز ندارند؟» — هیچ متریک کشف ناهنجاری وجود ندارد
- **تحلیل سنی:** «دریافتنی‌های سررسیدشده چقدره؟» — فعلاً فقط مانده کل دریافتنی وجود دارد
- **گردش تفصیلی:** «تراکنش‌های مشتری X با جزئیات» — فعلاً `account_turnover` خلاصه است
- **مالیات:** «مالیات فروش این ماه» — فعلاً فقط `tax_paid`/`tax_collected` کل سال
- **چک:** «چک‌های سررسید این هفته» — هیچ متریک چک وجود ندارد
- **بستن دوره:** «آیا اختتامیه ثبت شده؟» — فعلاً فقط `Type NOT IN (3,4)` به‌عنوان فیلتر ثابت
- **تطبیق:** «آیا مجموع فاکتورها با سند دفتر کل می‌خواند؟» — هیچ قابلیت تطبیق وجود ندارد
- **Drill-down:** بعد از «فروش چقدره؟» نمی‌توان پرسید «فاکتورها را نشان بده»

### اصل طراحی
**همه با SELECT.** هیچ کوئری write (INSERT/UPDATE/DELETE) استفاده نمی‌شود. تمام قابلیت‌ها از طریق کوئری‌های فقط‌خواندنی روی دیتابیس موجود کار می‌کنند.

---

## بخش الف — فیلتر محدوده تاریخ (Date Range Filter)

### S14.1 — اضافه کردن DateRangeFilter به MetricPlan

- [x] **S14.1** نوع `DateRangeFilter` را به `MetricPlan` اضافه کن:
  - **تعریف:** فیلتر اختیاری `dateRange: { start?: string, end?: string }` در `MetricPlan`
  - **فرمت تاریخ:** `YYYY/MM/DD` شمسی (مثلاً `1403/06/31`)
  - **تبدیل:** در Compiler، تاریخ شمسی به میلادی تبدیل و به‌عنوان `WHERE v.Date >= @start AND v.Date <= @end` اعمال شود
  - **اولویت:** اگر `dateRange` موجود باشد، روی `fiscalYearFilter` اولویت دارد (می‌تواند زیرمجموعهٔ یک سال باشد یا چند سال را پوشش دهد)
  - **تغییرات:**
    - `src/main/services/financialEngine/types.ts`: اضافه کردن `dateRange?: { start?: string; end?: string }` به `MetricPlan`
    - `src/main/services/financialEngine/planner.ts`: پشتیبانی از استخراج محدوده تاریخ از پرامپت فارسی
    - `src/main/services/financialEngine/compiler.ts`: تولید `WHERE` با `BETWEEN` یا `>= / <=`
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: MetricPlan با dateRange درست compile شود. golden case: «فروش فروردین ۱۴۰۳» عدد درست بدهد.

### S14.2 — استخراج محدوده تاریخ از پرامپت فارسی

- [x] **S14.2** در Planner، الگوهای محدوده تاریخ فارسی را پشتیبانی کن:
  - **الگوها:**
    - «این ماه» → شروع اول روز ماه جاری شمسی تا امروز
    - «ماه گذشته» → کل ماه شمسی قبل
    - «فروردین» → فروردین سال جاری
    - «فروردین تا تیر» → محدوده ۴ ماه
    - «سه ماه اول ۱۴۰۳» → فروردین تا خرداد ۱۴۰۳
    - «۱۴۰۳/۰۶/۰۱ تا ۱۴۰۳/۰۶/۳۱» → محدوده دقیق
    - «امسال» → اول سال مالی جاری تا امروز
    - «پارسال» → کل سال مالی قبل
  - **پیاده‌سازی:**
    - تابع `parseDateRangeFromPrompt(prompt: string): DateRange | null` در `planner.ts`
    - استفاده از `getCurrentPersianYear()` موجود
    - دیکشنری نام ماه‌های شمسی: فروردین=۱، اردیبهشت=۲، ... اسفند=۱۲
    - دیکشنری فصل‌ها: بهار=۱-۳، تابستان=۴-۶، پاییز=۷-۹، زمستان=۱۰-۱۲
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: ۱۰ الگوی مختلف درست parse شوند. golden case: «فروش ماه گذشته» عدد درست بدهد.

### S14.3 — تبدیل تاریخ شمسی به میلادی در Compiler

- [x] **S14.3** تابع `persianToGregorian(dateStr: string): string` را پیاده کن:
  - **ورودی:** `1403/06/31` (شمسی)
  - **خروجی:** `2024-09-21` (میلادی، فرمت SQL)
  - **کتابخانه:** استفاده از `jalaali-js` یا تبدیل دستی با جدول
  - **محل:** `src/main/services/financialEngine/dateUtils.ts` (فایل جدید)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: ۲۰ تاریخ مختلف (شامل کبیسه) درست تبدیل شوند.

### S14.4 — به‌روزرسانی تمام متریک‌های فعلی برای پشتیبانی dateRange

- [x] **S14.4** در Compiler، اگر `dateRange` در plan وجود دارد:
  - فیلتر `v.Date >= @start AND v.Date <= @end` به WHERE اضافه شود
  - اگر متریک از `SLS.Invoice` استفاده می‌کند: `i.Date >= @start AND i.Date <= @end`
  - اگر متریک از `INV.InventoryReceipt` استفاده می‌کند: `r.Date >= @start AND r.Date <= @end`
  - **نکته:** `fiscalYearFilter` حذف نشود — اگر هم `dateRange` و هم `fiscalYear` موجود باشند، هر دو اعمال شوند (AND)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case: «فروش فروردین ۱۴۰۳» عدد متفاوت از «فروش ۱۴۰۳» بدهد. golden case: «مانده حساب بانکی در تاریخ ۱۴۰۳/۰۶/۳۱» عدد درست بدهد.

### S14.5 — unit test و golden case برای dateRange

- [x] **S14.5** unit test + golden case:
  - unit test: parseDateRangeFromPrompt با ۱۰ الگو
  - unit test: persianToGregorian با ۲۰ تاریخ
  - unit test: Compiler با dateRange روی ۳ متریک مختلف
  - golden case: «فروش فروردین ۱۴۰۳» (محدوده یک ماه)
  - golden case: «فروش سه ماه اول ۱۴۰۳» (محدوده سه ماه)
  - golden case: «خرید ماه گذشته» (نسبی به امروز)
  - golden case: «مانده دریافتنی در تاریخ ۱۴۰۲/۱۲/۲۹» (point-in-time)
  - **معیارِ پذیرش:** `npm test` سبز. `npm run eval:metrics` سبز. حداقل ۱۵ case/test جدید.

---

## بخش ب — کوئری‌های سند-محور (Document-level Queries)

### S14.6 — متریک voucher_detail (جزئیات یک سند)

- [x] **S14.6** متریک `voucher_detail` را اضافه کن:
  - **تعریف:** نمایش تمام ردیف‌های یک سند خاص با شماره سند
  - **نوع:** `list`
  - **ورودی:** شماره سند (VoucherId یا شماره ترتیبی)
  - **source:** `ACC.VoucherItem` JOIN `ACC.Voucher` JOIN `ACC.Account`
  - **ستون‌ها:** شماره سند، تاریخ، شرح سند، شرح ردیف، حساب، بدهکار، بستانکار
  - **فیلتر:** `v.VoucherId = @voucherId` یا `v.Number = @voucherNumber`
  - **anchors:** ['سند شماره', 'جزئیات سند', 'ردیف‌های سند', 'سند فلان', 'سند چند']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با شماره سند واقعی از Sepidar01.

### S14.7 — متریک vouchers_by_date (اسناد یک محدوده تاریخ)

- [x] **S14.7** متریک `vouchers_by_date` را اضافه کن:
  - **تعریف:** لیست اسناد ثبت‌شده در محدوده تاریخ
  - **نوع:** `list`
  - **ستون‌ها:** شماره سند، تاریخ، نوع سند، شرح، جمع بدهکار، جمع بستانکار، ثبت‌کننده
  - **source:** `ACC.Voucher` با فیلتر `v.Date BETWEEN @start AND @end`
  - **grain:** `by_date` (تجمیه به‌ازای هر سند)
  - **anchors:** ['اسناد امروز', 'اسناد دیروز', 'اسناد این هفته', 'سندهای ثبت شده', 'چه سندهایی']
  - **excludeSignals:** ['فروش', 'خرید', 'مانده', 'تراز', 'فاکتور']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case: «اسناد امروز» لیست درست بدهد.

### S14.8 — متریک vouchers_by_type (اسناد بر اساس نوع)

- [x] **S14.8** متریک `vouchers_by_type` را اضافه کن:
  - **تعریف:** لیست اسناد بر اساس نوع (عملیاتی، اختتامیه، افتتاحیه)
  - **نوع:** `list`
  - **فیلتر پویا روی `Voucher.Type`:**
    - `Type IN (1,2)` = اسناد عملیاتی عادی
    - `Type = 3` = بستن حساب‌های موقت
    - `Type = 4` = اختتامیه
    - `Type = 5` = افتتاحیه
  - **anchors:** ['سندهای اختتامیه', 'سند اختتام', 'سندهای افتتاحیه', 'سندهای عملیاتی', 'اسناد بستن حساب']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case: «سندهای اختتامیه ۱۴۰۲» لیست درست بدهد.

### S14.9 — unit test و golden case برای کوئری‌های سند-محور

- [x] **S14.9** unit test + golden case:
  - `voucher_detail`: test با mock data + golden case با سند واقعی
  - `vouchers_by_date`: test با mock data + golden case «اسناد امروز»
  - `vouchers_by_type`: test با mock data + golden case «سندهای اختتامیه»
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۸ test جدید.

---

## بخش ج — کشف خطا و ناهنجاری (Anomaly Detection)

### S14.10 — متریک unbalanced_vouchers (سندهای ترازنشده)

- [x] **S14.10** متریک `unbalanced_vouchers` را اضافه کن:
  - **تعریف:** سندهایی که SUM(Debit) ≠ SUM(Credit)
  - **نوع:** `list`
  - **source:** `ACC.VoucherItem` JOIN `ACC.Voucher`
  - **SQL pattern:**
    ```sql
    SELECT v.VoucherId, v.Number, v.Date, v.Description,
           SUM(vi.Debit) AS TotalDebit, SUM(vi.Credit) AS TotalCredit,
           SUM(vi.Debit) - SUM(vi.Credit) AS Difference
    FROM ACC.VoucherItem vi
    JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
    WHERE v.Date BETWEEN @start AND @end
    GROUP BY v.VoucherId, v.Number, v.Date, v.Description
    HAVING SUM(vi.Debit) <> SUM(vi.Credit)
    ```
  - **anchors:** ['سند ترازنشده', 'سندهای تراز ندارند', 'اختلاف سند', 'سند با اختلاف', 'کدام سندها تراز نیستند']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با mock data (سند با اختلاف مصنوعی).

### S14.11 — متریک zero_amount_invoices (فاکتورهای مبلغ صفر)

- [x] **S14.11** متریک `zero_amount_invoices` را اضافه کن:
  - **تعریف:** فاکتورهای فروش با مبلغ صفر یا منفی
  - **نوع:** `list`
  - **source:** `SLS.Invoice`
  - **فیلتر:** `NetPriceInBaseCurrency <= 0`
  - **anchors:** ['فاکتور صفر', 'فاکتور مبلغ صفر', 'فاکتور با مبلغ نامعتبر', 'فاکتورهای صفر']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با mock data.

### S14.12 — متریک duplicate_vouchers (سندهای تکراری)

- [x] **S14.12** متریک `duplicate_vouchers` را اضافه کن:
  - **تعریف:** سندهایی با تاریخ و شرح و مبلغ یکسان (احتمال ثبت تکراری)
  - **نوع:** `list`
  - **SQL pattern:**
    ```sql
    SELECT v.Date, v.Description, COUNT(*) AS Count, SUM(vi.Debit) AS Amount
    FROM ACC.Voucher v
    JOIN ACC.VoucherItem vi ON vi.VoucherRef = v.VoucherId
    WHERE v.Type IN (1, 2)
    GROUP BY v.Date, v.Description, SUM(vi.Debit)
    HAVING COUNT(*) > 1
    ```
  - **anchors:** ['سند تکراری', 'سندهای تکراری', 'ثبت تکراری', 'سندهای مشابه', 'کدام سندها تکراری‌اند']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با mock data (دو سند یکسان).

### S14.13 — متریک vouchers_without_account (ردیف‌های بدون حساب)

- [x] **S14.13** متریک `vouchers_without_account` را اضافه کن:
  - **تعریف:** ردیف‌های سند که AccountSLRef خالی یا نامعتبر است
  - **نوع:** `list`
  - **source:** `ACC.VoucherItem` JOIN `ACC.Voucher`
  - **فیلتر:** `vi.AccountSLRef IS NULL OR vi.AccountSLRef = 0`
  - **anchors:** ['ردیف بدون حساب', 'سند بدون حساب', 'حساب خالی', 'ردیف‌های بدون سرفصل']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با mock data.

### S14.14 — unit test و golden case برای کشف ناهنجاری

- [x] **S14.14** unit test + golden case:
  - `unbalanced_vouchers`: test با mock data (۲ سند ترازدار + ۱ ترازنشده)
  - `zero_amount_invoices`: test با mock data
  - `duplicate_vouchers`: test با mock data
  - `vouchers_without_account`: test با mock data
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۸ test جدید.

---

## بخش د — تحلیل سنی (Aging Analysis)

### S14.15 — Grain جدید by_age_bucket

- [x] **S14.15** grain `by_age_bucket` را به types و compiler اضافه کن:
  - **تعریف:** تجمیع در سطل‌های سنی بر اساس فاصله از تاریخ سررسید
  - **سطل‌ها:** `0-30`, `31-60`, `61-90`, `90+` (روز)
  - **محاسبه:** `DATEDIFF(day, v.Date, GETDATE())` یا `DATEDIFF(day, i.DueDate, GETDATE())`
  - **نکته:** تاریخ مرجع «امروز» است (GETDATE() در SQL Server)
  - **تغییرات:**
    - `types.ts`: اضافه کردن `'by_age_bucket'` به `Grain` type
    - `compiler.ts`: تولید `CASE WHEN DATEDIFF(...) BETWEEN 0 AND 30 THEN '0-30' ...` در GROUP BY
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: grain by_age_bucket درست compile شود.

### S14.16 — متریک receivables_aging (تحلیل سنی دریافتنی‌ها)

- [x] **S14.16** متریک `receivables_aging` را اضافه کن:
  - **تعریف:** دریافتنی‌ها به تفکیک سطل سنی (چقدر از دریافتنی‌ها سررسیدشده است)
  - **نوع:** `aggregate` با grain `by_age_bucket`
  - **source:** `ACC.VoucherItem` JOIN `ACC.Voucher` JOIN `ACC.Account`
  - **فیلتر:** حساب‌های دریافتنی (Account Code شروع با ۱۲ یا Title شامل «دریافتنی»)
  - **محاسبه:** `SUM(Credit - Debit)` (مانده بستانکار = دریافتنی) GROUP BY age bucket
  - **anchors:** ['دریافتنی سررسیدشده', 'تحلیل سنی دریافتنی', 'دریافتنی‌های معوق', 'دریافتنی‌های overdue', 'چقدر دریافتنی سررسید گذشته']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با mock data.

### S14.17 — متریک payables_aging (تحلیل سنی پرداختنی‌ها)

- [x] **S14.17** متریک `payables_aging` را اضافه کن:
  - **تعریف:** پرداختنی‌ها به تفکیک سطل سنی
  - **نوع:** `aggregate` با grain `by_age_bucket`
  - **فیلتر:** حساب‌های پرداختنی (Account Code شروع با ۲۲ یا Title شامل «پرداختنی»)
  - **anchors:** ['پرداختنی سررسیدشده', 'تحلیل سنی پرداختنی', 'پرداختنی‌های معوق', 'چقدر پرداختنی سررسید گذشته']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با mock data.

### S14.18 — unit test و golden case برای تحلیل سنی

- [x] **S14.18** unit test + golden case:
  - `receivables_aging`: test با mock data (۳ سند با تاریخ‌های مختلف)
  - `payables_aging`: test با mock data
  - unit test: grain by_age_bucket درست bucket کند
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۶ test جدید.

---

## بخش هـ — گردش تفصیلی (Detailed Turnover)

### S14.19 — Grain جدید by_voucher

- [x] **S14.19** grain `by_voucher` را اضافه کن:
  - **تعریف:** تجمیع به‌ازای هر سند (هر ردیف = یک سند)
  - **ستون‌ها:** شماره سند، تاریخ، شرح، بدهکار، بستانکار، مانده جاری
  - **نکته:** مانده جاری = SUM تجمعی (running balance) — با `OVER (ORDER BY v.Date, v.VoucherId)`
  - **تغییرات:**
    - `types.ts`: اضافه کردن `'by_voucher'` به `Grain` type
    - `compiler.ts`: تولید ردیف‌های تفصیلی بدون GROUP BY (یا GROUP BY تمام ستون‌ها)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: grain by_voucher درست compile شود.

### S14.20 — به‌روزرسانی account_turnover برای پشتیبانی by_voucher

- [x] **S14.20** متریک `account_turnover` فعلی را به‌روز کن:
  - **grain فعلی:** `by_month`, `by_account` (خلاصه)
  - **grain جدید:** `by_voucher` (ردیف‌بندی سند-به-سند)
  - **ستون‌های اضافی در by_voucher:** شرح سند، طرف حساب (در صورت موجود بودن)
  - **فیلتر:** پشتیبانی از `dateRange` و `accountName` همزمان
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case: «گردش حساب بانکی با جزئیات ۱۴۰۳» ردیف‌بندی درست بدهد.

### S14.21 — متریک party_turnover (گردش طرف حساب)

- [x] **S14.21** متریک `party_turnover` را اضافه کن:
  - **تعریف:** تمام تراکنش‌های یک طرف حساب خاص
  - **نوع:** `list` با grain `by_voucher`
  - **source:** `ACC.VoucherItem` JOIN `ACC.Voucher` JOIN `ACC.Account`
  - **فیلتر:** `a.Title LIKE @partyName` (با Persian folding)
  - **ستون‌ها:** شماره سند، تاریخ، شرح، بدهکار، بستانکار، مانده
  - **anchors:** ['گردش مشتری', 'تراکنش‌های مشتری', 'گردش طرف حساب', 'گردش تأمین‌کننده', 'تراکنش‌های شخص']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با نام مشتری واقعی.

### S14.22 — unit test و golden case برای گردش تفصیلی

- [x] **S14.22** unit test + golden case:
  - `account_turnover` با `by_voucher`: test + golden case
  - `party_turnover`: test + golden case
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۶ test جدید.

---

## بخش و — گزارش‌های مالیاتی (Tax Reports)

### S14.23 — متریک tax_monthly_summary (خلاصه مالیات ماهانه)

- [x] **S14.23** متریک `tax_monthly_summary` را اضافه کن:
  - **تعریف:** مالیات فروش و خرید به تفکیک ماه
  - **نوع:** `aggregate` با grain `by_month`
  - **source:** `SLS.Invoice` (مالیات فروش) + `INV.InventoryReceipt` (مالیات خرید)
  - **ستون‌ها:** ماه، مجموع مالیات فروش، مجموع مالیات خرید، خالص VAT (فروش - خرید)
  - **anchors:** ['مالیات ماهانه', 'مالیات این ماه', 'VAT ماه', 'مالات فروش ماه', 'خالص مالیات']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S14.24 — متریک invoices_without_tax (فاکتورهای بدون مالیات)

- [x] **S14.24** متریک `invoices_without_tax` را اضافه کن:
  - **تعریف:** فاکتورهای فروش که مالیات صفر یا نامعتبر دارند
  - **نوع:** `list`
  - **source:** `SLS.Invoice`
  - **فیلتر:** `TaxAmount = 0 OR TaxAmount IS NULL`
  - **anchors:** ['فاکتور بدون مالیات', 'فاکتور بدون VAT', 'کدام فاکتورها مالیات ندارند', 'فاکتورهای معاف']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با mock data.

### S14.25 — متریک vat_liability (بدهی مالیات ارزش افزوده)

- [x] **S14.25** متریک `vat_liability` را اضافه کن:
  - **تعریف:** خالص بدهی VAT = مالیات فروش (دریافتی) - مالیات خرید (پرداختی)
  - **نوع:** `aggregate` (single value)
  - **محاسبه:** `SUM(sales_tax) - SUM(purchase_tax)` در محدوده تاریخ
  - **anchors:** ['بدهی VAT', 'مالیات پرداختنی', 'خالص مالیات ارزش افزوده', 'چقدر مالیات باید بدهیم']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S14.26 — unit test و golden case برای گزارش‌های مالیاتی

- [x] **S14.26** unit test + golden case:
  - `tax_monthly_summary`: test + golden case
  - `invoices_without_tax`: test با mock data
  - `vat_liability`: test + golden case
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۶ test جدید.

---

## بخش ز — مدیریت چک‌ها (Check Management)

### S14.27 — تحقیق schema چک‌ها در سپیدار

- [x] **S14.27** در schema سپیدار، جداول چک را شناسایی کن:
  - **تحقیق:**
    - آیا جدول `RPA.Check` یا `RPA.PaperCheck` وجود دارد؟
    - آیا جدول `BNK.Check` یا مشابه وجود دارد؟
    - ساختار: شماره چک، تاریخ سررسید، مبلغ، وضعیت (در جریان/وصول شده/برگشتی)، طرف حساب
    - آیا چک‌های دریافتی و پرداختی در جدول‌های جدا هستند یا با فیلد `Direction`؟
  - **خروجی:** ساختار schema چک در «شاهد S14».
  - **معیارِ پذیرش:** schema چک مستند شده. حداقل ۳ جدول شناسایی شده.

### S14.28 — متریک checks_due (چک‌های سررسید)

- [x] **S14.28** متریک `checks_due` را اضافه کن:
  - **تعریف:** چک‌های دریافتی/پرداختی با سررسید در محدوده تاریخ مشخص
  - **نوع:** `list`
  - **ستون‌ها:** شماره چک، تاریخ سررسید، مبلغ، نوع (دریافتی/پرداختی)، وضعیت، طرف حساب
  - **فیلتر:** `DueDate BETWEEN @start AND @end` و `Status = 'in_progress'` (یا معادل)
  - **anchors:** ['چک سررسید', 'چک‌های این هفته', 'چک‌های دریافتی سررسید', 'چک‌های پرداختی سررسید', 'چک‌های در جریان']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی (اگر داده وجود دارد).

### S14.29 — متریک checks_bounced (چک‌های برگشتی)

- [x] **S14.29** متریک `checks_bounced` را اضافه کن:
  - **تعریف:** چک‌های برگشتی در محدوده تاریخ
  - **نوع:** `list`
  - **فیلتر:** `Status = 'bounced'` (یا معادل در schema)
  - **anchors:** ['چک برگشتی', 'چک‌های برگشتی', 'چک‌های برگشت خورده', 'چک ناموفق']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با mock data.

### S14.30 — متریک checks_summary (خلاصه چک‌ها)

- [x] **S14.30** متریک `checks_summary` را اضافه کن:
  - **تعریف:** مجموع مبلغ چک‌های در جریان به تفکیک دریافتی/پرداختی
  - **نوع:** `aggregate` با grain `by_direction` (دریافتی vs پرداختی)
  - **anchors:** ['مجموع چک‌ها', 'چک‌های در جریان', 'چقدر چک داریم', 'خلاصه چک']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S14.31 — unit test و golden case برای چک‌ها

- [x] **S14.31** unit test + golden case:
  - `checks_due`: test با mock data
  - `checks_bounced`: test با mock data
  - `checks_summary`: test + golden case
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۶ test جدید.

---

## بخش ح — بستن دوره (Period Closing)

### S14.32 — متریک closing_status (وضعیت بستن دوره)

- [x] **S14.32** متریک `closing_status` را اضافه کن:
  - **تعریف:** بررسی اینکه آیا اسناد اختتامیه و افتتاحیه برای سال مالی ثبت شده است
  - **نوع:** `aggregate` (single value یا list)
  - **source:** `ACC.Voucher` با فیلتر `Type IN (3, 4, 5)`
  - **خروجی:** برای هر سال مالی: تعداد سند اختتامیه، تعداد سند افتتاحیه، مجموع بدهکار، مجموع بستانکار
  - **anchors:** ['بستن دوره', 'اختتامیه', 'افتتاحیه', 'آیا اختتامیه ثبت شده', 'وضعیت بستن سال']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S14.33 — متریک trial_balance_check (بررسی تراز آزمایشی)

- [x] **S14.33** متریک `trial_balance_check` را اضافه کن:
  - **تعریف:** بررسی اینکه آیا تراز آزمایشی می‌بندد (SUM(Debit) = SUM(Credit))
  - **نوع:** `aggregate` (single value)
  - **خروجی:** `SUM(Debit)`, `SUM(Credit)`, `SUM(Debit) - SUM(Credit)` (باید ۰ باشد)
  - **anchors:** ['تراز می‌بندد', 'آیا تراز آزمایشی می‌بندد', 'اختلاف تراز', 'بررسی تراز']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S14.34 — متریک period_comparison (مقایسه اول و آخر دوره)

- [x] **S14.34** متریک `period_comparison` را اضافه کن:
  - **تعریف:** مقایسه مانده اول دوره با آخر دوره برای کل حساب‌ها
  - **نوع:** `aggregate` با grain `by_account`
  - **خروجی:** مانده اول دوره، مانده آخر دوره، تغییرات
  - **anchors:** ['اول دوره', 'آخر دوره', 'تغییرات حساب', 'مقایسه اول و آخر دوره']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S14.35 — unit test و golden case برای بستن دوره

- [x] **S14.35** unit test + golden case:
  - `closing_status`: test + golden case
  - `trial_balance_check`: test + golden case
  - `period_comparison`: test با mock data
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۶ test جدید.

---

## بخش ط — تطبیق بین‌ماژولی (Cross-module Reconciliation)

### S14.36 — متریک sales_reconciliation (تطبیق فروش با دفتر کل)

- [x] **S14.36** متریک `sales_reconciliation` را اضافه کن:
  - **تعریف:** مقایسه مجموع فاکتورهای فروش با سند فروش در دفتر کل
  - **نوع:** `comparison` (دو منبع داده)
  - **source 1:** `SLS.Invoice` — `SUM(NetPriceInBaseCurrency)`
  - **source 2:** `ACC.VoucherItem` JOIN `ACC.Account` WHERE Account Code = حساب فروش — `SUM(Credit)`
  - **خروجی:** مبلغ فاکتورها، مبلغ سند دفتر کل، اختلاف
  - **anchors:** ['تطبیق فروش', 'آیا فاکتورها با دفتر کل می‌خواند', 'اختلاف فروش', 'reconciliation فروش']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S14.37 — متریک purchase_reconciliation (تطبیق خرید با دفتر کل)

- [x] **S14.37** متریک `purchase_reconciliation` را اضافه کن:
  - **تعریف:** مقایسه مجموع حواله‌های ورودی (خرید) با سند خرید در دفتر کل
  - **نوع:** `comparison`
  - **source 1:** `INV.InventoryReceipt` WHERE `IsReturn=0` — `SUM(TotalPrice)`
  - **source 2:** `ACC.VoucherItem` JOIN `ACC.Account` WHERE Account Code = حساب خرید — `SUM(Debit)`
  - **anchors:** ['تطبیق خرید', 'آیا خرید با دفتر کل می‌خواند', 'اختلاف خرید']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S14.38 — متریک inventory_reconciliation (تطبیق موجودی انبار با حساب)

- [x] **S14.38** متریک `inventory_reconciliation` را اضافه کن:
  - **تعریف:** مقایسه ارزش موجودی انبار با مانده حساب موجودی در دفتر کل
  - **نوع:** `comparison`
  - **source 1:** `INV.InventoryReceipt` — `SUM(TotalPrice)` WHERE `IsReturn=0` - `SUM(TotalPrice)` WHERE `IsReturn=1`
  - **source 2:** `ACC.VoucherItem` JOIN `ACC.Account` WHERE Account Code = حساب موجودی — `SUM(Debit - Credit)`
  - **anchors:** ['تطبیق موجودی', 'آیا انبار با حساب می‌خواند', 'اختلاف موجودی']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S14.39 — unit test و golden case برای تطبیق

- [x] **S14.39** unit test + golden case:
  - `sales_reconciliation`: test + golden case
  - `purchase_reconciliation`: test + golden case
  - `inventory_reconciliation`: test با mock data
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۶ test جدید.

---

## بخش ی — Drill-down مکالمه‌ای (Conversational Drill-down)

### S14.40 — Context-aware follow-up در Planner

- [x] **S14.40** قابلیت follow-up مکالمه‌ای را به Planner اضافه کن:
  - **سناریو:**
    - کاربر: «فروش ۱۴۰۳ چقدره؟» → engine پاسخ می‌دهد: ۵۷ میلیارد
    - کاربر: «نمایش بده فاکتورها» → engine باید بداند که منظور فاکتورهای فروش ۱۴۰۳ است
    - کاربر: «به تفکیک مشتری» → engine باید فاکتورهای فروش ۱۴۰۳ را به تفکیک مشتری نشان دهد
  - **پیاده‌سازی:**
    - در `planner.ts`: حفظ `lastMetricPlan` در context مکالمه
    - اگر پرامپت جدید شامل سیگنال‌های drill-down باشد («نمایش بده»، «جزئیات»، «فاکتورها»، «به تفکیک»):
      - metricId قبلی را حفظ کن
      - grain را به `list` یا grain جزئی‌تر تغییر بده
      - فیلترها (dateRange, fiscalYear) را از plan قبلی به ارث ببر
    - سیگنال‌های drill-down: ['نمایش بده', 'جزئیات', 'لیست', 'فاکتورها', 'سندها', 'به تفکیک', 'تفکیک', 'ردیف‌ها']
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: ۳ سناریوی follow-up درست parse شوند. ✅ (۹ unit test در financialEnginePlanner.test.ts)

### S14.41 — به‌روزرسانی sendMessage برای پشتیبانی از context

- [x] **S14.41** در `sendMessage` یا `agentOrchestrator`:
  - اگر پرامپت فعلی drill-down است:
    - `conversationHistory` شامل plan قبلی باشد
    - Planner بتواند به `lastMetricPlan` دسترسی داشته باشد
    - پاسخ نهایی شامل ارجاع به پاسخ قبلی باشد («در ادامه فاکتورهای فروش ۱۴۰۳ که مجموعشان ۵۷ میلیارد است:»)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. integration test: مکالمه ۳ مرحله‌ای درست کار کند. ✅ (integration test در financialEngine.integration.test.ts)

### S14.42 — unit test و golden case برای drill-down

- [x] **S14.42** unit test + golden case:
  - unit test: parseFollowUp با ۵ سناریو
  - integration test: مکالمه «فروش ۱۴۰۳» → «نمایش بده فاکتورها» → «به تفکیک مشتری»
  - golden case: مکالمه ۲ مرحله‌ای با context
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۵ test جدید. ✅ (۹ unit test + ۱ integration test + ۵ golden conversation case)

---

## بخش ک — تست، اعتبارسنجی و پختگی نهایی

### S14.43 — golden cases گسترده

- [x] **S14.43** golden cases برای تمام متریک‌های جدید:
  - کوئری سند-محور: ۳ case
  - کشف ناهنجاری: ۴ case
  - تحلیل سنی: ۲ case
  - گردش تفصیلی: ۲ case
  - مالیات: ۳ case
  - چک: ۳ case
  - بستن دوره: ۳ case
  - تطبیق: ۳ case
  - dateRange: ۵ case
  - drill-down: ۲ case
  - **معیارِ پذیرش:** `npm run eval:metrics` سبز با ۱۸۰+ case. ✅ (211/211 = 100%)

### S14.44 — field test با ۳۰ سؤال حسابداری

- [x] **S14.44** field test با ۳۰ سؤال متنوع حسابداری روی remote:
  - ۵ سؤال کوئری سند-محور
  - ۳ سؤال کشف خطا
  - ۳ سؤال تحلیل سنی
  - ۳ سؤال گردش تفصیلی
  - ۳ سؤال مالیات
  - ۳ سؤال چک
  - ۳ سؤال بستن دوره
  - ۳ سؤال تطبیق
  - ۴ سؤال dateRange روی متریک‌های فعلی
  - ۳ سؤال drill-down مکالمه‌ای
  - **معیارِ پذیرش:** حداقل ۲۵/۳۰ verdict=ok. `requestId`‌ها ثبت شود.

### S14.45 — typecheck + test + eval کامل

- [x] **S14.45** `npm run typecheck:node` + `npm test` + `npm run eval:metrics` — همه سبز.
  - **انتظار:** typecheck ۰ خطا، test ۱۰۰+ pass ۰ fail، eval ۱۸۰+ case سبز.
  - **شاهد:** typecheck ۰ خطا ✅ | unit 267 pass 0 fail ✅ | integration 50 pass 0 fail 1 skip ✅ | eval 211/211 (100%) ✅

### S14.46 — build + deploy + asar-grep

- [x] **S14.46** `npm run build:win` + deploy + asar-grep:
  - `ACCOUNTANT_TOOLS` مارکر پیدا شود. ✅
  - `DATE_RANGE_FILTER` مارکر پیدا شود. ✅
  - `ANOMALY_DETECTION` مارکر پیدا شود. ✅
  - `AGING_ANALYSIS` مارکر پیدا شود. ✅
  - `CHECK_MANAGEMENT` مارکر پیدا شود. ✅
  - **شاهد:** asar-grep: ACCOUNTANT_TOOLS, DATE_RANGE_FILTER, ANOMALY_DETECTION, AGING_ANALYSIS, CHECK_MANAGEMENT, TAX_TOOLS, RECONCILIATION, VOUCHER_TOOLS, CLOSING_TOOLS, TURNOVER_TOOLS, DRILL_DOWN — همه پیدا شدند.

### S14.47 — مستندسازی نهایی

- [x] **S14.47** مستندسازی کامل:
  - لیست نهایی تمام متریک‌های حسابداری
  - راهنمای فیلتر محدوده تاریخ
  - راهنمای drill-down مکالمه‌ای
  - **معیارِ پذیرش:** سند در «شاهد S14». ✅

---

## بخش ل — دروازهٔ خروجِ فاز ۱۴

- [x] **S14.48** حداقل ۱۸۰ golden case سبز در `eval:metrics`.
  - **شاهد:** 211/211 (100%) ✅
- [x] **S14.49** فیلتر محدوده تاریخ روی تمام متریک‌های فعلی فعال.
  - **شاهد:** ۷ golden case برای dateRange (explicit dates, month names, half-year, single month, year range, day-month range, half-first) ✅
- [x] **S14.50** کشف ناهنجاری (سند ترازنشده، فاکتور صفر، تکراری) فعال.
  - **شاهد:** ۸ golden case (unbalanced_vouchers ×2, zero_amount_invoices ×2, duplicate_vouchers ×2, vouchers_without_account ×2) ✅
- [x] **S14.51** تحلیل سنی دریافتنی/پرداختنی فعال.
  - **شاهد:** ۶ golden case (receivables_aging ×3, payables_aging ×3) ✅
- [x] **S14.52** گزارش چک‌ها فعال.
  - **شاهد:** ۶ golden case (checks_due ×2, checks_bounced ×2, checks_summary ×2) ✅
- [x] **S14.53** تطبیق بین‌ماژولی فعال.
  - **شاهد:** ۶ golden case (sales/purchase/inventory_reconciliation ×2 each) ✅
- [x] **S14.54** drill-down مکالمه‌ای فعال.
  - **شاهد:** integration test با مکالمه ۳ مرحله‌ای + ۵ golden conversation case ✅
- [x] **S14.55** field test با ۳۰ سؤال حسابداری، حداقل ۲۵ verdict=ok.
  - **شاهد:** ۳۰/۳۰ verdict=ok ✅ | requestId‌ها در «شاهد S14».
- [x] **S14.56** `typecheck:node` + `npm test` + `eval:metrics` سبز.
  - **شاهد:** typecheck ۰ خطا | unit 267 pass | integration 50 pass 1 skip | eval 211/211 ✅
- [x] **S14.57** `build:win` + deploy + asar-grep با مارکرهای فاز.
  - **شاهد:** ۱۱ مارکر در asar پیدا شدند ✅
- [x] **S14.58** ثبتِ شواهد در «شاهد S14».

---

## شاهد S14
```
--- Date Range Filter ---
dateRange in MetricPlan: implemented
persianToGregorian: implemented
Patterns supported: explicit dates (1403/05/01), month names (فروردین تا مرداد), half-year (نیمه اول/دوم), single month, year range, day-month range
All existing metrics support dateRange: yes

--- Document-level Queries ---
voucher_detail: implemented
vouchers_by_date: implemented
vouchers_by_type: implemented

--- Anomaly Detection ---
unbalanced_vouchers: implemented
zero_amount_invoices: implemented
duplicate_vouchers: implemented
vouchers_without_account: implemented

--- Aging Analysis ---
by_age_bucket grain: implemented
receivables_aging: implemented
payables_aging: implemented

--- Detailed Turnover ---
by_voucher grain: implemented
account_turnover (by_voucher): implemented
party_turnover: implemented

--- Tax Reports ---
tax_monthly_summary: implemented
invoices_without_tax: implemented
vat_liability: implemented

--- Check Management ---
Schema discovered: Sepidar Check tables
checks_due: implemented
checks_bounced: implemented
checks_summary: implemented

--- Period Closing ---
closing_status: implemented
trial_balance_check: implemented
period_comparison: implemented

--- Cross-module Reconciliation ---
sales_reconciliation: implemented
purchase_reconciliation: implemented
inventory_reconciliation: implemented

--- Conversational Drill-down ---
follow-up detection: implemented (isDrillDownPrompt)
context-aware planning: implemented (buildFollowUpPlan with lastMetricPlan)
drill-down signals: ['نمایش بده', 'جزئیات', 'لیست', 'اقلام', 'ردیف', 'به تفکیک مشتری', 'به تفکیک ماه', 'به تفکیک سال', 'به تفکیک حساب', 'طرف حساب', 'مشتری', 'فروشنده', 'حساب', 'سرفصل', 'معین', 'تفضیلی']

--- Field Test (30 accountant questions) ---
Date: 2026-06-28
Mode: engine on remote 192.168.85.56
Results: 30/30 verdict=ok
RequestIds:
  q1: ssh-1782629015723 (voucher_detail)
  q2: ssh-1782629032552 (voucher_detail)
  q3: ssh-1782629055199 (vouchers_by_date)
  q4: ssh-1782629069753 (vouchers_by_type closing)
  q5: ssh-1782629088643 (vouchers_by_type opening)
  q6: ssh-1782629107014 (unbalanced_vouchers)
  q7: ssh-1782629123577 (zero_amount_invoices)
  q8: ssh-1782629141909 (duplicate_vouchers)
  q9: ssh-1782629160694 (receivables_aging)
  q10: ssh-1782629190791 (payables_aging)
  q11: ssh-1782629225677 (receivables_aging)
  q12: ssh-1782629258774 (account_turnover)
  q13: ssh-1782629277567 (account_turnover)
  q14: ssh-1782629313635 (party_turnover)
  q15: ssh-1782629334323 (tax_monthly_summary)
  q16: ssh-1782629354198 (invoices_without_tax)
  q17: ssh-1782629377632 (vat_liability)
  q18: ssh-1782629402811 (checks_due)
  q19: ssh-1782629449810 (checks_bounced)
  q20: ssh-1782629472883 (checks_summary)
  q21: ssh-1782629498368 (closing_status)
  q22: ssh-1782629513308 (trial_balance_check)
  q23: ssh-1782629532409 (period_comparison)
  q24: ssh-1782629541858 (sales_reconciliation)
  q25: ssh-1782629565038 (purchase_reconciliation)
  q26: ssh-1782629582398 (inventory_reconciliation)
  q27: ssh-1782629603976 (net_sales dateRange)
  q28: ssh-1782629620477 (net_sales dateRange)
  q29: ssh-1782629639176 (net_sales dateRange)
  q30: ssh-1782629659108 (net_sales dateRange)

--- eval:metrics ---
Total cases: 211
Pass: 211/211 (100%)

--- tests ---
Unit: 267 pass, 0 fail
Integration: 50 pass, 0 fail, 1 skipped

--- typecheck ---
node: clean (0 errors)

--- build:win ---
Status: success
asar-grep: ACCOUNTANT_TOOLS found, DATE_RANGE_FILTER found, ANOMALY_DETECTION found,
           AGING_ANALYSIS found, CHECK_MANAGEMENT found, TAX_TOOLS found,
           RECONCILIATION found, VOUCHER_TOOLS found, CLOSING_TOOLS found,
           TURNOVER_TOOLS found, DRILL_DOWN found

--- Final Metrics Count ---
Total metrics: 58 (41 from Phase 13 + 17 new accountant metrics)
Total golden cases: 211
Total unit tests: 267
Total integration tests: 50
```

> قدمِ بعدی: فاز ۱۵ — Blind Schema Discovery برای اتصال کور به هر دیتابیس SQL Server.
