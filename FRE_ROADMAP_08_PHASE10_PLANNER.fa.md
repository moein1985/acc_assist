# FRE Roadmap 08 — فاز ۱۰: Planner مدلی پیشرفته و سؤال‌های آزاد
### از Planner قطعیِ first-pass به Planner مدلیِ قوی برای زبانِ طبیعیِ پیچیده

> پیش‌نیاز: فاز ۹ کامل. کد legacy حذف شده. ۱۵ متریک + MultiMetric + مشتق در engine mode. این فاز Planner را برای سؤال‌های آزاد، محاوره‌ای، و مبهم ارتقا می‌دهد.

**مارکرهای asar این فاز:** `SMART_CLARIFY`, `MULTI_METRIC_PLANNER`, `CONVERSATIONAL_PLANNER`.

---

## ۰ — وضعیتِ فعلیِ Planner

Planner فعلی (در `planner.ts`):
- `routeMetric`: deterministic first-pass با anchors/excludeSignals. برای سؤال‌های صریح عالی کار می‌کند.
- `buildDeterministicPlan`: regex برای سال، grain، entityName. سریع و قطعی.
- `buildModelPlan`: پرامپتِ few-shot با ۴ مثال. فقط fallback برای سؤال‌های غیر-صریح.
- `PLANNER_CONFIDENCE_THRESHOLD = 0.5`

**مشکلات:**
- فقط ۴ مثالِ few-shot → مدلِ ضعیف برای سؤال‌های آزاد خوب عمل نمی‌کند.
- `MultiMetricPlan` در Planner پشتیبانی نمی‌شود (فقط در deterministic router).
- Clarify فقط `confidence < threshold` را چک می‌کند — هیچ پیشنهادی نمی‌دهد.
- زبانِ محاوره‌ای («چقدر فروختیم؟») پشتیبانی نمی‌شود.

---

## بخش الف — ارتقاءِ پرامپتِ Planner

### S10.1 — few-shot بهبودیافته (۱۰+ مثال)

- [ ] **S10.1** در `planner.ts` تابعِ `buildPlannerPrompt` (خط ۷۵)، مثال‌های few-shot را از ۴ به ۱۰+ افزایش بده. مثال‌های جدید:
  - «چقدر فروختیم؟» (بدون سال → سالِ جاری) → `net_sales` با filter سالِ جاری
  - «فروش و خرید ۱۴۰۲» → `MultiMetricPlan` با `joinMode: 'side_by_side'`
  - «روند ماهانهٔ فروش ۱۴۰۲» → `net_sales` با `grain: 'by_month'`
  - «نسبت فروش به خرید» → `sales_to_purchase_ratio` (derived)
  - «۱۰ سند اخیر» → `recent_documents` با `topN: 10`
  - «گردش حساب دریافتنی از فروردین تا تیر ۱۴۰۲» → `account_turnover` با `op: 'between'`
  - «مانده طرف حساب آقای مرادی» → `party_balance` با `entityName: 'مرادی'`
  - «پرداختنی‌ها چقدر است؟» → `payables`
  - «آب‌وهوای تهران» → `confidence: 0.1` (غیرمالی)
  - «مقایسه فروش و خرید ۱۴۰۲» → `MultiMetricPlan` با `joinMode: 'comparison'`
  - **معیارِ پذیرش:** `typecheck:node` تمیز. پرامپت شاملِ ۱۰+ مثال است.

### S10.2 — پرامپت برای MultiMetricPlan

- [ ] **S10.2** در `planner.ts` تابعِ `buildPlannerPrompt`، بخشِ schema را گسترش بده تا `MultiMetricPlan` را هم پوشش بدهد:
  - شِمای `MultiMetricPlan` را به پرامپت اضافه کن.
  - قاعده: «اگر سؤال دو یا چند متریک می‌خواهد، `MultiMetricPlan` تولید کن با `plans: [...]` و `joinMode`.»
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S10.3 — parsePlannerOutput برای MultiMetricPlan

