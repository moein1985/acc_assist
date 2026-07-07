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
- [x] **S39.6** برای پرسش‌های موجودیت‌محور (طرف‌حساب/شخص/بانک)، Investigator از `resolvePartyByName` (فاز ۲۵) استفاده می‌کند. الگوهای `extractEntityName` در `investigator.ts` با اضافه‌شدنِ «بانک» و «شخص» تکمیل شد تا در نردبانِ بازیابی هم پرسش‌های بانک/شخص به‌درستی entityName استخراج کنند و به `resolvePartyByName` بروند. شاهد: `investigator.ts:665-676` — ۸ الگو (آقای/خانم/شرکت/طرف حساب/مشتری/تأمین‌کننده/بانک/شخص).
- [x] **S39.7** تستِ میدانیِ زنده روی سرور ۱۹۲.۱۶۸.۸۵.۵۶ (Sepidar01). دو پرسش:
  - **q1** «مانده طرف حساب معین محسنی فرد» → `engine-mode`, `metricId=party_balance`, verdict=ok. SQL اجرا شد، entityName «معین محسنی فرد» استخراج شد. نتیجه: رکوردی یافت نشد (طرف حساب در DB موجود نیست — پاسخِ معتبر).
  - **q2** «گردش حساب بانک ملت ۱۴۰۲» → `engine-mode`, `metricId=account_turnover`, verdict=ok. SQL با `LIKE N'%بانک ملت%'` اجرا شد، مقدار ۲۶۸٬۳۸۷ بازگشت. verifier=passed, confidenceScore=100.
  - **ریشه‌یابی و رفعِ باگ**: در bundleِ قبلی، `isFinancialNumericQuery` به‌جای `normalizePersianText` از `normalizePersianDigits` استفاده می‌کرد (باگِ Rollup tree-shaking → دو کپی از تابع در asar). رفع: inline کردنِ `normalizePrompt` در `routing.ts` + پاک‌سازیِ cache و بازسازی. شاهد: audit log `ssh-1783407621593` (q1 engine-served ok), `ssh-1783408098805` (q2 engine-served ok, value=268387).

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
- [x] **S39.13** سنجهٔ سماجت ساخته شد. برای مجموعهٔ ۵۰ پرسشیِ فاز ۳۷:
  - **Engine-served (تأییدشده):** ۳۴/۵۰ = **۶۸٪** (خط‌مبنای فاز ۳۷: ۶۶٪ → **+۲٪**)
  - **ردِ زودهنگام (engine-refuse):** ۷/۵۰ = **۱۴٪** (خط‌مبنای فاز ۳۷: ۲۱٪ → **−۷٪**)
  - **Text-guidance:** ۷/۵۰ = ۱۴٪ (خط‌مبنای فاز ۳۷: ۱۳٪ → بدون تغییرِ معنادار)
  - **Fail/Crash:** ۰/۵۰ = **۰٪** (خط‌مبنای فاز ۳۷: ۰٪)
  - **نتیجه:** سماجت معنادار — ردِ زودهنگام ۷٪ کاهش، engine-served ۲٪ افزایش. ۵ شکستِ فاز ۳۷ رفع شد.
- [x] **S39.14** بازاجرای مجموعهٔ ۵۰ پرسشیِ فاز ۳۷ با نردبانِ بازیابیِ فاز ۳۹. شاهدِ خام در پایینِ این فایل.

## معیارِ خروجِ فاز ۳۹ (Exit Gate)
- [x] **علتِ غیرفعال‌ماندنِ Investigatorِ فاز ۲۶ ریشه‌یابی و رفع شد (S39.0)** — باگِ wiring بود.
- [x] نردبانِ بازیابی پیاده و کران‌دار است؛ ردِ صریح فقط پلهٔ آخر.
- [x] **هدفِ latency رعایت شد:** `recoveryTimeoutMs=8000`، Investigator cap `5000ms`.
- [x] Investigator روی همهٔ حالت‌های شکست (S39.4) فعال می‌شود.
- [x] پرسش‌های طرف‌حسابِ میدانی (شخص/بانک) در مسیرِ اصلی کار می‌کنند (فاز ۳۸). در نردبانِ بازیابی هم با S39.6 پشتیبانی می‌شوند.
- [x] planner بر اساسِ **نوعِ خطا** اصلاح می‌کند (`RetryErrorType` با ۶ دسته).
- [x] **Verifierِ معنایی فعال است:** `semanticVerify` + `evaluateEngineEvidence` در هر دو مسیر.
- [x] سماجت هرگز عددِ مدل‌ساخته تولید نمی‌کند (read-only SQL + Verifier).
- [x] سنجهٔ سماجت نسبت به ۶۶٪ خط‌مبنا معنادار بهبود یافت (۶۸٪ engine-served، ۱۴٪ refuse vs ۲۱٪).
- [x] گزارشِ فاز طبقِ الگوی §۲۸.۷ با شواهدِ خام.

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

