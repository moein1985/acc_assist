# FRE Roadmap 43 — ماژولِ عملیاتِ راه‌دور (Remote Ops Toolkit)
### Remote Operations Reusable Module — «یک‌بار بنویس، هر جلسه استفاده کن»

> پیش‌نیاز: هیچ (ابزارِ زیرساختی، مستقل از فازهای قابلی).
> مسئله: در هر جلسهٔ تستِ میدانی، زمانِ زیادی صرفِ نوشتن اسکریپتِ یک‌بارمصرف برای deploy، start/stop، send query و audit log می‌شود. با وجودِ `remote-server-control.ps1` فعلی، چند قابلیتِ کلیدی غایب است که هر بار به‌صورتِ دستی پیاده می‌شود.

**فایل‌های این فاز:** `scripts/ops/remote-server-control.ps1` (گسترش)، `package.json` (npm scripts جدید)، `ops/SSH-TELEMETRY-GUIDE.md` (بروزرسانی).

---

## بخش الف — قابلیت‌های غایب

### RO.1 — deploy-asar: استقرارِ سریعِ app.asar
- [x] **RO.1** اکشنِ `deploy-asar`: stop app → copy `app.asar` + `snapshot_blob.bin` + `v8_context_snapshot.bin` از `dist\win-unpacked` (یا `dist2\win-unpacked`) به سرور → اختیاری write settings → start app. پارامترها: `-LocalBuildDir`، `-WriteSettings` (switch)۔ شاهد: یک دستور `npm run remote:deploy-asar` کلِ چرخهٔ استقرار را انجام دهد.

### RO.2 — رفعِ encoding فارسی در ask-ai
- [x] **RO.2** اکشنِ `ask-ai` فعلی از `prompt` (plain text) استفاده می‌کند که در مسیرِ SSH به mojibake تبدیل می‌شود. رفع: ارسال با `promptBase64` به‌جای `prompt` در body. تابعِ `Convert-ToPromptBase64` از قبل وجود دارد ولی در body نهایی استفاده نمی‌شود. شاهد: `npm run remote:ask-ai -- -Prompt "مانده طرف حساب معین محسنی فرد"` متنِ فارسیِ درست را به سرور برساند.

### RO.3 — ask-batch: چند پرسش در یک نشستِ SSH
- [x] **RO.3** اکشنِ `ask-batch`: آرایه‌ای از پرسش‌ها را در یک نشستِ واحدِ SSH بفرستد (جلوگیری از crash app هنگام بسته شدنِ SSH). پارامترها: `-QuestionsFile` (فایل JSON با `{ id, prompt, expectedMetricId? }`) یا `-QuestionsJson` (رشتهٔ JSON). خروجی: جدولِ نتایج با `id, ok, requestId, verdict, finalTextLen`. شاهد: `npm run remote:ask-batch -- -QuestionsFile scripts/ops/test-questions.json`.

### RO.4 — audit-log: جستجوی audit بر اساسِ requestId
- [x] **RO.4** اکشنِ `audit-log`: لاگِ audit سرور را بر اساسِ `-RequestId` (یا `-Tail` برای آخرین N خط) فیلتر کند. خروجی: JSON خط‌به‌خط. شاهد: `npm run remote:audit -- -RequestId ssh-123456`.

### RO.5 — health: بررسیِ سریعِ debug endpoint
- [x] **RO.5** اکشنِ `health`: فقط `GET /health` بزند و `ok/not-ok` برگرداند. شاهد: `npm run remote:health`.

### RO.6 — write-settings: نوشتنِ settings.json
- [x] **RO.6** اکشنِ `write-settings`: فایلِ `acc-assist.settings.json` روی سرور را با تنظیماتِ SQL + debug mode بازنویس کند. پارامترها: `-SqlUser`، `-SqlPassword`، `-SqlDatabase`، `-DebugMode` (switch)۔ شاهد: `npm run remote:write-settings -- -SqlDatabase Sepidar01 -DebugMode`.

---

## بخش ب — یکپارچه‌سازی

### RO.7 — npm scripts
- [x] **RO.7** اکشن‌های جدید به `package.json` اضافه شوند:
  - `remote:deploy-asar` → `-Action deploy-asar`
  - `remote:ask-batch` → `-Action ask-batch`
  - `remote:audit` → `-Action audit-log`
  - `remote:health` → `-Action health`
  - `remote:write-settings` → `-Action write-settings`

### RO.8 — بروزرسانیِ راهنما
- [x] **RO.8** فایلِ `ops/SSH-TELEMETRY-GUIDE.md` با دستوراتِ جدید بروز شود. بخشِ «عملیاتِ سریع» با مثال‌های `npm run remote:*` اضافه شود.

---

## معیارِ خروجِ فاز ۴۳ (Exit Gate)
- [x] `deploy-asar` با یک دستور کلِ چرخهٔ استقرار را انجام دهد.
- [x] `ask-ai` متنِ فارسی را بدون mojibake بفرستد.
- [x] `ask-batch` چند پرسش را در یک نشستِ SSH بفرستد و جدولِ نتایج بدهد.
- [x] `audit-log` بر اساسِ requestId لاگ فیلتر کند.
- [x] `health` در یک ثانیه وضعیتِ debug endpoint را بگوید.
- [x] `write-settings` تنظیماتِ SQL + debug را روی سرور بنویسد.
- [x] همهٔ اکشن‌های جدید npm script داشته باشند.
- [x] راهنما با مثال‌های جدید بروز شده باشد.
