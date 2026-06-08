# نقشه راه پیاده سازی ACC Assist

آخرین بازبینی: 2026-06-01

## راهنمای استفاده از این فایل برای مدل پیاده ساز

این فایل قرار است مرجع پیاده سازی برای یک مدل کمکی (مثلا codex) باشد. به همین دلیل دستورها باید دقیق، مرحله ای و بدون ابهام دنبال شوند:

- هر فاز را به ترتیب انجام بده و قبل از رفتن به فاز بعد، بخش «خروجی قابل قبول» همان فاز را کامل کن.
- مسیر دقیق فایل ها در بخش «نقشه کد فعلی» آمده است. قبل از تغییر هر فایل، اول آن را بخوان.
- بعد از هر تغییر مهم، حتما `npm run typecheck` و `npm run build` را اجرا کن و خطاها را رفع کن.
- چیزی فراتر از خواسته هر تسک اضافه نکن. refactor یا قابلیت اضافه بدون درخواست ممنوع است.
- **کلید API را حذف نکن.** جزئیات در بخش «پیکربندی provider هوش مصنوعی» توضیح داده شده است.

## نتیجه تطبیق roadmap با کد (2026-06-01)

مبنای این تطبیق: بررسی مستقیم فایل های main/preload/renderer، سرویس ها، تست ها، اسکریپت های smoke/fixture و CI.

جمع بندی وضعیت فازها:

- فاز 0: **بسته**
- فاز 1: **تقریبا بسته** (باز واقعی: یکپارچه سازی کامل فارسی سازی خطاهای زیربنایی)
- فاز 2: **بسته**
- فاز 3: **تقریبا بسته** (باز واقعی: abstraction کامل provider adapter هنوز می تواند بهتر شود)
- فاز 4: **تقریبا بسته** (استفاده از Parser/AST واقعی برای T-SQL پیاده‌سازی شد + لایه‌های دفاعی Regex).
- فاز 5: **در حال انجام** (بخش اصلی انجام شده، سیستم ذخیره Templateهای کاربر تکمیل شد).
- فاز 5.5: **بسته** (Mobile Bridge از حالت Placeholder خارج شد؛ سیستم جفت‌سازی، احراز هویت و برودکست رویدادهای Orchestrator پیاده‌سازی شد).
- فاز 6: **تقریبا بسته** (باز واقعی: تایید نهایی روی دیتابیس های واقعی مشتری)
- فاز 7: **تقریبا بسته** (باز واقعی: تکمیل چند معیار کیفیت روی دیتای واقعی)
- فاز 8: **باز**

باز بودن ظاهری (انجام شده در کد ولی هنوز در لیست تسک ها به شکل باز دیده می شود):

- «انتقال orchestration به main process» انجام شده (`AgentOrchestrator` + IPC `agent:send-message`/`agent:cancel-message` + event stream).
- «schema catalog و mapping» انجام شده (discovery + suggestion + override + persistence per profile/database).
- «guard ابهام mapping/date-range» انجام شده (clarification response به جای حدس SQL).
- «streaming/cancellation/multi-turn/context memory» انجام شده (event `response-chunk` + abort + refinement context + memory snapshot).
- «connector-aware discovery (Sepidar/Mahak) + onboarding» انجام شده.
- «golden/smoke/CI matrix و quality gate» انجام شده.
- «export PDF/Excel همراه شواهد + integration test» انجام شده.

موارد باز واقعی که باید صریحا در برنامه بعدی بمانند:

- فارسی سازی کامل خطاهای low-level (به ویژه پیام های برآمده از لایه های mssql/ssh/proxy) در تمام مسیرها.
- سختگیرتر کردن governance لایه SQL برای سناریوهای enterprise (parser/AST واقعی یا allowlist ساختاری دقیق تر + الزام عملی read-only credential در محیط production).
- نمودارهای روند در UI تحلیل و ذخیره پایدار (persistent) templateهای پرتکرار کاربر.
- تایید نهایی connectorها روی دیتابیس واقعی هر مشتری/نسخه نرم افزار هدف (فراتر از fixture/synthetic).
- فاز انتشار (حذف کلید هاردکد، metadata واقعی، نسخه بندی/امضا/آپدیت/پشتیبانی).

## نقشه کد فعلی

فایل های مهم پروژه و نقش آنها:

- `src/main/index.ts`: نقطه ورود main process و ثبت IPC handlerهای تنظیمات، SQL/SSH، schema، agent orchestration، report export و mobile bridge.
- `src/main/types.ts`: مقدار `DEFAULT_SETTINGS` و تابع `mergeSettings`. کلید API پیش فرض اینجاست.
- `src/shared/contracts.ts`: همه typeهای مشترک بین main و renderer.
- `src/main/services/settingsStore.ts`: ذخیره/خواندن تنظیمات با رمزنگاری `safeStorage`.
- `src/main/services/geminiClient.ts`: کلاینت AI با دو حالت `openai` و `google`.
- `src/main/services/sqlConnectionManager.ts`: اتصال `mssql`، pool و validator کوئری read-only.
- `src/main/services/agentOrchestrator.ts`: حلقه agentic در main process (tool budget، memory/refinement، streaming events، policy guard).
- `src/main/services/schemaDiscoveryService.ts`: کشف schema، tagging، mapping suggestion، date-mode detection.
- `src/main/services/reportExportService.ts`: خروجی PDF/Excel از پاسخ + شواهد.
- `src/main/services/auditLogService.ts`: audit log محلی برای مراحل agent/tool.
- `src/main/services/accountingConnectorProfiles.ts`: detection profile برای Sepidar/Mahak.
- `src/main/services/sshTunnelService.ts`: tunnel با `ssh2`.
- `src/main/services/telemetryIngestService.ts`: سیستم جمع‌آوری crash و event در سطح main و renderer با قابلیت صف‌بندی محلی و ارسال به collector.
- `src/main/services/mobileBridgeServer.ts`: سرور WebSocket فعلا placeholder.
- `src/renderer/src/renderer.ts`: UI، مدیریت eventهای agent/tool، onboarding schema، export report، cancel/streaming rendering.
- `tests/unit/*` و `tests/integration/*`: پوشش validator/discovery/agent/export.
- `scripts/smoke-agent-orchestrator.ts` و `scripts/fixtures/*`: smoke/golden regression و دیتاست synthetic.

## هدف محصول

ACC Assist قرار است یک agent مالی و حسابداری برای صاحبان کسب و کار باشد. کاربر باید بتواند با زبان طبیعی سوال بپرسد، برنامه به دیتابیس نرم افزار حسابداری متصل شود، داده واقعی را فقط به صورت خواندنی استخراج کند و پاسخ قابل اعتماد را در چت نشان دهد.

نمونه هدف:

> آقای مرادی طی سه ماه گذشته چقدر تنخواه دریافت کرده؟

در این سناریو agent باید خودش جدول ها و ستون های مرتبط را پیدا کند، مفهوم «آقای مرادی»، «تنخواه» و «سه ماه گذشته» را به کوئری امن تبدیل کند، خروجی عددی را با شواهد نشان دهد و اگر ابهام دارد سوال تکمیلی بپرسد.

## برداشت از وضعیت فعلی پروژه

پروژه در حال حاضر یک اپ Electron + TypeScript است و چند بخش مهم محصول پیاده سازی شده است:

- تنظیمات برنامه در main process ذخیره می شود و برای برخی مقادیر حساس از `safeStorage` استفاده شده است.
- اتصال مستقیم به SQL Server با پکیج `mssql` وجود دارد.
- SSH tunnel با `ssh2` برای حالتی که دیتابیس روی سرور دیگری است پیاده سازی شده است.
- کلاینت AI در `GeminiClient` هم حالت OpenAI-compatible و هم حالت Google-native دارد.
- orchestration ابزارها در `AgentOrchestrator` داخل main process انجام می شود و renderer فقط eventها/وضعیت را نمایش می دهد.
- مسیر SQL read-only نسبت به نسخه اولیه تقویت شده است: محدودیت scope، بودجه ابزار، redaction، timeout/row limit و policy error code.
- schema discovery + mapping + date-mode + software detection برای Sepidar/Mahak به جریان runtime متصل شده است.
- UI فعلی شامل تب تنظیمات، profile manager، onboarding schema، چت agentic، توقف پاسخ، drill-down شواهد و خروجی PDF/Excel است.
- زیرساخت تلمتری مرکزی (Collector) بر روی Proxmox (کانتینر ۲۰۵) پیاده‌سازی شده و اپلیکیشن تمامی خطاها، crashهای main/renderer و رویدادهای کلیدی را به صورت امن و با Bearer Token به آن ارسال می‌کند.
- WebSocket mobile bridge فعلا بیشتر حالت placeholder دارد و هنوز به یک پروتکل واقعی، احراز هویت و routing کاربردی وصل نشده است.
- smoke/golden/CI matrix و تست های unit/integration برای مسیرهای کلیدی موجود است.

## ریسک ها و فاصله های مهم قبل از محصولی شدن

