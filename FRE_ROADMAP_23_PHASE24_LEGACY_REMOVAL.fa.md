# FRE Roadmap 23 — فاز ۲۴: حذفِ کاملِ legacy و سوییچِ قطعی به engine
### Legacy Retirement — «موتور تنها ورودی، یا عددِ تأییدشده یا ردِ صریح»

> پیش‌نیاز: فاز ۲۳ سبز (Verifier قفل، اعداد قفل، مدل عدد تولید نمی‌کند).
> هدف: مسیرِ توهم‌زای `sendMessageFn` (حلقهٔ مدل + SQL) را **کاملاً** حذف کنیم و سوئیچِ سه‌حالته را بردایم؛ engine تنها ورودی شود. این کارِ سنگین دقیقاً همان چیزی است که مدلِ heavy-lifting در آن خوب است.

**مارکرهای asar این فاز:** `ENGINE_ONLY_ENTRY`, `no-legacy-fallback`.

---

## بخش الف — نقشهٔ وابستگیِ legacy (قبل از حذف)

### S24.1 — ممیزیِ سطحِ تماس

- [x] **S24.1** نقشهٔ کاملِ آنچه legacy الان انجام می‌دهد را بساز. نقاطِ کلیدی:
  - `agentOrchestrator.ts:334` — انتخابِ mode با پیش‌فرضِ `'legacy'`
  - `agentOrchestrator.ts` — سقوط به `sendMessageFn(this.sendMessageDeps, ...)` وقتی engine `null` می‌دهد یا mode≠engine
  - `runShadowComparison` (خطوط ~۵۹۰–۶۵۰)
  - کلِ پکیجِ `src/main/services/agentOrchestrator/` (زیرماژول‌ها: `sendMessage.ts`, `toolExecution.ts`, `sqlExecution.ts`, `sqlGuards.ts`, `recovery.ts`, `promptBuilder.ts`, `intentRouting.ts`, `salesGrowth.ts`, `fiscalYearFallback.ts`, ...)
  - `FinancialEngineMode` در `financialEngine/types.ts:340`، `src/main/types.ts:120`، `src/shared/contracts.ts:287`

  **نقشهٔ سطحِ تماس:**
  - `agentOrchestrator.ts:333-334`: `mode = process.env.ACC_FINANCIAL_ENGINE_MODE ?? settings.financialEngineMode ?? 'legacy'`
  - `agentOrchestrator.ts:343-356`: اگر `mode === 'engine'` → `tryEngineResponse()`، اگر null → fallback به `sendMessageFn`
  - `agentOrchestrator.ts:358-364`: اگر `mode !== 'engine'` → مستقیم `sendMessageFn` + shadow comparison
  - `agentOrchestrator.ts:590-650`: `runShadowComparison` — اجرای هم‌زمانِ engine و legacy، مقایسهٔ خروجی
  - `agentOrchestrator.ts:656-755`: `sendMessageDeps` getter — ۲۰+ وابستگی به زیرماژول‌های legacy
  - `sendMessage.ts` (39KB): حلقهٔ اصلیِ مدل+ابزار، ۶۰۰+ خط
  - `toolExecution.ts` (21KB): اجرای ابزارهای مدل (SQL، جستجو، ...)
  - `sqlExecution.ts` (28KB): اجرای SQL با guards
  - `promptBuilder.ts` (12KB): ساختِ system prompt برای مدل
  - `prompts.ts` (7KB): قالب‌های prompt
  - `evidenceValidation.ts` (12KB): اعتبارسنجی evidence
  - `responseContract.ts` (13KB): قالبِ پاسخِ مالی
  - `clarification.ts` (8KB): پاسخ‌های clarification
  - `salesGrowth.ts` (9KB): fallbackِ درصدِ رشد
  - `fiscalYearFallback.ts` (13KB): fallbackِ سال مالی
  - `geminiRetry.ts` (10KB): retry منطق
  - `recovery.ts` (840B): ثابتِ MAX_RECOVERY
  - `intentRouting.ts` (820B): stub شده در فاز ۹
  - `deterministicTools.ts` (2KB): stub شده در فاز ۹
  - `responseBuilder.ts` (2.6KB): ساختِ پاسخ
  - `routing.ts` (4KB): تشخیص intent
  - `rowUtils.ts` (4.5KB): محدودسازی ردیف‌ها
  - `telemetry.ts` (2.2KB): تله‌متری
  - `schemaCache.ts` (6.3KB): کشِ schema
  - `schemaCatalog.ts` (21KB): کاتالوگِ schema
  - `sqlGuards.ts` (808B): guardهای SQL
  - `sqlUtils.ts` (3.8KB): ابزارهای SQL (quote, etc.)