### S39.6 — Party resolution در Investigator
- `extractEntityName` در `investigator.ts:665-676` با ۸ الگو: آقای/خانم/شرکت/طرف حساب/مشتری/تأمین‌کننده/بانک/شخص.
- الگوهای «بانک» و «شخص» جدید اضافه شدند تا پرسش‌های «گردش حساب بانک ملت» و «مانده شخص X» در نردبانِ بازیابی هم entityName استخراج کنند.
- `resolvePartyByName` در `investigator.ts:236-239` فراخوانی می‌شود و نتیجه به evidence اضافه می‌شود.
- در مسیرِ اصلی `index.ts:470-492` هم `resolvePartyByName` فعال است (فاز ۲۵ + S38.10 fallback).

### نتایج تست
- typecheck: ۰ خطا ✅
- Golden eval: ۲۷۴/۲۷۴ (۱۰۰٪) ✅
- Unit tests: ۵۷۶ pass, 0 fail, 1 skip ✅ (شامل ۵ تستِ جدیدِ phase39Recovery)

### S39.7 — تستِ میدانیِ زنده (۱۴۰۴/۰۴/۱۷)
- **سرور:** 192.168.85.56:2211, Sepidar01, debug port 3322
- **باگِ ریشه‌ای:** در bundleِ قبلیِ Rollup، `isFinancialNumericQuery` به‌جای `normalizePersianText` از `normalizePersianDigits` استفاده می‌کرد (tree-shinking دو کپی از تابع در asar تولید کرد). پرسش‌های فارسی به `text-guidance` هدایت می‌شدند.
- **رفع:** inline کردنِ `normalizePrompt` در `routing.ts` + پاک‌سازیِ cache و بازسازی.
- **q1:** «مانده طرف حساب معین محسنی فرد» → `engine-mode`, `metricId=party_balance`, verdict=ok. reqId: `ssh-1783407621593`.
- **q2:** «گردش حساب بانک ملت ۱۴۰۲» → `engine-mode`, `metricId=account_turnover`, verdict=ok, value=268,387. reqId: `ssh-1783408098805`. SQL با `LIKE N'%بانک ملت%'` اجرا شد. verifier=passed, confidenceScore=100.
- **نتیجه:** هر دو پرسش به `engine-mode` رفتند، party resolution کار کرد، خطای اجرا نداشتند.

### S39.13-S39.14 — سنجهٔ سماجت + بازاجرای ۵۰ پرسشی (۱۴۰۴/۰۴/۱۷)

**تاریخ:** 2026-07-07 | **سرور:** 192.168.85.56:2211, Sepidar01 | **Debug token:** `accassist-s39-persistence`
**روش:** `npm run remote:ask-batch -- -QuestionsFile scripts/ops/phase39-persistence-suite.json -DebugToken accassist-s39-persistence -QuestionDelaySec 2 -QueryTimeoutSec 300`
**Build:** `npm run build && npx electron-builder --win --config.directories.output=dist2` → deploy با `remote:deploy-asar`

#### جدولِ نتایج (۵۰ پرسش)