- [ ] **S10.3** در `planner.ts` تابعِ `parsePlannerOutput` (خط ۱۳۴) را گسترش بده:
  - اگر JSON شاملِ `plans` است (آرایه)، آن را با `multiMetricPlanSchema` اعتبارسنجی کن.
  - اگر JSON شاملِ `metricId` است (تک)، همان `metricPlanSchema` فعلی.
  - خروجی: `ParsePlannerResult` با فیلدِ `multiPlan?: MultiMetricPlan`.
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: JSON با `plans` → `multiPlan` parse می‌شود.

### S10.4 — buildModelPlan برای MultiMetricPlan

- [ ] **S10.4** در `planner.ts` تابعِ `buildModelPlan` (خط ۲۲۸) را گسترش بده:
  - اگر `parsePlannerOutput` یک `multiPlan` برگرداند، آن را برگردان.
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

---

## بخش ب — Clarify هوشمند

### S10.5 — نوعِ ClarifyResult

- [ ] **S10.5** در `planner.ts` اضافه کن:
  ```ts
  export interface ClarifyResult {
    question: string           // سؤالِ شفاف‌سازی
    suggestions: string[]      // گزینه‌های پیشنهادی
  }
  ```
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S10.6 — تولیدِ Clarify هوشمند

- [ ] **S10.6** در `planner.ts` تابعِ `buildClarify(prompt, metricId) → ClarifyResult`:
  - اگر `confidence < threshold`:
    - سؤال: «آیا منظورتان <titleFa> بود؟»
    - suggestions: ۲-۳ متریکِ نزدیک‌تر (بر اساسِ scoreِ router).
  - مثال: «آیا منظورتان فروش خالص بود یا فروش ناخالص؟»
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: `buildClarify('فروش', 'net_sales')` باید سؤال و suggestions برگرداند.

### S10.7 — ادغامِ Clarify در Engine

- [ ] **S10.7** در `financialEngine/index.ts` تابعِ `run`:
  - اگر `plan.confidence < PLANNER_CONFIDENCE_THRESHOLD`:
    - `buildClarify` را صدا بزن.
    - نتیجه را در `EngineResult` (یا یک نوعِ جدید `ClarifyResponse`) برگردان.
    - Explainer باید Clarify را به‌صورتِ سؤال + گزینه‌ها به کاربر نمایش بده.
  - **معیارِ پذیرش:** `typecheck:node` تمیز + تست سبز.

---

## بخش ج — زبانِ محاوره‌ای

### S10.8 — استخراجِ سالِ جاری

- [ ] **S10.8** در `planner.ts` تابعِ `buildDeterministicPlan` (خط ۶):
  - اگر هیچ سالی در متن نیست و متریک `by_year` را پشتیبانی می‌کند:
    - سالِ جاری را از `new Date()` استخراج کن (تبدیلِ میلادی به شمسی — یا از contextِ تنظیمات).
    - یا اگر سالِ فعال در settings وجود دارد، از آن استفاده کن.
    - filter `by_year` با سالِ جاری اضافه کن.
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: «فروش چقدر است؟» (بدون سال) → filter با سالِ جاری.

### S10.9 — استخراجِ نامِ موجودیتِ محاوره‌ای

- [ ] **S10.9** در `planner.ts` تابعِ `buildDeterministicPlan`:
  - regexهای بیشتری برای نامِ حساب/طرف‌حساب اضافه کن:
    - «حساب <name>» / «سرفصل <name>» / «معین <name>» (فعلی)
    - «طرف حساب <name>» / «آقای <name>» / «شرکت <name>» (جدید برای party_balance)
    - «حساب دریافتنی» / «حساب پرداختنی» (entityName به‌عنوانِ نوعِ حساب)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test برای هر الگو.

