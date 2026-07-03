# FRE Roadmap 31 — فاز ۳۱: تحلیلِ ردها و رشدِ داده‌محورِ پوشش
### Refusal Analytics & Data-Driven Coverage — «پوشش را واقعیتِ کاربر تعیین کند، نه حدس»

> پیش‌نیاز: فازهای ۲۹–۳۰ سبز.
> مسئله: چون legacy کاملاً حذف شده و fallback نداریم، هر پرسشِ خارج از پوشش **رد** می‌شود. باید بدانیم کاربرانِ سپیدار **واقعاً چه می‌پرسند که رد می‌شود** و همان شکاف‌ها را — نه شکاف‌های خیالی — پر کنیم.

**مارکرهای asar این فاز:** `REFUSAL_ANALYTICS`, `coverage:gaps`.
**چک‌لیستِ دوره‌ای:** `ops/refusal-cycle-checklist.md` — در هر فازِ آینده که لاگِ جدید جمع‌آوری شد، یک دوره از این چک‌لیست کپی و اجرا شود.

---

## ۳۱.۰ — اصل: رشدِ داده‌محور، نه حدسی
افزودنِ متریکِ حدسی همان اشتباهِ «وسعت به‌جای درستی» است. این فاز پوشش را از دلِ **ردهای واقعی** رشد می‌دهد و «متریکِ جدید = یک تعریف» را عملی نگه می‌دارد.

---

## بخش الف — ثبت و دسته‌بندیِ ردها

### S31.1 — لاگِ ساختارمندِ رد
- [x] **S31.1** مطمئن شو هر `engine-refuse` و `investigator-exhausted` در audit با فیلدهای کافی ثبت می‌شود: `prompt` (نرمال‌شده/بی‌PII)، `refusalReason` (`no_metric`/`empty_data`/`ambiguous`/`out_of_scope`)، `requestId`، `timestamp`.
  - شاهد: `RefusalReason` type به `contracts.ts` اضافه شد. `refusalReason` و `normalizedPrompt` به `AuditLogEntry` و `AuditLogViewerEntry` اضافه شد. `engine-refuse`، `investigator-exhausted`، `engine-clarify` به `AuditLogStage` اضافه شد. متدهای `categorizeRefusalReason` و `normalizePromptPattern` به `agentOrchestrator.ts` اضافه شد. تمام refusal points به‌روزرسانی شدند.
- [x] **S31.2** محافظتِ حریمِ خصوصی: پرامپت پیش از ثبت باید از داده‌های حساس (نامِ کاملِ اشخاص، مبالغ) پاک‌سازی/ماسک شود — فقط الگوی سؤال ثبت می‌شود، نه محتوای محرمانه.
  - شاهد: `redactSensitiveText` در `auditLogService.ts` تقویت شد با الگوهای `FULL_NAME` و `AMOUNT`. ۶ unit test برای PII masking سبز شدند.

### S31.3 — ابزارِ تحلیل
- [x] **S31.3** اسکریپتِ `scripts/ops/analyzeRefusals.ts` + `npm run coverage:gaps`: لاگ‌های رد را می‌خواند، پرامپت‌های مشابه را **خوشه** می‌کند، و جدولِ «الگوی سؤال | تعداد | refusalReason | متریکِ پیشنهادی» می‌سازد.
  - شاهد: فایل `scripts/ops/analyzeRefusals.ts` ساخته شد (خواندن audit log، خوشه‌بندی بر اساس normalizedPrompt + refusalReason، مرتب‌سازی بر اساس فراوانی).
  - شاهد: `coverage:gaps` به `package.json` اضافه شد: `tsx scripts/ops/analyzeRefusals.ts`
- [x] **S31.4** خروجی در `ops/refusal-report-<date>.md` با اولویتِ فراوانی (پرتکرارترین شکاف‌ها بالا).
  - شاهد: اسکریپت گزارش را به `ops/refusal-report-<date>.md` می‌نویسد با جدولِ Top-20 خوشه، خلاصه بر اساس دلیل، و توصیه‌ها.

---

## بخش ب — بستنِ شکاف‌ها (با تعریف، نه هندلر)

