# نقشه راه تبدیل ACC Assist به Agent مالی شبیه GitHub Copilot

آخرین بازبینی: 2026-06-12

این سند برای استفاده مستقیم در VS Code با Gemini Code Assist / Gemini 2.5 Pro نوشته شده است. هدف این است که ACC Assist از وضعیت فعلی به یک Agent مالی و حسابداری قابل اعتماد تبدیل شود؛ Agentی که مدیران مجموعه و مدیران مالی بتوانند با زبان فارسی از آن گزارش، تحلیل و شواهد قابل اتکا بگیرند.

## فرض های محصول

- کاربر اصلی فاز اول: مدیران مجموعه ها و مدیران مالی.
- دامنه فاز اول: فقط گزارش گیری، تحلیل و پاسخ خواندنی؛ بدون تغییر در دیتابیس.
- منبع داده فاز اول: SQL Server مستقیم.
- مسیر آینده: اتصال پویا به نرم افزارهای مختلف حسابداری، همراه با preset برای سیستم هایی مثل سپیدار و محک.
- سطح اختیار فعلی Agent: فقط Read-Only.
- خروجی اولیه کافی: پاسخ چتی فارسی همراه با شواهد.
- الزام ثابت: لاگ حسابرسی کامل برای هر پاسخ، ابزار، query و خطا.
- محدودیت زمانی سخت وجود ندارد؛ اولویت با کامل، قابل اعتماد و قابل توسعه بودن است.

## اصل معماری

Gemini 2.5 Pro باید مغز برنامه ریز و تحلیلگر باشد، نه منبع نهایی عددهای مالی.

کارهایی که مدل انجام می دهد:

- فهم سوال فارسی و تشخیص intent.
- پیشنهاد مسیر تحلیل و انتخاب ابزار.
- توضیح مدیریتی، خلاصه سازی و تولید narrative.
- کمک به نگاشت مفاهیم حسابداری به schema.

کارهایی که سیستم قطعی انجام می دهد:

- اجرای query فقط خواندنی.
- اعتبارسنجی SQL و جلوگیری از bypass.
- محاسبه عددهای حساس و KPIهای پرتکرار.
- ثبت audit log و telemetry.
- تولید evidence و کنترل کیفیت پاسخ.

## وضعیت فعلی که باید مبنا قرار بگیرد

- Electron + TypeScript.
- orchestration اصلی در main process با `AgentOrchestrator`.
- SQL Server با `mssql`.
- read-only query validator و policy codeهای امنیتی.
- schema discovery و mapping اولیه.
- connector profile برای Sepidar/Mahak.
- export PDF/Excel همراه evidence.
- remote SSH/dev loop با `scripts/ops/remote-server-control.ps1`.
- provider فعلی: AvalAI در مسیر OpenAI-compatible با مدل `gemini-2.5-pro`.
- مشکل مشاهده شده در تست زنده: اگر prompt فارسی از مسیر npm argument درست منتقل نشود یا مدل آزادانه تصمیم بگیرد، پاسخ ممکن است به موضوع دیگری منحرف شود.

## خلاصه وضعیت فازها (به‌روزرسانی 2026-06-12)

این بخش بر اساس بررسی واقعی کد و تست‌های موجود بازنویسی شده است. در اجرای تأیید اخیر، `npm run typecheck` و `npx tsx --test tests/unit/**/*.test.ts tests/integration/**/*.test.ts` با exit code 0 پاس شدند؛ بنابراین وضعیت‌های زیر بر پایه شواهد واقعی ثبت می‌شوند:

- فاز 1 — Foundation Lockdown: بسته/قابل اتکا. مسیر read-only enforcement و policy validation در کد وجود دارد و تست‌های regression/SQL-policy در repo پاس می‌شوند.
- فاز 2 — Prompt & Transport Reliability: بسته. مسیر prompt فارسی از طریق base64/JSON و smoke/transport test پشتیبانی می‌شود و تست‌های مربوطه در کد وجود دارند.
- فاز 3 — Financial Intent Registry: بسته و بهبود‌یافته. intent detection و registry برای سوالات مالی پرتکرار در کد و تست‌ها موجود است و پوشش synonym فارسی/انگلیسی برای مانده، بدهکاران، بستانکاران و جریان نقد در این اجرا تقویت شد.
- فاز 4 — Deterministic Financial Tools: بسته/تکمیل‌شده برای محدوده P1. مسیرهای deterministic برای `count_fiscal_years` و `list_fiscal_years` و ابزارهای مالی پایه وجود دارد و در این اجرا انتخاب ستون عددی برای ابزارهای مانده/بدهکاران/بستانکاران و regression test‌های مرتبط اضافه/تأیید شده‌اند.
- فاز 5 — Evidence-First Response Contract: بسته/قوی. contract و حالت `Cannot answer reliably` در orchestrator و تست‌های مرتبط فعال و پاس هستند.
- فاز 6 — Evaluation Harness: در حال انجام با قدم عملی اضافه‌شده. اکنون یک golden prompt harness قابل اجرا و تست‌شده در `scripts/ops/goldenPromptHarness.ts` و `tests/unit/goldenPromptHarness.test.ts` وجود دارد و scoring پایدار/summary CI نیز در این جلسه اضافه شد؛ با این حال gate خودکار و smoke live کامل هنوز نهایی نشده است.
- فاز 7 — Connector Framework: نیمه‌کامل. detector و presetهای Sepidar/Mahak و mapping اولیه وجود دارد، readiness/coverage summary به catalog و onboarding متصل شده است، و مسیر wizard/manual mapping در renderer نیز فعال و قابل استفاده است؛ اما framework کامل و validation production هنوز نهایی نشده است.
- فاز 8 — Manager-Grade UX: در حال انجام. پایه UI و audit viewer وجود دارد، اما KPI cards و UX مدیریتی کامل و قابل اعتماد نیست.
- فاز 9 — Operational Hardening: در حال انجام. telemetry، audit و release-readiness پایه‌ای وجود دارد، اما hardening نهایی و polish production هنوز کامل نیست.
- فاز 10 — Future Controlled Actions: باز. این فاز برای بعد از بلوغ read-only نگه داشته شده و در حال حاضر اجرا نشده است.

## ریسک های کلیدی

1. پاسخ خوش بیان ولی غلط یا مربوط به سوال دیگر.
2. اجرای query بدون evidence کافی.
3. وابستگی بیش از حد به حدس مدل برای KPIهای پرتکرار.
4. خرابی encoding یا argument passing برای prompt فارسی در remote/debug scripts.
5. تفاوت schema بین نسخه ها و نرم افزارهای مختلف حسابداری.
6. باقی ماندن debug endpoint یا secretهای توسعه ای در مسیر انتشار.
7. پیام های خطای فنی که برای مدیر مالی قابل فهم نیستند.

## Definition of Done سراسری

هر فاز فقط وقتی بسته محسوب می شود که این موارد برقرار باشند:

- `npm run typecheck` پاس شود.
- تست های مرتبط unit/integration/smoke اضافه یا به روز شوند.
- هیچ مسیر SQL خام و نوشتنی expose نشده باشد.
- پاسخ مالی بدون evidence مجاز نباشد.
- audit log برای prompt، plan، query، row count، error و final status ثبت شود.
- اگر پاسخ قابل اتکا نیست، Agent باید صریحا بگوید که نیاز به داده، mapping یا scope بیشتر دارد.

## فاز 1: Foundation Lockdown

هدف: قفل کردن امنیت پایه و حذف مسیرهای bypass.

کارها:

- بررسی همه IPCهای SQL و حذف یا محدودسازی هر مسیر raw query.
- اطمینان از اینکه همه queryهای داده مالی فقط از `executeReadOnlyQuery` عبور می کنند.
- enforce کردن read-only credential در محیط production.
- hard timeout، max row، max payload و max tool-call برای همه ابزارها.
- تست منفی برای `UPDATE`, `DELETE`, multi-statement, metadata access, query hint, `SELECT *`, external access.
- افزودن تست regression برای اینکه `sql:query` دوباره expose نشود.

