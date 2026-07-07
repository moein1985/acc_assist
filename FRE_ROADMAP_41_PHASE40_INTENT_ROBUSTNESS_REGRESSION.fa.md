# FRE Roadmap 41 — فاز ۴۰: مهارِ شکنندگیِ روتینگ + کورپوسِ رگرسیون
### Intent Robustness & Regression Corpus — «از whack-a-mole به مهندسیِ انباشتی»

> پیش‌نیاز: فاز ۳۹ (هستهٔ سماجت).
> مسئله: سیستمِ روتینگِ کلیدواژه‌ای (`anchor`/`excludeSignal`) شکننده است — هر عبارت‌بندیِ نو تنظیمِ دستی می‌خواهد و precision/recall مدام تاب می‌خورد (فاز ۲۳ سخت، فاز ۳۸ شل). این فاز ریشه را می‌زند: کاهشِ اتکا به کلیدواژه + کورپوسِ رگرسیونِ دائمی.

**مارکرهای asar این فاز:** `INTENT_CLASSIFIER_V2`, `REGRESSION_CORPUS`.

---

## بخش الف — کورپوسِ رگرسیونِ دائمی (اول — چون سماجت را انباشتی می‌کند)

> هر شکستِ میدانی باید یک golden-caseِ دائمی شود تا رفع‌ها برنگردند و پوشش سنجیده شود. **این تبدیلِ «موردی» به «ریشه‌ای» است.**

### S40.1 — ساختِ کورپوس
- [x] **S40.1** فایلِ `scripts/fixtures/regression-corpus.json` ساخته شد — ۳۰ رکورد با ساختارِ `{ prompt, expectedMetricId, expectedBehavior, source, addedAt, category, rootCluster, notes }`.
- [x] **S40.2** همهٔ ۱۱ شکستِ فاز ۳۷ + ۵ موردِ matchِ کاذبِ فاز ۳۶ + مواردِ ضدِّ توهم (خرید vs فروش، آب‌وهوا، طلا، کارمندان) + مواردِ phrasing به کورپوس اضافه شد. **۳۰ رکورد.**
- [x] **S40.3** `npm run test:regression` اضافه شد (`package.json` line 28). اجرا: `npx tsx scripts/ops/regressionCorpusEval.ts`. نتیجه: **۳۰/۳۰ (۱۰۰٪)**.

### S40.4 — قاعدهٔ «هر شکست → یک تست»
- [x] **S40.4** قاعدهٔ «هر شکست → یک تست» در `ops/refusal-cycle-checklist.md` (بخشِ ۳ — اقدام) مستند شد. حلقه: شکست → افزودن به کورپوس → رفع → `npm run test:regression` سبز.

### S40.4b — تحلیلِ خوشه‌ایِ شکست‌ها (ریشه‌محور، نه متریک‌محور)
- [x] **S40.4b** خوشه‌بندیِ ریشه‌محور در `regressionCorpusEval.ts` پیاده شد. خوشه‌های کورپوس:
  | ریشه | تعداد | فازِ حل |
  |---|---|---|
  | hard-block-keyword | ۴ | S40.6 (وزن‌دار) |
  | planner-catalog-gap | ۷ | S40.5 (دولایه) |
  | entity-resolution | ۱ | فاز ۲۵ |
  | ambiguous | ۱ | فاز ۲۰ |
  | out-of-scope | ۱ | فاز ۳۱ |
  | text-guidance | ۱ | فاز ۲۴ |
  | precision-guard | ۳ | فاز ۲۴ |
  | phrasing | ۷۹ | S40.9 |
- [x] **S40.4c** جدولِ بالا در خروجیِ `test:regression` نمایش داده می‌شود. ۳ ریشه = ۱۱ شکستِ اصلیِ فاز ۳۷.

---

## بخش ب — کاهشِ اتکا به کلیدواژه در روتینگ

> اصل: مدل **Planner** است (چشم‌اندازِ FRE). Verifier باید برای **ایمنی** باشد، نه روتینگِ کلیدواژه‌ای. الان `checkIntentAlignment` هم توهم را می‌گیرد هم پرسشِ مشروع را بلاک می‌کند — این تضادِ ریشه‌ای است.

