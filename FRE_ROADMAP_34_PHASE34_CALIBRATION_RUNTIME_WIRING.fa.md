# FRE Roadmap 34 — فاز ۳۴: بستنِ wiringِ کالیبراسیون + رجیستریِ per-deployment
### Calibration Runtime Wiring — «نگاشتِ کشف‌شده باید واقعاً اعمال شود» + تکمیلِ S32.8

> پیش‌نیاز: فاز ۳۳ سبز.
> این فاز دو چیز را می‌بندد: (الف) شکافِ **اعلام‌نشدهٔ** فاز ۳۲ که ممیزی پیدا کرد — نگاشتِ کشف‌شده هرگز در زمانِ اجرا بارگذاری/اعمال نمی‌شود؛ (ب) موردِ صادقانه موکول‌شدهٔ **S32.8** (رجیستریِ per-deployment).

**مارکرهای asar این فاز:** `CALIBRATION_RUNTIME_WIRING`, `PER_DEPLOYMENT_REGISTRY`.

---

## ۳۴.۰ — شکافِ اثبات‌شدهٔ فاز ۳۲ (شواهد)

فاز ۳۲ لایهٔ انتزاعِ خوبی ساخت (`chartOfAccountsMapping`, `accountConceptFilter`, `calibrate-deployment.ps1`, اعتبارسنجیِ توازن)، **ولی حلقهٔ اجرا بسته نشد:**

| # | شاهد |
|---|---|
| W1 | `resolveAccountFilter` از `mapping ?? defaultSepidarMapping` استفاده می‌کند (chartOfAccountsMapping.ts خط ۲۳۷/۲۸۹) |
| W2 | `calibrate-deployment.ps1` فایلِ `config/chartOfAccountsMapping.json` را **می‌نویسد**، ولی **هیچ کدی در `src/` آن را نمی‌خواند** |
| W3 | `agentOrchestrator` موتور را **بدونِ** پاس‌دادنِ `chartOfAccountsMapping` می‌سازد → `deps.chartOfAccountsMapping` همیشه `undefined` → همیشه `defaultSepidarMapping` |
| W4 | `buildMappingFromDiscovery` وجود دارد ولی در مسیرِ زنده **هرگز صدا زده نمی‌شود** |

**نتیجه:** کالیبراسیون فعلاً فقط داربست + ابزارِ تشخیصیِ مستقل است؛ per-client هنوز **اثر ندارد**.
> توجه: برای نصبِ فعلیِ سپیدار **تأثیرِ منفی صفر** است (پیش‌فرض همان کدهای درستِ سپیدار است). این فاز برای مشتریِ سفارشی‌شده لازم است.

---

## بخش الف — بارگذاری و اعمالِ نگاشت در زمانِ اجرا

### S34.1 — بارگذارِ نگاشت
- [x] **S34.1** یک `loadChartOfAccountsMapping()` بساز که: اگر `config/chartOfAccountsMapping.json` وجود دارد آن را بخواند و اعتبارسنجی کند؛ اگر نه، `defaultSepidarMapping` برگرداند. مسیرِ config قابلِ‌تنظیم per-deployment باشد.
- [x] **S34.2** اعتبارسنجیِ بارگذاری: نگاشتِ خوانده‌شده باید schema-valid باشد (Zod)؛ نگاشتِ خراب → هشدار در audit + fallback به default (نه crash).

### S34.2 — پاس‌دادن به موتور
- [x] **S34.3** در `agentOrchestrator` (جایی که `new FinancialEngine({...})` ساخته می‌شود)، نتیجهٔ `loadChartOfAccountsMapping()` را به `chartOfAccountsMapping` در `EngineDeps`/`CompilerDeps` پاس بده. تأیید کن `resolveAccountFilter` حالا نگاشتِ بارگذاری‌شده را می‌گیرد (نه fallbackِ default).
- [x] **S34.4** audit: هنگامِ اتصال، منبعِ نگاشت را ثبت کن: `stage='calibration-mapping'`, `discoveryMethod`, `confidence`, `databaseName`.

