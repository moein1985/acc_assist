# FRE Roadmap 00 — نمای کلی، معماری و قرارداد کاری
### Financial Reasoning Engine (FRE) — مهاجرت ارکستریتر به «لایهٔ معنایی + کامپایلر قطعی»

> این مجموعه نقشهٔ راهی است که باید به‌صورت قدم‌به‌قدم توسط یک مدلِ پیاده‌سازِ قوی (GPT‑5.3 Codex یا Sonnet 4.5) اجرا شود. این فایل «۰» سند ریشه است: ابتدا کامل خوانده شود، سپس فایل‌های فاز به ترتیب اجرا شوند.

---

## ۰.۱ — هدف یک‌خطی

ارکستریترِ مالی را از الگوی **«مدلِ ضعیف + N هندلرِ دست‌سازِ deterministic»** به الگوی **«مدلِ قوی به‌عنوان Planner/Explainer + یک موتورِ معناییِ واحد که درست‌به‌ساخت است»** تبدیل کنیم — چیزی شبیه حلقهٔ شفافِ Cascade/GitHub Copilot، اما با **تضمینِ عددیِ مالی** (هیچ عددی توهمی تولید نشود).

---

## ۰.۲ — چرا (مسئله‌ای که حل می‌کنیم)

وضعیت فعلی: هر سؤال مالیِ جدید نیازمند یک regexِ روتینگ + یک هندلر TypeScript + build + deploy + field-test است. این یک «تردمیل» است:

- مقیاس‌پذیر نیست (هر KPI و هر عبارت‌بندی، کدِ جدید می‌خواهد).
- شکننده است (دانشِ schema در ۵ هندلر تکرار شده؛ هر اصلاح باید در همه تکرار شود).
- به قدرتِ مدل گره خورده است (راهنماییِ متنی به مدلِ ضعیف، ما را از مسیر خارج می‌کند — درسِ مستندِ SWE‑1.6).

**اصلِ معماریِ هدف:** *هستهٔ قطعی، پوستهٔ احتمالی* (deterministic core, probabilistic shell). مدل هرگز عدد تولید نمی‌کند؛ مدل فقط **برنامه‌ریزی** و **توضیح** می‌کند، و عددها فقط از اجرای SQLِ قطعی و تأییدشده می‌آیند.

---

## ۰.۳ — نمای معماری هدف

```mermaid
flowchart TB
    Q[سؤال فارسی کاربر] --> RT[Router قطعی first-pass]
    RT --> P[Planner مدل: تولید MetricPlan JSON محدود]
    P --> VP{Validate MetricPlan با Zod schema}
    VP -->|نامعتبر/مبهم| CL[Clarify یا تأیید کاربر]
    VP -->|معتبر| SC[Semantic Layer / Metric Catalog]
    SC --> COMP[SQL Compiler قطعی]
    COMP --> EX[executeReadOnlySql امن]
    EX --> VER[Verifier / Critic: reconciliation + intent-alignment + evidence]
    VER -->|تأیید| EXP[Explainer مدل: نثر فارسی + شواهد]
    VER -->|مردود| RC[recovery / fallback مسیر کاوش با برچسب کم‌اعتماد]
    EXP --> A[پاسخ نهایی + Evidence + SQL]
    MEM[(Memory: mappings، KPI locks، حافظهٔ گفتگو)] --- P
    MEM --- COMP
```

### مسئولیتِ لایه‌ها

| لایه | ورودی | خروجی | قطعی؟ |
|---|---|---|---|
| **Router** | متنِ فارسی | کاندیدای metricId + سیگنال‌های اطمینان | بله |
| **Planner** (مدل) | متن + کاتالوگ متریک | `MetricPlan` (JSON محدود) | خیر (اما محدود + اعتبارسنجی‌شده) |
| **Semantic Layer** | — | `MetricDefinition[]` (دادهٔ اعلانی) | بله |
| **Compiler** | `MetricPlan` + `MetricDefinition` + Catalog | رشتهٔ SQLِ امن | بله |
| **Executor** | SQL | ردیف‌ها | بله (read-only policy) |
| **Verifier** | ردیف‌ها + plan | verdict + اعداد تأییدشده | بله |
| **Explainer** (مدل) | اعداد تأییدشده | نثر فارسی + Evidence | خیر (فقط می‌چیند، عدد نمی‌سازد) |

