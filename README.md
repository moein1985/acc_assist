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
- **موتور استدلال مالی (FRE)** با ۷۳ متریک (۵۸ پایه + ۱۵ مشتق) — معماری engine-only (legacy حذف شده).
- **کشف کور schema** — اتصال به هر دیتابیس SQL Server بدون دانش قبلی از ساختار جداول.
- **پشتیبانی چندنسخه‌ای** — تشخیص خودکار نسخه سپیدار و سازگاری متریک‌ها.
- **نردبان بازیابی** — ۵ پله: متریک کاتالوگ → جایگزین → تأیید معنایی → کاوشگر → رد صریح.
- **حلقهٔ agentic** — Router هوشمند، Smart Retry، Entity Resolution، drill-down مکالمه‌ای.
- **سندباکس پایتون ۳.۱۲** تعبیه‌شده برای محاسبات پیشرفته.
- **نمودار تعاملی** (Chart.js) + **گزارش زمان‌بندی‌شده** + **چندزبانه** (فارسی/انگلیسی/ترکیبی).
- **کالیبراسیون per-deployment** — نگاشت کدهای حساب قابل‌ تنظیم به‌ازای هر مشتری.
- اجرای فقط‌خواندنی کوئری با validation روی `SELECT` بودن کوئری در main process.
- کشف اولیه connector نرم افزار حسابداری برای **Sepidar** و **Mahak** در مسیر schema discovery.
- انتخاب دستی نرم افزار هدف (`auto/sepidar/mahak`) در schema mapping و اعمال آن در runtime context به عنوان نرم افزار موثر.
- ذخیره‌ی تنظیمات با رمزنگاری مقادیر حساس از طریق `safeStorage`.
- مسیر opt-in auto-update با `electron-updater` و بررسی `release:readiness` برای انتشار/rollback.
- **عملیات راه‌دور** — استقرار، تست دسته‌ای، استخراج لاگ و بررسی سلامت از طریق SSH با یک دستور.
- WebSocket mobile bridge (فعلاً placeholder).

## معماری

```text
Renderer (UI + chat + tool loop)
  -> IPC (preload)
Main Process
  -> SettingsStore (safeStorage)
  -> GeminiClient (AvalAPIs / Gemini)
  -> FinancialEngine (FRE)
       -> Router → Planner → Semantic Layer → Compiler → Executor → Verifier → Explainer
       -> Recovery Ladder (۵ پله) + Investigator Loop
  -> SqlConnectionManager (mssql + validator فقط‌خواندنی)
  -> SshTunnelService (ssh2)
  -> PythonRunnerService (embedded Python 3.12)
  -> AuditLogService + TelemetryIngestService
  -> MobileBridgeServer (WebSocket)
SQL Server / SSH Tunnel
```

## Financial Reasoning Engine (FRE)

موتور استدلال مالی (FRE) لایهٔ معنایی و کامپایلر قطعی است که جایگزین هندلرهای دست‌سازِ deterministic شده است. اصل: **هستهٔ قطعی، پوستهٔ احتمالی** — مدل هرگز عدد تولید نمی‌کند؛ فقط برنامه‌ریزی (`MetricPlan`) و توضیح می‌کند. عددها فقط از اجرای SQLِ قطعی و تأییدشده می‌آیند.

### معماری Engine-Only
از فاز ۲۴، legacy کاملاً حذف شد و موتور FRE تنها ورودی برای پرسش‌های مالی است. هیچ fallback به هندلرهای قدیمی وجود ندارد. هر خطای کامپایلر/اجرا → **ردِ صریحِ بی‌عدد**.

### متریک‌های FRE (۷۳ متریک: ۵۸ پایه + ۱۵ مشتق)

**متریک‌های پایه:** `net_sales`, `purchases`, `account_balance`, `trial_balance`, `cash_bank_balance`, `sales_count`, `fiscal_year_count`, `fiscal_year_list`, `party_balance`, `receivables`, `payables`, `cashflow`, `sales_by_period`, `account_turnover`, `recent_documents`, `balance_sheet`, `income_statement`, `total_assets`, `total_liabilities`, `total_equity`, `total_revenue`, `total_expenses`, `cogs`, `net_profit`, `tax_paid`, `tax_collected`, `inventory_value`, `inventory_turnover`, `voucher_detail`, `vouchers_by_date`, `vouchers_by_type`, `unbalanced_vouchers`, `zero_amount_invoices`, `duplicate_vouchers`, `vouchers_without_account`, `receivables_aging`, `payables_aging`, `party_turnover`, `tax_monthly_summary`, `invoices_without_tax`, `vat_liability`, `checks_due`, `checks_bounced`, `checks_summary`, `closing_status`, `trial_balance_check`, `period_comparison`, `sales_reconciliation`, `purchase_reconciliation`, `inventory_reconciliation`, `cash_flow_statement`, `cash_flow_direct`, `trend_analysis`, `fixed_assets_register`, `depreciation_summary`, `cost_center_detailed`, `cogs_detailed`, `bank_reconciliation`, `vat_detailed`, `tax_liability_summary`

