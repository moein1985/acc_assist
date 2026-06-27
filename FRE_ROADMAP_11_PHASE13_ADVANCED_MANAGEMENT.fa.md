# FRE Roadmap 11 — فاز ۱۳: متریک‌های مدیریتی پیشرفته، گزارش‌های تفصیلی و خروجی استاندارد
### از صورت‌های مالی پایه به حسابداری مدیریتي — COGS، موجودی، بودجه، مراکز هزینه، PDF/Excel

> پیش‌نیاز: فاز ۱۱ و ۱۲ کامل. ۱۰۰+ golden case سبز. صورت‌های مالی استاندارد پیاده‌سازی شده. Schema Abstraction Layer فعال با SepidarAdapter و HamkaranAdapter. محصول روی حداقل ۲ نرم‌افزار کار می‌کند.

**مارکرهای asar این فاز:** `ADVANCED_MANAGEMENT`, `COGS_METRIC`, `INVENTORY_METRIC`, `BUDGET_VARIANCE`, `PDF_EXPORT`.

---

## ۰ — نقشهٔ فاز

| بخش | موضوع | اندازه |
|---|---|---|
| الف | متریک‌های هزینه و سود (COGS، حقوق پرداختی، مالیات) | متوسط |
| ب | متریک‌های موجودی کالا و انبار | متوسط |
| ج | بودجه و مقایسه بودجه با واقعی | متوسط |
| د | حسابداری مدیریتي (مراکز هزینه، پروژه‌ها، تخصیص) | متوسط–بزرگ |
| هـ | خروجی استاندارد (PDF/Excel) و نمودار | متوسط |
| و | تست، اعتبارسنجی و پختگی نهایی | کوچک–متوسط |

---

## ۱ — انگیزه و دامنه

### وضعیت پس از فاز ۱۲
- ۱۵+ متریک پایه + صورت‌های مالی استاندارد (ترازنامه، سود و زیان، جریان نقد)
- نسبت‌های مالی (حاشیه سود، نسبت جاری، بدهی به حقوق)
- پشتیبانی از ۲ نرم‌افزار حسابداری (سپیدار + همکاران)

### شکاف‌های باقی‌مانده
- **هزینه فروش (COGS)** وجود ندارد — حاشیه سود ناخالص واقعی قابل محاسبه نیست
- **موجودی کالا** پشتیبانی نمی‌شود — یکی از پرکاربردترین سؤال‌های کاربران
- **بودجه و انحراف** — کاربران می‌خواهند بودجه را با واقعی مقایسه کنند
- **مراکز هزینه/پروژه** — حسابداری مدیریتي پیشرفته
- **خروجی PDF/Excel** — کاربران می‌خواهند گزارش‌ها را ذخیره و چاپ کنند
- **نمودار** — روند فروش، مقایسه دوره‌ای به‌صورت بصری

---

## بخش الف — متریک‌های هزینه و سود

### S13.1 — هزینه فروش (COGS)

- [ ] **S13.1** متریک `cogs` را در `metricCatalog.ts` اضافه کن:
  - **تعریف:** بهای تمام‌شده کالای فروش‌رفته
  - **تحقیق:** در schema سپیدار، آیا جدولی برای ارتباط فاکتور فروش با کالا و بهای آن وجود دارد؟
    - `SLS.InvoiceItem`؟ `SLS.InvoiceLine`؟
    - `INV.InventoryReceipt` با `IsReturn=0` به‌عنوان خرید + `SLS.Invoice` به‌عنوان فروش → FIFO/LIFO/Weighted Average
    - یا جدول `INV.InventoryTransaction` برای ردیابی ورود/خروج کالا؟
  - **چالش:** محاسبه COGS نیاز به اطلاعات ردیف‌های فاکتور و بهای کالا دارد — پیچیده‌تر از متریک‌های تکی
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی از Sepidar01.

### S13.2 — حقوق و دستمزد پرداختی

- [ ] **S13.2** متریک `payroll` را اضافه کن:
  - **تعریف:** مجموع حقوق پرداختی در یک دوره
  - **تحقیق:** آیا در schema سپیدار جدول `PAY.Payroll` یا `HR.Salary` وجود دارد؟
  - یا از طریق `ACC.VoucherItem` با filter روی account type «حقوق پرداختی»؟
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S13.3 — مالیات پرداختی/دریافتی

- [ ] **S13.3** متریک `tax_paid` و `tax_collected` را اضافه کن:
  - **تعریف:** مالیات بر ارزش افزوده پرداختی/دریافتی
  - **تحقیق:** آیا در schema سپیدار فیلدی برای مالیات در فاکتورها وجود دارد؟
    - `SLS.Invoice.TaxAmount`؟ `TaxInBaseCurrency`؟
    - یا از طریق `ACC.VoucherItem` با filter روی account type «مالیات»؟
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S13.4 — به‌روزرسانی حاشیه سود با COGS واقعی

