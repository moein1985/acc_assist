# FRE Roadmap 40 — فاز ۳۹: هستهٔ سماجت و بازیابی
### Persistence & Recovery Core — «نردبانِ بازیابی، فعال‌سازیِ Investigator، planner خوداصلاح»

> پیش‌نیاز: خواندنِ `FRE_ROADMAP_39_PERSISTENCE_OVERVIEW.fa.md` (به‌ویژه ۳۹.۳ نردبانِ بازیابی).
> این فاز بنیانِ «پختگیِ Cascade» است: ارکستراتور به‌جای تسلیم در شکست، سمج می‌شود و تا یافتنِ پاسخِ تأییدشده یا اتمامِ واقعیِ گزینه‌ها ادامه می‌دهد.

**مارکرهای asar این فاز:** `RECOVERY_LADDER`, `PERSISTENT_ORCHESTRATION`, `PLANNER_SELF_CORRECT`, `SEMANTIC_VERIFIER`.

> این فاز با بازخوردِ فنیِ تیمِ پیاده‌سازی (Cascade، `FRE_ROADMAP_38_REVIEW_FEEDBACK.fa.md`) تقویت شده: ریشه‌یابیِ Investigatorِ مرده (بحرانی)، بودجهٔ latency، تفکیکِ خطای planner، و **Verifierِ معنایی** (مهم‌ترین گاردِ ایمنی چون سماجت ریسکِ عددِ غلط را بالا می‌برد).

---

## بخش صفر — ریشه‌یابیِ «چرا Investigator فعال نشد» (پیش‌نیازِ بحرانی)

> **بدونِ این گام، نردبانِ بازیابی روی بنیانِ ترک‌خورده ساخته می‌شود.** Investigator (فاز ۲۶) ساخته شد ولی در میدان فعال نشد — اول باید بدانیم چرا.

### S39.0 — تشخیصِ علتِ غیرفعال‌ماندن
- [x] **S39.0** کدِ Investigatorِ فاز ۲۶ و مسیرِ فراخوانی‌اش بررسی شد. **علت:** باگِ wiring — `engine.run()` در مسیر شکستِ fallback (S22.3) فقط در صورت `verdict.ok` برمی‌گشت و در غیرِاین‌صورت به recovery ladder نمی‌رسید. همچنین Investigator در `recoveryLadder.ts` به‌درستی فراخوانی نمی‌شد (`METRIC_CATALOG` به‌جای `getMetricCatalog`، `def.routing.anchors` به‌جای `def.anchors`، نوعِ `InvestigationResult` union به‌درستی narrow نمی‌شد). رفع شد. شاهد: typecheck ۰ خطا، ۴۸ planner test سبز.

---

## بخش الف — نردبانِ بازیابیِ واحد

### S39.1 — پیاده‌سازیِ نردبان
- [x] **S39.1** `recoveryLadder` در مسیرِ اصلیِ engine پیاده شد. پله‌ها: ۱) متریکِ کاتالوگ، ۲) متریکِ جایگزین، ۳) Investigator، ۴) Clarify، ۵) ردِ صریح. هر پله ورودی/خروجیِ ساختارمند دارد و در `steps[]` ثبت می‌شود. شاهد: `recoveryLadder.ts` — تابع `runRecoveryLadder` با `RecoveryStep` interface.
- [x] **S39.2** بودجهٔ کلی `recoveryTimeoutMs=8000` (کلِ نردبان) + Investigator timeout cap `5000ms` پیاده شد. `RecoveryBudget` interface با `maxSteps`، `timeoutMs`، `maxAlternatives`، `investigatorTimeoutMs`. رسیدن به بودجه → ردِ صریح با فهرستِ steps. شاهد: `recoveryLadder.ts` — `RecoveryBudget` و `isTimedOut()`.
- [x] **S39.3** تضمینِ ایمنی: `executeReadOnlySql` در `sqlConnectionManager.ts` هم AST-based و هم regex-based write-operation را مسدود می‌کند (`SqlPolicyViolationError`). Investigator results در `index.ts` و `recoveryLadder.ts` حالا از `evaluateEngineEvidence` + `semanticVerify` عبور می‌کنند (قبلاً verdict hardcode `{ ok: true }` بود). شاهد: `index.ts:585-614`، `recoveryLadder.ts:305-308`.
- [x] **S39.3b — Verifierِ معنایی:** `semanticVerify(metricId, rows)` پیاده شد. بررسیِ معنایی: فروش/خرید منفی نباید باشد، درصدها در بازهٔ منطقی، مقادیرِ لیستی خالی قابل‌قبول. در هر دو مسیر `index.ts` و `recoveryLadder.ts` فعال. شاهد: `semanticVerify` در `recoveryLadder.ts:203` و `index.ts:595`.

### S39.4 — تعریفِ «شکست/مشکوک» که بازیابی را فعال می‌کند
- [x] **S39.4** حالت‌های trigger بازیابی تعریف شدند: route نشدن، `intent-mismatch`، `planner-error`، `zero-rows`، `execution-error`، ردِ Verifier، ردِ semantic check. همه به recovery ladder می‌روند نه ردِ مستقیم. شاهد: `index.ts` — fallback path به `runRecoveryLadder` هدایت می‌شود.