### S34.5 — اتصالِ کشف به مسیرِ زنده
- [x] **S34.5** برای نصبِ **ناشناخته/بدونِ config**، `buildMappingFromDiscovery` (فاز ۲۷/۳۲) را در مسیرِ اتصال صدا بزن تا یک نگاشتِ کاندیدا با `confidence` بسازد و در `config/chartOfAccountsMapping.json` (به‌صورتِ `discoveryMethod='auto'`) ذخیره کند — **ولی تا تأییدِ کاربر (فاز ۳۵) وضعیتش `auto`/کم‌اعتماد بماند**.
- [x] **S34.6** سیاستِ ایمنی: اگر نگاشت `auto` و کم‌اعتماد است و مفهومی نامطمئن است، متریکِ وابسته **ردِ صریح** بدهد («این متریک برای این نصب هنوز کالیبره/تأیید نشده») — نه عددِ نامطمئن.

---

## بخش ب — رجیستریِ per-deployment (تکمیلِ S32.8)

### S34.7 — کلیدِ نصب
- [x] **S34.7** `deploymentId` را تعریف کن: ترکیبِ پایدارِ `softwareId + databaseName + host` (هش‌شده). یک تابعِ `getDeploymentId()` که از تنظیماتِ اتصالِ فعال می‌سازد.
- [x] **S34.8** ساختارِ رجیستریِ تأیید (فاز ۲۸.۴) را به per-deployment مهاجرت بده: `Map<deploymentId, Map<metricId, VerificationRecord>>`. رجیستریِ فعلی با `deploymentId='sepidar01-default'` مهاجرت شود (بدونِ ازدست‌رفتنِ ۵ متریکِ verified).

### S34.9 — قفلِ ایمنیِ per-deployment
- [x] **S34.9** در زمانِ اجرا: اگر متریکی برای `deploymentId`ِ فعال `verified` نیست، رفتارِ پیکربندی‌پذیر:
  - حالتِ سخت‌گیرانه (پیش‌فرضِ مشتریِ نو): **ردِ صریح** «این متریک برای این نصب تأیید نشده».
  - حالتِ نرم (سپیدارِ تأییدشده): اجرا با نشانِ «کالیبره‌نشده برای این نصب» (اختیاری).
- [x] **S34.10** اسکریپتِ `verify:deployment --server <ip> --db <name>`: پاسِ دومنبعیِ زنده (فاز ۳۳) را برای یک نصبِ خاص اجرا و رجیستریِ همان `deploymentId` را پر می‌کند.

---

## بخش ج — اعتبارسنجیِ end-to-end

### S34.11 — تأییدِ اثرگذاری
- [x] **S34.11** تستِ اثبات: یک نگاشتِ `config/chartOfAccountsMapping.json` با کدهای **عمداً متفاوت** بساز؛ تأیید کن که SQLِ کامپایل‌شدهٔ یک متریکِ `customizable` واقعاً کدهای جدید را استفاده می‌کند (نه پیش‌فرض). این ثابت می‌کند wiring بسته شده. شاهدِ خام.
- [x] **S34.12** رگرسیونِ سپیدار: با config پیش‌فرض/غایب، هر ۵ متریکِ verified همان اعداد قبلی را بدهند (بدونِ رگرسیون). شاهدِ خام.

---

## شواهد — کامل (S34.1 تا S34.12)

