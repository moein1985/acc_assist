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

## پیش‌نیازها

- **Node.js 20+** و **npm**.
- دسترسی به یک دیتابیس **SQL Server** (مستقیم یا از طریق SSH).
- یک کلید API معتبر برای provider هوش مصنوعی (کلید پیش‌فرضی در برنامه وجود ندارد و باید توسط کاربر وارد شود).

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

# smoke سریع برای PR (build + dry/refinement + golden score subset)
npm run smoke:fast

# smoke کامل orchestrator (build + dry/refinement + golden score + cancellation)
npm run smoke:full

# alias پیش فرض smoke (فعلاً برابر smoke:full)
npm run smoke

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

- provider پیش‌فرض سایت **avalapis.ir** است و از مسیر سازگار با OpenAI در `https://api.avalapis.ir/v1` استفاده می‌شود (`mode: openai`).
- مدل هدف **`gemini-2.5-pro`** است. این کلید چند مدل را در اختیار می‌گذارد، اما در این محصول فقط باید از `gemini-2.5-pro` استفاده شود.
- کلید API فقط از طریق تب Settings دریافت و در storage برنامه ذخیره می‌شود (با safeStorage در سیستم‌عامل). مقدار پیش‌فرض خالی است.
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

## IDE پیشنهادی

- [VS Code](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