- [x] **S24.2** برای هر زیرماژولِ legacy مشخص کن: (الف) آیا engine هم به آن نیاز دارد؟ (`sqlUtils`, `sqlGuards`, `schemaCatalog`, `textNormalization` احتمالاً مشترک‌اند) — این‌ها **حذف نمی‌شوند**، فقط مسیرِ حلقهٔ مدل حذف می‌شود. جدولِ «ماژول | مصرف‌کنندهٔ engine؟ | سرنوشت (نگه‌دار/حذف)» بساز.

  **جدولِ وابستگی:**

  | ماژول | مصرف‌کنندهٔ engine؟ | سرنوشت |
  |-------|---------------------|---------|
  | `sqlUtils.ts` | بله — `quoteSqlIdentifier`, `quoteSqlTableRef` در `tryEngineResponse` | **نگه‌دار** |
  | `conversationMemory.ts` | بله — `getOrCreateConversationMemory`, `updateContextEntities`, `pushConversationTurn` | **نگه‌دار** |
  | `schemaCatalog.ts` | بله — `findActiveSchemaCatalog`, `resolvePreferredMapping` در `resolveAdapter` | **نگه‌دار** |
  | `schemaCache.ts` | بله — `fetchTableListCached` در `resolveAdapter` | **نگه‌دار** |
  | `textNormalization.ts` | بله — `normalizePersianText` در `tryEngineResponse` | **نگه‌دار** (خارج از پکیج) |
  | `sqlGuards.ts` | خیر — فقط در `sqlExecution.ts` (legacy) | **حذف** |
  | `sendMessage.ts` | خیر — حلقهٔ اصلی legacy | **حذف** |
  | `toolExecution.ts` | خیر — اجرای ابزارِ legacy | **حذف** |
  | `sqlExecution.ts` | خیر — اجرای SQLِ legacy (engine مسیر خودش را دارد) | **حذف** |
  | `promptBuilder.ts` | خیر — promptِ legacy | **حذف** |
  | `prompts.ts` | خیر — قالب‌های legacy | **حذف** |
  | `evidenceValidation.ts` | خیر — validationِ legacy | **حذف** |
  | `responseContract.ts` | خیر — قالبِ پاسخِ legacy | **حذف** |
  | `clarification.ts` | خیر — clarificationِ legacy | **حذف** |
  | `salesGrowth.ts` | خیر — fallbackِ legacy | **حذف** |
  | `fiscalYearFallback.ts` | خیر — fallbackِ legacy | **حذف** |
  | `geminiRetry.ts` | خیر — retryِ legacy | **حذف** |
  | `recovery.ts` | خیر — ثابتِ legacy | **حذف** |
  | `intentRouting.ts` | خیر — stub شده | **حذف** |
  | `deterministicTools.ts` | خیر — stub شده | **حذف** |
  | `responseBuilder.ts` | خیر — فقط legacy | **حذف** |
  | `routing.ts` | خیر — فقط legacy | **حذف** |
  | `rowUtils.ts` | خیر — فقط legacy | **حذف** |
  | `telemetry.ts` | خیر — فقط legacy | **حذف** |
  | `index.ts` | خیر — re-exportهای legacy | **حذف** |

> ⚠️ **هشدارِ ایمنی:** پیش از حذف، این جدول را کامل کن. زیرماژول‌های مشترکِ SQL-safety (`sqlGuards`, `sqlPolicyValidator`) **نباید** حذف شوند؛ فقط `sendMessage.ts` (حلقهٔ مدل‌+ابزار) و مسیرهای تولیدِ SQLِ مدل حذف می‌شوند.

---

## بخش ب — طراحیِ «engine تنها ورودی»

### S24.3 — مسیرِ ورودیِ واحد