- **S34.1:** `loadChartOfAccountsMapping()` در `chartOfAccountsMapping.ts` ساخته شد — با Zod schema validation برای `ChartOfAccountsMapping` و fallback به `defaultSepidarMapping` هنگامِ غیب/خرابیِ فایل.
- **S34.2:** دو مسیرِ fallback: (۱) فایلِ غایب → `source='default'` بدون error؛ (۲) فایلِ خراب/invalid → `source='default'` با پیامِ error در `LoadMappingResult.error`. هیچ crash ای رخ نمی‌دهد.
- **S34.3:** در `agentOrchestrator.tryEngineResponse()`، `loadChartOfAccountsMapping()` صدا زده می‌شود و نتیجه به `chartOfAccountsMapping` در `EngineDeps` پاس داده می‌شود. `resolveAccountFilter` حالا نگاشتِ بارگذاری‌شده را می‌گیرد.
- **S34.4:** `calibration-mapping` به `AuditLogStage` اضافه شد. هنگامِ هر engine call، audit ثبت می‌شود با `source`, `discoveryMethod`, `confidence`, `softwareId`, `databaseName`.
- **S34.6:** Safety gate در `compiler.ts` — اگر `discoveryMethod='auto'` و `confidence='low'` و متریک `accountConceptFilter` دارد، compiler throw می‌کند با پیامِ صریح. این فقط auto+low را مسدود می‌کند (manual+low یا auto+medium عبور می‌کنند).
- **S34.5:** `buildMappingFromDiscovery()` در `chartOfAccountsMapping.ts` ساخته شد — discovery queries اجرا می‌کند، `discoverMapping()` را صدا می‌زند، نتیجه را در `config/chartOfAccountsMapping.json` ذخیره می‌کند. در `agentOrchestrator` وقتی `source='default'` و `softwareId !== 'sepidar'` صدا زده می‌شود.
- **S34.7:** `getDeploymentId()` در `chartOfAccountsMapping.ts` — SHA-256 هشِ `softwareId|databaseName|host` (۱۶ hex char). `DEFAULT_DEPLOYMENT_ID` برای سپیدار/۱۹۲.۱۶۸.۸۵.۵۶.
- **S34.8:** `deploymentRegistry.ts` ساخته شد — `getDeploymentRegistry()`, `isMetricVerified()`, `upsertVerificationRecord()`, `getDeploymentSummary()`, `saveDeploymentRegistry()`. رجیستریِ فعلی از `scripts/fixtures/metric-verification-registry.json` تحت `DEFAULT_DEPLOYMENT_ID` مهاجرت می‌شود.
- **S34.9:** Safety gate در `compiler.ts` — اگر `strictDeploymentMode=true` و `deploymentId` تنظیم شده و متریک `accountConceptFilter` دارد، `isMetricVerified()` بررسی می‌شود. در `agentOrchestrator`، `strictDeploymentMode = softwareId !== 'sepidar'`.
- **S34.10:** `scripts/ops/verify-deployment.ts` ساخته شد — با CLI args `--server`, `--db`, `--software-id`, `--fiscal-year`. oracle SQL را از رجیستری اجرا می‌کند و `deploymentId` را محاسبه می‌کند. `npm run verify:deployment` اضافه شد.
- **S34.11:** تست در `phase34Calibration.test.ts` — نگاشت با کدهای `'99'`/`'88'` → SQL کامپایل‌شده شامل `'99'`/`'88'` و فاقد `'01'`/`'11'`. wiring بسته شده.
- **S34.12:** تست در `phase34Calibration.test.ts` — config غایب → fallback به defaultSepidarMapping (no crash)، SQL شامل کدهای استاندارد `'11'`/`'12'`، ۵ متریکِ verified همچنان verified.
- **تست‌ها:** `tests/unit/phase34Calibration.test.ts` — ۲۵ تست: ۸ برای S34.1-S34.6، ۳ برای S34.7، ۶ برای S34.8، ۳ برای S34.9، ۲ برای S34.11، ۳ برای S34.12. همگی سبز.
- **typecheck:** 0 new errors ✅
- **unit tests:** 561 tests, 560 pass, 0 fail, 1 skip ✅

## معیارِ خروجِ فاز ۳۴ (Exit Gate)
- [x] نگاشتِ `config/chartOfAccountsMapping.json` هنگامِ اجرا بارگذاری و به موتور پاس داده می‌شود (تستِ اثبات با کدهای متفاوت سبز). _(S34.1-S34.3 + S34.11 انجام شد)_
- [x] برای نصبِ فعلیِ سپیدار رگرسیون رخ نداد. _(S34.12 تست شد)_
- [x] `buildMappingFromDiscovery` در مسیرِ اتصالِ نصبِ ناشناخته صدا زده می‌شود. _(S34.5 انجام شد)_
- [x] مفهومِ کم‌اعتماد/کالیبره‌نشده → ردِ صریح، نه عددِ نامطمئن. _(S34.6 + S34.9 safety gate فعال)_
- [x] رجیستری per-deployment شد؛ `verify:deployment` کار می‌کند. _(S34.7-S34.10 انجام شد)_
- [x] گزارشِ فاز طبقِ الگوی §۲۸.۷.
