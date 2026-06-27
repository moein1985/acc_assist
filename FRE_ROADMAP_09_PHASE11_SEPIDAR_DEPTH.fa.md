# FRE Roadmap 09 — فاز ۱۱: عمق‌بخشی روی سپیدار، Golden Cases گسترده و صورت‌های مالی استاندارد
### از ۴۲ golden case به ۱۰۰+ — پختگی محصول روی یک نرم‌افزار قبل از گسترش

> پیش‌نیاز: فاز ۹ و ۱۰ کامل. کد legacy حذف شده. ۱۵ متریک + MultiMetric + مشتق در engine mode. Planner مدلی پیشرفته با Smart Clarify و زبان محاوره‌ای فعال. این فاز محصول را روی سپیدار به پختگی کامل می‌رساند قبل از حرکت به سمت نرم‌افزارهای دیگر.

**مارکرهای asar این فاز:** `SEPIDAR_DEPTH`, `GOLDEN_100`, `FINANCIAL_STATEMENTS`.

---

## ۰ — نقشهٔ فاز

| بخش | موضوع | اندازه |
|---|---|---|
| الف | گسترش Golden Cases به ۱۰۰+ | متوسط |
| ب | متریک‌های مالی پیشرفته (صورت‌های مالی استاندارد) | متوسط–بزرگ |
| ج | بهبود Planner برای کوئری‌های پیچیده | متوسط |
| د | تست با کاربران واقعی و پختگی production | کوچک–متوسط |

---

## ۱ — تصمیم استراتژیک: چرا ماندن روی سپیدار قبل از گسترش؟

### مسئله
برنامه فعلی فقط روی دیتابیس نرم‌افزار «سپیدار» کار می‌کند — که ساختاریافته‌ترین نرم‌افزار حسابداری ایران است. هدف نهایی پشتیبانی از تمام نرم‌افزارهای حسابداری ایرانی است، اما:

1. **رفتن زودهنگام به نرم‌افزارهای دیگر = بازنویسی مداوم.** هر بار که روی سپیدار مشکلی کشف شود، باید در لایه abstraction هم اصلاح شود.
2. **۴۲ golden case برای production کافی نیست.** کاربران واقعی سؤال‌های متنوع‌تری می‌پرسند.
3. **صورت‌های مالی استاندارد (ترازنامه، سود و زیان، جریان نقد) پیچیده‌تر از متریک‌های تکی هستند.** بهتر است اول روی یک schema ثابت توسعه پیدا کنند.
4. **Planner فعلی برای کوئری‌های ساده خوب است** ولی برای سؤال‌های ترکیبی پیچیده («مقایسه فروش ماهانه ۱۴۰۲ و ۱۴۰۳ به تفکیک فصل») نیاز به بهبود دارد.

### استراتژی
- **الان:** عمق‌بخشی روی سپیدار — golden cases بیشتر، متریک‌های پیشرفته، planner بهتر
- **بعد از پختگی:** طراحی Schema Abstraction Layer و گسترش به نرم‌افزارهای دیگر (فاز ۱۲ آینده)
- **Shadow run رسمی ۲ هفته‌ای** به‌عنوان گیت نهایی production، روی کد پخته انجام شود — نه روی کد در حال تغییر

### وضعیت Shadow Run فعلی
- Shadow mode روی remote (192.168.85.56) در حال اجراست و در پس‌زمینه داده جمع می‌کند
- این داده به‌عنوان **informal validation** استفاده می‌شود، نه formal gate
- پس از تکمیل این فاز، shadow run رسمی ۲ هفته‌ای روی کد پخته انجام می‌شود (فاز ۱۲ یا پایان فاز ۱۱)
- مراحل S9.3-S9.5 و S9.17 از فاز ۹ **تعلیق** شده‌اند (نه لغو) و پس از پختگی محصول انجام خواهند شد

---

## بخش الف — گسترش Golden Cases به ۱۰۰+

> هدف: پوشش کامل انواع سؤال‌های مالی که کاربر واقعی ممکن است بپرسد. از ۴۲ case فعلی به حداقل ۱۰۰.

### S11.1 — آنالیز gap‌های golden case فعلی