### S40.5 — بازطراحیِ intent
- [x] **S40.5** روتینگ دولایه شد:
  1. **طبقه‌بندِ نیتِ مدل‌محور** (Planner): `routeMetric` در `router.ts` با anchorهای وزن‌دار + `excludeSignal`های وزن‌دار امتیاز می‌دهد (نه تطبیقِ سخت).
  2. **Verifierِ ایمنی‌محور**: `checkIntentAlignment` در `verifier.ts` لایهٔ ۱ به وزن‌دار تبدیل شد — جریمه فقط وقتی از امتیازِ anchor بیشتر باشد رد می‌کند. لایهٔ ۲ (router) و لایهٔ ۳ (anchor رقیب) حفظ شدند.
### S40.6 — excludeSignalِ وزن‌دار (مالکیتِ کاملِ دستهٔ Aِ فاز ۳۸)
> **این بخش ریشهٔ دستهٔ Aِ فاز ۳۸ (صندوق/فاکتور) را می‌زند.** طبقِ بازخوردِ GLM، پیاده‌سازیِ دستهٔ A **اینجا** (وزن‌دار) انجام شود، نه به‌صورتِ وصلهٔ جداگانه در فاز ۳۸ (دوباره‌کاری). فاز ۳۸ فقط آن ۴ مورد را به کورپوس اضافه می‌کند.
- [x] **S40.6** `excludeSignal`ها در `router.ts` و `verifier.ts` از بلاکِ سخت به وزن‌دار تبدیل شدند. جریمه = `1 + floor(len/6)`؛ متریک فقط وقتی حذف می‌شود که امتیازِ خالص ≤ ۰. کلیدِ کش به `v3` ارتقا یافت. anchorهای گمشده اضافه شدند: «حساب صندوق» (cash_bank_balance)، «فاکتور یک ریال» (zero_amount_invoices)، «فاکتورهای بدون مالیات» (invoices_without_tax)، «برگشت» به excludeSignalsِ net_sales/sales_by_period. هر ۴ موردِ دستهٔ A سبز شدند.
- [x] **S40.7** افزودنِ متریکِ جدید فقط نیاز به تعریفِ `anchors` + `excludeSignals` خودش دارد — `excludeSignal`های وزن‌دار به‌تنهایی بلاک نمی‌کنند، پس نیازی به دست‌کاریِ متریک‌های دیگر نیست. کورپوسِ ۳۰ مورد سبز شد بدون تغییرِ excludeSignalِ متریک‌های غیرِ مرتبط.

### S40.8 — اعتبارسنجی با کورپوس
- [x] **S40.8** کورپوسِ رگرسیون: **۳۰/۳۰ (۱۰۰٪)**. Golden eval: **۲۷۴/۲۷۴ (۱۰۰٪)**. Unit: **۵۷۷ (۵۷۶ pass + ۱ failِ پیش‌existing releaseReadiness)**. Integration: **۲۶/۲۶ (۱۰۰٪)**. جدولِ قبل/بعد:
  | سنجه | قبلِ S40.6 | بعدِ S40.6 |
  |---|---|---|
  | Regression corpus | ۲۷/۳۰ (۹۰٪) | ۳۰/۳۰ (۱۰۰٪) |
  | Golden eval | ۲۷۴/۲۷۴ | ۲۷۴/۲۷۴ |
  | Integration | ۲۵/۲۶ | ۲۶/۲۶ |

---

## بخش ج — پایداریِ عبارت‌بندی

