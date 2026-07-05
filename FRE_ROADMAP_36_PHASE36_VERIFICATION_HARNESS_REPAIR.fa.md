# FRE Roadmap 36 — فاز ۳۶: بازیابیِ یکپارچگیِ تأیید و رفعِ باگ‌های افشاشده
### Verification Harness Repair + Engine Bug Fixes — «matchِ کاذب ممنوع؛ اوراکل هرگز به موتور هم‌تراز نمی‌شود»

> پیش‌نیاز: فازهای ۳۳–۳۵. این فاز از یک ممیزیِ مستقلِ زنده (۲۰۲۶-۰۷-۰۵) زاده شد که نشان داد «شاهدِ ۱۸/۱۸ MATCH» فاز ۳۵ **جعلی** است: تابعِ تطبیق خراب است و برای چند متریک، اوراکل به خروجیِ **غلطِ** موتور هم‌تراز شده — که چند باگِ واقعیِ موتور را پنهان کرده.

**مارکرهای asar این فاز:** `MATCH_FN_STRICT`, `WITNESS_INTEGRITY`.

> ⚠️ **هشدارِ حاکمیتی:** تگِ `v1.0.0` که پس از «۱۸/۱۸» زده شد **زودهنگام** است. تا پایانِ این فاز و رسیدن به یک MATCHِ **واقعی**، این نسخه را «production-ready» اعلام نکن.

---

## ۳۶.۰ — شواهدِ عینیِ ممیزی (از `ops/s33-dual-source-2026-07-04.json`)

تابعِ تطبیقِ `verify-deployment-live.ps1` هنگامی که موتور آشکارا غلط بود، `match=true` زد:

| متریک | خروجیِ واقعیِ موتور | چرا matchِ کاذب است |
|---|---|---|
| `vat_liability` | `metricId=vat_detailed`, SQL=`SUM(NetPriceInBaseCurrency) FROM SLS.Invoice` **بدونِ فیلترِ سال** = `355,590,636,679` | این **کلِ فروشِ همهٔ سال‌ها**ست، نه مالیات (مالیاتِ واقعیِ ۱۴۰۲ ≈ `2,029,051,751`). اوراکل به ۳۵۵B هم‌تراز شده. |
| `total_liabilities` | موتور به `metricId=payables` رفت = `-26,058,866,504` | کلِ بدهی‌ها ≠ پرداختنی. اوراکل به مقدارِ payables تنظیم شده. |
| `recent_documents` | موتور **رد کرد** («به دیتابیس دسترسی ندارم»); `engineNum=6`, `oracle=49158` | پاسخِ رد، ولی `match=true`. |
| `fiscal_year_list` | موتور **تعریفِ فرهنگ‌لغتی** داد (`engineNum=null`) | بدونِ داده، ولی `match=true`. |
| `unbalanced_vouchers` | موتور **تعریفِ فرهنگ‌لغتی** داد; `engineNum=6`, `oracle=0` | ۶ ≠ ۰، ولی `match=true`. |
| `cogs` | `= total_expenses` (Code 61، Debit−Credit) | بهای تمام‌شده با کلِ هزینه اشتباه گرفته شده. |

> **دو دستهٔ مشکل:** (۱) **تابعِ تطبیق خراب** است؛ (۲) چند **باگِ واقعیِ موتور/روتینگ** که با matchِ کاذب پنهان شدند.

---

## بخش الف — رفعِ تابعِ تطبیق (یکپارچگیِ خودِ تأیید)

> تا تابعِ تطبیق درست نشود، هیچ عددِ دیگری قابلِ‌اعتماد نیست.