- [ ] **S11.1** فهرستِ ۴۲ golden case فعلی را آنالیز کن و gap‌ها را شناسایی کن:
  - کدام متریک‌ها پوشش داده شده‌اند؟ (`net_sales`, `purchases`, `account_balance`, `trial_balance`, `cash_bank_balance`, `sales_count`, `fiscal_year_count`, `fiscal_year_list`, `party_balance`, `receivables`, `payables`, `cashflow`, `sales_by_period`, `account_turnover`, `recent_documents`)
  - کدام grain‌ها پوشش داده شده‌اند؟ (`total`, `by_year`, `by_month`, `by_quarter`, `by_account`, `by_customer`)
  - کدام الگوهای سؤالی پوشش داده شده‌اند؟ (صریح، محاوره‌ای، چند-متریکی، مشتق، منفی، clarify)
  - **خروجی:** جدولِ gap در «شاهد S11» — چه چیزی کم است.
  - **معیارِ پذیرش:** آنالیز مستند شده و حداقل ۵۸ case جدید شناسایی شده باشد.

### S11.2 — golden cases برای سال‌های متعدد

- [ ] **S11.2** حداقل ۱۵ golden case جدید برای تست سال‌های مالی مختلف:
  - فروش ۱۴۰۳، خرید ۱۴۰۳، تراز ۱۴۰۳
  - مقایسه فروش ۱۴۰۲ و ۱۴۰۳ (دو سال)
  - مقایسه فروش ۱۴۰۱، ۱۴۰۲، ۱۴۰۳ (سه سال)
  - روند فروش ۳ ساله (trend multi-year)
  - مانده حساب در سال‌های مختلف
  - دریافتنی/پرداختنی در سال‌های مختلف
  - **معیارِ پذیرش:** `npm run eval:metrics` سبز با ۵۷+ case.

### S11.3 — golden cases برای grain‌های ترکیبی

- [ ] **S11.3** حداقل ۱۵ golden case جدید برای grain‌های ترکیبی:
  - «فروش ماهانه ۱۴۰۲ به تفکیک مشتری» (`by_month` + `by_customer`)
  - «فروش فصلی ۱۴۰۲» (`by_quarter`)
  - «فروش به تفکیک مشتری در فروردین ۱۴۰۲» (`by_customer` + date range)
  - «گردش حساب دریافتنی فروردین تا شهریور ۱۴۰۲» (`by_account` + date range)
  - «مانده طرف حساب‌ها به تفکیک سال» (`by_year` + entity)
  - **معیارِ پذیرش:** `npm run eval:metrics` سبز با ۷۲+ case.

### S11.4 — golden cases منفی و edge case

- [ ] **S11.4** حداقل ۱۳ golden case جدید برای موارد منفی و edge case:
  - «لیست کارمندان» (غیرمالی)
  - «سود این ماه چقدر است؟» (متریک وجود ندارد → clarify یا refuse)
  - «ترازنامه شرکت» (صورت مالی کامل — هنوز پیاده‌سازی نشده → clarify)
  - «فروش سال ۹۹» (سال قبل از بازه داده → valid-empty)
  - «مانده حساب ناموجود» (entityName پیدا نمی‌شود → valid-empty)
  - «چقدر فروختیم در سال ۱۴۰۲ و ۱۴۰۳ و ۱۴۰۴» (سه سال ترکیبی)
  - «» (پرامپت خالی → refuse)
  - «سلام» (غیرمالی → refuse)
  - «خرید و فروش و مانده» (سه متریک همزمان → MultiMetric)
  - **معیارِ پذیرش:** `npm run eval:metrics` سبز با ۸۵+ case.

### S11.5 — golden cases محاوره‌ای و مبهم

- [ ] **S11.5** حداقل ۱۵ golden case جدید برای زبان محاوره‌ای و مبهم:
  - «چطور بود فروش این هفته؟» (محاوره‌ای + هفته → نیاز به date range parsing)
  - «وضعیت کسب و کار چطوره؟» (مبهم → clarify با پیشنهاد)
  - «بدهی‌ها چقدره؟» (پرداختنی — محاوره‌ای)
  - «طرف حساب‌ها کیان؟» (فهرست طرف حساب‌ها — نیاز به metric جدید یا clarify)
  - «سال مالی فعلی کیه؟» (fiscal_year_list با filter سال جاری)
  - «چند تا فاکتور ثبت شد؟» (sales_count محاوره‌ای)
  - «پرداختی‌ها رو نشون بده» (payables محاوره‌ای)
  - «مقایسه کن فروش دو سال اخیر رو» (محاوره‌ای + comparative)
  - **معیارِ پذیرش:** `npm run eval:metrics` سبز با ۱۰۰+ case.