- [ ] **S13.4** متریک مشتق `gross_margin` را به‌روز کن:
  - `gross_margin` = (فروش - COGS) / فروش
  - به جای estimate فعلی، از متریک `cogs` واقعی استفاده کن
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S13.5 — سود خالص (Net Profit)

- [ ] **S13.5** متریک `net_profit` را اضافه کن:
  - **تعریف:** درآمد - تمام هزینه‌ها (COGS + اداری + عمومی + مالیات)
  - **وابستگی:** `cogs` (S13.1) + `payroll` (S13.2) + `tax_paid` (S13.3) + هزینه‌های عمومی
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S13.6 — unit test و golden case برای متریک‌های هزینه

- [ ] **S13.6** unit test + golden case:
  - `cogs`: test با mock data + golden case با عدد واقعی
  - `payroll`: test با mock data + golden case
  - `tax_paid`, `tax_collected`: test + golden case
  - `gross_margin` (به‌روز شده): test + golden case
  - `net_profit`: test + golden case
  - **معیارِ پذیرش:** `npm test` سبز. `npm run eval:metrics` سبز. حداقل ۱۵ case/test جدید.

---

## بخش ب — متریک‌های موجودی کالا و انبار

### S13.7 — موجودی کالا

- [ ] **S13.7** متریک `inventory_value` را اضافه کن:
  - **تعریف:** ارزش موجودی کالا در انبار (به قیمت خرید یا میانگین وزنی)
  - **تحقیق:** در schema سپیدار:
    - `INV.InventoryReceipt` (ورود/خروج کالا)
    - `INV.StockBalance` یا جدول مشابه برای موجودی فعلی؟
    - `INV.Item` یا `GNR.Item` برای تعریف کالا؟
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S13.8 — گردش کالا

- [ ] **S13.8** متریک `inventory_turnover` را اضافه کن:
  - **تعریف:** ورود و خروج کالا در یک دوره (مقدار + ارزش)
  - **grain:** `by_item`, `by_month`, `by_warehouse`
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case.

### S13.9 — کالاهای کم‌موجود

- [ ] **S13.9** متریک `low_stock_items` را اضافه کن:
  - **تعریف:** کالاهایی که موجودی‌شان زیر حداقل مجاز است
  - **نوع:** `list` (مانند `recent_documents`)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case.

### S13.10 — unit test و golden case برای متریک‌های موجودی

- [ ] **S13.10** unit test + golden case:
  - `inventory_value`: test + golden case
  - `inventory_turnover`: test + golden case
  - `low_stock_items`: test + golden case
  - **معیارِ پذیرش:** `npm test` سبز. `npm run eval:metrics` سبز. حداقل ۱۰ case/test جدید.

---

## بخش ج — بودجه و مقایسه بودجه با واقعی

### S13.11 — ساختار بودجه

- [ ] **S13.11** در schema بررسی کن آیا ساختار بودجه وجود دارد:
  - جدول `BGT.Budget` یا مشابه؟
  - یا باید بودجه به‌صورت manual input در settings تعریف شود؟
  - اگر در schema وجود ندارد: یک `budgetConfig` در settings با ساختار JSON اضافه کن
  - **معیارِ پذیرش:** تصمیم معماری مستند شده. `typecheck:node` تمیز.

### S13.12 — متریک انحراف بودجه

- [ ] **S13.12** متریک مشتق `budget_variance` را اضافه کن:
  - **تعریف:** (واقعی - بودجه) / بودجه × ۱۰۰
  - **ورودی:** متریک واقعی (مثلاً `net_sales`) + عدد بودجه (از config یا schema)
  - **خروجی:** درصد انحراف + جهت (مثبت/منفی)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با mock budget.

### S13.13 — گزارش بودجه تفصیلی

- [ ] **S13.13** متریک `budget_report` را اضافه کن:
  - **تعریف:** مقایسه بودجه vs واقعی برای چند متریک همزمان (فروش، خرید، حقوق، COGS)
  - **نوع:** `MultiMetricPlan` با `joinMode: 'comparison'`
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case.

### S13.14 — unit test و golden case برای بودجه

- [ ] **S13.14** unit test + golden case:
  - `budget_variance`: test با mock budget
  - `budget_report`: test با multi-metric
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۵ test جدید.

---

## بخش د — حسابداری مدیریتي (مراکز هزینه، پروژه‌ها)

### S13.15 — مراکز هزینه

- [ ] **S13.15** پشتیبانی از مراکز هزینه:
  - **تحقیق:** آیا در schema سپیدار `ACC.CostCenter` یا `GNR.CostCenter` وجود دارد؟
  - آیا `ACC.VoucherItem` به cost center مرتبط می‌شود؟
  - اگر وجود دارد: grain `by_cost_center` اضافه کن
  - متریک `cost_center_summary`: مجموع هزینه/درآمد به تفکیک مرکز هزینه
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case (اگر داده واقعی وجود دارد).