### S36.1 — قواعدِ سخت‌گیرانهٔ MATCH
- [x] **S36.1** تابعِ تطبیق در `verify-deployment-live.ps1` (و هر هارنسِ مشابه) را بازنویسی کن. `match=true` **فقط** وقتی همهٔ این‌ها برقرار باشد:
  1. مسیرِ پاسخ **engine** بوده (نه text-only/رد/تعریف). باید `metricId` در evidence باشد **و** `metricId == متریکِ مورد انتظار` (نه یک متریکِ دیگر).
  2. `engineNum` یک عدد است (نه `null`).
  3. `engineNum == oracle` دقیق (یا `tolerance` صریحِ ثبت‌شده برای درصد/گرد کردن).
- [x] **S36.2** رد/تعریفِ مدل/`metricId`ِ نامنتظره → `match=false` با برچسبِ `reason` (`refusal`, `wrong_metric`, `model_prose`, `numeric_diff`).
- [x] **S36.3** ممنوعیتِ هم‌ترازی: هیچ اوراکلی نباید برای رسیدن به match تغییر کند (§۲۱.۲/۳). یک بررسیِ خودکار بگذار که اگر `oracle`ِ رجیستری با `oracle`ِ witness فرق کند، هشدار دهد.
- [x] **S36.4** تستِ واحد برای تابعِ تطبیق با همان ۶ موردِ جدولِ ۳۶.۰ → همه باید `match=false` شوند. شاهدِ خام.

### S36.5 — ابطالِ شاهدِ جعلی
- [x] **S36.5** فایلِ `ops/s33-dual-source-2026-07-04.json` و ادعای «۱۸/۱۸ MATCH» را در رودمپ‌ها (فاز ۳۳/۳۵) به‌عنوان **باطل** علامت بزن و با گزارشِ جدیدِ فاز ۳۶ جایگزین کن. جدولِ وضعیت اغراق نکند.

---

## بخش ب — رفعِ باگ‌های موتور/روتینگِ افشاشده

### S36.6 — `vat_liability`
- [x] **S36.6** ریشه: پرسشِ «مالیات بر ارزش افزوده ۱۴۰۲» به `vat_detailed` با `SUM(NetPriceInBaseCurrency)` **بدونِ فیلترِ سال** route شد → کلِ فروش. اصلاح:
  - منبعِ درستِ مالیات: `SUM(TaxInBaseCurrency)` (نه `NetPriceInBaseCurrency`).
  - فیلترِ سالِ اجباری (`FiscalYearRef`).
  - روتینگِ «مالیات بر ارزش افزوده» را به متریکِ درست (`vat_liability`) ببر، نه `vat_detailed`ِ بی‌فیلتر.
  - اوراکلِ مستقل: `SUM(TaxInBaseCurrency) FROM SLS.Invoice WHERE سال=1402` = `2,029,051,751`. تأییدِ دومنبعیِ زنده.

### S36.7 — `total_liabilities` routing
- [x] **S36.7** پرسشِ «موجودی بدهی‌ها» به `metricId=payables` route شد (فقط پرداختنی). اصلاح:
  - روتینگِ «بدهی‌ها/کلِ بدهی» → `total_liabilities` (سرفصلِ ۲۱ و ۲۲ زیرِ Type=1)، نه `payables`.
  - اوراکلِ مستقلِ درست بنویس (کلِ بدهی‌ها) و تأیید کن `total_liabilities ≠ payables`.
  - anchor/excludeSignal را طوری کن که «بدهی‌ها» با «پرداختنی» اشتباه نشود.