---

## ۰.۴ — نقشهٔ فازها و فایل‌ها

| فاز | فایل | موضوع | اندازه | ریسک منطقی |
|---|---|---|---|---|
| ۱ | `FRE_ROADMAP_01_FOUNDATION_AND_MODULE_SPLIT.fa.md` | شکستنِ ارکستریتر (رفتار-حفظ) + اسکلتِ ماژول‌ها + feature flag | متوسط | پایین |
| ۲–۳ | `FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md` | شِمای MetricDefinition، MetricPlan IR، کامپایلر، مهاجرتِ ۵ متریک | متوسط | پایین–متوسط |
| ۴–۵ | `FRE_ROADMAP_03_PLANNER_AND_VERIFIER.fa.md` | Planner ساختاریافته + Verifier/Critic + ادغامِ evidence | متوسط | پایین |
| ۶ | `FRE_ROADMAP_04_EVAL_DEPLOY_AND_CUTOVER.fa.md` | هارنسِ golden، CI، shadow mode، استقرار، تأیید میدانی، cutover، rollback | کوچک–متوسط | پایین |
| ۷ | `FRE_ROADMAP_05_PHASE7_LEGACY_MIGRATION.fa.md` | مهاجرتِ ۹ intent باقی‌مانده به FRE — هر کدام فقط با تعریف + golden test | متوسط | پایین–متوسط |
| ۸ | `FRE_ROADMAP_06_PHASE8_MULTI_METRIC.fa.md` | MultiMetricPlan، grains واقعی (by_month/by_quarter/by_customer)، متریک‌های مشتق | متوسط | متوسط |
| ۹ | `FRE_ROADMAP_07_PHASE9_PRODUCTION.fa.md` | Shadow run ۲ هفته، حذفِ فیزیکیِ legacy، monitoring، بهینه‌سازی | کوچک–متوسط | پایین |
| ۱۰ | `FRE_ROADMAP_08_PHASE10_PLANNER.fa.md` | Planner مدلی پیشرفته، Clarify هوشمند، زبانِ محاوره‌ای، ۴۰+ golden | متوسط | متوسط |
| ۱۱ | `FRE_ROADMAP_09_PHASE11_SEPIDAR_DEPTH.fa.md` | عمق‌بخشی روی سپیدار: ۱۰۰+ golden cases، صورت‌های مالی استاندارد، نسبت‌های مالی، planner پیچیده | متوسط–بزرگ | متوسط |
| ۱۲ | `FRE_ROADMAP_10_PHASE12_SCHEMA_ABSTRACTION.fa.md` | **جایگزین‌شده با فاز ۱۵** — تمام اهداف (SchemaAdapter, SepidarAdapter, adapter registry) در فاز ۱۵ به‌صورت کامل‌تر پیاده‌سازی شد (automatic discovery + buildAdapter) | — | — |
| ۱۳ | `FRE_ROADMAP_11_PHASE13_ADVANCED_MANAGEMENT.fa.md` | متریک‌های مدیریتی پیشرفته: COGS، موجودی، بودجه، مراکز هزینه، پروژه، خروجی PDF/Excel، نمودار | بزرگ | متوسط |
| ۱۴ | `FRE_ROADMAP_12_PHASE14_ACCOUNTANT_TOOLS.fa.md` | ابزارهای حسابدار: فیلتر محدوده تاریخ، کوئری سند-محور، کشف خطا، تحلیل سنی، گردش تفصیلی، مالیات، چک، بستن دوره، تطبیق، drill-down مکالمه‌ای | بزرگ | متوسط |
| ۱۵ | `FRE_ROADMAP_13_PHASE15_BLIND_SCHEMA_DISCOVERY.fa.md` | کشف کور schema: SchemaAdapter interface، INFORMATION_SCHEMA scan، LLM semantic mapping، human-in-the-loop، مسیر دوگانه (سپیدار + auto-detect) | متوسط–بزرگ | متوسط |
| ۱۶ | `FRE_ROADMAP_14_PHASE16_SSH_REMOTE_CONNECTION.fa.md` | اتصال از راه دور با SSH: auto-connect، auto-reconnect، Connection Wizard، host key verification، credential encryption، health indicator، ادغام با Blind Schema Discovery | متوسط–بزرگ | متوسط |
| ۱۷ | `FRE_ROADMAP_15_PHASE17_ARCH_FIXES.fa.md` | رفع مسائل معماری: backpressure در تونل SSH، بستن pool SQL هنگام قطع تونل، گیت کردن DIAG logs، کش کردن resolveRuntimeSqlConnection، رفع فراخوانی مضاعف eventLogEntries، surfacing خطای autoDiscoverSchema به UI | کوچک–متوسط | پایین |
| ۱۸ | `FRE_ROADMAP_16_PHASE18_PYTHON_SANDBOX.fa.md` | محیط اجرای پایتون embedded: sandbox امن، AST validation، whitelist کتابخانه‌ها، ادغام با Planner (PythonOutputPlan)، رندر نمودار/اکسل/PDF در چت، pip با repo fallback ایرانی | متوسط–بزرگ | متوسط |
| ۱۹ | `FRE_ROADMAP_17_PHASE19_ADVANCED_FINANCIAL_METRICS.fa.md` | متریک‌های مالی پیشرفته: صورت جریان وجوه نقد، نسبت‌های سودآوری (ROE/ROA)، نسبت‌های نقدی و گردش، تحلیل روند و CAGR، دارایی‌های ثابت، بهای تمام‌شده تفصیلی، تطبیق بانک، مالیات پیشرفته | متوسط–بزرگ | متوسط |
| ۲۰ | `FRE_ROADMAP_18_PHASE20_ADVANCED_PLANNER.fa.md` | Planner هوشمند: چندمرحله‌ای (MultiStepPlan)، حافظه مکالمه v2، پیشنهادهای هوشمند (Smart Suggestions)، کشف خودکار anomaly، دانش دامنه حسابداری، Clarify پیشرفته | متوسط–بزرگ | متوسط |
| ۲۱ | `FRE_ROADMAP_19_PHASE21_UX_REPORTING.fa.md` | تجربه کاربری و گزارش‌گیری: شفافیت SQL، اعتماد-score، نمودار تعاملی (Chart.js)، گزارش‌های زمان‌بندی‌شده، پشتیبانی چندزبانه (فارسی+انگلیسی)، chat history persistence، quick actions | متوسط | پایین–متوسط |