### S13.16 — پروژه‌ها

- [ ] **S13.16** پشتیبانی از پروژه‌ها:
  - **تحقیق:** آیا در schema سپیدار `PRJ.Project` یا مشابه وجود دارد؟
  - آیا `ACC.VoucherItem` به project مرتبط می‌شود؟
  - متریک `project_summary`: مجموع هزینه/درآمد به تفکیک پروژه
  - متریک `project_profitability`: سود/زیان هر پروژه
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case (اگر داده واقعی وجود دارد).

### S13.17 — تخصیص هزینه

- [ ] **S13.17** متریک `cost_allocation` را اضافه کن:
  - **تعریف:** تخصیص هزینه‌های مشترک بین مراکز هزینه/پروژه‌ها (بر اساس درصد یا پایه تخصیص)
  - **چالش:** این یک محاسبه چندمرحله‌ای است — نیاز به logic فراتر از SQL ساده
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test با mock data.

### S13.18 — unit test و golden case برای حسابداری مدیریتي

- [ ] **S13.18** unit test + golden case:
  - `cost_center_summary`: test
  - `project_summary`: test
  - `project_profitability`: test
  - `cost_allocation`: test
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۸ test جدید.

---

## بخش هـ — خروجی استاندارد (PDF/Excel) و نمودار

### S13.19 — خروجی PDF صورت‌های مالی

- [ ] **S13.19** در renderer، قابلیت خروجی PDF اضافه کن:
  - ترازنامه، سود و زیان، جریان نقدی به‌صورت PDF فرمت‌شده
  - استفاده از `electron-print` یا `pdfkit` یا `puppeteer-core`
  - قالب: عنوان شرکت، دوره، تاریخ تولید، جدول فرمت‌شده، امضا
  - **معیارِ پذیرش:** PDF تولید شده و قابل باز کردن در Adobe Reader. `typecheck:node` تمیز.

### S13.20 — خروجی Excel گزارش‌ها

- [ ] **S13.20** در renderer، قابلیت خروجی Excel اضافه کن:
  - استفاده از `exceljs` یا `sheetjs`
  - گزارش‌های تفصیلی (فروش به تفکیک مشتری، گردش کالا، بودجه vs واقعی)
  - قالب: هدر، فیلترها، جدول داده، جمع‌ها
  - **معیارِ پذیرش:** Excel تولید شده و قابل باز کردن در Excel/LibreOffice. `typecheck:node` تمیز.

### S13.21 — نمودار روند و مقایسه

- [ ] **S13.21** در renderer، نمودار اضافه کن:
  - استفاده از `chart.js` یا `recharts`
  - نمودار خطی (line) برای روند فروش ماهانه/فصلی
  - نمودار میله‌ای (bar) برای مقایسه سال‌ها
  - نمودار دایره‌ای (pie) برای ترکیب هزینه‌ها
  - **معیارِ پذیرش:** نمودار در UI نمایش داده شود. `typecheck:node` تمیز.

### S13.22 — چاپ مستقیم

- [ ] **S13.22** قابلیت چاپ مستقیم از Electron:
  - `webContents.print()` با تنظیمات صفحه (A4، حاشیه، orientation)
  - پیش‌نمایش چاپ قبل از ارسال به پرینتر
  - **معیارِ پذیرش:** چاپ از dialog پرینتر کار کند. `typecheck:node` تمیز.

---

## بخش و — تست، اعتبارسنجی و پختگی نهایی

### S13.23 — golden cases گسترده

- [ ] **S13.23** golden cases برای تمام متریک‌های جدید:
  - COGS، حقوق، مالیات، سود خالص
  - موجودی، گردش کالا، کالای کم‌موجود
  - بودجه و انحراف
  - مراکز هزینه، پروژه‌ها
  - **معیارِ پذیرش:** `npm run eval:metrics` سبز با ۱۳۰+ case.

### S13.24 — field test گسترده

- [ ] **S13.24** field test با ۳۰ سؤال متنوع روی remote:
  - ۱۰ سؤال متریک‌های هزینه و سود
  - ۵ سؤال موجودی و انبار
  - ۵ سؤال بودجه و انحراف
  - ۵ سؤال مراکز هزینه/پروژه
  - ۵ سؤال خروجی PDF/Excel
  - **معیارِ پذیرش:** حداقل ۲۷/۳۰ verdict=ok. `requestId`‌ها ثبت شود.

### S13.25 — typecheck + test + eval کامل

- [ ] **S13.25** `npm run typecheck:node` + `npm test` + `npm run eval:metrics` — همه سبز.
  - **انتظار:** typecheck ۰ خطا، test ۳۲۰+ pass ۰ fail، eval ۱۳۰+ case سبز.
  - **شاهد:** خروجی در «شاهد S13».

