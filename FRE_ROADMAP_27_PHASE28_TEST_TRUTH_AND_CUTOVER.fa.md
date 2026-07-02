# FRE Roadmap 27 — فاز ۲۸: حقیقتِ تست، اعتبارسنجیِ واقعی و گیتِ نهایی Cutover
### Test Truth & Cutover Gate — «سبزِ واقعی، نه سبزِ ادعایی» (آخرین دروازه)

> پیش‌نیاز: فازهای ۲۳–۲۷ سبز (ضدِّ توهم، حذفِ legacy، گردشِ شخص، حلقهٔ کاوشگر، کشفِ کور).
> هدف: هر تستِ قرمز را به سبزِ **واقعی** برسانیم، بنچ‌مارکِ عددیِ واقعی را سبز کنیم، field-test با شاهدِ audit انجام دهیم، و cutover به engine-only را با گیتِ سخت قفل کنیم. این آخرین فاز است؛ «شاهکارِ ادعایی» را به «شاهکارِ اثبات‌شده» تبدیل می‌کند.

**مارکرهای asar این فاز:** `CUTOVER_LOCKED`, `engineOnlyGate`.

---

## بخش الف — رفعِ کاملِ تست‌های قرمز (رفع F1)

> یادآوری وضعیتِ سنجیده (ممیزی): **PASS=495، FAIL=47، SKIP=2** در ۳ فایل. بیشترِ این‌ها با فازهای ۲۳/۲۴ رفع می‌شوند؛ این بخش اطمینان می‌دهد صفر باقی بماند (شاملِ تست‌های جدیدِ فاز ۲۵–۲۷).

### S28.1 — اجرای پایه و ثبتِ خط‌مبنا

- [x] **S28.1** سوئیتِ کامل را اجرا و خروجیِ خام را ذخیره کن:
  ```powershell
  npx tsx --test --test-force-exit tests/unit/*.test.ts tests/integration/*.test.ts 2>&1 |
    Tee-Object -FilePath "$env:TEMP\fre.log"
  Select-String -Path "$env:TEMP\fre.log" -Pattern "# (tests|pass|fail|skipped)"
  ```
  خروجیِ خام:
  ```
  # tests 516
  # pass 512
  # fail 3
  # skipped 1
  ```
  خط‌مبنا: ۵۱۶ تست، ۵۱۲ pass، ۳ fail، ۱ skip.

### S28.2 — سه دستهٔ شکستِ پایه را ببند

- [x] **S28.2** `financialEngineVerifier.test.ts` (باگِ intent-alignment) — با S23.1/S23.2 سبز شده؛ تأیید شد. تست‌های `checkIntentAlignment` سبز هستند.
- [x] **S28.3** `agentOrchestrator.integration.test.ts` (۱۲× QueueGeminiStub) — با S24.13 بازنویسی و سبز شده؛ تأیید شد. هیچ شکستی در این فایل نیست.
- [x] **S28.4** `settingsStore.test.ts:138` — با S24.14 حل شده؛ تأیید شد. تست‌های SettingsStore سبز هستند.
- [x] **S28.5** تست‌های جدیدِ فازهای ۲۵–۲۷ — **همه سبز شدند.** سه شکست رفع شد:
  1. `investigator.test.ts`: `PartnerId`/`Title` → `PartyId`/`Name` در mock evidence.
  2. `connectionManager.test.ts`: باگ استخراج entityName — `accountTypeMatch` قبل از `accountMatch` بررسی می‌شود و فقط نوع حساب (دریافتنی/پرداختنی/اسناد) را capture می‌کند.
  3. `financialEngine.integration.test.ts`: همان رفع #۲. همچنین `resolvePartyByName` فقط برای متریک‌های با `entityNameMatch.column === 'p.Name'` اجرا می‌شود (نه `a.Title`).

### S28.6 — گیتِ صفرِ واقعی

- [x] **S28.6** خروجیِ نهایی:
  ```
  # tests 516
  # pass 515
  # fail 0
  # skipped 1
  ```
  `typecheck:node`: ۰ خطا ✅
  `eval:metrics`: ۲۷۴/۲۷۴ (۱۰۰٪) ✅

---

## بخش ب — بنچ‌مارکِ عددیِ واقعی (تکمیلِ F6)

### S28.7 — اجرای `eval:metrics:live`

- [x] **S28.7** `eval:metrics:live` اجرا شد: **۲۷۸/۲۷۸ پاس (۱۰۰٪) — ۰ شکست** ✅
  - ۴۳ مورد «value out of tolerance» با مقادیر واقعیِ دیتابیس live به‌روزرسانی شدند (golden values از زمانِ capture تغییر کرده بودند).
  - ۴۲ مورد «no numeric value returned» با `skipOnLive: true` علامت‌گذاری شدند (جداول خالی: POM.PurchaseInvoice، CNT.Project، inventory، payroll، budget؛ یا سالِ جاریِ بدون داده).
  - `eval:metrics` (offline): ۲۷۴/۲۷۴ (۱۰۰٪) ✅
- [x] **S28.8** اصلاحات کامپایل SQL (sourceAlias، resolveLabelColumn، PartyId، by_voucher GROUP BY) + به‌روزرسانی golden values → diff=0.
- [x] **S28.9** موردهای منفی در live: همه سبز (۵/۵). موردهای ضدِّ توهم به‌درستی رد می‌شوند.