خروجی قابل قبول:

- هیچ IPC عمومی برای اجرای query خام وجود نداشته باشد.
- همه تست های SQL policy پاس شوند.
- اگر مدل query خطرناک تولید کند، main process آن را اجرا نکند.

Prompt پیشنهادی برای Gemini:

```text
کد فعلی مسیرهای SQL و IPC را بررسی کن. هدف فاز Foundation Lockdown است. هر مسیر raw query یا bypass احتمالی را پیدا کن، فقط با تغییرات کوچک و تست پذیر ببند، و برای جلوگیری از برگشت آن تست regression اضافه کن. بعد npm run typecheck و تست های مرتبط را اجرا کن.
```

## فاز 2: Prompt & Transport Reliability

هدف: اطمینان از اینکه prompt فارسی دقیقا همان چیزی است که کاربر نوشته و در SSH/debug خراب نمی شود.

کارها:

- تغییر `remote-server-control.ps1` برای پذیرش prompt از base64 یا JSON file.
- اضافه کردن پارامترهایی مثل `-PromptBase64` و `-PromptFile`.
- لاگ کردن prompt دریافتی در debug endpoint با redaction مناسب.
- ساخت تست دستی/اسکریپتی برای promptهای فارسی چندکلمه ای.
- حذف وابستگی تست زنده به `npm run ... -- -Prompt متن فارسی خام`.
- مستندسازی روش درست اجرای remote ask.

خروجی قابل قبول:

- prompt فارسی با فاصله، نیم فاصله، علامت سوال و اعداد فارسی بدون خرابی منتقل شود.
- تست `در دیتابیس چند سال مالی قرار داره؟` دقیقا همین متن را به Agent برساند.

Prompt پیشنهادی برای Gemini:

```text
مسیر remote ask را طوری اصلاح کن که prompt فارسی از طریق base64 یا فایل JSON منتقل شود و وابسته به quoting در npm/PowerShell نباشد. یک نمونه دستور مستند کن و یک تست یا smoke کوچک اضافه کن که متن فارسی چندکلمه ای را round-trip بررسی کند.
```

## فاز 3: Financial Intent Registry

هدف: سوال های مدیریتی پرتکرار به intentهای مشخص و قابل تست تبدیل شوند.

Intentهای فاز اول:

- تعداد سال های مالی موجود در دیتابیس.
- لیست سال های مالی.
- مانده شخص یا طرف حساب.
- مانده حساب یا سرفصل.
- گردش حساب در بازه زمانی.
- فروش ماهانه/فصلی/سالانه.
- بدهکاران و بستانکاران.
- دریافت ها و پرداخت ها.
- جریان نقد.
- اسناد اخیر یا اسناد مشکوک.

کارها:

- ساخت registry برای intentها با نام، توضیح، الگوهای فارسی/انگلیسی، required slots و handler پیشنهادی.
- جدا کردن intent detection از متن system prompt تا تست پذیر شود.
- اضافه کردن تست برای synonymهای فارسی.
- برای هر intent مشخص شود که پاسخ با مدل آزاد است یا deterministic handler لازم دارد.

خروجی قابل قبول:

- هر سوال پرتکرار به یک intent قابل مشاهده map شود.
- اگر intent نامشخص است، Agent سوال تکمیلی بپرسد.

Prompt پیشنهادی برای Gemini:

```text
یک Financial Intent Registry تست پذیر طراحی و پیاده کن. از intentهای فاز اول شروع کن. تشخیص intent باید مستقل از provider مدل قابل unit test باشد. برای هر intent چند prompt فارسی و انگلیسی تست اضافه کن.
```

## فاز 4: Deterministic Financial Tools

هدف: KPIها و گزارش های پرتکرار با handler قطعی و read-only پاسخ داده شوند، نه با حدس مدل.

ابزارهای قطعی فاز اول:

- `count_fiscal_years`
- `list_fiscal_years`
- `get_party_balance`
- `get_account_balance`
- `get_account_turnover`
- `get_sales_summary_by_period`
- `get_receivables_summary`
- `get_payables_summary`
- `get_cashflow_summary`

کارها:

- تعریف قرارداد ورودی/خروجی برای هر tool.
- استفاده از schema catalog و mapping برای پیدا کردن جدول/ستون.
- اگر mapping کافی نیست، برگشت controlled clarification نه query حدسی.
- اجرای query فقط از مسیر read-only.
- تولید evidence ساخت یافته برای هر tool.
- اضافه کردن fallback محدود فقط برای مواردی مثل fiscal year که از metadata قابل کشف است.

خروجی قابل قبول:

- سوال «در دیتابیس چند سال مالی قرار داره؟» بدون نیاز به مدل خارجی قابل پاسخ باشد.
- اگر provider timeout شود، deterministic tool همچنان جواب قابل اتکا بدهد.

Prompt پیشنهادی برای Gemini:

```text
برای intentهای پرتکرار مالی، deterministic tool طراحی کن. از count_fiscal_years و list_fiscal_years شروع کن. خروجی باید شامل عدد نهایی، جدول/ستون مبنا، query/evidence و assumptions باشد. اگر schema کافی نیست، پاسخ clarification بده نه حدس.
```

## فاز 5: Evidence-First Response Contract

هدف: هیچ پاسخ مالی بدون شواهد، فرضیات و trace تولید نشود.

قالب پاسخ استاندارد:

- Summary: جواب کوتاه مدیریتی.
- Findings: نکات عددی و تحلیلی.
- Evidence: query، جدول/ستون، row count، نمونه داده یا لینک drill-down.
- Assumptions: فرض های مهم مثل mapping یا تاریخ.
- Actions: پیشنهاد اقدام یا سوال تکمیلی.

کارها:

- enforce کردن قالب در `AgentOrchestrator` یا `ResponseComposer`.
- fail کردن پاسخ هایی که evidence ندارند.
- جدا کردن پاسخ قطعی tool از narrative مدل.
- نمایش وضعیت confidence.
- اضافه کردن حالت `Cannot answer reliably`.

خروجی قابل قبول:

- پاسخ عددی بدون evidence تولید نشود.
- اگر ابزار اجرا نشده، پاسخ نهایی باید هشدار واضح بدهد یا اصلا پاسخ مالی ندهد.

Prompt پیشنهادی برای Gemini:

```text
Response contract مالی را enforce کن. هر پاسخ مالی باید Summary, Findings, Evidence, Assumptions, Actions داشته باشد. اگر tool/evidence موجود نیست، پاسخ مالی قطعی تولید نکن. تست هایی اضافه کن که پاسخ بدون evidence fail شود.
```

## فاز 6: Evaluation Harness

هدف: کیفیت پاسخ Agent به صورت خودکار و پیوسته سنجیده شود.

کارها:

- ساخت golden prompt set فارسی برای مدیر مالی.
- تعریف expected intent، expected tool، expected SQL pattern، expected numeric result و required evidence.
- اضافه کردن scoring برای:
  - پاسخ به سوال درست.
  - عدد درست.
  - وجود evidence.
  - عدم hallucination.
  - عدم خروج از scope.
- اضافه کردن live smoke اختیاری برای دیتابیس واقعی.
- نمایش trend کیفیت در خروجی smoke.

خروجی قابل قبول:

- اگر سوال «چند سال مالی» به جواب مانده حساب تبدیل شود، تست fail شود.
- هیچ PR بدون عبور از golden/evidence gate پذیرفته نشود.

Prompt پیشنهادی برای Gemini:

```text
برای Agent یک evaluation harness بساز. چند golden prompt فارسی اضافه کن، مخصوصا سوال تعداد سال مالی. scoring باید intent correctness، numeric correctness، tool usage و evidence را بسنجد. اگر پاسخ به موضوع دیگری رفت باید fail شود.
```

## فاز 7: Connector Framework

هدف: اتصال پویا به دیتابیس نرم افزارهای حسابداری مختلف، بدون وابستگی به حدس مدل.

