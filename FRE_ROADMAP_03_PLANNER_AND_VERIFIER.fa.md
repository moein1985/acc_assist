# FRE Roadmap 03 — فاز ۴ و ۵: Planner ساختاریافته و Verifier/Critic
### مدل به‌عنوان برنامه‌ریزِ محدود + لایهٔ تأییدِ پس از اجرا

> پیش‌نیاز: فاز ۲–۳ کامل و سبز؛ engine در `shadow` با legacy منطبق. این فاز دو کار می‌کند: (الف) Plannerِ مدلی که به‌جای Planner موقتِ قطعی می‌نشیند و سؤال‌های آزادتر را پوشش می‌دهد؛ (ب) Verifier/Critic که قبل از تحویلِ هر عدد، آن را تأیید می‌کند. اصل: مدل فقط `MetricPlan`ِ **معتبر** تولید می‌کند — هرگز SQL، هرگز عدد.

**مارکرهای asar این فاز:** `PLANNER_STRUCTURED`, `verifyResult`, `metricPlanSchema`.

---

## بخش الف — Planner ساختاریافته (فاز ۴)

### اصل طراحی
Planner یک مسئلهٔ **تولیدِ محدود (constrained generation)** است، نه تولیدِ آزاد. مدل باید **فقط** یک JSONِ منطبق با `metricPlanSchema` بدهد. این کار را حتی برای مدلِ ضعیف امن می‌کند، و correctness را از قدرتِ مدل جدا نگه می‌دارد.

### P4.1 — پرامپتِ Planner

- [ ] **P4.1** در `financialEngine/planner.ts`، تابعِ `buildPlannerPrompt(userPrompt, catalogSummary)` بساز که به مدل می‌دهد:
  - فهرستِ متریک‌های موجود (id + titleFa + grainSupported + توضیحِ کوتاه) از کاتالوگ.
  - تعریفِ دقیقِ شِمای خروجی (`MetricPlan`) + چند مثالِ few-shot فارسی → JSON.
  - قاعدهٔ سخت: «اگر سؤال به هیچ متریکی نمی‌خورد یا مبهم است، `confidence` پایین بده و `metricId` را null/نامشخص بگذار؛ هرگز SQL ننویس و عدد حدس نزن.»
  - خروجی را در حالتِ JSON-only/structured-output بخواه (اگر provider پشتیبانی می‌کند؛ وگرنه fence‌گذاری + parse مقاوم).

### P4.2 — تجزیه و اعتبارسنجیِ خروجی

- [ ] **P4.2** `parsePlannerOutput(raw) → MetricPlan | { error }`:
  - JSON را استخراج کن (مقاوم به متنِ اضافه).
  - با `metricPlanSchema` (Zod) اعتبارسنجی کن. خطای schema → plan نامعتبر.
  - بررسی‌های معناییِ اضافه: `metricId` در کاتالوگ باشد؛ `grain` در `grainSupported` متریک باشد؛ مقادیرِ سال 4-رقمی معتبر باشند؛ `comparison` فقط با grain سازگار.
  - **هرگز** خروجیِ نامعتبر را اجرا نکن.

### P4.3 — سیاستِ تصمیمِ Planner

- [ ] **P4.3** منطقِ تصمیم:
  1. اول `routeToMetric` قطعی (first-pass) را اجرا کن.
  2. اگر اطمینانِ router بالا بود و سؤال ساده بود (تک‌متریک، سال صریح) → از `buildDeterministicPlan` استفاده کن (سریع، بدونِ هزینهٔ مدل).
  3. در غیر این صورت → Plannerِ مدلی.
  4. اگر `plan.confidence < آستانه` یا اعتبارسنجی شکست → مسیرِ **Clarify** (سؤالِ شفاف‌سازی از کاربر) — همان گاردِ clarification موجود، اما حالا با پیشنهادِ «آیا منظورت متریکِ X بود؟».
  5. اگر هیچ متریکی نخورد → degrade به مسیرِ کاوشِ مدلِ legacy، با **برچسبِ صریحِ کم‌اعتماد** در پاسخ.