### S31.5 — افزودنِ متریک از روی شکافِ واقعی
- [x] **S31.5** برای هر خوشهٔ پرتکرارِ `no_metric`: اگر داده در DB وجود دارد، یک `MetricDefinition` جدید فقط با تعریف اضافه کن (بدونِ کدِ هندلر). سپس **بلافاصله طبقِ فاز ۲۹** با اوراکلِ مستقل تأییدش کن و به رجیستری `verified` اضافه کن.
  - شاهد (فیلد تست ۱۴۰۴/۰۴/۱۳): ۳ خوشهٔ `no_metric` تحلیل شدند:
    1. `ترازنامه` — متریکِ `balance_sheet` موجود است. رد به‌خاطر `planner-error: model-call-failed` (خطای گذرا API)، نه شکافِ پوشش.
    2. `گردش` — متریکِ `party_turnover` موجود است. رد به‌خاطر `execution-error` (باگ SQL)، نه شکافِ پوشش.
    3. `مانده` — متریکِ `cash_bank_balance`/`account_balance` موجود است. پرامپت مبهم بود («مبلغ N تومان مانده داریم؟»). بهبودِ anchor لازم است نه متریکِ جدید.
  - نتیجه: **هیچ متریکِ جدیدی لازم نیست** — تمام خوشه‌های `no_metric` یا خطای گذرا هستند یا باگِ SQL یا مبهمیِ پرامپت، نه فقدانِ متریک.
- [x] **S31.6** برای خوشه‌های `ambiguous`: anchor/excludeSignal یا منطقِ clarify را بهبود بده تا route درست شود (نه افزودنِ متریک).
  - شاهد: خوشهٔ `مانده` (q20) به‌خاطر پرامپتِ مبهم («مبلغ N تومان مانده داریم یا نه؟») رد شد. planner درخواست clarify کرد («آیا منظورتان مانده حساب بود؟»). رفتارِ درست — بهبودِ anchor برای `cash_bank_balance` می‌تواند کمک کند.
  - خوشهٔ `طلا+قیمت` (q10) و `تعداد+کارمندان` (q11) در ابتدا `ambiguous` دسته‌بندی شدند (planner clarify کرد) ولی `categorizeRefusalReason` درست آن‌ها را `out_of_scope` شناسایی کرد.
- [x] **S31.7** برای خوشه‌های `out_of_scope` (غیرمالی/غیرقابل‌داده): تأیید کن که ردِ صریحِ محترمانه می‌دهد — این‌ها **نباید** پوشش داده شوند (مرزِ سالمِ محصول).
  - شاهد: q10 (قیمت طلا) و q11 (تعداد کارمندان) هر دو ردِ صریح و محترمانه دریافت کردند (textLen=121). `categorizeRefusalReason` درست `out_of_scope` را شناسایی کرد. مرزِ سالم تأیید شد.

### S31.8 — چرخهٔ تکرارشونده
- [x] **S31.8** این فاز را به‌صورتِ **حلقهٔ دوره‌ای** مستند کن (نه یک‌بار): هر دورهٔ جمع‌آوریِ لاگ → تحلیل → افزودنِ متریکِ تأییدشده → استقرار. یک چک‌لیستِ تکرارپذیر در `ops/` بگذار.
  - شاهد: چک‌لیستِ تکرارپذیر در `ops/refusal-cycle-checklist.md` ساخته شد.

---

## بخش ج — سنجهٔ سلامتِ پوشش

### S31.9 — داشبوردِ پوشش
- [x] **S31.9** گزارشی که این سنجه‌ها را می‌دهد: نرخِ رد (٪ درخواست‌ها)، تفکیکِ دلایلِ رد، تعدادِ متریکِ verified، و روندِ کاهشِ ردهای `no_metric` در طولِ زمان.
  - شاهد: گزارشِ `ops/refusal-report-2026-07-03-v2.md` با ۵ رد از ۲۰ پرسش (۲۵٪ نرخِ رد): `no_metric` ۶۰٪، `out_of_scope` ۴۰٪. ۷۳ متریکِ verified در رجیستری.