**متریک‌های مشتق:** `sales_to_purchase_ratio`, `gross_margin`, `net_margin`, `current_ratio`, `debt_to_equity`, `roe`, `roa`, `operating_margin`, `cash_ratio`, `asset_turnover`, `inventory_turnover_ratio`, `receivables_turnover`, `accounts_payable_turnover`, `interest_coverage`, `debt_service_coverage`, `cagr`, `growth_rate`

### MultiMetricPlan و MultiStepPlan
پرسش‌های چندمتریکی (مثل «فروش و خرید ۱۴۰۲») با `MultiMetricPlan` و `joinMode` (`side_by_side`, `comparison`, `trend`) و `MultiStepPlan` با `combineStrategy` (`compare`, `cascade`, `explain`) پشتیبانی می‌شوند.

### Planner هوشمند
- **Model Planner:** پرامپت با ۳۲+ مثال few-shot، شِمای `MetricPlan` و `MultiMetricPlan`.
- **Smart Clarify:** وقتی confidence پایین است، سؤالِ شفاف‌سازی + ۳ پیشنهاد ارائه می‌شود.
- **زبانِ محاوره‌ای:** استخراجِ خودکارِ سالِ جاریِ شمسی، الگوهای نامِ موجودیت، و بازه‌های تاریخ با نام ماه‌های شمسی.
- **Drill-down مکالمه‌ای:** پرسش‌های پیگیری زمینهٔ پرسشِ قبلی را به ارث می‌برند.
- **خوداصلاحی planner:** retry با بازخوردِ اصلاحی در صورت JSON نامعتبر.

### نردبان بازیابی (Recovery Ladder)
هر پرسش مالی از این نردبان بالا می‌رود؛ ردِ صریح فقط پلهٔ آخر است:
1. مسیر متریک کاتالوگ (سریع، قطعی)
2. متریک جایگزین/مشتق (هم‌معنا)
3. تأیید معنایی (semantic verify)
4. کاوشگر (Investigator loop)
5. ردِ صریحِ بی‌عدد

### کشف کور Schema و چندنسخه‌ای
- **Blind Schema Discovery:** اتصال به هر دیتابیس SQL Server بدون دانش قبلی — کشف جداول، نگاشت مفاهیم، ساخت آداپتور.
- **Multi-Version Sepidar:** تشخیص خودکار نسخه سپیدار و سازگاری متریک‌ها (تأیید روی Sepidar01 و Sepidar03).
- **کالیبراسیون per-deployment:** نگاشت کدهای حساب قابل تنظیم به‌ازای هر مشتری با UI کالیبراسیون.

### مقیاس‌پذیری
افزودن متریک جدید = فقط یک `MetricDefinition` در `metricCatalog.ts` + یک golden test. بدون هندلر TypeScript جدید. اثبات‌شده با ۷۳ متریک.

### ارزیابی خودکار
```bash
npm run eval:metrics       # 274/274 golden cases (offline)
npm run eval:metrics:live  # 278/278 golden cases (live, diff=0)
npm run test:regression    # 97/97 regression corpus
npm run test:unit          # 603 unit tests
npm run test:integration   # 26 integration tests
```

