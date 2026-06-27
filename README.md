# ACC Assist

دستیار هوش مصنوعی مالی و حسابداری برای صاحبان کسب‌وکار.

ACC Assist یک اپ دسکتاپ مبتنی بر Electron + TypeScript است که مانند یک agent عمل می‌کند: کاربر با زبان طبیعی (فارسی) سؤال مالی می‌پرسد، برنامه به دیتابیس نرم‌افزار حسابداری متصل می‌شود، داده‌ی واقعی را فقط به‌صورت **خواندنی** استخراج می‌کند و پاسخ مستند را در چت نمایش می‌دهد.

نمونه‌ی سؤال:

> آقای مرادی طی سه ماه گذشته چقدر تنخواه دریافت کرده؟

در این سناریو agent خودش جدول‌ها و ستون‌های مرتبط را کشف می‌کند، مفهوم سؤال را به یک کوئری امن `SELECT` تبدیل می‌کند و خروجی عددی را همراه با شواهد نشان می‌دهد.

> برای نقشه‌ی راه فازبندی‌شده و وضعیت پیاده‌سازی، فایل [ROADMAP.fa.md](./ROADMAP.fa.md) را ببینید.

## قابلیت‌های فعلی

- اتصال مستقیم به **SQL Server** با پکیج `mssql`.
- اتصال از طریق **SSH tunnel** (با `ssh2`) وقتی دیتابیس روی سرور دیگری قرار دارد.
- کلاینت AI با دو حالت `openai` (سازگار با OpenAI) و `google` (Google-native).
- حلقه‌ی tool-call با سه ابزار: `list_database_tables`، `get_database_schema` و `fetch_financial_data`.
- اجرای فقط‌خواندنی کوئری با validation روی `SELECT` بودن کوئری در main process.
- کشف اولیه connector نرم افزار حسابداری برای **Sepidar** و **Mahak** در مسیر schema discovery.
- انتخاب دستی نرم افزار هدف (`auto/sepidar/mahak`) در schema mapping و اعمال آن در runtime context به عنوان نرم افزار موثر.
- ذخیره‌ی تنظیمات با رمزنگاری مقادیر حساس از طریق `safeStorage`.
- مسیر opt-in auto-update با `electron-updater` و بررسی `release:readiness` برای انتشار/rollback.
- WebSocket mobile bridge (فعلاً placeholder).

## معماری

```text
Renderer (UI + chat + tool loop)
  -> IPC (preload)
Main Process
  -> SettingsStore (safeStorage)
  -> GeminiClient (AvalAPIs / Gemini)
  -> SqlConnectionManager (mssql + validator فقط‌خواندنی)
  -> SshTunnelService (ssh2)
  -> MobileBridgeServer (WebSocket)
SQL Server / SSH Tunnel
```

## Financial Reasoning Engine (FRE)

موتور استدلال مالی (FRE) لایهٔ معنایی و کامپایلر قطعی است که جایگزین هندلرهای دست‌سازِ deterministic شده است. اصل: **هستهٔ قطعی، پوستهٔ احتمالی** — مدل هرگز عدد تولید نمی‌کند؛ فقط برنامه‌ریزی (`MetricPlan`) و توضیح می‌کند. عددها فقط از اجرای SQLِ قطعی و تأییدشده می‌آیند.

### حالت‌های عملیات (`ACC_FINANCIAL_ENGINE_MODE`)
- `legacy` — فقط هندلرهای قدیمی (رفتار پیش از FRE)
- `shadow` — هر دو مسیر اجرا می‌شوند؛ خروجی کاربر از legacy، مقایسه و لاگ می‌شود
- `engine` — موتورِ نو به کاربر سرویس می‌دهد؛ legacy فقط fallback

### متریک‌های FRE (۱۵ متریک)
`net_sales`, `purchases`, `account_balance`, `trial_balance`, `cash_bank_balance`, `sales_count`, `fiscal_year_count`, `fiscal_year_list`, `party_balance`, `receivables`, `payables`, `cashflow`, `sales_by_period`, `account_turnover`, `recent_documents`