### P4.4 — تست‌های Planner (با مدلِ stub)

- [ ] **P4.4** `tests/unit/financialEnginePlanner.test.ts` با `QueueGeminiStub` (الگوی موجود):
  - ورودیِ فارسی → مدلِ stub یک JSON می‌دهد → assert که `MetricPlan`ِ درست parse و validate می‌شود.
  - JSONِ خراب/نامعتبر → assert که رد می‌شود و به Clarify/Null می‌رود (نه crash، نه اجرا).
  - سؤالِ بی‌ربط → assert که `confidence` پایین و مسیرِ degrade.

---

## بخش ب — Verifier / Critic (فاز ۵)

### اصل طراحی
هیچ عددی بدونِ عبور از Verifier به Explainer نمی‌رسد. Verifier سه چیز را بررسی می‌کند: (۱) آشتیِ ریاضی، (۲) تطابقِ intent سؤال با پاسخ، (۳) قراردادِ evidence.

### V5.1 — قواعدِ آشتی (Reconciliation)

- [ ] **V5.1** در `financialEngine/verifier.ts`، `verifyResult(result, plan, def) → EngineVerdict`. قواعدِ `def.reconciliations` را اجرا کن:
  - `balanced_to_zero`: برای ترازنامه‌ها، مجموعِ بدهکار/بستانکار باید در `toleranceAbs` نزدیکِ صفر باشد.
  - `sum_of_parts_equals_total`: اگر grain تفکیکی است، جمعِ اجزا = کلِ مستقل (یک کوئریِ کنترلی).
  - `non_negative`: مثلاً «خرید» نباید منفی باشد (به‌جز مرجوعی).
  - `custom`: قلابِ توسعه.
  - هر شکست → `verdict.ok=false` + دلیل؛ پاسخ به کاربر باید با هشدارِ صریح یا رد همراه شود، نه عددِ مشکوک.

### V5.2 — تطابقِ intent

- [ ] **V5.2** بررسیِ هم‌راستاییِ intentِ سؤال و intentِ پاسخ (بازاستفاده از گاردِ موجودِ ارکستریتر). اگر سؤال «خرید» بود ولی plan/نتیجه «فروش» شد → رد. این گارد را به سطحِ `MetricPlan` ببر (مقایسهٔ `metricId` با routerِ مستقل).

### V5.3 — ادغامِ Evidence Contract

- [ ] **V5.3** نتیجهٔ engine را به ساختارِ `ToolEvidence`/`ExecutionTrace` موجود نگاشت کن و از `evaluateEvidence` استفاده کن:
  - `POSITIVE_DATA`: ردیف با مقدارِ غیرnull → پاسخِ عددی مجاز.
  - `VALID_EMPTY`: کوئریِ سالم اما ۰ ردیف/NULL → پیامِ صادقانهٔ «رکوردی ثبت نشده» (نه «Cannot answer reliably»). این همان رفعِ FiscalYearRef 0-row است؛ حفظ شود.
  - `INSUFFICIENT`: کوئری اجرا/موفق نشد → رد یا fallback.
- [ ] **V5.4** **bypassِ مسیرِ deterministic:** پاسخِ engine (کدساخت، scope-validated، self-evidenced) نباید توسطِ heuristicهای strict-quantِ مدل‌محور به رد تبدیل شود. همان `routeMode==='deterministic'` early-return در `responseContract.ts` برای پاسخ‌های engine هم اعمال شود.

### V5.5 — تست‌های Verifier