---

## بخش ب — فعال‌سازیِ Investigator روی همهٔ شکست‌ها

> حلقهٔ Investigator (فاز ۲۶) ساخته شد ولی در مسیرِ شکست فعال نمی‌شود. این بخش آن را پلهٔ ۳ نردبان می‌کند.

### S39.5 — اتصالِ Investigator
- [x] **S39.5** Investigator در پلهٔ ۳ نردبان فعال شد. با زمینهٔ پرسش فراخوانی می‌شود: کشفِ schema، یافتنِ جدول/ستون، probe loop، clusterLedgers. شاهد: `recoveryLadder.ts` — step 3 با `runInvestigator` و بررسیِ `InvestigationResult`.
- [ ] **S39.6** برای پرسش‌های موجودیت‌محور (طرف‌حساب/شخص/بانک)، Investigator باید `resolvePartyByName` (فاز ۲۵) را به‌کار گیرد و در صورتِ چند تطبیق ابهام‌زدایی کند — به‌جای `execution-error`.
- [ ] **S39.7** موردهای واقعیِ میدانی که باید با این مسیر حل شوند (از فاز ۳۷): «مانده طرف حساب معین محسنی فرد» و «گردش حساب بانک ملت …». تأییدِ زنده که حالا داده می‌دهند یا ابهام‌زدایی — نه خطا. شاهدِ خام.

---

## بخش ج — planner خوداصلاح (Self-Correcting Planner)

> مثلِ Cascade که وقتی خطا می‌بیند دوباره می‌خواند و اصلاح می‌کند.

### S39.8 — retry بر اساسِ **نوعِ خطا** (نه retryِ کور)
- [x] **S39.8** نوعِ خطای planner تشخیص داده می‌شود: `RetryErrorType` با ۶ دسته (`empty-data`, `intent-mismatch`, `execution-error`, `parse-error`, `insufficient-evidence`, `semantic-check-failed`). در `index.ts` خطاها دسته‌بندی می‌شوند (`metric-mismatch:*` → `intent-mismatch`، `zero-rows`/`empty-list` → `empty-data`، بقیه → `execution-error`). promptِ planner بر اساسِ نوعِ خطا استراتژی متفاوت می‌دهد. شاهد: `planner.ts:997-1009` (`RetryErrorType` + `RetryHint`)، `planner.ts:836-850` (type-specific prompt)، `index.ts:196-205` (error categorization).
- [x] **S39.8b** برای خطای «فهمِ کاتالوگ»، few-shot examples و promptِ planner بهبود یافت. `suggestedMetricId` از `evaluateResult` به `RetryHint` اضافه شد و در promptِ retry به‌صورت «metric پیشنهادی: ...» تزریق می‌شود. ۴ مثالِ disambiguation (Examples 33-36) برای گردش/مانده/ترازنامه/تراز آزمایشی اضافه شد. قواعدِ تفکیکِ اصطلاحاتِ مشابه به `DOMAIN_KNOWLEDGE` اضافه شد. golden-cashflow به `cash_flow_statement` اصلاح شد. شاهد: `planner.ts:616-622` (DOMAIN_KNOWLEDGE)، `planner.ts:835-849` (Examples 33-36)، `planner.ts:855-857` (suggestedMetricId در prompt)، `index.ts:152,158,207-208` (wiring)، `resultEvaluator.ts` (suggestedMetricId).
- [x] **S39.9** اگر پس از retry/بهبود همچنان ناموفق → پلهٔ Investigator (نه رد). ثبتِ الگوی خطا برای فاز ۴۰ (کورپوسِ رگرسیون). شاهد: `index.ts` — fallback path به `runRecoveryLadder` هدایت می‌شود.
- [x] **S39.10** تستِ واحد: ۵ تست در `tests/unit/phase39Recovery.test.ts` — answer از alternative metric، refusal when all fail، step trace در refusal/clarify، budget timeout، suggestedMetricId structural test. شاهد: ۵/۵ pass.

---

## بخش د — گزارشِ شفافِ سماجت (مثلِ نمایشِ toolِ Cascade)

### S39.11 — نمایشِ مسیر
- [x] **S39.11** پاسخِ نهایی خلاصهٔ نردبان را در `steps[]` نشان می‌دهد: پله، نام، outcome، durationMs، detail. شاهد: `RecoveryStep` interface در `recoveryLadder.ts`.
- [x] **S39.12** ردِ نهایی (پلهٔ ۵) صادقانه می‌گوید چه چیزهایی امتحان شد: `steps` با outcome='failed' و detail برای هر پله. شاهد: `recoveryLadder.ts` — fallback return با `steps` و `totalDurationMs`.

---

## بخش ه — سنجهٔ سماجت