**ترتیب اجرا:** ۱ → ۲ → ۳ → ۴ → ... → ۱۳ → ۱۴ → ۱۵ → ۱۶ → ۱۷ → ۱۸ → ۱۹ → ۲۰ → ۲۱. هیچ فازی قبل از سبزشدنِ کاملِ فاز قبل (تست + typecheck + شواهد) شروع نشود.

---

## ۰.۵ — استراتژی Strangler Fig (بدون big-bang)

هیچ‌چیز یک‌باره بازنویسی نمی‌شود. یک flagِ سه‌حالته معرفی می‌کنیم:

```ts
// در settings/contracts
financialEngineMode: 'legacy' | 'shadow' | 'engine'
```

- **`legacy`** (پیش‌فرض اولیه): فقط مسیرِ deterministicِ فعلی. هیچ تغییرِ رفتاری.
- **`shadow`**: هر دو مسیر اجرا می‌شوند؛ خروجی به کاربر از مسیرِ legacy می‌آید، اما خروجیِ موتورِ نو **مقایسه و لاگ** می‌شود (mismatch ثبت می‌شود). برای اعتبارسنجیِ بی‌خطرِ معماریِ نو.
- **`engine`**: موتورِ نو به کاربر سرویس می‌دهد؛ legacy فقط fallback اضطراری.