- یک API key پیش فرض داخل `DEFAULT_SETTINGS` قرار دارد. طبق تصمیم فعلی این کلید **عمدا** تا رسیدن به نقطه نهایی محصول به صورت هاردکد باقی می ماند و نباید حذف شود. حذف کلید و انتقال آن به ورودی کاربر یا secret storage فقط در فاز نهایی انجام می شود. جزئیات در بخش «پیکربندی provider هوش مصنوعی».
- بخش عمده orchestration اکنون در main process است، اما abstraction provider هنوز می تواند decoupleتر شود تا تعویض backend ساده تر شود.
- validator فعلی SQL نسبت به شروع قوی تر شده، اما برای سطح enterprise هنوز جای کار دارد (parser/AST واقعی یا allowlist ساختاری سختگیرانه تر + hard enforcement read-only credential در استقرار نهایی).
- حالت Google-native در کلاینت فعلی tool/function calling را مثل OpenAI-compatible ارسال نمی کند. برای agent فعلی باید OpenAI-compatible mode مسیر اصلی باشد یا Google tool calling جداگانه پیاده شود.
- ساختار واقعی دیتابیس نرم افزارهای حسابداری مختلف متفاوت است. بدون schema catalog و mapping، کیفیت پاسخ ها وابسته به حدس مدل می شود.
- Mobile bridge فعلا بدون auth جدی و origin enforcement واقعی است و نباید برای شبکه غیرقابل اعتماد فعال شود.
- تست خودکار، fixture، golden prompt و CI اضافه شده اند؛ ریسک فعلی بیشتر روی پوشش دیتای واقعی مشتری و سناریوهای edge production است.

## جهت معماری پیشنهادی

معماری هدف بهتر است این شکلی باشد:

```text
Renderer UI
  -> IPC
Main Process
  -> AgentOrchestrator
     -> AiProviderAdapter
     -> ToolRegistry
        -> SchemaDiscoveryService
        -> SafeSqlPlanner / QueryValidator
        -> SqlExecutionService
        -> AuditLogService
     -> ResponseComposer
SQL Server / SSH Tunnel
```

اصل مهم: renderer فقط UI و نمایش conversation باشد. main process تصمیم بگیرد چه ابزاری مجاز است، چه کوئری اجرا شود، چه چیزی لاگ شود و چه داده ای به مدل برگردد.

## پیکربندی provider هوش مصنوعی

این بخش تصمیم قطعی پروژه درباره کلید و مدل AI است و باید دقیقا رعایت شود:

- provider فعلی سایت `avalai.ir` است و از مسیر OpenAI-compatible در `https://api.avalai.ir/v1` استفاده می شود (`mode: 'openai'`).
- مدل هدف **gemini-2.5-pro** است. این کلید چندین مدل را در اختیار می گذارد، اما در این محصول فقط باید از `gemini-2.5-pro` استفاده شود مگر اینکه صراحتا تصمیم دیگری گرفته شود.
- کلید API پیش فرض در `src/main/types.ts` داخل `DEFAULT_SETTINGS.gemini.apiKey` به صورت هاردکد قرار دارد. **این کلید را حذف نکن و خالی نکن.** هدف این است که برنامه تا نقطه نهایی توسعه بدون نیاز به ورود دستی کلید توسط کاربر اجرا شود.
- حذف کلید هاردکد، خالی کردن مقدار پیش فرض، و الزام کاربر به وارد کردن کلید خودش، یک کار مربوط به **فاز نهایی (فاز ۸ / انتشار)** است و قبل از آن نباید انجام شود.
- تا آن زمان کاربر همچنان می تواند کلید را در تنظیمات تغییر دهد، اما مقدار پیش فرض هاردکد باید سرجایش بماند.
- حالت `google` فعلا tool/function calling را پشتیبانی نمی کند؛ بنابراین برای agent فقط حالت `openai` مسیر اصلی است.

## فاز 0: تثبیت پایه فعلی

وضعیت تطبیق با کد (2026-06-01): **بسته**

هدف: پروژه فعلی بدون تغییر بزرگ، امن تر و قابل ادامه شود.

کارها:

- **کلید API پیش فرض را حذف نکن.** کلید باید همانطور که در `src/main/types.ts` داخل `DEFAULT_SETTINGS.gemini.apiKey` هست هاردکد بماند تا برنامه بدون تنظیم دستی کاربر اجرا شود (به بخش «پیکربندی provider هوش مصنوعی» مراجعه کن).
- تکمیل README با توضیح هدف محصول، نصب، اجرای dev، ساخت، نیازمندی SQL Server و AvalAPIs/Gemini (مدل `gemini-2.5-pro`).
- مشخص کردن اینکه agent فعلا فقط read-only است و عملیات نوشتنی روی دیتابیس انجام نمی دهد.
- افزودن یک checklist دستی برای تست: ذخیره تنظیمات، تست SQL direct، تست SSH، dry-run، پرسش مالی ساده.
- اجرای `npm run typecheck` و `npm run build` بعد از تغییرات پایه.

خروجی قابل قبول:

- مسیر فعلی چت و dry-run خراب نشود.
- برنامه با کلید هاردکد فعلی بدون نیاز به ورود دستی کلید AI بالا بیاید.
- README هدف محصول و نحوه اجرا را توضیح دهد.

## فاز 1: اتصال قابل اعتماد به دیتابیس

وضعیت تطبیق با کد (2026-06-01): **تقریبا بسته**

هدف: کاربر غیرتخصصی بتواند اتصال direct یا SSH را با اطمینان تنظیم کند.

کارها:

- ساخت connection profile با نام، توضیح، نوع اتصال و وضعیت آخرین تست.
- پشتیبانی UI از private key و passphrase در SSH، چون type آن در قرارداد وجود دارد ولی در UI فعلی کامل نیست.
- افزودن انتخاب دیتابیس بعد از اتصال به سرور، به جای اینکه کاربر حتما نام دیتابیس را دستی بداند.
- نمایش نتیجه health check شامل server version، database name، login user و read-only بودن دسترسی.
- پیشنهاد ساخت user فقط خواندنی در مستندات و هشدار اگر user دسترسی نوشتن دارد.
- قطع و وصل امن pool هنگام تغییر profile.

خروجی قابل قبول:

- کاربر بتواند یک profile بسازد، تست کند، ذخیره کند و دوباره همان را استفاده کند.
- خطاهای رایج مثل host اشتباه، credential اشتباه، certificate، port و SSH timeout با پیام فارسی قابل فهم نمایش داده شود.

## فاز 2: کشف schema و ساخت فرهنگ حسابداری

وضعیت تطبیق با کد (2026-06-01): **بسته**

هدف: agent به جای حدس زدن جدول ها، ابتدا دیتابیس را بشناسد و یک catalog قابل استفاده بسازد.

کارها:

- ساخت `SchemaDiscoveryService` در main process برای خواندن schema، table، column، index، foreign key و چند sample محدود از داده ها.
- ذخیره schema catalog به ازای connection profile و database.
- تشخیص جدول های محتمل حساب ها، اسناد، آرتیکل ها، اشخاص، صندوق، بانک، تنخواه، پروژه و مرکز هزینه.
- ساخت mapping قابل ویرایش توسط کاربر: مثلا «اشخاص» به جدول طرف حساب، «تنخواه» به حساب یا سرفصل مربوطه.
- تشخیص نوع تاریخ: میلادی، شمسی متنی، شمسی عددی یا fiscal period.
- تعریف synonyms فارسی برای مفاهیم پرتکرار: تنخواه، دریافت، پرداخت، بدهکار، بستانکار، فروش، خرید، مانده، گردش، طرف حساب.

خروجی قابل قبول:

- قبل از پاسخ مالی، برنامه بتواند schema را کشف کند و خلاصه قابل فهمی از جداول مالی مهم بسازد.
- برای یک دیتابیس ناشناخته، agent ابتدا table list و schema را بخواند، بعد SELECT نهایی را بسازد.

## فاز 3: انتقال agent orchestration به main process

وضعیت تطبیق با کد (2026-06-01): **تقریبا بسته**

هدف: حلقه tool-call از renderer خارج شود و کنترل امنیتی، لاگ و سیاست ها مرکزی شوند.

کارها:

- ساخت `AgentOrchestrator` در main process.
- انتقال system prompt، ابزارها، max rounds، row limits و error handling از renderer به main process.
- تعریف IPC جدید مثل `agent:send-message` و برگشت دادن eventهای مرحله ای برای UI: thinking، tool-start، tool-success، tool-error، final.
- نگه داشتن renderer به عنوان نمایش دهنده پیام ها و وضعیت ابزارها.
- افزودن history manager برای کوتاه کردن context و خلاصه سازی conversation طولانی.
- جدا کردن provider adapter از منطق agent تا بعدها OpenAI-compatible، Google-native یا مدل local قابل تعویض باشد.

خروجی قابل قبول:

- هیچ اجرای ابزار مالی مستقیما در renderer تصمیم گیری نشود.
- کاربر در UI همچنان مراحل ابزارها را ببیند، اما main process منبع حقیقت باشد.

## فاز 4: امنیت SQL و حاکمیت داده

وضعیت تطبیق با کد (2026-06-01): **در حال انجام**

هدف: برنامه برای دیتابیس مالی واقعی قابل اعتماد شود.

کارها:

- اجرای کوئری فقط با user خواندنی و مستندسازی ساخت این user در SQL Server.
- تقویت validation با parser یا allowlist برای فقط SELECT/CTE امن.
- اجباری کردن `TOP` یا pagination برای کوئری های بدون aggregation.
- محدود کردن زمان اجرا، تعداد ردیف، حجم خروجی و تعداد tool-call.
- جلوگیری از اجرای multiple statement، dynamic SQL، stored procedure، temp mutation و دسترسی به metadata حساس غیرضروری.
- افزودن audit log محلی: پرسش کاربر، ابزارهای اجرا شده، کوئری نهایی، تعداد ردیف، زمان اجرا و خطاها.
- redaction برای اطلاعات حساس مثل کد ملی، شماره موبایل یا شماره حساب در خروجی ارسالی به مدل، در صورت نیاز مشتری.

خروجی قابل قبول:

- هر پاسخ مالی قابل ردیابی به کوئری و شواهد باشد.
- حتی اگر مدل کوئری خطرناک پیشنهاد دهد، main process آن را اجرا نکند.

## فاز 5: تجربه کاربری چت مالی

وضعیت تطبیق با کد (2026-06-01): **در حال انجام**