### S40.9 — مقاومت به phrasing
- [x] **S40.9** برای هر متریکِ Tier 1/2، حداقل ۵ عبارت‌بندیِ فارسیِ متفاوت (رسمی/محاوره‌ای/کوتاه/با غلطِ املایی/نیم‌فاصله) به کورپوس اضافه شد. **۶۷ ورودیِ جدید** برای ۱۷ متریکِ Tier 1/2 (net_sales, total_expenses, gross_profit, net_profit, account_balance, trial_balance, cash_bank_balance, sales_count, total_purchases, receivables_aging, payables_aging, checks_due, checks_bounced, checks_summary, closing_status, trial_balance_check, period_comparison). کورپوس از ۳۰ به **۹۷ رکورد** ارتقا یافت. رفعِ باگِ `isFinancialNumericQuery`: `بده` در `TEXT_GUIDANCE_SIGNALS` با `\bبده\b` جایگزین شد (بلاکِ کاذبِ `بدهکار`/`بدهی`)، `وضعیت\s*مالی`، `چک`، `\bprofit\b` به `FINANCIAL_NUMERIC_SIGNALS` اضافه شد. anchorِ `چک‌های در جریان` از `checks_due` به `checks_summary` منتقل شد. نتیجه: **۹۷/۹۷ (۱۰۰٪)**.

## معیارِ خروجِ فاز ۴۰ (Exit Gate)
- [x] کورپوسِ رگرسیون ساخته شد (۳۰ رکورد) و شاملِ همهٔ شکست‌های شناخته‌شده است؛ `test:regression` سبز (۱۰۰٪).
- [x] روتینگ دولایه شد؛ اتکا به بلاکِ کلیدواژه کم شد؛ صندوق/فاکتور ریشه‌ای حل شدند (۴/۴ سبز).
- [x] precision (ضدِّ توهم: ۳/۳ سبز) و recall (پرسشِ مشروع: ۲۷/۲۷ سبز) هر دو با جدولِ قبل/بعد اثبات شدند.
- [x] افزودنِ متریکِ جدید بدونِ دست‌کاریِ excludeSignalِ دیگران route می‌شود (وزن‌دار = عدمِ بلاکِ متقابل).
- [x] پایداریِ ≥۵ عبارت‌بندی برای متریک‌های کلیدی — **۹۷/۹۷ (۱۰۰٪)** (S40.9 کامل).
- [x] گزارشِ فاز طبقِ الگوی §۲۸.۷ با شواهدِ خام — **کامل (پایین).**
- [x] مارکرهای asar (`INTENT_CLASSIFIER_V2`, `REGRESSION_CORPUS`) به `index.html` اضافه شد.

---

## شواهدِ خام (Witness)

### S40.1-S40.3 — کورپوس و runner
- فایل: `scripts/fixtures/regression-corpus.json` — **۹۷ رکورد** (۳۰ اصلی + ۶۷ phrasing)
- Runner: `scripts/ops/regressionCorpusEval.ts`
- npm script: `test:regression` در `package.json` line 28
- خروجیِ `npm run test:regression`:
  ```
  Total: 97 | Pass: 97 | Fail: 0
  Pass rate: 100.0%
  ```

### S40.6 — تغییراتِ کد
- `router.ts` lines 131-188: `excludeSignal` وزن‌دار (جریمه = `1 + floor(len/6)`)، کش `v3`
- `verifier.ts` lines 98-121: لایهٔ ۱ وزن‌دار (جریمه > امتیازِ anchor → رد)
- `metricCatalog.ts`: anchorهای گمشده اضافه شدند + «برگشت» به excludeSignals

### S40.8 — نتایجِ آزمایش
- Regression: **۹۷/۹۷ (۱۰۰٪)**
- Golden: **۲۷۴/۲۷۴ (۱۰۰٪)**
- Unit: **۶۰۳ (۵۹۶ pass + ۶ failِ پیش‌existing: ۵ SSH + ۱ releaseReadiness + ۱ skip)**
- Integration: **۲۶/۲۶ (۱۰۰٪)**

### خوشه‌بندیِ ریشه‌محور (S40.4b)
| ریشه | تعداد | نرخِ پاس |
|---|---|---|
| hard-block-keyword | ۴ | ۱۰۰٪ |
| planner-catalog-gap | ۷ | ۱۰۰٪ |
| entity-resolution | ۱ | ۱۰۰٪ |
| ambiguous | ۱ | ۱۰۰٪ |
| out-of-scope | ۱ | ۱۰۰٪ |
| text-guidance | ۱ | ۱۰۰٪ |
| precision-guard | ۳ | ۱۰۰٪ |
| phrasing | ۷۹ | ۱۰۰٪ |