هر متریک **به‌صورت جداگانه** و پشتِ این flag مهاجرت می‌کند. ترتیب: ابتدا «فروش» (vertical slice کامل)، سپس بقیه. هندلرِ قدیمی فقط پس از اثباتِ تطابقِ عددی (shadow سبز) بازنشسته می‌شود.

---

## ۰.۶ — قرارداد کاری اجباری (Working Agreement)

> این بخش از تجربهٔ مستندِ پروژه استخراج شده و **نقض‌ناپذیر** است. مدلِ پیاده‌ساز باید به همهٔ این قواعد پایبند بماند.

### قانون ضدِ تیکِ بی‌شاهد (Anti-over-ticking)
- هیچ آیتمی `[x]` نشود مگر با **شاهدِ واقعی**: خروجیِ تست، یا خطِ `final` از `agent-audit.log` با `requestId`.
- **هرگز** «Cannot answer reliably» یا یک پاسخِ رد را به‌عنوان موفقیت تیک نزن.
- اگر کاری ناقص ماند، صادقانه `[ ]` بگذار و دلیل + یافته را بنویس.

### دستورهای تأییدشده (Windows / PowerShell)
```powershell
# Typecheck
npm run typecheck:node            # = tsc --noEmit -p tsconfig.node.json --composite false

# Test (الزاماً با --test-force-exit)
npx tsx --test --test-force-exit tests/unit/*.test.ts tests/integration/*.test.ts 2>&1 `
  | Select-String -Pattern "tests |pass |fail |skipped " | Select-Object -Last 5
# baseline فعلی = 244 tests / 243 pass / 0 fail / 1 skipped — نباید قرمز شود

# Build (چند دقیقه؛ خروجیِ امضاشده)
npm run build:win                 # → dist\win-unpacked\ACCAssist.exe + dist\acc-assist-1.0.0-setup.exe

