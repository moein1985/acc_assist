# FRE Roadmap 18 — فاز ۲۰: Planner هوشمند و مکالمه‌ای (Advanced Planner & Intelligence)
### Planner چندمرحله‌ای، حافظه پیشرفته، پیشنهاد هوشمند، کشف خودکار anomaly

> پیش‌نیاز: فاز ۱۹ کامل. متریک‌های مالی پیشرفته فعال. ۲۴۶ golden case سبز.

**مارکرهای asar:** `MULTI_STEP_PLANNER`, `CONVERSATION_MEMORY_V2`, `SMART_SUGGESTIONS`, `ANOMALY_DETECTION_AUTO`.

---

## ۰ — نقشهٔ فاز

| بخش | موضوع | اندازه |
|---|---|---|
| الف | Planner چندمرحله‌ای (زنجیره‌ای) | متوسط–بزرگ |
| ب | حافظه مکالمه پیشرفته | متوسط |
| ج | پیشنهادهای هوشمند (Smart Suggestions) | کوچک–متوسط |
| د | کشف خودکار anomaly | متوسط |
| هـ | Planner با دانش دامنه (Domain Knowledge) | متوسط |
| و | تست و اعتبارسنجی | متوسط |

---

## ۱ — انگیزه و دامنه

### وضعیت پس از فاز ۱۹
- ۸۰+ متریک فعال، ۲۴۶ golden case ✅
- Planner تک‌مرحله‌ای: یک MetricPlan per request ✅
- Drill-down مکالمه‌ای (فاز ۱۴) ✅
- حافظه گفتگو: `lastMetricPlan` ✅
- کاربر نمی‌تواند سؤال ترکیبی پیچیده بپرسد ❌
- برنامه پیشنهاد سؤال بعدی نمی‌دهد ❌
- ناهنجاری‌ها به‌صورت خودکار کشف نمی‌شوند ❌

### هدف
- Planner بتواند زنجیره‌ای از متریک‌ها را اجرا کند (مثلاً: فروش → حاشیه سود → مقایسه)
- حافظه مکالمه چندسطحی: ارجاع به پاسخ‌های ۳ پیام قبلی
- بعد از هر پاسخ، ۳ سؤال مرتبط پیشنهاد شود
- کشف خودکار anomaly در داده‌ها و اطلاع کاربر

---

## بخش الف — Planner چندمرحله‌ای

### S20.1 — MultiStepPlan schema

- [ ] **S20.1** schema جدید `MultiStepPlan` در `types.ts`:
  ```typescript
  interface MultiStepPlan {
    steps: MetricPlan[]
    combineStrategy?: 'compare' | 'cascade' | 'explain'
    // cascade: خروجی step N ورودی step N+1
    // compare: خروجی‌ها در کنار هم مقایسه شوند
    // explain: step اول عدد، step دوم توضیح
  }
  ```
  - **معیار:** Zod schema. `typecheck:node` تمیز.

### S20.2 — Planner few-shot برای multi-step

- [ ] **S20.2** نمونه‌های جدید در `planner.ts`:
  1. «فروش امسال چقدره و نسبت به پارسال چند درصد تغییر کرده؟» → ۲ step: (1) total_revenue امسال, (2) growth_rate
  2. «ترازنامه بگو و بعد حاشیه سود رو هم محاسبه کن» → ۲ step: (1) balance_sheet, (2) net_margin
  3. «پرفروش‌ترین مشتری رو پیدا کن و بعد گردش حسابش رو نشون بده» → ۲ step: (1) sales_by_customer topN=1, (2) party_turnover filter
  - **معیار:** Planner برای سؤال ۱ یک `MultiStepPlan` با ۲ step تولید کند. `typecheck:node` تمیز.

### S20.3 — Engine.run برای MultiStepPlan