### S10.10 — استخراجِ بازهٔ تاریخ با فرمت‌های مختلف

- [ ] **S10.10** در `planner.ts` تابعِ `buildDeterministicPlan`:
  - regex برای فرمت‌های مختلفِ تاریخِ فارسی:
    - «از فروردین تا تیر ۱۴۰۲» (نامِ ماه)
    - «نیمهٔ اول ۱۴۰۲» (فروردین تا شهریور)
    - «سه ماه اول ۱۴۰۲»
  - تبدیلِ نامِ ماه به تاریخ (مثلاً فروردین = 1402/01/01).
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test برای هر فرمت.

---

## بخش د — تست‌های گسترده

### S10.11 — unit tests برای Planner

- [ ] **S10.11** در `tests/unit/financialEnginePlanner.test.ts` مواردِ زیر را اضافه کن:
  - سؤالِ چند-متریکی → `MultiMetricPlan` parse می‌شود.
  - سؤالِ محاوره‌ای («چقدر فروختیم؟») → سالِ جاری استخراج می‌شود.
  - سؤالِ مبهم → `ClarifyResult` تولید می‌شود.
  - سؤالِ غیرمالی → `confidence < 0.5`.
  - JSONِ خراب → `error` برگردانده می‌شود (نه crash).
  - **معیارِ پذیرش:** همهٔ تست‌ها سبز.

### S10.12 — golden tests گسترده

- [ ] **S10.12** در `golden-metrics.json` مواردِ زیر را اضافه کن (هدف: ۴۰+ مورد کل):
  - «چقدر فروختیم؟» (محاوره‌ای)
  - «فروش و خرید ۱۴۰۲» (MultiMetric)
  - «نسبت فروش به خرید» (derived)
  - «۱۰ سند اخیر» (topN)
  - «گردش حساب دریافتنی فروردین تا تیر ۱۴۰۲» (dateRange)
  - «مانده طرف حساب آقای مرادی» (party_balance)
  - «روند ماهانهٔ فروش ۱۴۰۲» (trend)
  - «مقایسه فروش و خرید ۱۴۰۲» (comparison)
  - مواردِ منفی: «آب‌وهوا»، «تعداد کارمندان»
  - مواردِ مبهم: «فروش» (بدون سال → clarify یا سالِ جاری)
  - **معیارِ پذیرش:** `eval:metrics` سبز (۴۰+ مورد).

### S10.13 — integration test برای MultiMetric

- [ ] **S10.13** در `tests/integration/financialEngine.integration.test.ts`:
  - «فروش و خرید ۱۴۰۲» → assert: دو `EngineResult`، هر دو verdict=ok.
  - «نسبت فروش به خرید ۱۴۰۲» → assert: عددِ واحد (percent).
  - **معیارِ پذیرش:** تست سبز.

---

## بخش ه — دروازهٔ خروجِ فاز ۱۰

- [ ] **S10.14** `npm run typecheck:node` تمیز + `npm test` سبز.
  - **شاهد:** خروجی در «شاهد S10».
- [ ] **S10.15** `npm run eval:metrics` سبز (۴۰+ مورد).
  - **شاهد:** تعدادِ کل و pass rate.
- [ ] **S10.16** `npm run build:win` + asar-grep: `SMART_CLARIFY`, `MULTI_METRIC_PLANNER`, `CONVERSATIONAL_PLANNER` پیدا شوند.
  - **شاهد:** خروجیِ asar-grep.
- [ ] **S10.17** field test روی remote: ۱۰ سؤالِ پیچیده (محاوره‌ای، چند-متریکی، مبهم، dateRange، topN).
  - **شاهد:** نتایج در «شاهد S10».
- [ ] **S10.18** به‌روزرسانیِ مستندات نهایی:
  - `README.md` — بخش FRE به‌روز شود (۱۵ متریک، MultiMetric، derived).
  - `technical-summary.md` — بخش 1b به‌روز شود.
  - memory به‌روز شود.
  - **شاهد:** فایل‌ها به‌روز شده‌اند.