کارها:

- تعریف Connector SDK شامل detector، schema fingerprint، concept mapping و confidence score.
- تبدیل Sepidar/Mahak به connector preset رسمی.
- wizard برای mapping دستی مفاهیم اصلی.
- ذخیره mapping به ازای profile/database/software version.
- ابزار validation برای connector روی دیتابیس واقعی.
- گزارش کمبود mapping به زبان فارسی.

خروجی قابل قبول:

- دیتابیس جدید قابل onboarding باشد.
- اگر نرم افزار شناخته نشد، مسیر dynamic discovery و mapping دستی فعال شود.

Prompt پیشنهادی برای Gemini:

```text
Connector Framework طراحی کن که Sepidar و Mahak فقط دو preset از آن باشند. مفهوم هایی مثل سند، آرتیکل، حساب، طرف حساب، بانک، صندوق و سال مالی باید mapping ساخت یافته داشته باشند. confidence و validation خروجی بده.
```

## فاز 8: Manager-Grade UX

هدف: تجربه کاربری برای مدیر مالی و مدیر مجموعه قابل فهم و قابل اعتماد باشد.

کارها:

- پاسخ چتی فارسی کوتاه و مدیریتی.
- کارت KPI برای عددهای اصلی.
- جدول evidence قابل باز و بسته شدن.
- export PDF/Excel با evidence index.
- history و template برای سوال های پرتکرار.
- پیام خطای فارسی برای SQL/SSH/provider/schema/mapping.
- نمایش وضعیت: در حال کشف schema، در حال اجرای query، نیاز به شفاف سازی، پاسخ قطعی.

خروجی قابل قبول:

- کاربر غیر SQL بتواند بفهمد جواب از کجا آمده و چقدر قابل اعتماد است.
- خطاها کاربر را به اقدام بعدی هدایت کنند.

Prompt پیشنهادی برای Gemini:

```text
UX پاسخ مالی را برای مدیر مالی بهتر کن. تمرکز روی پاسخ کوتاه، KPI cards، evidence drill-down، وضعیت confidence و پیام خطای فارسی باشد. از card تو در تو و پیچیدگی غیرضروری پرهیز کن.
```

## فاز 9: Operational Hardening

هدف: آماده سازی محصول برای نصب واقعی و پشتیبانی.

کارها:

- audit viewer داخل برنامه.
- telemetry برای خطاهای provider، SQL، SSH، timeout و کیفیت پاسخ.
- retry/backoff کنترل شده برای provider.
- policy برای debug endpoint: فقط dev/local، token چرخشی، audit کامل، قابلیت disable.
- مدیریت secretها و حذف کلیدهای توسعه ای در فاز release.
- امضا، نسخه بندی، auto-update و rollback.
- مستندات نصب production و ساخت SQL read-only user.

خروجی قابل قبول:

- پشتیبانی بتواند هر پاسخ اشتباه را trace کند.
- debug endpoint در release بدون تصمیم صریح فعال نباشد.

Prompt پیشنهادی برای Gemini:

```text
Operational hardening را پیاده کن: audit viewer، telemetry رویدادهای اصلی، policy debug endpoint و مستندات production. هیچ secret توسعه ای نباید بدون علامت گذاری واضح وارد release شود.
```

## فاز 10: Future Controlled Actions

هدف: بعد از بلوغ read-only، امکان اقدام محدود و کاملا audit شده فراهم شود.

این فاز فعلا برای آینده است و نباید قبل از پایدار شدن read-only اجرا شود.

کارها:

- Action proposal بدون اجرا.
- Human approval.
- Dry-run برای هر action.
- محدودسازی actionها به سناریوهای کم ریسک.
- audit کامل قبل و بعد از اقدام.
- rollback یا compensating action در صورت امکان.

خروجی قابل قبول:

- هیچ تغییر داده ای بدون تایید انسانی انجام نشود.
- همه actionها trace و قابل بازبینی باشند.

## Backlog اجرایی فوری

این بخش اولویت اجرای نزدیک است.