### مستندات نقشهٔ راه
- [FRE_ROADMAP_00_OVERVIEW.fa.md](./FRE_ROADMAP_00_OVERVIEW.fa.md) — سند ریشه (فازهای ۱–۴۱ + وضعیت)
- [FRE_ROADMAP_01_FOUNDATION_AND_MODULE_SPLIT.fa.md](./FRE_ROADMAP_01_FOUNDATION_AND_MODULE_SPLIT.fa.md) — فاز ۱
- [FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md](./FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md) — فاز ۲-۳
- [FRE_ROADMAP_03_PLANNER_AND_VERIFIER.fa.md](./FRE_ROADMAP_03_PLANNER_AND_VERIFIER.fa.md) — فاز ۴-۵
- [FRE_ROADMAP_04_EVAL_DEPLOY_AND_CUTOVER.fa.md](./FRE_ROADMAP_04_EVAL_DEPLOY_AND_CUTOVER.fa.md) — فاز ۶
- [FRE_ROADMAP_05_PHASE7_LEGACY_MIGRATION.fa.md](./FRE_ROADMAP_05_PHASE7_LEGACY_MIGRATION.fa.md) — فاز ۷
- [FRE_ROADMAP_06_PHASE8_MULTI_METRIC.fa.md](./FRE_ROADMAP_06_PHASE8_MULTI_METRIC.fa.md) — فاز ۸
- [FRE_ROADMAP_07_PHASE9_PRODUCTION.fa.md](./FRE_ROADMAP_07_PHASE9_PRODUCTION.fa.md) — فاز ۹
- [FRE_ROADMAP_08_PHASE10_PLANNER.fa.md](./FRE_ROADMAP_08_PHASE10_PLANNER.fa.md) — فاز ۱۰
- [FRE_ROADMAP_09_PHASE11_SEPIDAR_DEPTH.fa.md](./FRE_ROADMAP_09_PHASE11_SEPIDAR_DEPTH.fa.md) — فاز ۱۱
- [FRE_ROADMAP_10_PHASE12_SCHEMA_ABSTRACTION.fa.md](./FRE_ROADMAP_10_PHASE12_SCHEMA_ABSTRACTION.fa.md) — فاز ۱۲
- [FRE_ROADMAP_11_PHASE13_ADVANCED_MANAGEMENT.fa.md](./FRE_ROADMAP_11_PHASE13_ADVANCED_MANAGEMENT.fa.md) — فاز ۱۳
- [FRE_ROADMAP_12_PHASE14_ACCOUNTANT_TOOLS.fa.md](./FRE_ROADMAP_12_PHASE14_ACCOUNTANT_TOOLS.fa.md) — فاز ۱۴
- [FRE_ROADMAP_13_PHASE15_BLIND_SCHEMA_DISCOVERY.fa.md](./FRE_ROADMAP_13_PHASE15_BLIND_SCHEMA_DISCOVERY.fa.md) — فاز ۱۵
- [FRE_ROADMAP_14_PHASE16_SSH_REMOTE_CONNECTION.fa.md](./FRE_ROADMAP_14_PHASE16_SSH_REMOTE_CONNECTION.fa.md) — فاز ۱۶
- [FRE_ROADMAP_15_PHASE17_ARCH_FIXES.fa.md](./FRE_ROADMAP_15_PHASE17_ARCH_FIXES.fa.md) — فاز ۱۷
- [FRE_ROADMAP_16_PHASE18_PYTHON_SANDBOX.fa.md](./FRE_ROADMAP_16_PHASE18_PYTHON_SANDBOX.fa.md) — فاز ۱۸
- [FRE_ROADMAP_17_PHASE19_ADVANCED_FINANCIAL_METRICS.fa.md](./FRE_ROADMAP_17_PHASE19_ADVANCED_FINANCIAL_METRICS.fa.md) — فاز ۱۹
- [FRE_ROADMAP_18_PHASE20_ADVANCED_PLANNER.fa.md](./FRE_ROADMAP_18_PHASE20_ADVANCED_PLANNER.fa.md) — فاز ۲۰
- [FRE_ROADMAP_19_PHASE21_UX_REPORTING.fa.md](./FRE_ROADMAP_19_PHASE21_UX_REPORTING.fa.md) — فاز ۲۱
- [FRE_ROADMAP_20_PHASE22_AGENTIC_LOOP.fa.md](./FRE_ROADMAP_20_PHASE22_AGENTIC_LOOP.fa.md) — فاز ۲۲
- [FRE_ROADMAP_21_CORRECTION_OVERVIEW.fa.md](./FRE_ROADMAP_21_CORRECTION_OVERVIEW.fa.md) — سری اصلاح (فاز ۲۳–۲۴)
- [FRE_ROADMAP_22_PHASE23_ANTI_HALLUCINATION.fa.md](./FRE_ROADMAP_22_PHASE23_ANTI_HALLUCINATION.fa.md) — فاز ۲۳
- [FRE_ROADMAP_23_PHASE24_LEGACY_REMOVAL.fa.md](./FRE_ROADMAP_23_PHASE24_LEGACY_REMOVAL.fa.md) — فاز ۲۴
- [FRE_ROADMAP_24_PHASE25_PARTY_LEDGER.fa.md](./FRE_ROADMAP_24_PHASE25_PARTY_LEDGER.fa.md) — فاز ۲۵
- [FRE_ROADMAP_25_PHASE26_INVESTIGATOR_LOOP.fa.md](./FRE_ROADMAP_25_PHASE26_INVESTIGATOR_LOOP.fa.md) — فاز ۲۶
- [FRE_ROADMAP_26_PHASE27_BLIND_DISCOVERY.fa.md](./FRE_ROADMAP_26_PHASE27_BLIND_DISCOVERY.fa.md) — فاز ۲۷
- [FRE_ROADMAP_27_PHASE28_TEST_TRUTH_AND_CUTOVER.fa.md](./FRE_ROADMAP_27_PHASE28_TEST_TRUTH_AND_CUTOVER.fa.md) — فاز ۲۸
- [FRE_ROADMAP_28_VERIFICATION_OVERVIEW.fa.md](./FRE_ROADMAP_28_VERIFICATION_OVERVIEW.fa.md) — سری تأیید (فاز ۲۹–۳۸)
- [FRE_ROADMAP_29_PHASE29_GROUNDTRUTH_SWEEP.fa.md](./FRE_ROADMAP_29_PHASE29_GROUNDTRUTH_SWEEP.fa.md) — فاز ۲۹
- [FRE_ROADMAP_30_PHASE30_ACCOUNTANT_DEEP_VERIFICATION.fa.md](./FRE_ROADMAP_30_PHASE30_ACCOUNTANT_DEEP_VERIFICATION.fa.md) — فاز ۳۰
- [FRE_ROADMAP_31_PHASE31_REFUSAL_ANALYTICS_COVERAGE.fa.md](./FRE_ROADMAP_31_PHASE31_REFUSAL_ANALYTICS_COVERAGE.fa.md) — فاز ۳۱
- [FRE_ROADMAP_32_PHASE32_PER_DEPLOYMENT_CALIBRATION.fa.md](./FRE_ROADMAP_32_PHASE32_PER_DEPLOYMENT_CALIBRATION.fa.md) — فاز ۳۲
- [FRE_ROADMAP_33_PHASE33_VERIFICATION_INTEGRITY.fa.md](./FRE_ROADMAP_33_PHASE33_VERIFICATION_INTEGRITY.fa.md) — فاز ۳۳
- [FRE_ROADMAP_34_PHASE34_CALIBRATION_RUNTIME_WIRING.fa.md](./FRE_ROADMAP_34_PHASE34_CALIBRATION_RUNTIME_WIRING.fa.md) — فاز ۳۴
- [FRE_ROADMAP_35_PHASE35_CALIBRATION_UI.fa.md](./FRE_ROADMAP_35_PHASE35_CALIBRATION_UI.fa.md) — فاز ۳۵ (UI کالیبراسیون)
- [FRE_ROADMAP_35_PHASE35_METRIC_ALIGNMENT.fa.md](./FRE_ROADMAP_35_PHASE35_METRIC_ALIGNMENT.fa.md) — فاز ۳۵ (هم‌سازی متریک)
- [FRE_ROADMAP_36_PHASE36_VERIFICATION_HARNESS_REPAIR.fa.md](./FRE_ROADMAP_36_PHASE36_VERIFICATION_HARNESS_REPAIR.fa.md) — فاز ۳۶
- [FRE_ROADMAP_37_PHASE37_LIVE_FIELD_TEST_50.fa.md](./FRE_ROADMAP_37_PHASE37_LIVE_FIELD_TEST_50.fa.md) — فاز ۳۷
- [FRE_ROADMAP_38_PHASE38_FIELD_DEFECT_CLOSURE.fa.md](./FRE_ROADMAP_38_PHASE38_FIELD_DEFECT_CLOSURE.fa.md) — فاز ۳۸
- [FRE_ROADMAP_39_PERSISTENCE_OVERVIEW.fa.md](./FRE_ROADMAP_39_PERSISTENCE_OVERVIEW.fa.md) — سری پختگی (فاز ۳۹–۴۱)
- [FRE_ROADMAP_40_PHASE39_PERSISTENCE_RECOVERY_CORE.fa.md](./FRE_ROADMAP_40_PHASE39_PERSISTENCE_RECOVERY_CORE.fa.md) — فاز ۳۹
- [FRE_ROADMAP_41_PHASE40_INTENT_ROBUSTNESS_REGRESSION.fa.md](./FRE_ROADMAP_41_PHASE40_INTENT_ROBUSTNESS_REGRESSION.fa.md) — فاز ۴۰
- [FRE_ROADMAP_42_PHASE41_MULTI_VERSION_SEPIDAR.fa.md](./FRE_ROADMAP_42_PHASE41_MULTI_VERSION_SEPIDAR.fa.md) — فاز ۴۱
- [FRE_ROADMAP_43_REMOTE_OPS_TOOLKIT.fa.md](./FRE_ROADMAP_43_REMOTE_OPS_TOOLKIT.fa.md) — فاز ۴۳ (عملیات راه‌دور)
- [ops/SSH-TELEMETRY-GUIDE.md](./ops/SSH-TELEMETRY-GUIDE.md) — راهنمای SSH و تله‌متری

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