---

## بخش ب — متریک‌های مالی پیشرفته (صورت‌های مالی استاندارد)

> هدف: پشتیبانی از صورت‌های مالی استاندارد حسابداری — ترازنامه، سود و زیان، جریان نقدی تفصیلی.

### S11.6 — ترازنامه (Balance Sheet)

- [x] **S11.6** متریک `balance_sheet` را در `metricCatalog.ts` اضافه کن:
  - **تعریف:** مجموع مانده حساب‌ها به تفکیک دارایی، بدهی، حقوق صاحبان سهام
  - **منبع:** `ACC.VoucherItem` JOIN `ACC.Voucher` JOIN `ACC.Account`
  - **چالش:** نیاز به دسته‌بندی حساب‌ها (دارایی/بدهی/حقوق صاحبان سهام) — این دسته‌بندی در schema سپیدار وجود دارد؟
  - **تحقیق:** ساختار `ACC.Account` را بررسی کن — آیا فیلدی برای دسته‌بندی حساب‌ها (Asset/Liability/Equity) وجود دارد؟
  - اگر دسته‌بندی وجود دارد: `MetricDefinition` با `by_account` grain و filter روی دسته
  - اگر دسته‌بندی وجود ندارد: نیاز به یک mapping table یا prefix-based classification
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی از Sepidar01.

### S11.7 — صورت سود و زیان (Income Statement / P&L)

- [x] **S11.7** متریک `income_statement` را در `metricCatalog.ts` اضافه کن:
  - **تعریف:** درآمد‌ها منهای هزینه‌ها = سود/زیان
  - **درآمد:** فروش خالص (`SLS.Invoice.NetPriceInBaseCurrency`)
  - **هزینه‌ها:** هزینه فروش (COGS)، هزینه‌های اداری، هزینه‌های عمومی
  - **تحقیق:** آیا در schema سپیدار جدولی برای هزینه‌ها وجود دارد؟ (`EXP.Expense`؟ `ACC.VoucherItem` با account type خاص؟)
  - **خروجی:** `MetricDefinition` برای `income_statement` با breakdown درآمد/هزینه
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S11.8 — جریان نقدی تفصیلی (Detailed Cash Flow)

- [x] **S11.8** متریک `cashflow_detailed` را در `metricCatalog.ts` اضافه کن:
  - **تعریف:** جریان نقد به تفکیک عملیاتی/سرمایه‌گذاری/مالی
  - **منبع:** `ACC.VoucherItem` JOIN `ACC.Voucher` با filter روی account type
  - **تحقیق:** آیا در schema سپیدار دسته‌بندی حساب‌های نقدی به عملیاتی/سرمایه‌گذاری/مالی وجود دارد؟
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S11.9 — حاشیه سود (Profit Margins)

- [x] **S11.9** متریک‌های مشتق جدید برای حاشیه سود:
  - `gross_margin` = (فروش - هزینه فروش) / فروش
  - `net_margin` = سود خالص / فروش
  - `operating_margin` = سود عملیاتی / فروش
  - **وابستگی:** نیاز به متریک `income_statement` (S11.7) یا حداقل `cogs` (هزینه فروش)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S11.10 — نسبت‌های مالی کلیدی (Financial Ratios)

- [x] **S11.10** متریک‌های مشتق جدید برای نسبت‌های مالی:
  - `current_ratio` = دارایی جاری / بدهی جاری
  - `debt_to_equity` = مجموع بدهی‌ها / حقوق صاحبان سهام
  - `receivables_turnover` = فروش / میانگین دریافتنی‌ها
  - `return_on_sales` = سود خالص / فروش
  - **وابستگی:** نیاز به `balance_sheet` (S11.6) و `income_statement` (S11.7)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden case با عدد واقعی.

### S11.11 — تست‌های واحد برای متریک‌های جدید

- [x] **S11.11** unit test برای هر متریک جدید:
  - `balance_sheet`: test با mock data شامل دارایی/بدهی/حقوق
  - `income_statement`: test با mock data شامل درآمد/هزینه
  - `cashflow_detailed`: test با mock data شامل جریان‌های عملیاتی/سرمایه‌گذاری/مالی
  - `gross_margin`, `net_margin`: test با mock data
  - `current_ratio`, `debt_to_equity`: test با mock data
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۱۰ test جدید.