هدف: پاسخ ها برای صاحب کسب و کار قابل فهم، قابل اعتماد و قابل اقدام شوند.

وضعیت فعلی (2026-05-31):

- guard قالب پاسخ در `AgentOrchestrator` اضافه شد: اگر مدل سرفصل های `Summary/Findings/Evidence/Actions` را ناقص بدهد، خروجی نهایی به قالب استاندارد مالی نرمال می شود.
- برای `fetch_financial_data` رویداد `tool-success` اکنون `evidencePreview` تایپ دار ارسال می کند (query preview + rows preview + truncation flag).
- در UI چت، drill-down شواهد روی همان پیام ابزار اضافه شد: کاربر می تواند با باز کردن `details` نمونه ردیف ها و ستون های شواهد را ببیند.
- guard ابهام سوال اضافه شد: اگر mapping مفهوم مالی ناقص باشد یا بازه زمانی به صورت مبهم بیان شود، agent به جای حدس زدن کوئری، پاسخ follow-up با درخواست شفاف سازی برمی گرداند.
- در UI تحلیل، قالب های پرتکرار سوال مالی اضافه شد (مانده مشتریان، گردش تنخواه، فروش ماهانه، بدهکاران سررسید گذشته، انحراف مرکز هزینه) تا کاربر با یک کلیک prompt استاندارد را در کادر سوال قرار دهد.
- خروجی PDF/Excel از آخرین پاسخ + شواهد ابزار به صورت end-to-end اضافه شد: دکمه های export در renderer، قرارداد IPC مشترک، و سرویس main process برای تولید فایل PDF/Excel و ذخیره با dialog سیستم.
- کیفیت خروجی export ارتقا یافت: PDF با layout گزارش محور (header + KPI + بخش پاسخ markdown + شواهد) و Excel با `Summary` غنی تر، شیت `EvidenceIndex`، شماره ردیف، autofilter و عرض ستون پویا تولید می شود.
- پوشش integration برای export اضافه شد: مسیر Excel واقعی (اعتبارسنجی workbook/sheet ها)، مسیر PDF با stub قابل تست، و سناریوی لغو ذخیره توسط کاربر.
- smoke/integration بعد از این تغییرات سبز هستند و quality gate سریع حفظ شده است.

کارها:

- فارسی سازی کامل UI اصلی و پیام های خطا، یا انتخاب یک زبان ثابت برای محصول.
- تعریف قالب پاسخ: خلاصه، عدد نهایی، شواهد، فرضیات، ابهام ها، پیشنهاد اقدام.
- نمایش جدول شواهد با قابلیت drill-down به ردیف های استفاده شده.
- افزودن نمودارهای ساده برای روندها: ماهانه، فصلی، طرف حساب، گروه حساب.
- ذخیره سوال های پرتکرار و prompt templateها مثل «مانده مشتری»، «گردش تنخواه»، «فروش ماهانه»، «بدهکاران سررسید گذشته».
- اگر mapping یا بازه زمانی مبهم است، agent به جای حدس زدن سوال تکمیلی بپرسد.

خروجی قابل قبول:

- کاربر با سوال طبیعی به پاسخ عددی و مستند برسد.
- پاسخ نهایی صرفا متن تولیدی مدل نباشد، بلکه پشت آن evidence و query trace وجود داشته باشد.

## فاز 5.5: قابلیت های agentic سطح Copilot

وضعیت تطبیق با کد (2026-06-01): **بسته**

هدف: تجربه چت از حالت «درخواست-انتظار-پاسخ» به یک تعامل روان و agentic مثل GitHub Copilot نزدیک شود. این فاز بعد از انتقال orchestration به main process (فاز 3) معنا پیدا می کند.

کارها:

- **Streaming پاسخ**: نمایش تدریجی متن پاسخ مدل به جای انتظار طولانی تا پایان. در `geminiClient.ts` پشتیبانی از `stream: true` در مسیر OpenAI-compatible اضافه شود و event های مرحله ای (token/chunk) از main process به renderer ارسال شود. نمایش مراحل ابزار (tool-start/tool-success) هم به صورت زنده در همین مسیر باشد.
- **حافظه و مدیریت context**: فراتر از trim ساده تاریخچه. افزودن خلاصه سازی conversation طولانی، نگه داشتن نکات کلیدی (mapping تاییدشده، بازه زمانی فعلی، نام شرکت/سال مالی انتخاب شده) و تزریق آنها به context بدون تکرار کامل تاریخچه.
- **Multi-turn refinement**: کاربر بتواند پاسخ را اصلاح کند بدون شروع از صفر. مثلا «نه، منظورم سال ۱۴۰۲ بود» یا «همین را برای آقای رضایی هم بده». agent باید context قبلی (کوئری، جدول، فرضیات) را نگه دارد و فقط بخش تغییر یافته را بازسازی کند.
- **لغو درخواست (cancellation)**: امکان قطع یک پاسخ در حال تولید یا یک حلقه tool-call طولانی، با پاکسازی امن منابع (abort روی fetch و توقف حلقه).