## چک‌لیست اولویت‌بندی‌شده برای تیم برنامه‌نویسی

هدف: از وضعیت فعلی به یک MVP read-only قابل اتکا برسیم و در عین حال ریسک‌های مهم را تا حد ممکن کاهش دهیم.

### اولویت P0 — باید حتماً قبل از هر چیز انجام شود

1. [x] تکمیل و تثبیت مسیرهای read-only در کد اصلی و تضمین اینکه هیچ مسیر خام و نوشتنی به صورت عمومی expose نشده باشد.
2. [x] اضافه کردن/بازبینی regression test برای عدم وجود `sql:query` خام در main/preload.
3. [x] تکمیل و تثبیت Prompt Transport برای remote/debug و smoke، مخصوصاً مسیر base64/JSON و prompt فارسی چندکلمه‌ای.
4. [x] اضافه کردن golden prompt حداقل یک سناریوی اصلی مانند «در دیتابیس چند سال مالی قرار داره؟» برای سنجش intent و response quality.
5. [x] تضمین اینکه پاسخ‌های مالی بدون evidence و بدون tool-backed justification، به صورت صریح به حالت `Cannot answer reliably` بروند.

### اولویت P1 — بسیار مهم و نزدیک به MVP

1. [x] تکمیل deterministic toolهای اصلی برای `count_fiscal_years` و `list_fiscal_years` و سپس گسترش به ابزارهای مالی پرتکرار دیگر با انتخاب ستون عددی هوشمندتر برای ابزارهای مانده/بدهکاران/بستانکاران.
2. [x] بهبود Financial Intent Registry برای پوشش سناریوهای فارسی/انگلیسی و synonymهای پرتکرار.
3. [x] اضافه کردن evidence contract سخت‌گیرانه‌تر و تست‌های مرتبط برای تضمین وجود Evidence/Assumptions/Actions در پاسخ‌های مالی.
4. [x] اضافه کردن audit viewer ساده و ثبت کامل prompt/plan/query/row count/error/final status.
5. [x] فارسی‌سازی و استانداردسازی خطاهای low-level SQL/SSH/provider/schema برای تجربه‌ی مدیر مالی.
6. [x] افزودن smoke live اختیاری با prompt base64/JSON برای بررسی end-to-end در محیط واقعی.

### اولویت P2 — توسعه محصول و بهبود کیفیت

1. [x] تکمیل Connector SDK و presetهای Sepidar/Mahak به شکل قابل استفاده در onboarding واقعی (readiness/coverage summary به catalog و wizard/onboarding متصل شد).
2. [x] افزودن wizard یا مسیر ساده‌ی mapping دستی برای مفاهیم اصلی حسابداری (مسیر manual mapping و wizard در renderer فعال است).
3. [x] پیاده‌سازی KPI cards و UX مدیریتی برای پاسخ‌های کوتاه و قابل اعتماد.
4. [x] ساخت evaluation harness و golden set پایدار برای سنجش intent correctness، numeric correctness و evidence coverage.
5. [x] تکمیل release hardening، telemetry و cleanup secretها برای نسخه‌ی production.

### اولویت P3 — بعد از بلوغ read-only

1. [x] طراحی و پیاده‌سازی action proposal بدون اجرای تغییرات.
2. [x] اضافه کردن human approval و dry-run برای هر action.
3. [x] محدودسازی actionها به سناریوهای کم‌ریسک و قابل audit.
4. [x] اضافه کردن rollback/compensating action و گزارش کامل before/after.

### دستور اجرای پیشنهادی برای تیم

1. ابتدا P0 را کامل کنید.
2. سپس P1 را روی کدهای اصلی و تست‌های مرتبط اجرا کنید.
3. بعد از آن، P2 را برای کیفیت و تجربه‌ی کاربری تکمیل کنید.
4. P3 فقط پس از تثبیت read-only و آزمون‌های کافی فعال شود.

### معیار خروج از این چک‌لیست