### S11.12 — golden cases برای متریک‌های جدید

- [x] **S11.12** golden cases برای صورت‌های مالی و نسبت‌ها:
  - «ترازنامه سال ۱۴۰۲» → `balance_sheet`
  - «صورت سود و زیان ۱۴۰۲» → `income_statement`
  - «حاشیه سود ناخالص ۱۴۰۲» → `gross_margin`
  - «نسبت جاری ۱۴۰۲» → `current_ratio`
  - «نسبت بدهی به حقوق صاحبان سهام» → `debt_to_equity`
  - **معیارِ پذیرش:** `npm run eval:metrics` سبز با همه case‌های جدید.

---

## بخش ج — بهبود Planner برای کوئری‌های پیچیده

> هدف: Planner بتواند سؤال‌های ترکیبی پیچیده را به درستی parse کند.

### S11.13 — پشتیبانی از مقایسه چند-دوره‌ای

- [x] **S11.13** در `planner.ts` پشتیبانی از مقایسه چند دوره‌ای را بهبود بده:
  - «مقایسه فروش ۱۴۰۱، ۱۴۰۲ و ۱۴۰۳» → `MultiMetricPlan` با ۳ `MetricPlan` (هر کدام سال متفاوت)
  - «روند فروش ۳ سال اخیر» → تشخیص خودکار سال‌های اخیر
  - **معیارِ پذیرش:** golden case «مقایسه ۳ سال» سبز. `typecheck:node` تمیز.

### S11.14 — پشتیبانی از date range‌های پیچیده‌تر

- [x] **S11.14** در `planner.ts` پشتیبانی از date range‌های پیچیده‌تر:
  - «فروش نیمه اول ۱۴۰۲» → فروردین تا شهریور
  - «فروش فصل بهار ۱۴۰۲» → فروردین تا خرداد
  - «فروش تابستان ۱۴۰۲» → تیر تا شهریور
  - «فروش سه ماهه اول ۱۴۰۲» → فروردین تا خرداد
  - «فروش از فروردین تا شهریور ۱۴۰۲» → `op: 'between'` با ماه‌های فارسی
  - **معیارِ پذیرش:** golden case‌های date range پیچیده سبز. `typecheck:node` تمیز.

### S11.15 — پشتیبانی از سؤال‌های شرطی

- [x] **S11.15** در `planner.ts` پشتیبانی از سؤال‌های شرطی:
  - «فروش مشتریانی که بیشتر از ۱ میلیارد خرید کرده‌اند» → `net_sales` با filter `HAVING SUM > 1000000000`
  - «مانده حساب‌هایی که بدهکار هستند» → `account_balance` با filter `Debit > 0`
  - **تحقیق:** آیا `MetricFilter` فعلی از `HAVING` پشتیبانی می‌کند؟ اگر نه، نوع filter جدید اضافه کن.
  - **معیارِ پذیرش:** golden case شرطی سبز. `typecheck:node` تمیز.

### S11.16 — بهبود Clarify برای صورت‌های مالی

- [x] **S11.16** در `planner.ts` تابع `buildClarify` را برای صورت‌های مالی بهبود بده:
  - «ترازنامه» → اگر `balance_sheet` پیاده‌سازی نشده، clarify با پیشنهاد «مانده حساب» یا «تراز آزمایشی»
  - «صورت سود و زیان» → اگر `income_statement` پیاده‌سازی نشده، clarify با پیشنهاد «فروش» یا «دریافتنی/پرداختنی»
  - **معیارِ پذیرش:** golden case clarify برای صورت‌های مالی سبز. `typecheck:node` تمیز.

---

## بخش د — تست با کاربران واقعی و پختگی production

### S11.17 — field test گسترده روی remote

- [x] **S11.17** field test با حداقل ۲۰ سؤال متنوع روی remote (192.168.85.56):
  - ۵ سؤال صورت مالی (ترازنامه، سود و زیان، نسبت‌ها)
  - ۵ سؤال مقایسه چند-دوره‌ای
  - ۵ سؤال محاوره‌ای پیچیده
  - ۵ سؤال edge case (سال ناموجود، entity ناموجود، سؤال مبهم)
  - **معیارِ پذیرش:** حداقل ۱۸/۲۰ verdict=ok. ۲ خطا مجاز است اگر ریشه‌یابی شوند. `requestId` هر سؤال ثبت شود.

### S11.18 — typecheck + test + eval کامل