- [ ] **V5.5** `tests/unit/financialEngineVerifier.test.ts`:
  - تراز نامتوازن → `ok:false`.
  - intentِ ناهم‌خوان (خرید vs فروش) → رد.
  - نتیجهٔ ۰-ردیفِ سالم → `VALID_EMPTY` با پیامِ صادقانه (نه رد).
  - نتیجهٔ مثبتِ معتبر → عبور.

---

## بخش ج — Explainer

### X.1 — رندرِ پاسخ از اعدادِ تأییدشده

- [ ] **X5.6** Explainer فقط اعدادِ تأییدشده + plan را به نثرِ فارسی + بخشِ Evidence تبدیل می‌کند. دو حالت:
  - **قالبِ قطعی (پیش‌فرض):** برای پاسخ‌های ساده، markdown را **بدونِ مدل** بساز (مثل `composeSalesGrowthFallbackMarkdown` فعلی) — سریع، ارزان، صفرتوهم.
  - **قالبِ مدل‌محور (اختیاری):** فقط برای روایتِ غنی‌تر، اعدادِ تأییدشده را به مدل بده تا «توضیح» بنویسد، با قاعدهٔ سخت: «این اعداد قطعی‌اند؛ تغییرشان نده، عددِ نو نساز.» سپس یک گاردِ پس‌ازتولید که اعداد را با منبع چک کند.
- [ ] **X5.7** رفعِ نقصِ ظاهریِ شناخته‌شده: تکرارِ بولتِ «مسیر پاسخ» و پرانتزِ ناقصِ «(نوع KPI…)» در `annotateManagerUx` پاک‌سازی شود (یک‌بار، تمیز).

### X.2 — فعال‌سازیِ `engine` mode

- [ ] **X5.8** پس از سبزشدنِ Planner + Verifier + Explainer، در نقطهٔ تصمیم، حالتِ `engine` را سیم‌کشی کن: engine به کاربر سرویس می‌دهد؛ legacy فقط وقتی engine `null` داد (degrade). **هنوز پیش‌فرض را عوض نکن** — پیش‌فرض تا فاز ۶ (cutover) `legacy`/`shadow` می‌ماند.

---

## بخش د — دروازهٔ خروجِ فاز ۴–۵

- [ ] **X5.9** typecheck تمیز + تستِ کامل سبز (planner + verifier جدید).
- [ ] **X5.10** build + deploy + **asar-grep**: `PLANNER_STRUCTURED`, `verifyResult` پیدا شوند.
- [ ] **X5.11** field test در حالتِ `engine` روی محیطِ تست (نه پیش‌فرضِ کاربر): هر ۵ متریک عددِ درست + مسیرِ engine + Verdict سبز. گاردِ ایمنی («تعداد کارمندان») همچنان رد.
- [ ] **X5.12** ثبتِ شواهد در «شاهد X5».

**دروازهٔ خروج:** هر ۵ متریک در `engine` mode عددِ ground-truth را می‌دهند و Verifier سبز است؛ گاردِ ایمنی دست‌نخورده.

---

## شاهد X5
```
(خالی — هنگام اجرای X5.11 پر شود: متریک، مسیر=engine، عدد، verdict، requestId، خطِ final)
```

---

## نکاتِ ریسک

- **ریسکِ Planner:** خروجیِ غیر-JSON مدل. ضدِ آن: parseِ مقاوم + Zod + در شکست به Clarify، هرگز اجرا با planِ نامعتبر.
- **ریسکِ Explainer:** مدل عددِ تأییدشده را در روایت دستکاری کند. ضدِ آن: قالبِ قطعیِ پیش‌فرض + گاردِ پس‌ازتولید؛ قالبِ مدل‌محور اختیاری و کم‌اولویت.
- **هزینهٔ مدل:** برای سؤال‌های ساده اصلاً مدل صدا نزن (Planner قطعیِ first-pass). مدل فقط برای ابهام/سؤالِ آزاد.

> قدمِ بعدی: `FRE_ROADMAP_04_EVAL_DEPLOY_AND_CUTOVER.fa.md`.