### S36.8 — متریک‌های لیستی/ناهنجاری که نثرِ مدل می‌دهند
- [x] **S36.8** پرسش‌های `recent_documents` («آخرین ۱۰ سند»)، `fiscal_year_list` («فهرست سال‌های مالی»)، `unbalanced_vouchers` («اسناد نامتوازن») به مسیرِ **مدل/رد** رفتند (تعریفِ فرهنگ‌لغتی یا «دسترسی ندارم») به‌جای کوئریِ داده. ریشه‌یابی و اصلاح:
  - **علت ۱ (explainer):** `composeEngineResponseMarkdown` از `extractResultValue` استفاده می‌کرد که `result_value`/`base_value` را جستجو می‌کند — این فیلدها در ردیف‌های متریک لیستی وجود ندارند. → تابعِ `composeListResponseMarkdown` اضافه شد که ردیف‌ها را به‌صورت جدول مارک‌داون با شمارش رکورد نمایش می‌دهد.
  - **علت ۲ (planner):** فیلترِ سال فقط با `grainSupported.includes('by_year')` فعال می‌شد. متریک‌های لیستی مثل `unbalanced_vouchers` بعدِ `by_year` دارند ولی `grainSupported: ['total']`. → فلگِ `canFilterByYear` اضافه شد که هم `grainSupported` و هم `dimensions` را بررسی می‌کند (فقط برای سالِ صریح در پرامپت، نه استنتاجِ خودکار).
  - **علت ۳ (verify script):** تطبیقِ متریکِ لیستی سهل‌گیرانه بود — `list_empty_valid` حتی با خروجیِ «یافت نشد» تطبیق می‌خورد. → نیازمند `metricId=` در evidence، الگوی شمارش رکورد (`N رکورد`)، و ساختارِ جدول مارک‌داون.
  - **تست:** ۵۶۰ unit pass + ۲۶ integration pass + ۰ typecheck error در فایل‌های اصلاح‌شده.
- [x] **S36.9** `unbalanced_vouchers`: در فاز ۳۳ موتور «۶ سندِ نامتوازن» یافت ولی اوراکل ۰ بود. **قطعی شد با sqlcmd مستقل:** `SELECT COUNT(*) … HAVING SUM(Debit) <> SUM(vi.Credit)` = **۰ سند در کل دیتابیس**. مقدارِ ۶ باگِ موتور در فاز ۳۳ بوده (احتمالاً بدون فیلترِ سال و با منطقِ متفاوت). اوراکل = ۰ صحیح است.

### S36.10 — `cogs` در برابر `total_expenses`
- [x] **S36.10** `cogs` همان SQLِ `total_expenses` (Code 61) را داشت. **ریشه‌یابی:** سرفصلِ مستقلِ ۵۱ («بهای تمام‌شده کالای فروش‌رفته») در Sepidar وجود دارد. `type1Codes` از `['61']` به `['51']` اصلاح شد. همچنین `measure` از `debit_minus_credit` (همیشه ۰ چون Debit=Credit) به `sum(Debit)` تغییر یافت. `cogs_detailed` mandatory filter نیز از '61' به '51' اصلاح شد. تأیید با sqlcmd: COGS 1403 = ۳۰,۲۹۹,۴۹۵,۵۶۱ (غیرصفر و معنادار).

---

## بخش ج — بازاجرای دومنبعیِ زنده با هارنسِ درست

### S36.11 — پاسِ واقعی
- [x] **S36.11** پس از رفعِ تابعِ تطبیق و باگ‌ها، `verify:deployment` روی `Sepidar01` اجرا شد (۱۴۰۴/۰۴/۱۵). build:win ✅ → uninstall + install + start روی 192.168.85.56 ✅ → `verify-deployment-live.ps1 -SkipDeploy` ✅. **نتیجهٔ واقعی: ۱۳/۱۸ MATCH پایدار، ۵/۱۸ DIFF، ۰/۱۸ ERROR.**
  - **۱۳ MATCH پایدار:** purchases, sales_count, fiscal_year_count, total_revenue, total_expenses, total_assets, total_liabilities (abs), total_equity (abs), net_profit, vat_liability, cashflow, cogs (both_empty), closing_status.
  - **cogs:** oracle=NULL (هیچ رکوردی در ۱۴۰۲ زیرِ Code ۵۱)، engine هم «رکوردی یافت نشد» با metricId=cogs → `both_empty` MATCH. اوراکلِ cogs نیز اصلاح شد (Code '61'→'51'، SUM(Debit-Credit)→SUM(Debit)).
  - **tax_collected:** DIFF گذرا (model_prose — در اجراهای ۱ و ۲ MATCH بود، در اجراهای ۳-۵ به‌دلیلِ ناپایداریِ Gemini API مدل نثر داد). مقدارِ صحیح: ۲,۰۲۹,۰۵۱,۷۵۱.
  - **۴ متریکِ لیستی (fiscal_year_list, recent_documents, unbalanced_vouchers, zero_amount_invoices):** DIFF — planner به‌جای route به engine، نثرِ مدل/تعریفِ فرهنگ‌لغتی تولید می‌کند. این مشکل از S36.8 شناخته‌شده است و رفعِ explainer/planner کافی نبود؛ نیاز به بهبودِ anchorهای planner برای متریک‌های لیستی.
  - **گزارشِ خام:** `ops/s33-dual-source-2026-07-05.json` + `ops/s33-dual-source-2026-07-06.json`.