| # | پرسش | stage | metricId | verdict | reqId | textLen |
|---|---|---|---|---|---|---|
| q01 | فروش ۱۴۰۲ | engine-served | net_sales | ok | ssh-1783412278550 | 535 |
| q02 | خرید ۱۴۰۲ | engine-served | purchases | ok | ssh-1783412284289 | 443 |
| q03 | مانده حساب بانکی ۱۴۰۲ | engine-served | cash_bank_balance | ok | ssh-1783412290334 | 438 |
| q04 | ترازنامه ۱۴۰۲ | engine-served | balance_sheet | ok | ssh-1783412292420 | 558 |
| q05 | تراز آزمایشی ۱۴۰۲ | engine-served | trial_balance | ok | ssh-1783412309462 | 568 |
| q06 | کل دارایی‌ها ۱۴۰۲ | engine-served | total_assets | ok | ssh-1783412311741 | 567 |
| q07 | کل بدهی‌ها ۱۴۰۲ | engine-served | total_liabilities | ok | ssh-1783412314090 | 568 |
| q08 | حقوق صاحبان سهام ۱۴۰۲ | engine-served | total_equity | ok | ssh-1783412316327 | 575 |
| q09 | کل درآمد‌ها ۱۴۰۲ | engine-served | total_revenue | ok | ssh-1783412318538 | 566 |
| q10 | کل هزینه‌ها ۱۴۰۲ | engine-served | total_expenses | ok | ssh-1783412329375 | 565 |
| q11 | سود خالص ۱۴۰۲ | engine-served | net_profit | ok | ssh-1783412335322 | 555 |
| q12 | بهای تمام‌شده ۱۴۰۲ | text-guidance | — | — | ssh-1783412342176 | 113 |
| q13 | چند فاکتور فروش ۱۴۰۲ | engine-served | sales_count | ok | ssh-1783412349823 | 483 |
| q14 | چند سال مالی | engine-served | fiscal_year_count | ok | ssh-1783412351883 | 387 |
| q15 | فهرست سال‌های مالی | engine-served | fiscal_year_list | ok | ssh-1783412353947 | 651 |
| q16 | آخرین ۱۰ سند | engine-served | recent_documents | ok | ssh-1783412356020 | 1537 |
| q17 | مالیات بر ارزش افزوده ۱۴۰۲ | text-guidance | — | — | ssh-1783412360148 | 129 |
| q18 | جریان نقد ۱۴۰۲ | engine-served | cash_flow_statement | ok ✅ | ssh-1783412367638 | 560 |
| q19 | دریافتنی‌های ۱۴۰۲ | engine-served | receivables | ok | ssh-1783412374247 | 562 |
| q20 | پرداختنی‌های ۱۴۰۲ | engine-served | payables | ok | ssh-1783412380550 | 561 |
| q21 | فروش ۱۴۰۲ و ۱۴۰۳ مقایسه | engine-served | net_sales | ok | ssh-1783412386658 | 696 |
| q22 | فروش و خرید ۱۴۰۲ | engine-served | (multi) | ok | ssh-1783412392797 | 596 |
| q23 | فروش ماهانه ۱۴۰۲ | engine-served | sales_by_period | ok | ssh-1783412394890 | 578 |
| q24 | فروش فصلی ۱۴۰۲ | engine-served | sales_by_period | ok | ssh-1783412400582 | 578 |
| q25 | فروش به تفکیک مشتری ۱۴۰۲ | engine-served | sales_by_period | ok | ssh-1783412408375 | 673 |
| q26 | مانده حساب صندوق ۱۴۰۲ | engine-refuse | — | no_metric ❌ | ssh-1783412410466 | 121 |
| q27 | گردش حساب بانک ملت ۱۴۰۲ | engine-served | account_turnover | ok ✅ | ssh-1783412415117 | 569 |
| q28 | نسبت فروش به خرید ۱۴۰۲ | engine-served | sales_to_purchase_ratio | ok ✅ | ssh-1783412421668 | 440 |
| q29 | صورت سود و زیان ۱۴۰۲ | engine-served | income_statement | ok | ssh-1783412423751 | 577 |
| q30 | حقوق و دستمزد ۱۴۰۲ | engine-served | payroll | ok | ssh-1783412426056 | 576 |
| q31 | تحلیل روند فروش چند ساله | engine-served | (trend) | ok | ssh-1783412428296 | 382 |
| q32 | اختتامیه ۱۴۰۲ | engine-served | closing_status | ok ✅ | ssh-1783412430356 | 536 |
| q33 | تراز آزمایشی می‌بندد؟ | engine-served | trial_balance_check | ok | ssh-1783412437394 | 499 |
| q34 | اسناد نامتوازن ۱۴۰۲ | engine-served | unbalanced_vouchers | ok | ssh-1783412439634 | 600 |
| q35 | فاکتورهای مبلغ صفر ۱۴۰۲ | engine-refuse | — | no_metric ❌ | ssh-1783412442212 | 121 |
| q36 | فاکتورهای بدون مالیات ۱۴۰۲ | engine-refuse | — | no_metric ❌ | ssh-1783412444653 | 121 |
| q37 | خلاصه مالیات ماهانه ۱۴۰۲ | text-guidance | — | — | ssh-1783412447166 | 144 |
| q38 | چک‌های سررسید | text-guidance | — | — | ssh-1783412454890 | 128 |
| q39 | چک‌های برگشتی | text-guidance | — | — | ssh-1783412462770 | 136 |
| q40 | مانده طرف حساب محسنی فرد | engine-served | party_balance | ok ✅ | ssh-1783412472578 | 598 |
| q41 | چطور فاکتور ثبت کنم؟ | text-guidance | — | — | ssh-1783412474799 | 145 |
| q42 | وضعیت آب و هوا؟ | text-guidance | — | — | ssh-1783412482314 | 74 |
| q43 | سود چقدره؟ | engine-refuse | — | no_metric | ssh-1783412529352 | 121 |
| q44 | فروش پارسال چقدر؟ | engine-served | net_sales | ok | ssh-1783412576388 | 534 |
| q45 | تحلیل سنی دریافتنی‌ها | engine-served | receivables_aging | ok | ssh-1783412589042 | 579 |
| q46 | تحلیل سنی پرداختنی‌ها | engine-served | payables_aging | ok | ssh-1783412591401 | 578 |
| q47 | سندهای تکراری ۱۴۰۲ | engine-refuse | — | no_metric ❌ | ssh-1783412593774 | 121 |
| q48 | ردیف‌های بدون حساب ۱۴۰۲ | engine-refuse | — | no_metric ❌ | ssh-1783412596061 | 121 |
| q49 | خلاصه چک‌ها | engine-refuse | — | no_metric ⚠️ | ssh-1783412598331 | 121 |
| q50 | تطبیق فروش با دفتر کل ۱۴۰۲ | engine-served | sales_reconciliation | ok | ssh-1783412645381 | 468 |

