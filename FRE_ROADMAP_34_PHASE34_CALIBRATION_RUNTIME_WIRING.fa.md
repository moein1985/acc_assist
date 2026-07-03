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
- [ ] **S34.1** یک `loadChartOfAccountsMapping()` بساز که: اگر `config/chartOfAccountsMapping.json` وجود دارد آن را بخواند و اعتبارسنجی کند؛ اگر نه، `defaultSepidarMapping` برگرداند. مسیرِ config قابلِ‌تنظیم per-deployment باشد.
- [ ] **S34.2** اعتبارسنجیِ بارگذاری: نگاشتِ خوانده‌شده باید schema-valid باشد (Zod)؛ نگاشتِ خراب → هشدار در audit + fallback به default (نه crash).

### S34.2 — پاس‌دادن به موتور
- [ ] **S34.3** در `agentOrchestrator` (جایی که `new FinancialEngine({...})` ساخته می‌شود)، نتیجهٔ `loadChartOfAccountsMapping()` را به `chartOfAccountsMapping` در `EngineDeps`/`CompilerDeps` پاس بده. تأیید کن `resolveAccountFilter` حالا نگاشتِ بارگذاری‌شده را می‌گیرد (نه fallbackِ default).
- [ ] **S34.4** audit: هنگامِ اتصال، منبعِ نگاشت را ثبت کن: `stage='calibration-mapping'`, `discoveryMethod`, `confidence`, `databaseName`.

### S34.5 — اتصالِ کشف به مسیرِ زنده
- [ ] **S34.5** برای نصبِ **ناشناخته/بدونِ config**، `buildMappingFromDiscovery` (فاز ۲۷/۳۲) را در مسیرِ اتصال صدا بزن تا یک نگاشتِ کاندیدا با `confidence` بسازد و در `config/chartOfAccountsMapping.json` (به‌صورتِ `discoveryMethod='auto'`) ذخیره کند — **ولی تا تأییدِ کاربر (فاز ۳۵) وضعیتش `auto`/کم‌اعتماد بماند**.
- [ ] **S34.6** سیاستِ ایمنی: اگر نگاشت `auto` و کم‌اعتماد است و مفهومی نامطمئن است، متریکِ وابسته **ردِ صریح** بدهد («این متریک برای این نصب هنوز کالیبره/تأیید نشده») — نه عددِ نامطمئن.

---

## بخش ب — رجیستریِ per-deployment (تکمیلِ S32.8)

### S34.7 — کلیدِ نصب
- [ ] **S34.7** `deploymentId` را تعریف کن: ترکیبِ پایدارِ `softwareId + databaseName + host` (هش‌شده). یک تابعِ `getDeploymentId()` که از تنظیماتِ اتصالِ فعال می‌سازد.
- [ ] **S34.8** ساختارِ رجیستریِ تأیید (فاز ۲۸.۴) را به per-deployment مهاجرت بده: `Map<deploymentId, Map<metricId, VerificationRecord>>`. رجیستریِ فعلی با `deploymentId='sepidar01-default'` مهاجرت شود (بدونِ ازدست‌رفتنِ ۵ متریکِ verified).

### S34.9 — قفلِ ایمنیِ per-deployment
- [ ] **S34.9** در زمانِ اجرا: اگر متریکی برای `deploymentId`ِ فعال `verified` نیست، رفتارِ پیکربندی‌پذیر:
  - حالتِ سخت‌گیرانه (پیش‌فرضِ مشتریِ نو): **ردِ صریح** «این متریک برای این نصب تأیید نشده».
  - حالتِ نرم (سپیدارِ تأییدشده): اجرا با نشانِ «کالیبره‌نشده برای این نصب» (اختیاری).
- [ ] **S34.10** اسکریپتِ `verify:deployment --server <ip> --db <name>`: پاسِ دومنبعیِ زنده (فاز ۳۳) را برای یک نصبِ خاص اجرا و رجیستریِ همان `deploymentId` را پر می‌کند.

---

## بخش ج — اعتبارسنجیِ end-to-end

### S34.11 — تأییدِ اثرگذاری
- [ ] **S34.11** تستِ اثبات: یک نگاشتِ `config/chartOfAccountsMapping.json` با کدهای **عمداً متفاوت** بساز؛ تأیید کن که SQLِ کامپایل‌شدهٔ یک متریکِ `customizable` واقعاً کدهای جدید را استفاده می‌کند (نه پیش‌فرض). این ثابت می‌کند wiring بسته شده. شاهدِ خام.
- [ ] **S34.12** رگرسیونِ سپیدار: با config پیش‌فرض/غایب، هر ۵ متریکِ verified همان اعداد قبلی را بدهند (بدونِ رگرسیون). شاهدِ خام.

## معیارِ خروجِ فاز ۳۴ (Exit Gate)
- [ ] نگاشتِ `config/chartOfAccountsMapping.json` هنگامِ اجرا بارگذاری و به موتور پاس داده می‌شود (تستِ اثبات با کدهای متفاوت سبز).
- [ ] برای نصبِ فعلیِ سپیدار رگرسیون رخ نداد.
- [ ] `buildMappingFromDiscovery` در مسیرِ اتصالِ نصبِ ناشناخته صدا زده می‌شود.
- [ ] مفهومِ کم‌اعتماد/کالیبره‌نشده → ردِ صریح، نه عددِ نامطمئن.
- [ ] رجیستری per-deployment شد؛ `verify:deployment` کار می‌کند.
- [ ] گزارشِ فاز طبقِ الگوی §۲۸.۷.