### متریک‌های مشتق (DerivedMetric)
`sales_to_purchase_ratio`, `gross_margin` — از ورودی‌های متریک‌های پایه محاسبه می‌شوند.

### MultiMetricPlan
پرسش‌های چندمتریکی (مثل «فروش و خرید ۱۴۰۲») با `MultiMetricPlan` و `joinMode` (`side_by_side`, `comparison`, `trend`) پشتیبانی می‌شوند.

### Planner هوشمند
- **Model Planner:** پرامپت با ۱۲+ مثال few-shot، شِمای `MetricPlan` و `MultiMetricPlan`.
- **Smart Clarify:** وقتی confidence پایین است، سؤالِ شفاف‌سازی + ۳ پیشنهاد ارائه می‌شود.
- **زبانِ محاوره‌ای:** استخراجِ خودکارِ سالِ جاریِ شمسی، الگوهای نامِ موجودیت، و بازه‌های تاریخ با نام ماه‌های شمسی.

### هنوز legacy-only (۹ intent — در حال حذف)
`count_fiscal_years`, `list_fiscal_years`, `get_party_balance`, `get_account_turnover`, `get_sales_summary_by_period`, `get_receivables_summary`, `get_payables_summary`, `get_cashflow_summary`, `get_recent_or_suspicious_documents`

### مقیاس‌پذیری
افزودن متریک جدید = فقط یک `MetricDefinition` در `metricCatalog.ts` + یک golden test. بدون هندلر TypeScript جدید. اثبات‌شده با `sales_count`.

### ارزیابی خودکار
```bash
npm run eval:metrics    # 42/42 golden cases
```

### مستندات نقشهٔ راه
- [FRE_ROADMAP_00_OVERVIEW.fa.md](./FRE_ROADMAP_00_OVERVIEW.fa.md) — سند ریشه
- [FRE_ROADMAP_01_FOUNDATION_AND_MODULE_SPLIT.fa.md](./FRE_ROADMAP_01_FOUNDATION_AND_MODULE_SPLIT.fa.md) — فاز ۱
- [FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md](./FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md) — فاز ۲-۳
- [FRE_ROADMAP_03_PLANNER_AND_VERIFIER.fa.md](./FRE_ROADMAP_03_PLANNER_AND_VERIFIER.fa.md) — فاز ۴-۵
- [FRE_ROADMAP_04_EVAL_DEPLOY_AND_CUTOVER.fa.md](./FRE_ROADMAP_04_EVAL_DEPLOY_AND_CUTOVER.fa.md) — فاز ۶
- [FRE_ROADMAP_05_PHASE7_LEGACY_MIGRATION.fa.md](./FRE_ROADMAP_05_PHASE7_LEGACY_MIGRATION.fa.md) — فاز ۷
- [FRE_ROADMAP_06_PHASE8_MULTI_METRIC.fa.md](./FRE_ROADMAP_06_PHASE8_MULTI_METRIC.fa.md) — فاز ۸
- [FRE_ROADMAP_07_PHASE9_PRODUCTION.fa.md](./FRE_ROADMAP_07_PHASE9_PRODUCTION.fa.md) — فاز ۹
- [FRE_ROADMAP_08_PHASE10_PLANNER.fa.md](./FRE_ROADMAP_08_PHASE10_PLANNER.fa.md) — فاز ۱۰

## پیش‌نیازها

- **Node.js 20+** و **npm**.
- دسترسی به یک دیتابیس **SQL Server** (مستقیم یا از طریق SSH).
- یک کلید API معتبر برای provider هوش مصنوعی. در نسخه فعلی مقدار پیش‌فرض در کد خالی است و کاربر/محیط باید آن را در تنظیمات وارد کند؛ برای محیط‌های توسعه/CI می‌توان از متغیرهای محیطی یا storage برنامه استفاده کرد.