خروجی قابل قبول:

- پاسخ ها به صورت تدریجی نمایش داده شوند و کاربر منتظر یک بلوک طولانی نماند.
- conversation طولانی بدون از دست رفتن context مهم یا overflow ادامه پیدا کند.
- کاربر بتواند با یک پیام کوتاه پاسخ قبلی را اصلاح کند و agent context را حفظ کند.

## فاز 6: پشتیبانی از نرم افزارهای حسابداری واقعی

وضعیت تطبیق با کد (2026-06-01): **تقریبا بسته**

هدف: محصول از حالت generic SQL agent به assistant قابل استفاده برای بازار هدف تبدیل شود.

وضعیت فعلی (2026-05-31):

- نرم افزارهای هدف برای شروع انتخاب شدند: **سپیدار** و **محک**.
- connector profile اولیه برای سپیدار/محک در مسیر `SchemaDiscoveryService` اضافه شده و خروجی catalog شامل `detectedSoftware` و `softwareCandidates` است.
- در UI نتیجه کشف schema، نرم افزار شناسایی شده و confidence نمایش داده می شود.
- انتخاب دستی نرم افزار هدف (`auto/sepidar/mahak`) در بخش schema mapping اضافه شده و به ازای profile/database در catalog ذخیره می شود.
- در runtime prompt اکنون «نرم افزار موثر» (اولویت با override دستی، سپس auto-detected) همراه با منبع تشخیص (`manual override` / `auto-detected`) تزریق می شود.
- onboarding wizard مرحله ای برای schema اضافه شده است: انتخاب نرم افزار هدف، کشف schema با همان زمینه، و اعمال خودکار نگاشت های پیشنهادی در یک جریان واحد.
- context runtime در AgentOrchestrator برای چندشرکتی/چندسال مالی/چندشعبه ای تقویت شد: استخراج scopeهای چندگانه از مکالمه، نگهداری در حافظه conversation و تزریق راهنمای ستون های Company/FiscalYear/Branch از schema catalog به system prompt.
- guardrail اجرای SQL برای درخواست های چندscope تقویت شد: در `fetch_financial_data` اگر scopeهای شرکت/سال مالی/شعبه در conversation فعال باشند، کوئری بدون predicate معتبر، با مقادیر scope نامرتبط (نسبت به مقادیر درخواست)، یا با شاخه های OR خنثی کننده scope با policy error رد می شود.
- false-positive در guardrail شاخه های OR برای پرامپت های فارسی رفع شد: توقف extraction مقادیر scope دیگر به `\b` متکی نیست و با lookahead صریح انجام می شود، بنابراین عباراتی مثل «مشهد گزارش بده» به درستی به «مشهد» نرمال می شوند.
- اسکریپت validation روی دیتابیس واقعی اضافه شد: `scripts/validate-connector-live.ts` و دستور `npm run validate:connector:live` برای سنجش health check، effective software، date mode و پوشش mapping مفاهیم کلیدی connector.

مستندات پژوهش وب (2026-05-30):

- سپیدار (شواهد قوی): از اسکریپت های SQL عمومی در مخزن `baapar1101/Sepidar` شواهد مستقیم آبجکت های دیتابیس به دست آمد؛ از جمله `ACC.Voucher`، `ACC.VoucherItem`، `ACC.Account`، `ACC.DL`، `ACC.vwAccount`، `FMK.FiscalYear`، `RPA.BankAccount`، `RPA.BankBillItem` و `PAY.Calculation`.
  - مرجع: https://github.com/baapar1101/Sepidar/tree/main/SqlScripts
- سپیدار (شواهد دامنه API با اطمینان متوسط): در مستند OpenAPI سپیدار موجودیت های دامنه مانند `Invoices`، `Receipts`، `BankAccounts`، `Customers` و `Items` دیده می شود و عبارت های مرتبط با سال مالی جاری هم تکرار می شوند؛ این منبع برای mapping مفهومی مفید است اما نام جدول فیزیکی SQL نمی دهد.
  - مرجع: https://pourjanali.github.io/sepidar-api-docs/
- محک (شواهد دامنه ای با اطمینان متوسط، شواهد SQL ساختاری با اطمینان پایین): صفحات رسمی راهنما مفاهیم عملیاتی مانند `فاکتور فروش/خرید`، `سند دریافت/پرداخت`، `چک دریافتی`، `کاردکس کالا` و `سال مالی` را تایید می کنند و وجود نصب SQL را نشان می دهند؛ اما نام جدول/ویو/اسکیما به صورت عمومی ارائه نشده است.
  - مراجع:
    - https://help.mahaksoft.com/5313/manual-installation-of-sql-database-2014/
    - https://help.mahaksoft.com/5768/moghayerat60/
    - https://help.mahaksoft.com/5766/salemali-moghaierat56/
    - https://help.mahaksoft.com/5761/moghayerat51/
    - https://help.mahaksoft.com/5758/moghayerat50/