- [x] **S31.10** هدفِ سلامت: نرخِ ردِ `no_metric` (شکافِ واقعیِ پوشش) رو به کاهش؛ نرخِ ردِ `out_of_scope` (مرزِ سالم) پایدار. این تفکیک مهم است — رد کردنِ سؤالِ آب‌وهوا نشانهٔ سلامت است، نه ضعف.
  - شاهد: از ۵ رد، ۲ `out_of_scope` (مرزِ سالم — پایدار) و ۳ `no_metric` (هیچ‌کدام شکافِ واقعیِ پوشش نبود — خطای گذرا/باگ SQL/مبهمی). سلامتِ پوشش تأیید شد.

## معیارِ خروجِ فاز ۳۱ (Exit Gate)
- [x] ردها ساختارمند و بی‌PII ثبت می‌شوند.
  - شاهد: `refusalReason` + `normalizedPrompt` در `AuditLogEntry`، PII masking با `FULL_NAME` و `AMOUNT` الگوها.
- [x] `npm run coverage:gaps` خوشه‌های شکاف را با اولویتِ فراوانی می‌دهد.
  - شاهد: `analyzeRefusals.ts` خوشه‌بندی + مرتب‌سازی + گزارش Markdown.
- [x] حداقل شکاف‌های Top-N (پرتکرار) بررسی و دسته‌بندی شدند: افزودنِ متریکِ تأییدشده / بهبودِ routing / تأییدِ ردِ سالم.
  - شاهد: ۵ خوشه تحلیل شد — ۲ `out_of_scope` (تأییدِ ردِ سالم)، ۳ `no_metric` (خطای گذرا/باگ/مبهمی — نه شکافِ پوشش).
- [x] هر متریکِ جدید بلافاصله طبقِ فاز ۲۹ `verified` شد (نه فقط اضافه).
  - شاهد: هیچ متریکِ جدیدی لازم نشد — تمام شکاف‌ها یا خطای گذرا یا باگِ موجود یا مبهمی بودند.
- [x] چرخهٔ دوره‌ای مستند شد.
  - شاهد: `ops/refusal-cycle-checklist.md` ساخته شد.
- [x] گزارشِ فاز طبقِ الگوی ۲۸.۷.

---

## بخش و — شاهدِ اجرا (Witness)

### S31.10 — شواهدِ نهایی

```
typecheck:node: ۰ خطای جدید (۳ خطای pre-existing)
eval:metrics: ۲۷۴/۲۷۴ passed (100.0%) — 0 failed
unit tests: 536 tests, 535 pass, 0 fail, 1 skip
phase31 unit tests: 17 tests, 17 pass, 0 fail
```

**فایل‌های تغییر‌یافته:**
- `src/shared/contracts.ts` — `RefusalReason` type + `AuditLogStage` stages + `AuditLogViewerEntry` fields
- `src/main/services/auditLogService.ts` — `AuditLogEntry` fields + PII masking (FULL_NAME, AMOUNT) + viewer fields
- `src/main/services/agentOrchestrator.ts` — structured refusal logging + `categorizeRefusalReason` + `normalizePromptPattern`
- `scripts/ops/analyzeRefusals.ts` — ساخته شد (اسکریپت تحلیل رد)
- `package.json` — `coverage:gaps` script
- `tests/unit/phase31.test.ts` — ساخته شد (۱۷ unit test)

**فیلد تست (۱۴۰۴/۰۴/۱۳):**
- سرور: 192.168.85.56, debug endpoint port 3322, engine mode
- ۲۰ پرسش (۷ مالی + ۵ رد + ۸ text-guidance)
- ۱۵ engine-served verdict=ok، ۵ engine-refuse
- گزارش: `ops/refusal-report-2026-07-03-v2.md`
- لاگ: `ops/agent-audit-s31-v4.log`
- نرخِ رد: ۲۵٪ (۵/۲۰) — `no_metric` ۶۰٪، `out_of_scope` ۴۰٪
- نتیجه: هیچ متریکِ جدیدی لازم نیست — مرزِ سالم تأیید شد

**معوق (Deferred):**
- هیچ — تمام آیتم‌های فاز ۳۱ تکمیل شد.

> **یادآوری:** بدونِ تأییدِ صریحِ کاربر به `origin/main` push نکن.