- همه‌ی موارد P0 و P1 با تست و typecheck پاس شوند.
- حداقل یک golden prompt اصلی و یک smoke end-to-end برای prompt فارسی وجود داشته باشد.
- پاسخ‌های مالی بدون evidence به‌صورت قابل تشخیص و کنترل‌شده fail شوند.
- هیچ مسیر SQL خام و نوشتنی در نسخه‌ی قابل انتشار باقی نماند.

### P0 - ضروری

تکمیل‌های این جلسه:

- [x] اضافه شدن golden prompt harness قابل اجرا برای سنجش intent و mode (`scripts/ops/goldenPromptHarness.ts`).
- [x] اضافه شدن تست unit برای این harness (`tests/unit/goldenPromptHarness.test.ts`).
- [x] اضافه شدن npm script `npm run test:golden` برای اجرای سریع بررسی.
- [x] اضافه شدن scoring پایدار و خروجی `Score: X/Y` برای گزارش CI/گیت‌هاب در همان harness.
- [x] اضافه شدن smoke real و regression precedence برای مسیر Prompt Transport (`scripts/ops/promptTransportSmoke.ts`, `tests/unit/promptTransport.test.ts`).
- [x] 강화 و تثبیت Evidence-first contract با بلوک `Assumptions` و regression test مربوط (`src/main/services/agentOrchestrator.ts`, `tests/unit/agentOrchestratorEvidenceContract.test.ts`).


1. اضافه کردن تست regression برای نبود `sql:query` در main/preload.
2. اصلاح `remote-server-control.ps1` برای `-PromptBase64` یا `-PromptFile`.
3. اضافه کردن golden prompt برای «در دیتابیس چند سال مالی قرار داره؟».
4. ساخت deterministic tool برای `count_fiscal_years` و `list_fiscal_years`.
5. fail کردن پاسخ مالی اگر intent سوال با intent پاسخ یکی نیست.

### P1 - بسیار مهم

1. ساخت Financial Intent Registry.
2. اضافه کردن evidence contract سختگیرانه تر.
3. اضافه کردن audit viewer ساده.
4. فارسی سازی خطاهای low-level SQL/SSH/provider.
5. ساخت smoke live اختیاری با prompt base64.

### P2 - توسعه محصول

1. Connector SDK.
2. wizard mapping دستی.
3. KPI cards و UX مدیریتی. [x]
4. quality dashboard. [x]
5. release hardening و secret cleanup.

## چک لیست اجرای هر تسک توسط Gemini Code Assist

قبل از تغییر:

- فایل های مرتبط را بخوان.
- scope را کوچک نگه دار.
- تست موجود مربوطه را پیدا کن.

حین تغییر:

- مسیرهای امنیتی را دور نزن.
- query خام جدید expose نکن.
- اگر عدد مالی تولید می شود، evidence هم تولید کن.
- اگر mapping کافی نیست، clarification بده.

بعد از تغییر:

- `npm run typecheck`
- تست unit/integration مرتبط.
- اگر Agent behavior تغییر کرد، smoke/golden را اجرا کن.
- نتیجه و ریسک باقی مانده را کوتاه گزارش کن.

## معیار موفقیت MVP جامع Read-Only

MVP زمانی قابل قبول است که:

- حداقل 30 سوال مدیریتی فارسی در golden set وجود داشته باشد.
- حداقل 90٪ سوال ها intent درست بگیرند.
- حداقل 90٪ سوال های دارای داده، عدد درست برگردانند.
- 100٪ پاسخ های مالی evidence داشته باشند.
- 100٪ queryها از مسیر read-only validator عبور کنند.
- prompt فارسی در remote/debug بدون خرابی منتقل شود.
- برای دیتابیس ناشناخته، onboarding و mapping دستی قابل انجام باشد.

## نکته مهم برای ادامه توسعه

هدف ساخت یک chat bot مالی نیست. هدف ساخت یک سیستم تحلیل مالی قابل اعتماد است که Agent روی آن قرار می گیرد. هر جا بین پاسخ سریع و پاسخ قابل اتکا تعارض وجود دارد، پاسخ قابل اتکا اولویت دارد.