- جمع بندی اجرایی برای connector:
  - در سپیدار، وزن الگوهای schema-based مانند `ACC.*`، `RPA.*`، `PAY.*`، `FMK.*` باید بالا باشد.
  - در محک، تا قبل از دسترسی به دیتابیس واقعی یا داکیومنت رسمی SQL، اتکا باید روی mapping مفهومی + override دستی بماند.
  - نام های استفاده شده در fixtureهای محک (مثل `DaryaftPardakht` و `Ashkhas`) فعلا فرضیه عملیاتی هستند، نه نام های تایید شده رسمی.

کارها:

- انتخاب 1 تا 3 نرم افزار حسابداری هدف برای شروع.
- ساخت connector profile برای هر نرم افزار: جدول های اصلی، مفهوم حساب ها، طرف حساب، سند، fiscal year، branch و currency.
- ساخت نمونه دیتابیس یا fixture ناشناس شده برای تست هر connector.
- افزودن onboarding wizard: کاربر نرم افزار حسابداری خود را انتخاب کند و برنامه mapping پیشنهادی بدهد.
- پشتیبانی از چند شرکت، چند سال مالی و چند شعبه در صورت نیاز.

خروجی قابل قبول:

- برای نرم افزار هدف اول، سوال های پرتکرار بدون تنظیمات دستی زیاد جواب بگیرند.
- mapping هر مشتری قابل override باشد.

## فاز 7: ارزیابی، تست و کیفیت پاسخ

وضعیت تطبیق با کد (2026-06-01): **تقریبا بسته**

هدف: مطمئن شویم agent در پاسخ های مالی اشتباه خطرناک نمی دهد.

وضعیت فعلی (2026-05-30):

- smoke harness پیاده سازی شده و شامل dry-run/refinement/cancellation است.
- golden prompt regression با fixture مستقل در `scripts/fixtures/golden-prompts.json` اضافه شده است.
- پوشش golden fixture توسعه یافته و سناریوهای تاریخ شمسی، دوره مالی و ابهام نگاشت جدول را هم شامل می شود.
- سناریوهای connector-aware برای Sepidar/Mahak (الگوهای جدول واقعی تر مثل `ACC_Documents`, `ACC_DocumentItems`, `DaryaftPardakht`, `Ashkhas`) به golden fixture اضافه شده اند.
- دیتاست synthetic حسابداری برای سناریوهای connector در `scripts/fixtures/synthetic-accounting-db.json` اضافه شده است.
- تست های unit برای SQL validator و schema discovery و تست integration برای agent tool loop اضافه شده اند.
- تست integration چند-turn refinement اضافه شده و ماندگاری context نرم افزار موثر بین turnها را بررسی می کند.
- smoke در دو مود `fast` و `full` اجرا می شود و برای هر golden case گزارش امتیاز (score table + avg/min summary) تولید می شود.
- gate سراسری کیفیت روی smoke فعال است: هر دو شاخص `avg` و `min` باید بالاتر از آستانه (پیش فرض 95) باشند.
- CI در PR/Push از `smoke:fast` به صورت matrix روی `ubuntu-latest` و `windows-latest` استفاده می کند، `smoke:full` برای main/workflow_dispatch فعال است و قبل از smoke تست های `unit/integration` اجرا می شوند.
- اجرای مجدد `smoke:fast` بعد از بهبود onboarding schema موفق بود (avg=100 و min=100، آستانه 95).

کارها:

- ساخت test database با داده حسابداری ساختگی ولی واقع گرایانه.
- تعریف golden prompts و expected answer برای سناریوهای پرتکرار.
- تست خودکار برای SQL validator، schema discovery، query builder و agent tool loop.
- ثبت امتیاز کیفیت پاسخ: درست بودن عدد، درست بودن بازه زمانی، ذکر فرضیات، اجرای ابزار لازم و عدم hallucination.
- اجرای regression test قبل از انتشار.
- افزودن smoke test برای `npm run typecheck`، build و چند prompt خشک بدون اتصال به دیتابیس واقعی.

خروجی قابل قبول:

- قبل از هر release، سناریوهای اصلی مالی با عدد قابل انتظار پاس شوند.
- تغییر prompt یا provider بدون سنجش کیفیت وارد محصول نشود.

## فاز 8: انتشار و عملیات

وضعیت تطبیق با کد (2026-06-01): **باز**

هدف: برنامه قابل نصب، پشتیبانی و به روزرسانی شود.

کارها:

- **حذف کلید API هاردکد از `src/main/types.ts`** و قرار دادن مقدار خالی به عنوان default، تا کلید فقط از کاربر یا secret storage گرفته شود. این کار فقط در همین فاز نهایی انجام می‌شود، نه زودتر.
- اطمینان از اینکه بعد از حذف کلید، برنامه با تنظیمات خالی بالا می‌آید و پیام واضح برای ورود کلید نمایش می‌دهد.
- تنظیم metadata واقعی برنامه در `package.json` و electron-builder.
- تعریف نسخه بندی، release notes و مسیر backup/restore تنظیمات.
- امضای برنامه برای Windows در صورت انتشار عمومی.
- auto-update یا حداقل فرایند آپدیت دستی مشخص.
- logging قابل ارسال به پشتیبانی، بدون افشای اطلاعات مالی خام.
- مستند عیب یابی برای اتصال SQL، SSH، provider AI و مشکلات certificate.

خروجی قابل قبول:

- کاربر بتواند برنامه را نصب کند، تنظیمات را نگه دارد و در صورت خطا گزارش قابل بررسی بدهد.

## اولویت پیشنهادی برای گام بعدی

بهترین گام بعدی این است که ابتدا فاز 0 و بخش اصلی فاز 3 انجام شود، چون هم ریسک security را کم می کند و هم مسیر توسعه بعدی را تمیز می کند.

ترتیب پیشنهادی sprint اول:

1. تکمیل README (هدف محصول، نصب، اجرا، نیازمندی SQL Server و AvalAPIs/Gemini). کلید API را حذف نکن.
2. ساخت `AgentOrchestrator` در main process.
3. انتقال prompt و tool execution از renderer به main process.
4. افزودن event/status برای نمایش مراحل ابزار در UI.
5. افزودن audit log ساده برای tool-call و SQL نهایی.
6. اجرای typecheck و build.

بعد از این sprint، فاز 2 یعنی schema catalog و mapping حسابداری ارزشمندترین کار بعدی است.

## سوال های تصمیم ساز

برای دقیق تر کردن فازهای بعدی، این سوال ها باید پاسخ داده شوند:

1. تصمیم فعلی: اولین نرم افزارهای هدف **سپیدار** و **محک** هستند. برای ادامه باید نسخه/ادیشن هدف هرکدام و دیتابیس های واقعی نمونه مشخص شود.
2. آیا دیتابیس هدف همیشه SQL Server است یا باید در آینده MySQL/PostgreSQL/Oracle هم پشتیبانی شود؟
3. آیا مجازیم برای هر مشتری یک read-only SQL user بسازیم یا باید با credential موجود کار کنیم؟
4. داده ها می توانند به provider خارجی AI ارسال شوند یا بعضی مشتری ها نیاز به مدل local/on-prem دارند؟
5. تاریخ در دیتابیس های هدف معمولا شمسی متنی است یا میلادی `datetime`؟
6. پاسخ ها فقط باید read-only باشند یا در آینده عملیات مثل ثبت سند، اصلاح اطلاعات یا ارسال گزارش هم مدنظر است؟
7. آیا محصول فقط دسکتاپ است یا mobile bridge هم باید به یک اپ موبایل واقعی وصل شود؟
8. گزارش خروجی بیشتر برای تصمیم مدیریتی لازم است یا برای حسابدار و سندرسی هم باید جزئیات کامل داشته باشد؟

## زیرساخت تلمتری و مانیتورینگ (Ops)

برای پایش وضعیت برنامه در محیط مشتری و عیب‌یابی سریع، سرور تلمتری مرکزی (Collector) راه‌اندازی شده است. رخدادها و خطاها به صورت محلی در اپلیکیشن صف‌بندی (persistent queue) و سپس به کانتینر ۲۰۵ ارسال می‌شوند.

### مشخصات سرور (Container 205)
- **نام کانتینر**: `acc-telemetry`
- **آی‌پی Collector**: `192.168.85.84`
- **آی‌پی میزبان (Proxmox)**: `192.168.85.37`
- **پورت سرویس**: `8081` (Endpoint: `/ingest`)
- **مسیر ذخیره‌سازی لاگ**: `/var/lib/acc-telemetry/events.ndjson`

### طریقه ارتباط و مشاهده لاگ‌ها
برای مشاهده لاگ‌های زنده از روی سرور Proxmox:
```bash
# مشاهده زنده رخدادها
pct exec 205 -- tail -f /var/lib/acc-telemetry/events.ndjson

# جستجوی خطاهای خاص
pct exec 205 -- grep "error" /var/lib/acc-telemetry/events.ndjson
```
نحوه احراز هویت با استفاده از Bearer Token است که در کادر تنظیمات تلمتری برنامه در بخش Settings وارد می‌شود (مقدار پیش‌فرض در `/etc/acc-telemetry/token` سرور قرار دارد).

## اصل های غیرقابل مذاکره محصول

- هیچ عدد مالی بدون استخراج داده واقعی از دیتابیس اعلام نشود.
- هر پاسخ مهم باید query trace و evidence داشته باشد.
- تا زمانی که امنیت کامل نشده، فقط عملیات read-only مجاز باشد.
- agent باید اگر ابهام دارد سوال بپرسد، نه اینکه با اطمینان حدس بزند.
- اتصال، schema و mapping باید به ازای هر مشتری قابل تنظیم و قابل بازبینی باشد.