# Deploy (env باید در همان شل ست باشد)
$env:ACC_REMOTE_HOST='192.168.85.56'; $env:ACC_REMOTE_USER='administrator'
$env:ACC_REMOTE_SSH_PASSWORD='<در شل ست شده>'
$env:ACC_REMOTE_HOST_KEY='ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'
npm run remote:install ; npm run remote:start
```

### تأییدِ استقرار (asar-grep) — اجباری بعد از هر deploy
هرگز فرض نکن بیلد مستقر شده. نشانگرِ کدِ نو را در asarِ مستقرشده بشمار:
```powershell
$ps='(Select-String -Path "C:\Users\Administrator\AppData\Local\Programs\acc-assist\resources\app.asar" -Pattern "<MARKER>" -AllMatches | Measure-Object).Count'
$b64=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ps))
plink -P 2211 -ssh -batch -hostkey $env:ACC_REMOTE_HOST_KEY -pw $env:ACC_REMOTE_SSH_PASSWORD administrator@192.168.85.56 "powershell -NoProfile -EncodedCommand $b64"
```

### تستِ میدانی (ask-ai) — پرامپت کوتاه + DebugToken ثابت
```powershell
chcp 65001 > $null; [Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8
Set-Content -Path "$PWD\tmp-q.txt" -Value 'مقایسه فروش ۱۴۰۲ و ۱۴۰۳' -Encoding utf8 -NoNewline
pwsh -ExecutionPolicy Bypass -File scripts/ops/remote-server-control.ps1 -Action ask-ai `
  -PromptFile "$PWD\tmp-q.txt" -ConversationId 'fre1' -DebugToken 'fretok'
# خروجی: Ok / Rounds / ToolCallsUsed / ---FINAL TEXT---
```

### شاهدِ audit-log
مسیر روی ریموت: `C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log` (هر خط JSON).
خطِ `final`ِ تمیزِ deterministic: `round:0` و بدونِ `failureKind`. خطای ابزار: `{"stage":"tool-error","errorCategory":"deterministic-tool-failure",...}`.

### تشخیصِ ground-truth با sqlcmd
```powershell
# کاربر/رمز دموی واقعیِ تست‌DB
sqlcmd -S 127.0.0.1,58033 -U damavand -P damavand -d Sepidar01 -h -1 -W -Q "SET NOCOUNT ON; <query>"
# لیترال‌های فارسی را به‌صورت NCHAR(...) بنویس تا کامند ASCII-safe بماند (بدون mojibake)
```

---

## ۰.۷ — داده‌های Ground-Truth (لنگرهای رگرسیون)

این اعداد روی محیطِ تست (Sepidar01 @ 192.168.85.56) تأیید میدانی شده‌اند و باید به‌عنوان **اوراکلِ تست** در golden ها قفل شوند:

| متریک | پرسش | عددِ مرجع |
|---|---|---|
| تراز آزمایشی ۱۴۰۲ | `get_trial_balance` (SUM(Debit), VoucherItem JOIN Voucher JOIN Account JOIN FiscalYear, Type NOT IN(3,4)) | `566,396,483,280` |
| نقد + بانک | `get_cash_bank_balance` | `9,521,507,066` (نقد `2,127,900,602` + بانک `7,393,606,464`) |
| خرید ۱۴۰۲ | `INV.InventoryReceipt` `IsReturn=0` | `226,110,419,451` |
| فروش ۱۴۰۲ | `SLS.Invoice` net | `64,252,437,897` |
| فروش ۱۴۰۳ | `SLS.Invoice` net | `57,023,796,065` |
| مقایسهٔ فروش ۱۴۰۲→۱۴۰۳ | درصد | `-11.25%` (دقیق: `-11.2504%`) |
| ماندهٔ دریافتنی ۱۴۰۲ | `ACC.VoucherItem` `Type NOT IN(3,4)` | `19,755,458,505` |

### Schemaِ تأییدشده (Sepidar)

```
SLS.Invoice         : net = NetPriceInBaseCurrency ; FiscalYearRef (FK) ; Date
FMK.FiscalYear      : FiscalYearId (PK int) ; Title (nvarchar، سالِ واقعی مثل '1402')
ACC.Voucher         : VoucherId (PK) ; Type (int) ; FiscalYearRef ; Date ; Description
ACC.VoucherItem     : VoucherRef→ACC.Voucher.VoucherId ; AccountSLRef→ACC.Account.AccountId ;
                      Debit ; Credit   (تنها ستون‌های ارجاعِ حساب: AccountSLRef؛ AccountRef وجود ندارد)
ACC.Account         : AccountId (PK) ; Title (نام، با کاراکترهای عربی)
INV.InventoryReceipt: TotalPrice ; IsReturn (0=غیرمرجوعی)
RPA.CashBalance     : Balance
RPA.BankAccountBalance : Balance
POM.PurchaseInvoice : خالی (0 ردیف) — خرید واقعی در INV.InventoryReceipt است
```

### قواعدِ طلاییِ schema (که باید قواعدِ کامپایلر شوند)
- **R-سال:** فیلترِ سال **همیشه** با `JOIN FMK.FiscalYear ON <ref>=FiscalYearId WHERE Title IN (...)`. هرگز `CAST(FiscalYearRef AS int)=1402` (کلیدِ جانشین است، ۰ ردیف).
- **R-اختتامیه:** برای ماندهٔ مبتنی بر سند، **همیشه** `AND v.Type NOT IN (3, 4)` (وگرنه مانده روی سالِ بسته‌شده = ۰).
- **R-collation:** برای LIKEِ متنِ فارسی، هر دو طرف فولد شوند: JS `normalizePersianText` + SQL زنجیرهٔ `REPLACE(...NCHAR(1610)→1740, 1609→1740, 1603→1705...)` و `COLLATE`.
- **R-quote:** همیشه `quoteSqlTableRef('Schema.Table')` (که روی `.` جدا می‌کند) → `[Schema].[Table]`. هرگز `quoteSqlIdentifier('Schema.Table')` (که می‌دهد `[Schema.Table]`).
- **R-inject:** مقادیرِ رشته‌ای به‌صورت `N'...'` با escapeِ `''`؛ اعداد فقط پس از اعتبارسنجیِ integer متناهی.
- **R-KPI:** «فروش خالص» = `NetPriceInBaseCurrency` (قفل‌شده، نه `PriceInBaseCurrency`).

### enum ACC.Voucher.Type
`1,2` = اسناد عملیاتیِ عادی | `3` = بستن حساب‌های موقت | `4` = اختتامیه | `5` = افتتاحیه (نگه‌داشته شود).

---

## ۰.۸ — واژه‌نامه

- **Metric (متریک):** یک KPIِ مالیِ تعریف‌شده (فروش خالص، خرید، ماندهٔ حساب، …).
- **MetricDefinition:** تعریفِ اعلانیِ یک متریک (منبع، measure، ابعاد، فیلترها، آشتی‌ها).
- **MetricPlan (IR):** خروجیِ ساختاریافتهٔ Planner؛ انتخابِ متریک + grain + فیلتر + مقایسه.
- **Grain:** سطحِ تجمیع (total / by_year / by_month / by_branch / by_account …).
- **Compiler:** تابعِ قطعیِ `MetricPlan + MetricDefinition + Catalog → SQL`.
- **Verifier/Critic:** لایهٔ تأییدِ پس از اجرا (آشتیِ اعداد، تطابقِ intent، گاردِ evidence).
- **Shadow mode:** اجرای موازیِ engine برای مقایسه، بدونِ سرویس‌دادن به کاربر.

---

## ۰.۹ — معیارِ پذیرشِ کلیِ پروژه

پروژه «تمام» است وقتی همهٔ این‌ها هم‌زمان برقرار باشند:
1. هر ۵ متریکِ فعلی از طریقِ موتورِ نو (`engine` mode) پاسخ می‌دهند و عددشان **دقیقاً** با لنگرهای ground-truth بخش ۰.۷ می‌خوابد (شاهدِ field + audit).
2. هیچ رگرسیونی در گاردِ ایمنی نیست: سؤالِ مالیِ بی‌ربط بدون داده همچنان رد می‌شود (`failureKind=NO_FETCH`، بدونِ عددِ ساختگی).
3. تست‌ها سبز (≥ baseline) + `typecheck:node` تمیز.
4. افزودنِ یک متریکِ جدید فقط نیازمندِ **یک تعریفِ اعلانی + یک golden test** باشد — بدونِ هندلرِ TypeScriptِ جدید (اثبات با افزودنِ یک متریکِ نمونهٔ تازه در فاز ۶).
5. حداقل ۲ هفته اجرای `shadow` بدونِ mismatchِ عددی روی متریک‌های مهاجرت‌شده، قبل از سوییچ به `engine`. — **وضعیت: shadow run کوتاه‌مدت انجام شد (mismatchها اصلاح شدند). اجرای طولانی‌مدت ۲ هفته‌ای به production موکول شد. در حال حاضر engine mode فعال است.**

---

## ۰.۹.۱ — وضعیت فعلی پروژه (تاریخ بروزرسانی: ۱۴۰۵/۰۴/۰۹)

| فاز | وضعیت | توضیح |
|---|---|---|
| ۱–۶ | ✅ کامل | Foundation, Semantic Layer, Compiler, Planner, Verifier, Eval |
| ۷ | ✅ کامل | مهاجرت legacy intents |
| ۸ | ✅ کامل | MultiMetric, grains, derived metrics |
| ۹ | ⏳ ۱۷/۲۲ | ۵ آیتم زمان‌محور (shadow run ۲ هفته‌ای) معوق به production |
| ۱۰ | ✅ کامل | Planner پیشرفته, Smart Clarify, زبان محاوره‌ای |
| ۱۱ | ✅ کامل | ۱۳۰ golden cases, صورت‌های مالی, نسبت‌ها |
| ۱۲ | ✅ جایگزین‌شده | با فاز ۱۵ جایگزین شد — رویکرد automatic discovery برتری دارد |
| ۱۳ | ✅ کامل | COGS, موجودی, بودجه, مراکز هزینه, PDF/Excel |
| ۱۴ | ✅ کامل | ابزارهای حسابدار, drill-down مکالمه‌ای, ۲۱۱ golden cases |
| ۱۵ | ✅ کامل | Blind Schema Discovery, SchemaAdapter, buildAdapter, تست بلایند سپیدار |
| ۱۶ | ✅ کامل (به‌جز field test) | اتصال از راه دور با SSH: auto-connect, auto-reconnect, Connection Wizard, host key verification, credential encryption, health indicator, diagnostic panel, mapping wizard |
| ۱۷ | ✅ کامل | اصلاحات معماری: backpressure, pool cleanup, DIAG log gating, runtime connection cache, double-read fix, schema failure UI notification |
| ۱۸ | ✅ کامل (به‌جز S18.8/S18.12) | Python Sandbox: embedded Python 3.12, AST validation, template engine, IPC handlers, ۲۲ unit test, ۱۰ golden case, field test ۱۲/۱۲ (SSH) + ۱۰/۱۲ (direct install) |
| ۱۹ | � در حال پیاده‌سازی (S19.1-S19.17 ✅) | متریک‌های مالی پیشرفته: جریان وجوه نقد, ROE/ROA, تحلیل روند, دارایی ثابت, بهای تمام‌شده — ۳۳ golden case جدید، eval ۲۵۱/۲۵۱ |
| ۲۰ | 📋 برنامه‌ریزی‌شده | Planner هوشمند: multi-step, حافظه v2, smart suggestions, anomaly detection |
| ۲۱ | 📋 برنامه‌ریزی‌شده | UX و گزارش‌گیری: SQL transparency, confidence score, نمودار تعاملی, گزارش زمان‌بندی, چندزبانه |

**آمار فعلی (فاز ۱۹ در حال اجرا):**
- ۷۳ متریک (۵۸ قبلی + ۱۵ پایه جدید + ۱۱ مشتق جدید)
- ۲۵۱ golden cases (100% سبز)
- ۴۳۸ unit test + integration test
- typecheck: ۰ خطای جدید
- Python 3.12 embedded + sandbox امن
- مارکر asar: PYTHON_SANDBOX

**آمار هدف (پس از فاز ۲۱):**
- ~۸۰+ متریک (۵۸ فعلی + ~۲۲ جدید)
- ~۲۵۹ golden cases (۲۱۱ فعلی + ~۴۸ جدید)
- ~۳۸۰+ unit test
- Python embedded + sandbox امن
- نمودار تعاملی + گزارش زمان‌بندی + چندزبانه

**کارهای باقی‌مانده:**
- فاز ۱۸: S18.8 (planner few-shot) و S18.12 (renderer UI component) — اولویت متوسط
- shadow run رسمی ۲ هفته‌ای (پس از Release ۲.۰)
- فاز ۱۹: S19.18-S19.22 باقی‌مانده (full gate, build, field test, witness, OVERVIEW)
- فاز ۲۰-۲۱: پیاده‌سازی بر اساس roadmapهای جدید

---

## ۰.۱۰ — اصولِ راهنما برای مدلِ پیاده‌ساز

- **رفتار-حفظ تا حدِ ممکن:** در فاز ۱، صرفاً جابه‌جاییِ کد؛ هیچ تغییرِ منطقی نباید عددی را عوض کند.
- **داده > کد:** دانشِ دامنه باید در `MetricDefinition`های اعلانی زندگی کند، نه در شاخه‌های if.
- **محدودسازیِ مدل:** مدل هرگز SQL خام تولید نکند؛ فقط `MetricPlan`ِ معتبر. اگر نتوانست، به Clarify برود، نه به حدس.
- **شکستِ امن:** هر خطای کامپایلر/اجرا → fallback به مسیرِ legacy + لاگِ `deterministic-tool-failure`، نه عددِ مشکوک.
- **یک متریک در هر زمان:** هرگز چند متریک را هم‌زمان مهاجرت نده. vertical slice «فروش» اول.
- **شاهدِ واقعی:** هیچ ادعای موفقیتی بدونِ خروجیِ تست یا خطِ audit.

> قدمِ بعدی: فایل `FRE_ROADMAP_01_FOUNDATION_AND_MODULE_SPLIT.fa.md`.