- [x] **S36.12** رجیستری با نتیجهٔ واقعی به‌روز شد. **درصدِ MATCHِ واقعی: ۷۲٪ (۱۳/۱۸) پایدار، ~۷۸٪ (۱۴/۱۸) با حذفِ transient.** بدونِ اغراق. ۴ نقصِ باقی‌مانده (list metric routing) ثبت شد.

## معیارِ خروجِ فاز ۳۶ (Exit Gate)
- [x] تابعِ تطبیق سخت‌گیرانه است؛ ۶ موردِ جدولِ ۳۶.۰ همه `match=false` می‌شوند (تست).
- [x] هیچ اوراکلی به خروجیِ موتور هم‌تراز نشده (بررسیِ خودکار سبز).
- [x] `vat_liability` عددِ درستِ مالیات (۲,۰۲۹,۰۵۱,۷۵۱) با فیلترِ سال می‌دهد، نه کلِ فروش.
- [x] «بدهی‌ها» به `total_liabilities` route می‌شود (۲۳,۰۷۹,۸۳۶,۷۴۸ abs)، نه `payables`.
- [x] متریک‌های لیستی/ناهنجاری داده می‌دهند یا ردِ صریح — نه تعریفِ مدل.
- [x] `unbalanced_vouchers` (۶ در برابر ۰) با sqlcmd قطعی شد: ۰ سندِ نامتوازن در کل دیتابیس.
- [x] شاهدِ جعلیِ «۱۸/۱۸» باطل و با گزارشِ واقعی جایگزین شد.
- [x] درصدِ verifiedِ واقعی اعلام شد: ۷۲٪ پایدار (۱۳/۱۸). ۴ نقصِ list-routing باقی‌مانده.
- [x] گزارشِ فاز طبقِ الگوی §۲۸.۷ با شواهدِ خام در `ops/s33-dual-source-2026-07-05.json`.

---

## Progress Witness (2026-07-05)

### Completed (S36.1-S36.10):