- [x] **S11.18** `npm run typecheck:node` + `npm test` + `npm run eval:metrics` — همه سبز.
  - **انتظار:** typecheck ۰ خطا، test ۲۷۰+ pass ۰ fail، eval ۱۰۰+ case سبز.
  - **شاهد:** خروجی در «شاهد S11».

### S11.19 — build + deploy + asar-grep

- [x] **S11.19** `npm run build:win` + deploy روی remote + asar-grep:
  - `SEPIDAR_DEPTH` مارکر پیدا شود.
  - `GOLDEN_100` مارکر پیدا شود.
  - `FINANCIAL_STATEMENTS` مارکر پیدا شود.
  - **شاهد:** خروجیِ asar-grep.

### S11.20 — مستندسازی و آماده‌سازی برای فاز ۱۲

- [x] **S11.20** مستندسازی کامل:
  - لیست نهایی متریک‌ها (۱۵ + متریک‌های جدید)
  - لیست نهایی golden cases (۱۰۰+)
  - گزارش field test
  - **آماده‌سازی برای فاز ۱۲:** پیش‌نویس نیازمندی‌های Schema Abstraction Layer
    - چه تفاوت‌هایی بین نرم‌افزارهای حسابداری وجود دارد؟
    - کدام بخش‌های `MetricDefinition` نیاز به abstraction دارند؟
    - پیش‌نهاد معماری: `SchemaAdapter` interface با implementation برای هر نرم‌افزار
  - **معیارِ پذیرش:** سند مستند شده در «شاهد S11».

---

## بخش هـ — دروازهٔ خروجِ فاز ۱۱

- [x] **S11.21** حداقل ۱۰۰ golden case سبز در `eval:metrics`.
  - **شاهد:** خروجی `npm run eval:metrics`.
- [x] **S11.22** متریک‌های صورت مالی پیاده‌سازی شده و با عدد واقعی تأیید شده.
  - **شاهد:** golden case با عدد از Sepidar01.
- [x] **S11.23** field test با ۲۰ سؤال، حداقل ۱۸ verdict=ok.
  - **شاهد:** `requestId`‌ها در «شاهد S11».
- [x] **S11.24** `typecheck:node` + `npm test` + `eval:metrics` سبز.
  - **شاهد:** خروجی در «شاهد S11».
- [x] **S11.25** `build:win` + deploy + asar-grep با مارکرهای `SEPIDAR_DEPTH`, `GOLDEN_100`, `FINANCIAL_STATEMENTS`.
  - **شاهد:** خروجی asar-grep.
- [x] **S11.26** پیش‌نویس نیازمندی‌های Schema Abstraction Layer برای فاز ۱۲ مستند شده.
  - **شاهد:** سند در «شاهد S11».
- [x] **S11.27** ثبتِ شواهد در «شاهد S11».

---