- [ ] **S20.3** در `index.ts` `engine.run()` پشتیبانی از `MultiStepPlan`:
  - **cascade:** خروجی step N (rows) به‌عنوان filter برای step N+1
  - **compare:** هر step جدا اجرا، نتایج در یک جدول مقایسه‌ای
  - **explain:** step اول اجرا، اعداد به step دوم (explainer) پاس داده شود
  - **timeout:** مجموع timeout همه step‌ها نباید از ۶۰s تجاوز کند
  - **معیار:** `MultiStepPlan` با ۲ step cascade درست اجرا شود. `typecheck:node` تمیز.

### S20.4 — Explainer برای multi-step results

- [ ] **S20.4** explainer مدل بتواند نتایج چند step را در یک پاسخ منسجم توضیح دهد:
  - **منطق:** نتایج همه step‌ها در context مدل قرار گیرد، مدل یک پاسخ فارسی منسجم بنویسد
  - **نکته:** هر step باید evidence خودش را داشته باشد
  - **معیار:** پاسخ نهایی شامل اعداد از هر دو step باشد. `typecheck:node` تمیز.

---

## بخش ب — حافظه مکالمه پیشرفته

### S20.5 — ConversationMemory v2

- [ ] **S20.5** ارتقاء `ConversationMemoryState` در `conversationMemory.ts`:
  ```typescript
  interface ConversationMemoryState {
    // موجود
    lastMetricPlan: MetricPlan | null
    lastResult: MetricResult | null
    // جدید
    history: ConversationTurn[]  // آخرین ۵ تبادل
    contextEntities: {
      years: number[]      // سال‌های ذکرشده در مکالمه
      accounts: string[]   // حساب‌های ذکرشده
      parties: string[]    // طرف‌حساب‌های ذکرشده
    }
  }

  interface ConversationTurn {
    userMessage: string
    plan: MetricPlan | MultiStepPlan
    resultSummary: string  // خلاصه عددی نتیجه
    timestamp: number
  }
  ```
  - **معیار:** `typecheck:node` تمیز. history با ۵ turn ذخیره شود.

### S20.6 — ارجاع به پاسخ‌های قبلی

- [ ] **S20.6** Planner بتواند به پاسخ‌های قبلی ارجاع دهد:
  - **نمونه:** کاربر: «فروش ۱۴۰۲ چقدره؟» → پاسخ: ۶۴ میلیارد. کاربر: «نسبت به پارسال چطور؟» → Planner باید بفهمد «پارسال» = ۱۴۰۱ و «نسبت به» = مقایسه با عدد قبلی
  - **منطق:** در planner prompt، history و contextEntities به مدل داده شود
  - **معیار:** سؤال «نسبت به پارسال چطور؟» بعد از سؤال فروش، درست تفسیر شود. `typecheck:node` تمیز.

---

## بخش ج — پیشنهادهای هوشمند

### S20.7 — Smart Suggestions engine

- [ ] **S20.7** بعد از هر پاسخ، ۳ سؤال مرتبط پیشنهاد شود:
  - **محل:** `src/main/services/financialEngine/smartSuggestions.ts`
  - **منطق:**
    1. بر اساس metricId اجراشده، سؤال‌های مرتبط پیشنهاد شود
    2. بر اساس contextEntities (سال‌ها، حساب‌ها)، سؤال‌های drill-down
    3. بر اساس anomaly detection (بخش د)، اگر ناهنجاری کشف شد، پیشنهاد بررسی
  - **نمونه:**
    - بعد از «فروش ۱۴۰۲»: «مقایسه فروش ۱۴۰۲ و ۱۴۰۳»، «پرفروش‌ترین مشتری ۱۴۰۲»، «حاشیه سود ۱۴۰۲»
    - بعد از «ترازنامه»: «نسبت جاری چقدر است؟»، «تحلیل سنی دریافتنی‌ها»، «صورت سود و زیان»
  - **خروجی:** `Suggestion[]` = `{ text: string, plan?: MetricPlan }`
  - **معیار:** بعد از total_revenue، ۳ پیشنهاد مرتبط تولید شود. `typecheck:node` تمیز.

### S20.8 — نمایش پیشنهادها در UI