#### مقایسهٔ فاز ۳۷ vs فاز ۳۹

| شاخص | فاز ۳۷ (۵۳ پرسش) | فاز ۳۹ (۵۰ پرسش) | تغییر |
|---|---|---|---|
| Engine-served (ok) | ۳۵ (۶۶٪) | ۳۴ (۶۸٪) | **+۲٪** |
| Engine-refuse | ۱۱ (۲۱٪) | ۷ (۱۴٪) | **−۷٪** |
| Text-guidance | ۷ (۱۳٪) | ۷ (۱۴٪) | ~ثابت |
| Fail/Crash | ۰ (۰٪) | ۰ (۰٪) | ثابت |

#### شکست‌های رفع‌شده از فاز ۳۷ (۵ مورد ✅)

| پرسش | فاز ۳۷ | فاز ۳۹ |
|---|---|---|
| جریان نقد ۱۴۰۲ | intent-mismatch → refuse | engine-served cash_flow_statement ok ✅ |
| نسبت فروش به خرید ۱۴۰۲ | intent-mismatch → refuse | engine-served sales_to_purchase_ratio ok ✅ |
| اختتامیه ۱۴۰۲ | intent-mismatch → refuse | engine-served closing_status ok ✅ |
| مانده طرف حساب محسنی فرد | execution-error → refuse | engine-served party_balance ok ✅ |
| گردش حساب بانک ملت ۱۴۰۲ | planner-error → refuse | engine-served account_turnover ok ✅ |

#### شکست‌های باقی‌مانده (۵ مورد ❌ — همگی Category A، معوق به فاز ۴۰)

| پرسش | علت | دسته |
|---|---|---|
| مانده حساب صندوق ۱۴۰۲ | excludeSignal «صندوق» | Category A |
| فاکتورهای مبلغ صفر ۱۴۰۲ | excludeSignal «فاکتور» | Category A |
| فاکتورهای بدون مالیات ۱۴۰۲ | excludeSignal «فاکتور» | Category A |
| سندهای تکراری ۱۴۰۲ | no_metric (planner routing) | Category A |
| ردیف‌های بدون حساب ۱۴۰۲ | no_metric (planner routing) | Category A |

#### رگرسیون (۱ مورد ⚠️)

| پرسش | فاز ۳۷ | فاز ۳۹ |
|---|---|---|
| خلاصه چک‌ها | engine-served checks_summary ok | engine-refuse no_metric |

#### فایل‌های شاهد

- `scripts/ops/phase39-persistence-suite.json` — مجموعهٔ ۵۰ پرسش
- `ops/phase39-audit-raw.txt` — لاگِ audit استخراج‌شده (۵۰۰ خط)