- [x] **S24.3** در `agentOrchestrator.sendMessage` سوئیچِ mode را حذف کن. مسیرِ جدید:
  1. `tryEngineResponse(payload)` را صدا بزن.
  2. اگر عددِ تأییدشده داد → همان.
  3. اگر `null` داد (متریکِ تعریف‌شده نیست یا موجودیت مبهم است) → **حلقهٔ کاوشگر (فاز ۲۶)** را صدا بزن؛ فقط اگر کاوش هم خالی درآمد → **ردِ صریح** (بخش ج). در هیچ حالت سقوط به `sendMessageFn`.
  > توجه: در زمانِ اجرای فاز ۲۴، فاز ۲۶ هنوز ساخته نشده؛ یک `investigatorHook` بگذار که فعلاً مستقیم به ردِ صریح می‌رود، و در فاز ۲۶ پر می‌شود.
  - **انجام شد:** `sendMessage` مستقیم `tryEngineResponse` را صدا می‌زند. اگر `null` → ردِ صریح با پیامِ فارسی و `stage='engine-refuse'`. هیچ ارجاعی به `sendMessageFn` یا `mode` باقی نمانده.
- [x] **S24.4** فیلدِ `financialEngineMode` را از `SettingsStore`, `types.ts`, `contracts.ts`, و UI حذف کن. متغیرِ `ACC_FINANCIAL_ENGINE_MODE` را هم بردار.
  - **انجام شد:** فیلد از `contracts.ts`، `types.ts`، `financialEngine/types.ts` حذف شد. typeِ `FinancialEngineMode` هم حذف شد. تمام ارجاع‌ها در اسکریپت‌های ops (۹ فایل ps1) پاک شد. تستِ `settingsStore.test.ts` که `financialEngineMode` چک می‌کرد حذف شد. mockِ `connectionManager.test.ts` اصلاح شد. grep در `*.ts` و `*.ps1` و `*.json` صفر نتیجه. `typecheck:node` فقط ۲ خطای TS6307 از قبل موجود.
- [x] **S24.5** `runShadowComparison` و شاخهٔ `mode==='shadow'` را حذف کن.
  - **انجام شد:** متدِ `runShadowComparison` کاملاً حذف شد. grep در `agentOrchestrator.ts` برای `runShadowComparison|shadow|sendMessageFn` صفر نتیجه می‌دهد.

### S24.6 — مرزِ مالی/غیرمالی

- [ ] **S24.6** یک طبقه‌بندِ قطعیِ سبک بساز (`isFinancialNumericQuery`) که تشخیص دهد پرسش «عددِ مالی» می‌خواهد یا «راهنماییِ متنی». دو خروجی:
  - **مالی‌عددی:** فقط از engine؛ یا عددِ تأییدشده یا ردِ صریح. **هرگز** مدلِ آزاد.
  - **غیرمالی/راهنمایی:** مسیرِ متن‌فقط (بخش د) — بدونِ SQL و بدونِ عدد.

---

## بخش ج — ردِ صریح (پس از کاوش) به‌جای سقوط به legacy

> یادآوری: از فاز ۲۶ به بعد، ردِ صریح فقط **پس از خالی‌درآمدنِ حلقهٔ کاوشگر** رخ می‌دهد، نه زودهنگام.

### S24.7 — پیامِ ردِ استاندارد

- [ ] **S24.7** وقتی engine (و از فاز ۲۶ به بعد، کاوشگر) نمی‌تواند یک پرسشِ مالی‌عددی را قطعی پاسخ دهد، یک پاسخِ ردِ ساختارمند بده:
  - متنِ فارسیِ شفاف: «برای این پرسش دادهٔ قابل‌اتکا در دسترس ندارم» + دلیلِ کوتاه (متریکِ پشتیبانی‌نشده / دادهٔ خالی / ابهام).
  - در صورتِ ابهام، سؤالِ روشن‌کننده بپرس (clarify) — نه حدسِ عددی.
  - audit: `stage='engine-refuse'`, `failureKind` مشخص، `requestId`.
- [ ] **S24.8** تضمین کن ردِ صریح **هیچ عددی** ندارد و مسیرِ `sendMessageFn` را صدا نمی‌زند. تستِ واحد: پرسشِ «تعداد کارمندان» → ردِ صریح، بدونِ عدد، بدونِ فراخوانیِ legacy. شاهدِ خام ضمیمه.

### S24.9 — حذفِ فیزیکیِ حلقهٔ مدل‌+SQL

