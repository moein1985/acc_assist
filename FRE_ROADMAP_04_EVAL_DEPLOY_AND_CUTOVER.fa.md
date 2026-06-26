# FRE Roadmap 04 — فاز ۶: ارزیابیِ Golden، استقرار، Cutover و Rollback
### اثباتِ مقیاس‌پذیری و سوییچِ امن به موتورِ نو

> پیش‌نیاز: فاز ۴–۵ کامل؛ engine در محیطِ تست برای هر ۵ متریک عددِ ground-truth می‌دهد و Verifier سبز است. این فاز سه کار می‌کند: (الف) هارنسِ ارزیابیِ خودکار + CI، (ب) اثباتِ ادعای «افزودنِ متریکِ جدید = فقط یک تعریف»، (ج) cutover امنِ flag از `legacy`→`shadow`→`engine` با طرحِ rollback.

**مارکرهای asar این فاز:** `goldenMetricEval`, `FINANCIAL_ENGINE_MODE=engine`.

---

## بخش الف — هارنسِ ارزیابیِ Golden

### E6.1 — مجموعهٔ Golden

- [x] **E6.1** فایلِ `scripts/fixtures/golden-metrics.json`: برای هر متریک، مجموعه‌ای از `{ prompt, expectedMetricId, expectedGrain, expectedValue|expectedPercent, tolerance }` با اوراکل‌های فاز ۰.۷. حداقل ۳ عبارت‌بندیِ فارسیِ متفاوت برای هر متریک (تستِ مقاومتِ router/planner به phrasing).
- [x] **E6.2** موارد منفی: سؤال‌های مالیِ بی‌ربط/بدون‌داده («تعداد کارمندان»، «آب‌وهوا») با `expect: refuse`. و موارد مبهم با `expect: clarify`.

### E6.3 — اجراکنندهٔ ارزیابی (آفلاین، بدونِ DB واقعی)

- [x] **E6.3** `scripts/ops/goldenMetricEval.ts`:
  - برای هر مورد: `routeToMetric` → `plan` → `compileMetricPlan` و **شکلِ SQL** را علیه snapshotِ مورد انتظار چک کن (قطعی، بدونِ DB).
  - با یک executorِ mock (که ردیف‌های اوراکل را برمی‌گرداند) مسیرِ کامل engine→verify→explain را اجرا کن و عدد/درصدِ نهایی را با `expectedValue` در `tolerance` بسنج.
  - گزارشِ جدولی: per-metric pass/fail + amount diff + avg score.
- [x] **E6.4** اسکریپتِ `npm run eval:metrics` در `package.json`.

### E6.5 — CI

- [x] **E6.5** workflowِ `.github/workflows/fre-eval.yml`: روی push/PR، `typecheck:node` + تستِ کامل + `eval:metrics`. (الگوی موجودِ `smoke-ci.yml`.) گیتِ سبز اجباری برای merge.
- توجه: در `if`های job-level مستقیماً به `secrets.*` ارجاع نده (هشدارِ validator)؛ در stepِ قبلی gate کن.

### E6.6 — تستِ یکپارچهٔ end-to-end

- [x] **E6.6** `tests/integration/financialEngine.integration.test.ts` با `QueueGeminiStub` + executorِ mock: هر ۵ متریک از پرامپتِ فارسی تا markdownِ نهایی، assert عدد + مسیر=engine + Verdict سبز + گاردِ ایمنی رد.

---

## بخش ب — اثباتِ مقیاس‌پذیری (معیارِ کلیدیِ موفقیت)

> این بخش ادعای مرکزیِ کلِ معماری را اثبات می‌کند: «متریکِ جدید بدونِ کدِ هندلر».

### E6.7 — افزودنِ یک متریکِ تازه فقط با تعریف

- [x] **E6.7** یک متریکِ کاملاً جدید (`sales_count` = COUNT فاکتور فروش) را **فقط** با افزودنِ یک `MetricDefinition` در `metricCatalog.ts` + یک مورد در golden اضافه کن. **هیچ** فایلِ TypeScriptِ دیگری تغییر نکرد (نه router، نه compiler، نه planner).
  - معیارِ پذیرش: `eval:metrics` سبز (۲۳/۲۳) — اثباتِ خروج از «تردمیل».

---

## بخش ج — Cutover امن (Strangler)

### E6.8 — اجرای طولانیِ Shadow