- [ ] **S20.8** در renderer، پیشنهادها به‌صورت دکمه‌های قابل کلیک نمایش داده شود:
  - **محل:** `src/renderer/index.html`
  - **استایل:** chipهای کوچک زیر پاسخ، با آیکون 💡
  - **رفتار:** کلیک → ارسال متن پیشنهاد به‌عنوان پیام جدید
  - **معیار:** ۳ chip زیر هر پاسخ نمایش داده شود. کلیک → پیام جدید. `typecheck:node` تمیز.

---

## بخش د — کشف خودکار anomaly

### S20.9 — Anomaly Detection Service

- [ ] **S20.9** سرویس `AnomalyDetector` در `src/main/services/financialEngine/anomalyDetector.ts`:
  - **منطق:** بعد از هر کوئری، داده‌ها بررسی شود برای:
    1. **اختلاف بزرگ سال‌به‌سال:** تغییر > ۵۰٪ نسبت به سال قبل
    2. **اختلاف مانده:** مانده صفر با تعداد سند زیاد، یا مانده بزرگ با تعداد سند کم
    3. **سند غیرعادی:** سند با مبلغ بسیار بزرگتر از میانگین (> ۳ انحراف معیار)
    4. **حساب بدون گردش:** حساب با مانده ولی بدون سند در دوره
  - **خروجی:** `Anomaly[]` = `{ type, severity, description, metricId, data }`
  - **معیار:** داده با تغییر ۸۰٪ → anomaly با severity=high. `typecheck:node` تمیز.

### S20.10 — نمایش anomaly در پاسخ

- [ ] **S20.10** اگر anomaly کشف شد، در پاسخ به کاربر اطلاع داده شود:
  - **منطق:** در explainer prompt، anomaly‌ها اضافه شوند → مدل در پاسخ اشاره کند
  - **نمونه:** «فروش ۱۴۰۲: ۶۴ میلیارد. ⚠️ نکته: فروش ۱۴۰۳ کاهش ۱۱٪ داشته که قابل توجه است.»
  - **UI:** badge هشدار با رنگ زرد/قرمز بر اساس severity
  - **معیار:** پاسخ شامل اشاره به anomaly باشد. `typecheck:node` تمیز.

---

## بخش هـ — Planner با دانش دامنه

### S20.11 — Domain Knowledge injection

- [ ] **S20.11** planner prompt دانش حسابداری پایه را شامل شود:
  - **محل:** `src/main/services/financialEngine/planner.ts` — system prompt
  - **دانش:**
    - تعریف صورت‌های مالی (ترازنامه، سود و زیان، جریان وجوه نقد)
    - تعریف نسبت‌های مالی (ROE، ROA، current_ratio و غیره)
    - ترجمه اصطلاحات فارسی به انگلیسی مالی (حاشیه سود = margin، گردش = turnover)
    - قوانین مالیاتی ایران (VAT ۹٪، معافیت‌ها)
  - **نکته:** این دانش در system prompt ثابت باشد، نه per-request
  - **معیار:** Planner برای «نسبت جاری» درست metricId تولید کند. `typecheck:node` تمیز.

### S20.12 — Clarify هوشمند پیشرفته

- [ ] **S20.12** ارتقاء clarify با پیشنهادهای مبتنی بر دانش دامنه:
  - **نمونه:** کاربر: «سود چقدره؟» → clarify: «کدام سود؟ ۱) سود خالص ۲) سود عملیاتی ۳) سود ناخالص»
  - **منطق:** اگر metricId مبهم است، ۳ گزینه concrete با MetricPlan پیش‌فرض ارائه شود
  - **معیار:** سؤال مبهم «سود» → ۳ گزینه با plan. `typecheck:node` تمیز.

---

## بخش و — تست و اعتبارسنجی

### S20.13 — Unit tests

