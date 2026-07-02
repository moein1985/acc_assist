# FRE Roadmap 22 — فاز ۲۳: بستنِ راهِ توهم و تثبیتِ حقیقتِ عددی
### Anti-Hallucination Hardening + Independent Ground-Truth Re-derivation

> پیش‌نیاز: خواندنِ `FRE_ROADMAP_21_CORRECTION_OVERVIEW.fa.md` (به‌ویژه ۲۱.۲ قراردادِ ضدِّ over-ticking).
> هدفِ این فاز: (الف) سوراخِ Verifier را ببند، (ب) مطمئن شو مدل هیچ عددی تولید نمی‌کند، (ج) اعدادِ ground-truth را با دو مسیرِ مستقل بازتولید کن، (د) اوراکلِ تراز آزمایشی را با فرمولِ صریح قطعی کن.

**مارکرهای asar این فاز:** `checkIntentAlignment`, `EVIDENCE_FIRST_ENGINE`, `groundTruthProbe`.

---

## بخش الف — رفع باگِ تورِ ایمنی (Verifier)

### S23.1 — رفع سوراخِ `checkIntentAlignment`

مشکلِ فعلی در `src/main/services/financialEngine/verifier.ts`:
```ts
const route = routeMetric(prompt, softwareId)
if (route.metricId && route.confidence >= 0.7) {   // ← آستانهٔ ۰.۷ = سوراخ
  if (route.metricId !== plan.metricId) { return { passed: false, ... } }
}
return { passed: true }   // ← در شکِ کم‌اعتماد، بی‌جهت «سبز» می‌دهد
```

- [ ] **S23.1** منطق را به «شواهدِ ناسازگاری = رد» تغییر بده:
  1. اگر `route.metricId` وجود دارد و `!== plan.metricId` **و** `route.confidence >= 0.5` → `passed:false`.
  2. **مستقل از router:** اگر متنِ پرامپت شاملِ یکی از `excludeSignals`ِ متریکِ پلن باشد (مثلاً پلن `net_sales` ولی پرامپت شاملِ «خرید»/«purchase») → `passed:false` با دلیلِ `intent mismatch: prompt contains exclusive signal '<sig>' of a different metric`.
  3. اگر router هیچ متریکی نداد ولی پرامپت anchorِ **انحصاریِ** یک متریکِ دیگر را دارد → `passed:false`.
- [ ] **S23.2** تستِ `financialEngineVerifier.test.ts:144` (خرید vs net_sales) باید سبز شود. **علاوه بر آن** این موارد را به تست اضافه کن و سبز کن:
  - «تراز آزمایشی» با پلنِ `account_balance` → رد
  - «گردش حساب آقای X» با پلنِ `trial_balance` → رد (چون `گردش حساب` در excludeSignalهای trial_balance هست)
  - «فروش» با پلنِ `purchases` → رد
  - موردِ درست (فروش↔net_sales) → پذیرش (رگرسیون نگیرد)
- شاهدِ اجباری: کپیِ خامِ خروجیِ این فایلِ تست (`# pass/# fail`).

### S23.3 — Verifier به‌عنوان دروازهٔ سخت (fail-closed)

- [ ] **S23.3** در `financialEngine/index.ts` مطمئن شو: اگر هر یک از چک‌های Verifier (`intent-alignment`, `reconciliation`, `evidence`) رد شد، موتور **عدد را برنمی‌گرداند** و به «ردِ صریح» (بخش ب) می‌رود. هیچ مسیری نباید عددِ رد‌شده را به Explainer بدهد.
- [ ] **S23.4** تستِ واحد: یک `MetricPlan` که reconciliation آن رد می‌شود، هرگز markdownِ عددی تولید نکند؛ خروجی باید «ردِ صریح» باشد. شاهدِ خام ضمیمه شود.

---

## بخش ب — تضمینِ «مدل هرگز عدد تولید نمی‌کند»

### S23.5 — ممیزیِ مسیرهای تولیدِ عدد

- [ ] **S23.5** با grep همهٔ نقاطی که ممکن است عددِ مالی به کاربر برسد را فهرست کن:
  ```
  grep -rn "finalText\|composeEngine\|composeMulti\|explain" src/main/services/financialEngine
  ```
  برای هر نقطه ثابت کن ورودیِ عددی‌اش **فقط** از `engineResult.rows` (خروجیِ `executeReadOnlySql`) می‌آید، نه از متنِ مدل. اگر جایی مدل عدد تولید می‌کند، حذف کن.
- [ ] **S23.6** در Explainer یک **گاردِ عددی** بگذار: قبل از رندرِ نهایی، هر توکنِ عددیِ بزرگ در نثرِ تولیدیِ مدل را با مجموعهٔ اعدادِ مجاز (`verifiedValues`) مقایسه کن؛ اگر مدل عددی آورد که در `verifiedValues` نیست → آن را حذف/جایگزین کن و رخداد را در audit با `stage='explainer-number-guard'` ثبت کن.
- [ ] **S23.7** تستِ واحد برای گاردِ عددی: به Explainer یک نثرِ مدلِ جعلی با عددِ اضافه بده؛ خروجیِ نهایی نباید آن عدد را داشته باشد. شاهدِ خام ضمیمه شود.

### S23.8 — مارکرِ EVIDENCE_FIRST_ENGINE

- [ ] **S23.8** ثابتِ `EVIDENCE_FIRST_ENGINE = true` را در مسیرِ اصلیِ موتور اضافه کن (به‌عنوان مارکرِ asar و سوئیچِ دفاعی). هر پاسخِ عددی باید یک بلوکِ `evidence` (تعدادِ ردیف، SQLِ اجراشده، requestId) همراه داشته باشد؛ نبودِ evidence = ردِ خودکار.