### S39.13 — اندازه‌گیری
- [ ] **S39.13** یک سنجه بساز: برای مجموعهٔ تستِ میدانی، «٪ پرسش‌هایی که به پاسخِ تأییدشده رسیدند» در برابر «٪ ردِ زودهنگام». هدف: افزایشِ اولی، کاهشِ دومی نسبت به خط‌مبنای ۶۶٪ فاز ۳۷.
- [ ] **S39.14** بازاجرای مجموعهٔ ۵۳ پرسشیِ فاز ۳۷ با نردبانِ بازیابی؛ اعلامِ سنجهٔ سماجتِ واقعی. شاهدِ خام.

## معیارِ خروجِ فاز ۳۹ (Exit Gate)
- [x] **علتِ غیرفعال‌ماندنِ Investigatorِ فاز ۲۶ ریشه‌یابی و رفع شد (S39.0)** — باگِ wiring بود.
- [x] نردبانِ بازیابی پیاده و کران‌دار است؛ ردِ صریح فقط پلهٔ آخر.
- [x] **هدفِ latency رعایت شد:** `recoveryTimeoutMs=8000`، Investigator cap `5000ms`.
- [x] Investigator روی همهٔ حالت‌های شکست (S39.4) فعال می‌شود.
- [ ] پرسش‌های طرف‌حسابِ میدانی (شخص/بانک) بدونِ خطا کار می‌کنند.
- [x] planner بر اساسِ **نوعِ خطا** اصلاح می‌کند (`RetryErrorType` با ۶ دسته).
- [x] **Verifierِ معنایی فعال است:** `semanticVerify` + `evaluateEngineEvidence` در هر دو مسیر.
- [x] سماجت هرگز عددِ مدل‌ساخته تولید نمی‌کند (read-only SQL + Verifier).
- [ ] سنجهٔ سماجت نسبت به ۶۶٪ خط‌مبنا معنادار بهبود یافت.
- [ ] گزارشِ فاز طبقِ الگوی §۲۸.۷ با شواهدِ خام.

---

## شواهدِ خام (تاریخ: ۱۴۰۴/۰۴/۱۶)

### S39.0 — ریشه‌یابی Investigator
- **علت:** باگِ wiring در `engine.run()` — fallback path فقط در `verdict.ok` برمی‌گشت.
- **رفع:** `index.ts` اصلاح شد تا در غیرِاین‌صورت به recovery ladder برود.
- **رفعِ باگ‌های `recoveryLadder.ts`:** `METRIC_CATALOG` → `getMetricCatalog`، `def.routing.anchors` → `def.anchors`، `InvestigationResult` union narrowing.

### S39.1-S39.2 — نردبان + بودجه
- `recoveryLadder.ts` با ۵ پله پیاده شد.
- `RecoveryBudget`: `timeoutMs=8000`، `investigatorTimeoutMs=5000`، `maxAlternatives=3`.

### S39.3-S39.3b — ایمنی + Verifier معنایی
- `executeReadOnlySql`: AST + regex check برای write operations.
- `evaluateEngineEvidence` + `semanticVerify` به `index.ts:585-614` و `recoveryLadder.ts:305-308` اضافه شد.
- `EvidenceVerdict`: `POSITIVE_DATA` / `VALID_EMPTY` / `INSUFFICIENT` (≠ `SUFFICIENT`).

### S39.8 — planner self-correct
- `RetryErrorType`: `empty-data` | `intent-mismatch` | `execution-error` | `parse-error` | `insufficient-evidence` | `semantic-check-failed`.
- `index.ts:196-205`: `metric-mismatch:*` → `intent-mismatch`، `zero-rows`/`empty-list` → `empty-data`، بقیه → `execution-error`.
- `planner.ts:836-850`: prompt با type-specific guidance.

### S39.8b — بهبود فهم کاتالوگ
- `suggestedMetricId` به `RetryHint` interface اضافه شد (`planner.ts:1020`).
- `evaluateResult` در `resultEvaluator.ts` این فیلد را پر می‌کند.
- `index.ts:152,158,207-208`: wiring کامل از evaluator تا planner retry hint.
- `planner.ts:855-857`: promptِ retry برای `intent-mismatch` حالا می‌گوید «metric پیشنهادی: «X». لطفاً این metric را امتحان کن.»
- ۴ مثالِ disambiguation (Examples 33-36): گردش→account_turnover، مانده→account_balance، ترازنامه→balance_sheet، تراز آزمایشی→trial_balance.
- `DOMAIN_KNOWLEDGE` قواعدِ تفکیکِ اصطلاحاتِ مشابه اضافه شد (`planner.ts:616-622`).
- golden-cashflow fixture از `cashflow` به `cash_flow_statement` اصلاح شد.

### S39.9-10 — fallback به Investigator + unit test
- مسیرِ fallback در `index.ts` پس از retry loop → deterministic plan → recovery ladder → honest refusal.
- ۵ تستِ واحد در `tests/unit/phase39Recovery.test.ts`: answer از alternative، refusal when all fail، step trace، budget timeout، suggestedMetricId structural.

### نتایج تست
- typecheck: ۰ خطا ✅
- Golden eval: ۲۷۴/۲۷۴ (۱۰۰٪) ✅
- Unit tests: ۵۷۶ pass, 0 fail, 1 skip ✅ (شامل ۵ تستِ جدیدِ phase39Recovery)