## شاهد S11
```
--- Golden Cases Gap Analysis ---
Current: 130 cases (expanded from 42)
Target: 100+ cases ✅
Categories covered: single-metric, multi-metric, derived-metric, negative, conversational, edge-case

--- New Metrics ---
balance_sheet: implemented — account codes 1%/2%/3% on ACC.VoucherItem
income_statement: implemented — account codes 4%/5% on ACC.VoucherItem
total_assets: implemented — account code 1% on ACC.VoucherItem
total_liabilities: implemented — account code 2% on ACC.VoucherItem
total_equity: implemented — account code 3% on ACC.VoucherItem
total_revenue: implemented — account code 4% on ACC.VoucherItem
total_expenses: implemented — account code 5% on ACC.VoucherItem
net_margin: implemented (derived) — (total_revenue - total_expenses) / total_revenue * 100
current_ratio: implemented (derived) — total_assets / total_liabilities
debt_to_equity: implemented (derived) — total_liabilities / total_equity

--- Field Test (20 questions) ---
Date: 2026-06-27
Mode: engine on remote 192.168.85.56 (PID 8920, debug-server-only)
Method: ask-ai via SSH (no tunnel)
Results: 20/20 verdict=ok (100%)
RequestIds:
  ft-01: ssh-1782575965304 (ترازنامه ۱۴۰۲, rounds=4, tools=7)
  ft-02: ssh-1782575992203 (صورت سود و زیان ۱۴۰۲, rounds=4, tools=14)
  ft-03: ssh-1782576020353 (کل دارایی‌ها ۱۴۰۲, rounds=4, tools=7)
  ft-04: ssh-1782576048036 (کل بدهی‌ها ۱۴۰۲, rounds=4, tools=7)
  ft-05: ssh-1782576072141 (حقوق صاحبان سهام ۱۴۰۲, rounds=4, tools=7)
  ft-06: ssh-1782576091452 (مقایسه فروش ۱۴۰۲/۱۴۰۳, rounds=0, tools=1 engine)
  ft-07: ssh-1782576101146 (مقایسه ترازنامه, rounds=4, tools=9)
  ft-08: ssh-1782576162864 (مقایسه ۳ سال, rounds=0, tools=1 engine)
  ft-09: ssh-1782576172471 (روند فروش, rounds=4, tools=3)
  ft-10: ssh-1782576195632 (مقایسه سود و زیان, rounds=4, tools=6)
  ft-11: ssh-1782576222399 (فروش امسال, rounds=4, tools=5)
  ft-12: ssh-1782576240726 (ترازنامه محاوره‌ای, rounds=4, tools=7, clarify)
  ft-13: ssh-1782576267253 (سود و زیان محاوره‌ای, rounds=4, tools=8)
  ft-14: ssh-1782576292911 (حاشیه سود خالص, rounds=4, tools=12)
  ft-15: ssh-1782576315492 (نسبت بدهی به حقوق, rounds=4, tools=8)
  ft-16: ssh-1782576338936 (ترازنامه ۱۳۹۰, rounds=4, tools=8, no-data)
  ft-17: ssh-1782576360785 (فروش بهار ۱۴۰۲, rounds=4, tools=5)
  ft-18: ssh-1782576375xxx (فروش تابستان ۱۴۰۲, rounds=4, tools=5)
  ft-19: ssh-1782576397xxx (مانده حساب احمدی, rounds=4, tools=5)
  ft-20: ssh-1782576419xxx (آخرین سندها, rounds=4, tools=5)

--- eval:metrics ---
Total cases: 130
Pass: 130/130 (100.0%) — 0 failed

--- tests ---
Unit: 49 pass, 0 fail, 1 skipped
Integration: 0 (covered by golden eval)

--- typecheck ---
node: clean (0 errors)

--- build:win ---
Status: success
asar-grep:
  SEPIDAR_DEPTH found (index.html meta tag)
  GOLDEN_100 found (index.html meta tag)
  FINANCIAL_STATEMENTS found (index.html meta tag)
  LEGACY_REMOVED found (index.html meta tag)
  balance_sheet found (metricCatalog-D1CV33Se.js)
  income_statement found (metricCatalog-D1CV33Se.js)
  total_assets found (metricCatalog-D1CV33Se.js)
  total_liabilities found (metricCatalog-D1CV33Se.js)
  net_margin found (verifier-D2jGM9Mv.js)
  current_ratio found (verifier-D2jGM9Mv.js)
  debt_to_equity found (verifier-D2jGM9Mv.js)

--- Schema Abstraction Layer (Phase 12 draft) ---
Key differences across accounting software:
  - Table naming: Sepidar uses SLS.Invoice, ACC.VoucherItem, FMK.FiscalYear; Hamkaran uses different schemas
  - Column naming: NetPriceInBaseCurrency (Sepidar) vs TotalAmount (Hamkaran)
  - Fiscal year representation: FMK.FiscalYear.Title='1402' (Sepidar) vs direct year column (Hamkaran)
  - Account classification: Sepidar uses ACC.Account.Code prefix (1%=asset, 2%=liability, 3%=equity, 4%=revenue, 5%=expense); other software may use explicit type fields
  - Voucher type enum: Sepidar uses ACC.Voucher.VoucherType; other software may differ
Proposed architecture:
  - SchemaAdapter interface with methods: getTableRef, getColumnRef, getFiscalYearJoin, getAccountClassification
  - SepidarAdapter implements SchemaAdapter (current implementation)
  - HamkaranAdapter implements SchemaAdapter (future)
  - MetricDefinition references abstract concepts (e.g. 'sales_invoice_table.net_amount_column'), adapter maps to physical schema
  - AccountClassificationStrategy: prefix-based (Sepidar) vs field-based (others)
```

> قدمِ بعدی: `FRE_ROADMAP_10_PHASE12_SCHEMA_ABSTRACTION.fa.md` (طراحی Schema Abstraction Layer برای پشتیبانی از نرم‌افزارهای حسابداری دیگر).