## نصب

```bash
npm install
```

## اجرای حالت توسعه

```bash
npm run dev
```

## بررسی نوع و ساخت

```bash
# بررسی نوع (main + renderer)
npm run typecheck

# ساخت برای ویندوز
npm run build:win

# ساخت برای macOS
npm run build:mac

# ساخت برای لینوکس
npm run build:linux

# release readiness check (advisory)
npm run release:readiness

# release readiness check (enforce signing env vars)
npm run release:readiness:strict

# version bump helpers
npm run release:version:patch
npm run release:version:minor
npm run release:version:major
npm run release:version:beta
npm run release:version:rc

# smoke سریع برای PR (build + dry/refinement + golden score subset)
npm run smoke:fast

# smoke کامل orchestrator (build + dry/refinement + golden score + cancellation)
npm run smoke:full

# alias پیش فرض smoke (فعلاً برابر smoke:full)
npm run smoke

# smoke live اختیاری روی محیط ریموت (PromptBase64)
npm run smoke:live:agent

# smoke live اختیاری بدون fail کردن CI/local (best-effort)
npm run smoke:live:agent:allow-failure

# تست های unit (validator/discovery)
npm run test:unit

# تست های integration (agent tool loop)
npm run test:integration

# اجرای کامل تست ها
npm run test

# اعتبارسنجی connector روی دیتابیس واقعی (live)
npm run validate:connector:live
```

### اعتبارسنجی connector روی دیتابیس واقعی

برای اینکه تشخیص نرم افزار و کیفیت mapping روی دیتابیس واقعی سپیدار/محک سنجیده شود، اسکریپت زیر اضافه شده است:

- command: `npm run validate:connector:live`
- file: `scripts/validate-connector-live.ts`

نمونه اجرا در PowerShell:

```powershell
$env:ACC_SQL_SERVER="127.0.0.1"
$env:ACC_SQL_DATABASE="SepidarSample"
$env:ACC_SQL_USER="readonly_user"
$env:ACC_SQL_PASSWORD="your_password"
$env:ACC_EXPECTED_SOFTWARE="sepidar"
$env:ACC_VALIDATE_MIN_CONFIDENCE="0.70"
npm run validate:connector:live
```

خروجی اسکریپت شامل این موارد است:

- health check اتصال SQL (نسخه سرور، کاربر، read-only بودن دسترسی)
- نتیجه schema discovery (تعداد جدول ها، date mode، software candidates)
- سنجش پوشش مفاهیم کلیدی connector (documents/documentLines/counterparties)
- fail با exit code غیرصفر در صورت mismatch مهم (مثلا software اشتباه یا mapping ناکافی)

### سیاست کیفیت Smoke

- در smoke orchestrator یک gate سراسری کیفیت فعال است: هم `avg` و هم `min` score باید از آستانه کمتر نباشند.
- آستانه پیش فرض برابر `95` است و اگر رعایت نشود، smoke با exit code غیرصفر fail می شود.
- تست های `unit/integration` روی دیتاست synthetic در `scripts/fixtures/synthetic-accounting-db.json` اجرا می شوند.
- در CI، job سریع روی `ubuntu-latest` و `windows-latest` اجرا می شود و job کامل روی `main/workflow_dispatch` فعال است.

```bash
# تغییر آستانه در PowerShell
$env:SMOKE_GLOBAL_MIN_SCORE=97; npm run smoke:full

# یا با آرگومان مستقیم به smoke agent
npm run smoke:agent:full -- --global-min-score=97
```

## پیکربندی provider هوش مصنوعی