### S13.26 — build + deploy + asar-grep

- [ ] **S13.26** `npm run build:win` + deploy + asar-grep:
  - `ADVANCED_MANAGEMENT` مارکر پیدا شود.
  - `COGS_METRIC` مارکر پیدا شود.
  - `INVENTORY_METRIC` مارکر پیدا شود.
  - `BUDGET_VARIANCE` مارکر پیدا شود.
  - `PDF_EXPORT` مارکر پیدا شود.
  - **شاهد:** خروجی asar-grep.

### S13.27 — مستندسازی نهایی

- [ ] **S13.27** مستندسازی کامل:
  - لیست نهایی تمام متریک‌ها (۱۵ + صورت‌های مالی + هزینه + موجودی + بودجه + مدیریتي)
  - لیست نهایی golden cases (۱۳۰+)
  - راهنمای خروجی PDF/Excel
  - راهنمای نمودار
  - **معیارِ پذیرش:** سند در «شاهد S13».

---

## بخش ز — دروازهٔ خروجِ فاز ۱۳

- [ ] **S13.28** حداقل ۱۳۰ golden case سبز در `eval:metrics`.
  - **شاهد:** خروجی `npm run eval:metrics`.
- [ ] **S13.29** متریک‌های COGS، موجودی، بودجه پیاده‌سازی و با عدد واقعی تأیید شده.
  - **شاهد:** golden case با عدد از Sepidar01.
- [ ] **S13.30** خروجی PDF و Excel فعال و قابل باز کردن.
  - **شاهد:** فایل نمونه PDF + Excel.
- [ ] **S13.31** نمودار در UI نمایش داده می‌شود.
  - **شاهد:** screenshot یا توضیح.
- [ ] **S13.32** field test با ۳۰ سؤال، حداقل ۲۷ verdict=ok.
  - **شاهد:** `requestId`‌ها در «شاهد S13».
- [ ] **S13.33** `typecheck:node` + `npm test` + `eval:metrics` سبز.
  - **شاهد:** خروجی در «شاهد S13».
- [ ] **S13.34** `build:win` + deploy + asar-grep با مارکرهای فاز.
  - **شاهد:** خروجی asar-grep.
- [ ] **S13.35** ثبتِ شواهد در «شاهد S13».

---

## شاهد S13
```
--- New Metrics (Cost & Profit) ---
cogs: <implemented/not-implemented> — value: <number>
payroll: <implemented/not-implemented> — value: <number>
tax_paid: <implemented/not-implemented> — value: <number>
tax_collected: <implemented/not-implemented> — value: <number>
gross_margin (updated): <implemented/not-implemented> — value: <number>
net_profit: <implemented/not-implemented> — value: <number>

--- New Metrics (Inventory) ---
inventory_value: <implemented/not-implemented> — value: <number>
inventory_turnover: <implemented/not-implemented> — value: <number>
low_stock_items: <implemented/not-implemented> — count: <N>

--- New Metrics (Budget) ---
budget_variance: <implemented/not-implemented> — value: <number>%
budget_report: <implemented/not-implemented>

--- New Metrics (Management Accounting) ---
cost_center_summary: <implemented/not-implemented>
project_summary: <implemented/not-implemented>
project_profitability: <implemented/not-implemented>
cost_allocation: <implemented/not-implemented>

--- Output ---
PDF export: <implemented/not-implemented> — sample: <filename>
Excel export: <implemented/not-implemented> — sample: <filename>
Charts: <implemented/not-implemented> — types: <line/bar/pie>
Print: <implemented/not-implemented>

--- Field Test (30 questions) ---
Date: <date>
Mode: engine on remote 192.168.85.56
Results: <N>/30 verdict=ok
RequestIds: <list>

--- eval:metrics ---
Total cases: <N>
Pass: <N>/<N> (100%)

--- tests ---
Unit: <N> pass, 0 fail
Integration: <N> pass, 0 fail

--- typecheck ---
node: clean (0 errors)

--- build:win ---
Status: success
asar-grep: ADVANCED_MANAGEMENT found, COGS_METRIC found, INVENTORY_METRIC found,
           BUDGET_VARIANCE found, PDF_EXPORT found

--- Final Metrics Count ---
Total metrics: <N> (15 base + <N> financial statements + <N> cost/profit + <N> inventory + <N> budget + <N> management)
Total golden cases: <N>
Total unit tests: <N>
Total integration tests: <N>
```

> قدمِ بعدی: Shadow run رسمی ۲ هفته‌ای روی کد پخته (S9.3-S9.5 تعلیق‌شده) + سوییچ نهایی به engine mode + آماده‌سازی release نسخه ۲.۰.