- [ ] **S24.9** پس از اطمینان از پوششِ engine (فاز ۲۶ گیت می‌کند)، `sendMessage.ts` و زیرماژول‌های منحصرِ حلقهٔ مدل (`toolExecution.ts`, `recovery.ts`, `salesGrowth.ts`, `intentRouting.ts`, `fiscalYearFallback.ts`, `promptBuilder.ts`, `prompts.ts` — طبقِ جدولِ S24.2) را حذف کن. importهای مرده را پاک کن.
- [ ] **S24.10** `npm run typecheck:node` باید ۰ خطا باشد پس از حذف (شاهدِ خام). هیچ importِ شکسته نماند.

---

## بخش د — مسیرِ راهنماییِ متن‌فقط (حفظِ قابلیتِ عمومی)

> حذفِ legacy نباید «راهنماییِ نرم‌افزاری» (مثلِ «چطور در سپیدار فاکتور ثبت کنم») را از بین ببرد. این پاسخ‌ها متنی و بی‌عددند، پس امن‌اند.

### S24.11 — پاسخِ متنیِ ایمن

- [ ] **S24.11** یک مسیرِ سبکِ `answerTextOnly` بساز که برای پرسش‌های غیرمالی، پاسخِ متنیِ مدل را بدهد **با گاردِ سخت:**
  - هیچ SQL اجرا نمی‌شود.
  - گاردِ عددیِ S23.6 اعمال می‌شود: اگر مدل عددِ مالیِ مشخص (مبلغ/مانده) آورد، حذف و به «برای عدد باید از گزارش‌های مالی بپرسید» تبدیل شود.
- [ ] **S24.12** تستِ واحد: «چطور در سپیدار فاکتور فروش ثبت کنم؟» → پاسخِ متنیِ راهنما، بدونِ عدد، بدونِ SQL. و «فروش من چقدر بود؟» → مسیرِ مالی (engine)، نه متن‌فقط. شاهدِ خام.

---

## بخش ه — پاک‌سازیِ تست‌ها و اسناد

### S24.13 — تعمیرِ تست‌های یکپارچه (رفع F3)

- [ ] **S24.13** ۱۲ شکستِ `No queued handler in QueueGeminiStub` در `agentOrchestrator.integration.test.ts` از حذفِ مسیرِ deterministic ناشی شده. این تست‌ها را برای معماریِ جدید (engine-only) بازنویسی کن: هر موردی که مسیرِ legacy را فرض می‌کرد، یا به مسیرِ engine تبدیل شود یا اگر منسوخ است حذفِ صریح شود (نه skip بی‌دلیل).
- [ ] **S24.14** `settingsStore.test.ts:138` (رفع F4): چون `financialEngineMode` حذف شده، این assertion را بردار یا با «موتور تنها ورودی» جایگزین کن.
- [ ] **S24.15** هر ارجاعِ `legacy`/`shadow`/`financialEngineMode` در اسکریپت‌های ops (`diagnose-*.ps1`, `remote-server-control.ps1`) را حذف/به‌روز کن.

### S24.16 — به‌روزرسانیِ اسناد

- [ ] **S24.16** در `FRE_ROADMAP_00_OVERVIEW.fa.md` و `technical-summary.md` بخشِ سوئیچِ سه‌حالته را به «engine تنها ورودی» به‌روز کن و جدولِ وضعیت را با واقعیتِ سنجیده هماهنگ کن (نه ادعای ۱۰۰٪).

---

## معیارِ خروجِ فاز ۲۴ (Exit Gate)

- [ ] `grep -rn "sendMessageFn\|financialEngineMode\|runShadowComparison" src/` صفرِ نتیجهٔ مالی بدهد (جز شاید تعریف‌های حذف‌شده).
- [ ] `typecheck:node` = ۰ خطا (شاهدِ خام).
- [ ] پرسشِ مالیِ پشتیبانی‌نشده → ردِ صریحِ بی‌عدد (تست + شاهد).
- [ ] پرسشِ راهنماییِ غیرمالی → پاسخِ متنیِ بی‌عدد (تست + شاهد).
- [ ] تست‌های یکپارچه بازنویسی و سبز (شاهدِ خام).
- [ ] هیچ مسیری از پرسشِ مالی به تولیدِ SQL/عددِ مدل نمی‌رسد — ممیزیِ گرپ ضمیمه.
- [ ] گزارشِ فاز طبقِ الگوی ۲۱.۲.
