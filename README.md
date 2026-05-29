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
- یک کلید API برای provider هوش مصنوعی (به‌صورت پیش‌فرض روی AvalAPIs پیکربندی شده است).

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
```

## پیکربندی provider هوش مصنوعی

- provider پیش‌فرض سایت **avalapis.ir** است و از مسیر سازگار با OpenAI در `https://api.avalapis.ir/v1` استفاده می‌شود (`mode: openai`).
- مدل هدف **`gemini-2.5-pro`** است. این کلید چند مدل را در اختیار می‌گذارد، اما در این محصول فقط باید از `gemini-2.5-pro` استفاده شود.
- در وضعیت فعلی، یک کلید API به‌صورت هاردکد در `src/main/types.ts` داخل `DEFAULT_SETTINGS.gemini.apiKey` قرار دارد تا برنامه تا نقطه‌ی نهایی توسعه بدون نیاز به ورود دستی کلید اجرا شود. کاربر می‌تواند کلید را در تب تنظیمات تغییر دهد.
- حالت `google` فعلاً tool/function calling را پشتیبانی نمی‌کند؛ برای agent از حالت `openai` استفاده کنید.

## پیکربندی اتصال دیتابیس

تنظیمات از طریق تب **Settings** در برنامه قابل ویرایش است و با رمزنگاری ذخیره می‌شود:

- **SQL مستقیم:** host، database، user، password، port، encrypt و trustServerCertificate.
- **SSH tunnel:** host، port، username و password یا private key؛ به‌علاوه‌ی host/port مقصد دیتابیس.

پیشنهاد امنیتی: برای دسترسی برنامه یک **کاربر فقط‌خواندنی** در SQL Server بسازید. agent در حالت فعلی هیچ عملیات نوشتنی روی دیتابیس انجام نمی‌دهد و کوئری‌ها قبل از اجرا اعتبارسنجی می‌شوند تا فقط `SELECT`/`CTE` مجاز باشند.

## چک‌لیست تست دستی

1. ذخیره‌ی تنظیمات و بارگذاری مجدد آن‌ها.
2. تست اتصال مستقیم SQL.
3. تست اتصال از طریق SSH tunnel.
4. اجرای `dry-run` از تب تحلیل برای بررسی مسیر کامل tool-call.
5. یک پرسش مالی ساده و بررسی صحت پاسخ و شواهد.

## IDE پیشنهادی

- [VS Code](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