- provider پیش‌فرض سایت **avalai.ir** است و از مسیر سازگار با OpenAI در `https://api.avalai.ir/v1` استفاده می‌شود (`mode: openai`).
- مدل هدف **`gemini-2.5-pro`** است. این کلید چند مدل را در اختیار می‌گذارد، اما در این محصول فقط باید از `gemini-2.5-pro` استفاده شود.
- کلید API فقط از طریق تب Settings دریافت و در storage برنامه ذخیره می‌شود (با safeStorage در سیستم‌عامل). مقدار پیش‌فرض در کد خالی است و نباید به‌صورت hardcoded در مخزن باقی بماند.
- حالت `google` فعلاً tool/function calling را پشتیبانی نمی‌کند؛ برای agent از حالت `openai` استفاده کنید.

## پیکربندی اتصال دیتابیس

تنظیمات از طریق تب **Settings** در برنامه قابل ویرایش است و با رمزنگاری ذخیره می‌شود:

- **SQL مستقیم:** host، database، user، password، port، encrypt و trustServerCertificate.
- **SSH tunnel:** host، port، username و password یا private key؛ به‌علاوه‌ی host/port مقصد دیتابیس.

پیشنهاد امنیتی: برای دسترسی برنامه یک **کاربر فقط‌خواندنی** در SQL Server بسازید. agent در حالت فعلی هیچ عملیات نوشتنی روی دیتابیس انجام نمی‌دهد و کوئری‌ها قبل از اجرا اعتبارسنجی می‌شوند تا فقط `SELECT`/`CTE` مجاز باشند.

در نسخه فعلی، policy خواندن امن سخت‌گیرانه‌تر شده است: اجرای `SELECT *` در مسیر agent-data، query hint (`OPTION(...)`) و clauseهای `FOR JSON/FOR XML` مسدود می‌شوند، و برای کوئری‌های non-aggregate محدودشده وجود `ORDER BY` الزامی است. همچنین در صورت فعال بودن `sqlSecurity.enforceReadOnlyLogin` اجرای کوئری با کاربر دارای دسترسی نوشتن متوقف می‌شود.

## چک‌لیست تست دستی

1. ذخیره‌ی تنظیمات و بارگذاری مجدد آن‌ها.
2. تست اتصال مستقیم SQL.
3. تست اتصال از طریق SSH tunnel.
4. اجرای `dry-run` از تب تحلیل برای بررسی مسیر کامل tool-call.
5. یک پرسش مالی ساده و بررسی صحت پاسخ و شواهد.

## Smoke Live اختیاری با PromptBase64

برای smoke زنده ریموت، اسکریپت [scripts/ops/smoke-live-agent.ps1](scripts/ops/smoke-live-agent.ps1) اضافه شده که prompt را همیشه با Base64 ارسال می‌کند تا مشکل quoting فارسی در npm/PowerShell حذف شود.

نمونه اجرا:

```powershell
# اجرای پیش فرض (prompt فارسی تستی)
npm run smoke:live:agent

# اجرای با prompt فایل
pwsh -ExecutionPolicy Bypass -File scripts/ops/smoke-live-agent.ps1 -PromptFile scripts/fixtures/live-smoke-prompt.fa.txt

# اجرای با assertion سفارشی روی خروجی
pwsh -ExecutionPolicy Bypass -File scripts/ops/smoke-live-agent.ps1 -ExpectedContains 'سال مالی','Evidence'
```

نکته:

- این smoke اختیاری است و برای محیط‌هایی که سرور ریموت در دسترس نیست، می‌توانید از حالت `-AllowFailure` یا `npm run smoke:live:agent:allow-failure` استفاده کنید.

## Debug Endpoint و Release Hardening

- debug endpoint داخلی فقط با opt-in صریح بالا می‌آید؛ در buildهای عادی release فعال نمی‌شود.
- برای فعال‌سازی دستی باید هر دو متغیر زیر تنظیم شوند:

```powershell
$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
$env:ACC_AGENT_DEBUG_TOKEN = 'یک-توکن-تصادفی-طولانی'
```

- اسکریپت‌های remote live به‌صورت per-run token تولید می‌کنند تا secret ثابت داخل سورس باقی نماند.

## Release Versioning and Rollback

برای انتشار و rollback از مسیرهای زیر استفاده کنید:

```bash
npm run release:version:patch
npm run release:version:minor
npm run release:version:major
npm run release:version:beta
npm run release:version:rc
npm run release:readiness
```

برای rollback روی artifactهای update:

```powershell
pwsh -ExecutionPolicy Bypass -File scripts/ops/rollback-release.ps1 `
  -UpdatesRoot "D:\updates\desktop" `
  -BackupRoot "D:\updates\backups\2026-06-11" `
  -PreviousVersion "1.0.0" `
  -Channel latest
```

این مسیرها باید قبل از rollout و بعد از هر بازگشت، با `release:readiness` و یک smoke canary تست شوند.

## Auto-Update Channel Strategy

- زیرساخت auto-update با `electron-updater` اضافه شده اما به‌صورت پیش‌فرض خاموش است (opt-in).
- برای فعال سازی در runtime متغیرهای محیطی زیر را قبل از اجرای برنامه تنظیم کنید:

```powershell
$env:ACC_ENABLE_AUTO_UPDATE = '1'
$env:ACC_AUTO_UPDATE_CHANNEL = 'latest' # latest | rc | beta | alpha
$env:ACC_AUTO_UPDATE_AUTO_DOWNLOAD = '1' # 1 = دانلود خودکار
```

- channel پیش فرض build در `electron-builder.yml` روی `latest` است.
- برای buildهای pre-release می‌توانید version را به `-beta` یا `-rc` ببرید و فایل channel متناظر را روی update server منتشر کنید.

## Production Secret Policy

- هیچ credential یا token توسعه ای نباید در `DEFAULT_SETTINGS` یا scriptها hardcode شود.
- کلید API، SQL user/password و telemetry token باید در runtime توسط کاربر/محیط تامین شوند.
- در automation ریموت از متغیرهای محیطی استفاده کنید و از ثبت آن ها در git خودداری کنید.

متغیرهای محیطی پیشنهادی برای scriptهای `scripts/ops/remote-server-control.ps1`:

```powershell
$env:ACC_REMOTE_HOST = 'server-or-ip'
$env:ACC_REMOTE_USER = 'administrator'
$env:ACC_REMOTE_SSH_PASSWORD = '...'
$env:ACC_REMOTE_HOST_KEY = 'ssh-ed25519 255 SHA256:...'
$env:ACC_REMOTE_SQL_USER = 'readonly_user'
$env:ACC_REMOTE_SQL_PASSWORD = '...'
```

متغیر محیطی مورد نیاز برای `scripts/ops/telemetry-smoke-test.mjs`:

```powershell
$env:ACC_TELEMETRY_BEARER_TOKEN = '...'
```

نکته امنیتی:

- از user فقط خواندنی SQL در production استفاده کنید و `enforceReadOnlyLogin` را روشن نگه دارید.

## Rollback Runbook (Update Artifacts)

برای rollback سریع artifactهای update (generic provider)، ابتدا از `latest.yml/beta.yml/...` و artifactهای release قبلی backup بگیرید. سپس:

```powershell
pwsh -ExecutionPolicy Bypass -File scripts/ops/rollback-release.ps1 `
  -UpdatesRoot "D:\updates\desktop" `
  -BackupRoot "D:\updates\backups\2026-06-09" `
  -PreviousVersion "1.0.2" `
  -Channel latest
```

حالت dry-run:

```powershell
npm run release:rollback -- -UpdatesRoot "D:\updates\desktop" -BackupRoot "D:\updates\backups\2026-06-09" -PreviousVersion "1.0.2" -Channel latest -WhatIfMode
```

توصیه عملیاتی:

- قبل از rollback، pipeline انتشار channel را متوقف کنید.
- بعد از rollback یک canary update test روی یک ماشین اجرا کنید.
- فایل تولیدشده `build/release-rollback-plan.json` (از `release:readiness`) را کنار artifactها نگه دارید.

## IDE پیشنهادی

- [VS Code](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