- [ ] **S10.19** ثبتِ شواهد در «شاهد S10».

---

## شاهد S10
```
<پس از تکمیل، این بخش پر شود>

Planner upgrades:
  Few-shot examples: 10+
  MultiMetricPlan: supported
  Smart Clarify: <N> test cases
  Conversational: year extraction + entityName patterns + dateRange patterns

Field test (engine mode, remote 192.168.85.56):
  1. "چقدر فروختیم؟" → net_sales <value> (year=current) — verdict=ok (requestId=<id>)
  2. "فروش و خرید ۱۴۰۲" → MultiMetric side_by_side — verdict=ok (requestId=<id>)
  3. "نسبت فروش به خرید ۱۴۰۲" → derived <value>% — verdict=ok (requestId=<id>)
  4. "۱۰ سند اخیر" → recent_documents topN=10 — verdict=ok (requestId=<id>)
  5. "گردش حساب دریافتنی فروردین تا تیر ۱۴۰۲" → account_turnover between — verdict=ok (requestId=<id>)
  6. "مانده طرف حساب آقای مرادی" → party_balance — verdict=ok (requestId=<id>)
  7. "روند ماهانه فروش ۱۴۰۲" → net_sales by_month — verdict=ok (requestId=<id>)
  8. "مقایسه فروش و خرید ۱۴۰۲" → MultiMetric comparison — verdict=ok (requestId=<id>)
  9. "آب و هوای تهران" → no-metric-match → degrade (requestId=<id>)
  10. "فروش" (بدون سال) → clarify or current year (requestId=<id>)

eval:metrics: <N>/<N> (100%)
tests: <N> pass, 0 fail
typecheck: node + web clean
build:win: success
asar-grep: SMART_CLARIFY, MULTI_METRIC_PLANNER, CONVERSATIONAL_PLANNER found

Documentation:
  README.md: updated
  technical-summary.md: updated
  memory: updated
```

---

## جمع‌بندیِ نهاییِ کلِ پروژه (فاز ۱ تا ۱۰)

پروژه **واقعاً تمام** است وقتی:

1. ✅ همهٔ ۱۵ متریک از طریقِ engine پاسخ می‌دهند (فاز ۷).
2. ✅ هیچ هندلرِ legacy‌ای در کد وجود ندارد (فاز ۹).
3. ✅ سؤال‌های چند-متریکی و grain‌های پیچیده پشتیبانی می‌شوند (فاز ۸).
4. ✅ متریک‌های مشتق کار می‌کنند (فاز ۸).
5. ✅ ۲ هفته shadow تمیز در production (فاز ۹).
6. ✅ Planner مدلی برای سؤال‌های آزاد کار می‌کند (فاز ۱۰).
7. ✅ monitoring و dashboard فعال (فاز ۹).
8. ✅ افزودنِ متریکِ جدید = فقط یک تعریف + یک golden test (اصلِ خروج از تردمیل).

```mermaid
flowchart LR
    F1[فاز ۱: شکستن + flag] --> F23[فاز ۲-۳: لایهٔ معنایی + کامپایلر]
    F23 --> F45[فاز ۴-۵: Planner + Verifier]
    F45 --> F6[فاز ۶: eval + cutover + rollback]
    F6 --> F7[فاز ۷: ۹ متریکِ legacy]
    F7 --> F8[فاز ۸: چند-متریکی + grains + مشتق]
    F8 --> F9[فاز ۹: shadow ۲ هفته + حذف legacy + monitoring]
    F9 --> F10[فاز ۱۰: Planner پیشرفته + ۴۰+ golden]
    F10 --> GOAL[هدف: صفر هندلرِ دست‌ساز، همه چیز اعلانی]
```

> پایانِ مجموعهٔ نقشهٔ راه.