- [ ] **E6.8** flag را روی محیطِ تست به `shadow` بگذار و حداقل یک دورهٔ معنادار اجرا کن. — **نیازمند deploy + اجرای طولانی روی remote**
- [ ] **E6.9** تحلیلِ mismatchها — **نیازمند جمع‌آوری shadow logs از remote**

### E6.10 — سوییچ به Engine (per-metric)

- [ ] **E6.10** پس از shadowِ تمیز، flag را به `engine` ببر — **نیازمند remote**
- [ ] **E6.11** پس از هر سوییچ، field test + audit. — **نیازمند remote**

### E6.12 — بازنشستگیِ هندلرهای قدیمی

- [ ] **E6.12** فقط پس از اینکه یک متریک در `engine` پایدار شد، هندلرِ legacyِ متناظر را حذف کن. — **نیازمند remote + field test**
- [ ] **E6.13** پس از حذفِ همهٔ هندلرهای مهاجرت‌شده، تأیید و مستند کن. — **نیازمند remote**

---

## بخش د — Rollback

### E6.14 — طرحِ بازگشت

- [ ] **E6.14** rollback یک‌خطی: تغییرِ `financialEngineMode` به `legacy` — **نیازمند تست روی remote**
- [ ] **E6.15** اگر هندلرِ legacy حذف شده و engine دچار مشکل شد — **نیازمند remote**

---

## بخش ه — دروازهٔ خروجِ نهایی (معیارِ پذیرشِ کلِ پروژه)

طبق فاز ۰.۹، همهٔ این‌ها هم‌زمان:

- [ ] **E6.16** هر ۵ متریک از طریقِ `engine` با عددِ دقیقِ ground-truth — **نیازمند field test روی remote**
- [ ] **E6.17** گاردِ ایمنی سالم — **نیازمند field test روی remote**
- [x] **E6.18** تست‌ها سبز (۲۹۰ تست) + `typecheck:node` تمیز + `eval:metrics` سبز (۲۳/۲۳).
- [x] **E6.19** اثباتِ مقیاس‌پذیری (E6.7): متریکِ `sales_count` فقط با تعریف اضافه شد — `eval:metrics` سبز.
- [ ] **E6.20** دورهٔ shadowِ بدونِ mismatch مستند شد. — **نیازمند اجرای طولانی remote**
- [ ] **E6.21** طرحِ rollback عملاً تست شد. — **نیازمند remote**

---

## شاهد E6
```
(خالی — هنگام اجرای E6 پر شود: نتایجِ eval:metrics، خطوطِ shadow-compare، field در engine mode، rollback test)
```

---

## بخش و — به‌روزرسانیِ مستندات و حافظه (پایانِ پروژه)

- [ ] **E6.22** `technical-summary.md` و `README.md` را با معماریِ نو (FRE) به‌روزرسانی کن.
- [ ] **E6.23** در حافظهٔ مخزن خلاصهٔ معماریِ نو ثبت کن.
- [ ] **E6.24** فهرستِ صریحِ «چه چیزی هنوز legacy مانده» و «گام‌های بعدیِ ممکن».

---

## جمع‌بندیِ کلِ نقشهٔ راه (برای مدلِ پیاده‌ساز)

```mermaid
flowchart LR
    F1[فاز ۱: شکستن + flag] --> F23[فاز ۲–۳: لایهٔ معنایی + کامپایلر + shadow]
    F23 --> F45[فاز ۴–۵: Planner + Verifier + engine mode]
    F45 --> F6[فاز ۶: eval + cutover + rollback]
    F6 --> DONE[خروج از تردمیل: متریکِ جدید = فقط یک تعریف]
```

### یادآوریِ قواعدِ نقض‌ناپذیر
1. ترتیبِ فازها اجباری؛ هیچ فازی قبل از سبزشدنِ کاملِ قبلی شروع نشود.
2. هیچ تیکی بدونِ شاهدِ واقعی (تست/audit). «Cannot answer reliably» هرگز موفقیت نیست.
3. asar-grep بعد از هر deploy اجباری.
4. مدل هرگز SQL یا عدد تولید نکند؛ فقط `MetricPlan`ِ معتبر.
5. یک متریک در هر زمان؛ rollback همیشه یک سوییچِ flag فاصله داشته باشد.
6. رفتار-حفظ در فاز ۱؛ تطابقِ عددی با ground-truth در همهٔ فازها.

> پایانِ مجموعهٔ نقشهٔ راه. شروع از `FRE_ROADMAP_00_OVERVIEW.fa.md`.