---

## بخش ج — بازتولیدِ مستقلِ ground-truth (بلاکرِ فاز)

> این بخش قلبِ «حقیقتِ عددی» است. طبقِ قانونِ ۲۱.۲/بند۲ و ۳، هیچ عددی بدونِ دو مسیرِ مستقل قفل نمی‌شود.

### S23.9 — پروبِ مستقیمِ sqlcmd (منبعِ اول)

- [ ] **S23.9** اسکریپتِ `scripts/ops/ground-truth-probe.ps1` بساز که برای هر ۶ متریکِ هسته، کوئریِ **مستقلِ دست‌نوشتِ** ثبت‌شده را با sqlcmd روی `Sepidar01` اجرا و عدد را چاپ کند. کوئری‌ها باید در خودِ اسکریپت مستند و ثابت باشند (نه تولیدِ مدل). خروجی را در `ops/ground-truth-<date>.md` ذخیره کن.
- [ ] **S23.10 — تراز آزمایشی (حلِ اختلاف):** هر سه کوئری زیر را جدا اجرا و ثبت کن:
  - `A`: `SUM(vi.Debit)` با JOIN Voucher و **`v.Type NOT IN (3,4)`** (حذفِ اختتامیه)
  - `B`: `SUM(vi.Debit)` **بدونِ** فیلترِ Type (شاملِ اختتامیه)
  - `C`: بررسیِ توازن: `SUM(vi.Debit)` در برابر `SUM(vi.Credit)` با `v.Type NOT IN (3,4)`
  - نتیجه: مشخص کن کدام‌یک `566,396,483,280` و کدام `5,426,804,727,946` می‌دهد، و **کدام تعریفْ «ترازِ آزمایشیِ درست» است** (باید Debit≈Credit باشد). فرمولِ برنده را در `metricCatalog.ts` و در `FRE_ROADMAP_00` بخش ۰.۷ ثبت کن.
- شاهدِ اجباری: کپیِ خامِ خروجیِ sqlcmd برای A/B/C.

### S23.11 — تطبیقِ موتور با پروب (منبعِ دوم)

- [ ] **S23.11** موتور را در حالت engine روی همان DB برای هر ۶ متریک اجرا کن و عددِ `audit final` (با requestId) را کنارِ عددِ sqlcmd بگذار. جدولِ «متریک | sqlcmd | engine | مطابقت؟» بساز.
- [ ] **S23.12** برای هر عدم‌تطابق: **موتور را اصلاح کن، نه اوراکل را** (قانونِ ۲۱.۲/بند۳). فقط اگر sqlcmdِ مستقل خلافِ اوراکلِ قبلی را ثابت کرد، اوراکل را با ثبتِ فرمولِ صریح به‌روز کن.
- [ ] **S23.13** فایلِ `scripts/fixtures/golden-metrics.json` و `tests/integration/financialEngine.integration.test.ts` را با اعدادِ **قفل‌شدهٔ نهایی** هماهنگ کن (الان `financialEngine.integration.test.ts` عددِ قدیمیِ `5426804727946` را هاردکد کرده — رفع شود).

---

## بخش د — بنچ‌مارکِ عددیِ واقعی (رفع F6)

> بنچ‌مارکِ فعلی فقط planning را می‌سنجد. اینجا یک لایهٔ «بنچ‌مارکِ عددی» اضافه می‌کنیم که علیه DB واقعی عدد را چک کند.

### S23.14 — حالتِ live در هارنس

- [ ] **S23.14** به `scripts/ops/goldenMetricEval.ts` یک پرچمِ `--live` اضافه کن که به‌جای executorِ mock، از `executeReadOnlySql` واقعی (تونل) استفاده کند و `expectedValue` را با عددِ **واقعیِ DB** بسنجد (نه fixture-mock). گزارشِ per-metric: `sqlcmd_expected | engine_actual | diff`.
- [ ] **S23.15** اسکریپتِ `npm run eval:metrics:live`. این مسیر عدم‌قطعیت را نشان می‌دهد؛ در CIِ آفلاین اجرا نمی‌شود ولی برای گیتِ cutover (فاز ۲۶) اجباری است.
- [ ] **S23.16** موردهای منفیِ عددی: پرامپت‌هایی که باید **رد** شوند (مثلاً «تعداد کارمندان»، «هوای تهران») در حالت live هم NO_FETCH بدهند؛ اگر عددی برگرداندند = شکستِ بنچ‌مارک.

---

## معیارِ خروجِ فاز ۲۳ (Exit Gate)

- [ ] تست `financialEngineVerifier.test.ts` کاملاً سبز (شاهدِ خام).
- [ ] گاردِ عددیِ Explainer فعال و تست‌شده.
- [ ] `ground-truth-probe.ps1` اجرا شد؛ عددِ تراز با فرمولِ صریح قطعی شد (A/B/C ثبت شد).
- [ ] برای هر ۶ متریک: `sqlcmd == engine` (جدولِ مطابقت با requestIdها).
- [ ] `golden-metrics.json` و integration test با اعدادِ قفل‌شده هماهنگ.
- [ ] هیچ عددِ مدل‌ساخته در هیچ مسیر — با گرپِ ممیزیِ S23.5 ثابت شده.
- [ ] گزارشِ نهاییِ فاز طبقِ الگوی ۲۱.۲ با شواهدِ خام ضمیمه شده.