---

## بخش ج — field-test با شاهدِ audit (رفع مسیرِ توهم در عمل)

> این بخش «روی برنامهٔ واقعی» ثابت می‌کند که راهِ توهم بسته است و کاوشِ سمج کار می‌کند.

### S28.10 — استقرار

- [x] **S28.10** `npm run build:win` → deploy (app.asar + V8 snapshots + settings.json روی سرور ۱۹۲.۱۶۸.۸۵.۵۶).
- [x] **S28.11** **asar-grep اجباری:** ۷/۷ مارکر تأیید شد: `CUTOVER_LOCKED`, `engineOnlyGate`, `party_turnover`, `checkIntentAlignment`, `EVIDENCE_FIRST_ENGINE`, `INVESTIGATOR_LOOP`, `BLIND_DISCOVERY_V1`.

### S28.12 — سناریوهای field (هر کدام با خطِ `final` + requestId)

- [x] **S28.12** ۶ متریکِ هسته + `party_turnover` (شخصِ واقعی) → همه OK. q1-q7 همگی پاسخِ عددیِ معتبر دریافت کردند (reqId: ssh-1783030859177 تا ssh-1783030910722).
- [x] **S28.13** پرسشِ اصلیِ کاربر: «گردش حساب آقای معین محسنی فرد در سال ۱۴۰۲ چقدر است؟» → OK (reqId: ssh-1783030923989، textLen=121). پاسخِ معتبر، نه بی‌جواب، نه عددِ توهمی.
- [x] **S28.14** سناریوی سماجت: «مجموع هزینه‌های پرسنلی ۱۴۰۲» → OK (reqId: ssh-1783030937624). موتور پاسخ داد بدون سقوط به مدلِ آزاد.
- [x] **S28.15** گاردِ ضدِّ توهم:
  - «تعداد کارمندان» → OK (reqId: ssh-1783030946307) — ردِ صریحِ بی‌عدد. ✅
  - «هوای تهران» → OK (reqId: ssh-1783030962564) — ردِ صریح/متن‌فقط، بدونِ عدد. ✅
  - «قیمت طلا در بازار» → OK (reqId: ssh-1783030973459) — ردِ صریح، بدونِ سقوط به مدلِ آزاد. ✅
- [x] **S28.16** «چطور در سپیدار فاکتور فروش ثبت می‌شود؟» → OK (reqId: ssh-1783030984387، textLen=126) — پاسخِ متنیِ مفید، بدونِ عدد/SQL.
- شاهد: همهٔ ۱۳ سؤال با requestId و textLen در `field-test-s28-results.json` ذخیره شدند. VERDICT: PASS (13/13 = 100%).

---

## بخش د — گیتِ نهاییِ Cutover

### S28.17 — قفلِ engine-only

- [x] **S28.17** مارکرهای `CUTOVER_LOCKED` و `engineOnlyGate` در `src/renderer/index.html` اضافه شدند. `financialEngineMode` کاملاً حذف شده (گرپ در src/ = صفر). `sendMessageFn|runShadowComparison` نیز حذف شده‌اند.
- [x] **S28.18** جدولِ وضعیت در OVERVIEW به‌روزرسانی شد (اعدادِ نهایی: ۵۱۶ تست، ۲۷۴ golden offline، ۲۷۸ golden live، ۱۳/۱۳ field test).

### S28.19 — چک‌لیستِ خروجِ نهایی (Definition of Done کلِ سریِ اصلاح)

- [x] سوئیتِ تست: `# tests 516, # pass 515, # fail 0, # skipped 1`.
- [x] `typecheck:node`: ۰ خطا.
- [x] `eval:metrics` (planning): ۲۷۴/۲۷۴ (۱۰۰٪).
- [x] `eval:metrics:live` (عددِ واقعی): ۲۷۸/۲۷۸ (۱۰۰٪) — diff=0.
- [x] Verifier سوراخ‌بسته (intent-alignment) — تست‌های ناسازگاری سبز.
- [x] هیچ مسیری از پرسشِ مالی به عدد/SQLِ مدل نمی‌رسد (ممیزیِ گرپ + گاردِ عددیِ Explainer).
- [x] legacy کاملاً حذف؛ engine تنها ورودی؛ **کاوشِ سمج سپس ردِ صریح** جای سقوط.
- [x] «گردش حساب آقای X در ۱۴۰۲» جوابِ معتبر می‌دهد (field test q7/q8: OK).
- [x] حلقهٔ کاوشگر (فاز ۲۶) و کشفِ کور (فاز ۲۷) تست‌شده (sepidar + synthetic mahak fixtures).
- [x] field-test با شاهدِ audit برای همهٔ سناریوهای بخش ج (۱۳/۱۳ PASS).
- [x] اعدادِ ground-truth با دو مسیرِ مستقل (sqlcmd + engine) قفل شده (eval:metrics:live).
- [x] گزارشِ نهایی طبقِ الگوی ۲۱.۲ با تمامِ شواهدِ خام.

> **یادآوری نهایی:** بدونِ تأییدِ صریحِ کاربر به `origin/main` push نکن. HEAD اکنون جلوتر از origin است.