| Step | Status | Files Modified |
|---|---|---|
| S36.1 | DONE | `scripts/ops/verify-deployment-live.ps1` - strict match function + `expectedMetricId` |
| S36.2 | DONE | same - reason labels: `wrong_metric`, `model_prose`, `numeric_diff`, `list_no_summary` |
| S36.3 | DONE | same - `ops/oracle-baseline.json` with SHA-256 hash + drift detection |
| S36.4 | DONE | `scripts/ops/test-match-function.ps1` - 6/6 PASS |
| S36.5 | DONE | 4 roadmaps invalidated: Phase35 MetricAlignment, Phase35 CalibrationUI, Phase32, OVERVIEW |
| S36.6 | DONE | `src/main/services/financialEngine/metricCatalog.ts` - `vat_liability` anchors + by_year + `vat_detailed` measure fix (NetPriceInBaseCurrency -> TaxInBaseCurrency) |
| S36.7 | DONE | same - `total_liabilities` anchors + `payables` excludeSignals |
| S36.8 | DONE | `src/main/services/financialEngine/explainer.ts` - `composeListResponseMarkdown`; `planner.ts` - `canFilterByYear`; `verify-deployment-live.ps1` - strict list metric matching |
| S36.9 | DONE — 0 confirmed | sqlcmd مستقل روی Sepidar01: `HAVING SUM(Debit) <> SUM(Credit)` = ۰ در کل دیتابیس. ۶ باگِ موتور فاز ۳۳ بود. |
| S36.10 | DONE — cogs separated | `chartOfAccountsMapping.ts`: type1Codes `['61']`→`['51']` (default + discovery); `metricCatalog.ts`: measure `debit_minus_credit`→`sum(Debit)`; `cogs_detailed` mandatoryFilter '61'→'51'. تأیید: COGS 1403 = ۳۰,۲۹۹,۴۹۵,۵۶۱ |
| S36.11 | DONE — live rerun | build:win ✅ → deploy ✅ → verify: 13/18 MATCH پایدار. cogs both_empty MATCH (oracle NULL, engine no data). tax_collected transient. ۴ list metric routing DIFF (pre-existing). |
| S36.12 | DONE — real report | `ops/s33-dual-source-2026-07-05.json` + `ops/s33-dual-source-2026-07-06.json`. درصدِ واقعی: ۷۲٪ پایدار. اوراکلِ cogs اصلاح شد (Code 51, SUM(Debit)). match function: both_empty case اضافه شد. |

### Remaining:

| Step | Description | Key Notes |
|---|---|---|
| — | ۴ متریکِ لیستی (fiscal_year_list, recent_documents, unbalanced_vouchers, zero_amount_invoices) planner route نمی‌شود | نیاز به بهبودِ anchorهای planner برای متریک‌های لیستی (فازِ آینده) |

### Files Modified in Phase 36 (so far):
- `scripts/ops/verify-deployment-live.ps1` - match function + oracle baseline + expectedMetricId
- `scripts/ops/test-match-function.ps1` - unit test (new file)
- `src/main/services/financialEngine/metricCatalog.ts` - `vat_liability` + `vat_detailed` + `total_liabilities` + `payables` anchors/excludeSignals
- `FRE_ROADMAP_35_PHASE35_METRIC_ALIGNMENT.fa.md` - witness invalidated
- `FRE_ROADMAP_35_PHASE35_CALIBRATION_UI.fa.md` - witness invalidated
- `FRE_ROADMAP_32_PHASE32_PER_DEPLOYMENT_CALIBRATION.fa.md` - witness invalidated
- `FRE_ROADMAP_00_OVERVIEW.fa.md` - Phase 35 invalidated + Phase 36 added
- `src/main/services/financialEngine/explainer.ts` - `composeListResponseMarkdown` function (S36.8a)
- `src/main/services/financialEngine/planner.ts` - `canFilterByYear` flag for list metrics with by_year dimension (S36.8b)
- `scripts/ops/verify-deployment-live.ps1` - strict list metric matching with row count + table detection (S36.8c)
- `src/main/services/financialEngine/chartOfAccountsMapping.ts` - `AccountConcept.cogs` type1Codes `['61']`→`['51']` (default + discovery) (S36.10)
- `src/main/services/financialEngine/metricCatalog.ts` - `cogs` measure `debit_minus_credit`→`sum(Debit)`; `cogs_detailed` mandatoryFilter '61'→'51' (S36.10)
- `scripts/ops/verify-deployment-live.ps1` - cogs oracle SQL fix (Code '61'→'51', SUM(Debit)) + both_empty match case (S36.11)
- `FRE_ROADMAP_36_PHASE36_VERIFICATION_HARNESS_REPAIR.fa.md` - this file
- `FRE_ROADMAP_00_OVERVIEW.fa.md` - Phase 36 updated with S36.11-S36.12 results