- [ ] **S20.13** unit tests جدید در `tests/unit/`:
  1. MultiStepPlan parse و validation
  2. cascade: خروجی step 1 به filter step 2
  3. compare: نتایج در جدول مقایسه‌ای
  4. ConversationMemory v2: history با ۵ turn
  5. ارجاع به «پارسال» از history
  6. SmartSuggestions: ۳ پیشنهاد بعد از total_revenue
  7. AnomalyDetector: تغییر ۸۰٪ → severity=high
  8. AnomalyDetector: سند با مبلغ ۳σ → anomaly
  9. Domain Knowledge: «نسبت جاری» → درست metricId
  10. Clarify: «سود» → ۳ گزینه
  - **معیار:** ۱۰ تست pass. `typecheck:node` تمیز.

### S20.14 — Golden cases

- [ ] **S20.14** golden cases جدید:
  1. `s20-multi-step-sales-growth` — «فروش امسال و نسبت به پارسال چند درصد تغییر کرده؟»
  2. `s20-multi-step-balance-margin` — «ترازنامه بگو و حاشیه سود رو هم محاسبه کن»
  3. `s20-multi-step-top-customer-turnover` — «پرفروش‌ترین مشتری و گردش حسابش»
  4. `s20-conversation-ref-last-year` — مکالمه ۲ تبادل: فروش → «نسبت به پارسال»
  5. `s20-suggestion-after-revenue` — بررسی پیشنهادها بعد از پاسخ فروش
  6. `s20-anomaly-sales-drop` — بررسی anomaly در کاهش فروش
  7. `s20-clarify-profit-ambiguous` — «سود چقدره؟» → clarify
  - **مجموع:** ۷ golden case جدید
  - **معیار:** eval سبز. `typecheck:node` تمیز.

### S20.15 — Full Gate

- [ ] **S20.15** `typecheck:node` + `npm test` + `eval:metrics`:
  - **معیار:** ۰ خطای typecheck. تمام test pass. eval ۲۵۳/۲۵۳ (۲۴۶ + ۷).

### S20.16 — Build + asar-grep

- [ ] **S20.16** build + asar-grep:
  - **مارکرها:** `MULTI_STEP_PLANNER`, `CONVERSATION_MEMORY_V2`, `SMART_SUGGESTIONS`, `ANOMALY_DETECTION_AUTO`
  - **معیار:** build موفق. مارکرها در asar.

### S20.17 — Field test

- [ ] **S20.17** تست میدانی:
  - ۸ پرسش (multi-step، conversation ref، suggestion، anomaly)
  - **معیار:** ۸/۸ موفق.

### S20.18 — شاهد S20

- [ ] **S20.18** پر شدن بخش شاهد.

### S20.19 — به‌روزرسانی OVERVIEW

- [ ] **S20.19** فاز ۲۰ در OVERVIEW اضافه شود.

---

## شاهد S20
```
فاز ۲۰ — Planner هوشمند و مکالمه‌ای
تاریخ: [پس از تکمیل پر شود]

S20.1-S20.4 — MultiStepPlan:
  - schema: MultiStepPlan با steps[], combineStrategy
  - cascade/compare/explain
  - فایل: types.ts, index.ts, planner.ts

S20.5-S20.6 — ConversationMemory v2:
  - history: ۵ turn, contextEntities
  - ارجاع به «پارسال» از history
  - فایل: conversationMemory.ts, planner.ts

S20.7-S20.8 — Smart Suggestions:
  - ۳ پیشنهاد بعد از هر پاسخ
  - نمایش در UI به‌صورت chip
  - فایل: smartSuggestions.ts, index.html

S20.9-S20.10 — Anomaly Detection:
  - اختلاف سالانه >۵۰٪, سند ۳σ, حساب بدون گردش
  - نمایش در پاسخ با badge
  - فایل: anomalyDetector.ts

S20.11-S20.12 — Domain Knowledge:
  - دانش حسابداری در system prompt
  - Clarify هوشمند با ۳ گزینه concrete

S20.15 — Full Gate:
  - typecheck:node: [تعداد] errors
  - unit tests: [تعداد] pass
  - eval:metrics: [تعداد]/[تعداد] (X%)

S20.17 — Field test:
  - [تعداد]/[تعداد] OK
```
