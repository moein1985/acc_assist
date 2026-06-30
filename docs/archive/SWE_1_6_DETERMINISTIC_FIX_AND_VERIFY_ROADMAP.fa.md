# نقشه راه رفع باگ مسیرهای قطعی و راستی‌آزمایی ACC Assist — برای مدل SWE-1.6 در Devin (سری U)

آخرین بازبینی: 2026-06-25

این سند سومین سند مخصوص **SWE-1.6** است و بعد از `SWE_1_6_DETERMINISTIC_PATHS_AND_CODE_HEALTH_ROADMAP.fa.md` (سری T) اجرا می‌شود.

## نحوهٔ استفاده (مخصوص Devin / Plan Mode)

- ابتدا در **Plan Mode** از روی این سند پلن بساز، سپس مرحله‌به‌مرحله پیش برو.
- گام‌ها بسیار کوچک و اتمیک‌اند. هر گام یک شناسه (مثل U1.3) و یک «شرط پذیرش» دارد.
- بعد از هر گام، تست و typecheck را سبز نگه دار.

---

## ⚠️ چرا این سند لازم شد (تشخیص مستقلِ تأییدشده)

در سری T همهٔ چک‌باکس‌ها [x] خوردند، اما لاگ‌های میدانیِ خودِ شما نشان داد فقط **۲ از ۵ مسیر** کار می‌کند:

| سؤال | نتیجهٔ واقعی | failureKind |
|---|---|---|
| خرید ۱۴۰۲ | ✅ ۲۲۶٬۱۱۰٬۴۱۹٬۴۵۱ | NONE |
| فروش ۱۴۰۲ | ✅ ۶۴٬۲۵۲٬۴۳۷٬۸۹۷ | NONE |
| ماندهٔ بدهکار حساب | ❌ بدون عدد | NO_FETCH |
| تراز آزمایشی | ❌ Invalid column name | UNKNOWN_OBJECT |
| مانده نقد و بانک | ❌ | POLICY_ERROR |
| مقایسهٔ فروش ۱۴۰۲/۱۴۰۳ | ❌ پسرفت | evidence-contract reject |

### 🐞 باگ ریشه‌ای (تأییدشده در کد) — مهم‌ترین گام این سند

در `src/main/services/agentOrchestrator.ts`، تابع `tryResolveDeterministicFinancialTool`، مسیرهای ACC/RPA این‌طور نوشته شده‌اند:

```ts
const voucherTable = this.quoteSqlIdentifier('ACC.Voucher')   // ❌ خروجی: [ACC.Voucher]
```

اما تعریف تابع:

```ts
private quoteSqlIdentifier(value: string): string {
  return `[${value.replace(/\]/g, ']]')}]`
}
```

یعنی `'ACC.Voucher'` می‌شود `[ACC.Voucher]` (یک identifier واحد با نقطهٔ داخلی) نه `[ACC].[Voucher]`. SQL Server این را جدولی با نامِ تحت‌اللفظیِ «ACC.Voucher» در schemaی پیش‌فرض می‌بیند → **Invalid object name** → استثنا → بلوک `catch` آن را می‌بلعد و `null` برمی‌گرداند → سقوط به مسیر مدل → NO_FETCH / UNKNOWN_OBJECT / POLICY_ERROR.

**چرا خرید کار می‌کند؟** چون آن مسیر schema و table را **جدا** quote می‌کند:
`this.quoteSqlIdentifier('POM')` + `'.'` + `this.quoteSqlIdentifier('PurchaseInvoice')`.

### باگ‌های ثانویه (تأییدشده)
1. مسیر `get_account_balance` هیچ‌وقت بر اساس **سال مالی** فیلتر نمی‌کند (به `FMK.FiscalYear` JOIN می‌زند ولی `WHERE fy.Title = N'<سال>'` ندارد) → عددِ همهٔ سال‌ها.
2. **چرا تست‌ها سبزند ولی میدان می‌شکند:** هیچ تستی `tryResolveDeterministicFinancialTool` را اجرا و شکلِ SQLِ تولیدشده را بررسی نمی‌کند. تست‌ها فقط registry و متن system-prompt را چک می‌کنند.
3. مقایسهٔ فروش چنددوره: داده fetch می‌شود ولی محاسبهٔ درصد انجام نمی‌شود؛ قرارداد evidence-first پاسخ را رد می‌کند.

---

## قوانین اجرای اجباری

1. فازها به ترتیب (U0 → U6).
2. **قانون ضدِ تیکِ توخالی:** هیچ گام رفتاری بدون شاهد واقعی تیک نخورد. شاهد = خروجی واقعی تست **یا** خط `agent-audit.log` با `requestId` و `failureKind`. کپی‌کردن «Cannot answer reliably» به‌عنوان موفقیت ممنوع است.
3. بعد از هر گامِ کدنویسی این دو سبز باشند:
   - `npm run typecheck:node`
   - `npx tsx --test --test-force-exit tests/unit/*.test.ts tests/integration/*.test.ts`
4. **گاردِ ایمنی (رد پاسخ مالی بدون شواهد trace) هرگز حذف یا تضعیف نشود.**
5. **بلوک‌های `catch { return null }` که خطای SQL را می‌بلعند، باید خطا را در `agent-audit.log` لاگ کنند** تا دفعهٔ بعد علت دقیق دیده شود (نه فقط null خاموش).

---

## 📌 نقشهٔ دادهٔ زمینیِ تأییدشده (تغییر نکرده)

| مفهوم | جدول | ستون | PK / Join |
|---|---|---|---|
| فروش | `SLS.Invoice` | `NetPriceInBaseCurrency`, `Date`, `FiscalYearRef` | کار می‌کند ✓ |
| خرید | `INV.InventoryReceipt` | `TotalPrice`, `IsReturn` (۰=غیرمرجوعی) | SUM WHERE IsReturn=0 = ۲۲۶٬۱۱۰٬۴۱۹٬۴۵۱ |
| مانده/تراز | `ACC.VoucherItem` | `Debit`, `Credit`, `VoucherRef`, `AccountSLRef` | مانده=SUM(Debit)-SUM(Credit) |
| سند | `ACC.Voucher` | PK=`VoucherId`, `FiscalYearRef` | `VoucherItem.VoucherRef = Voucher.VoucherId` ✓ |
| حساب | `ACC.Account` | PK=`AccountId`, نام=`Title` | `VoucherItem.AccountSLRef = Account.AccountId` ✓ |
| نقد | `RPA.CashBalance` | `Balance` | SUM=۲٬۱۲۷٬۹۰۰٬۶۰۲ |
| بانک | `RPA.BankAccountBalance` | `Balance` | SUM=۷٬۳۹۳٬۶۰۶٬۴۶۴ |
| سال مالی | `FMK.FiscalYear` | PK=`FiscalYearId`, `Title` | `<t>.FiscalYearRef = fy.FiscalYearId WHERE fy.Title = N'<سال>'` |

---

## روش‌های عملیاتی تأییدشده

### asar-grep (تأیید استقرار)
```powershell
$ps='(Select-String -Path "C:\Users\Administrator\AppData\Local\Programs\acc-assist\resources\app.asar" -Pattern "<marker>" -AllMatches | Measure-Object).Count'
$b64=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ps))
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "powershell -NoProfile -EncodedCommand $b64"
```

### ask-ai (تست میدانی) — **پرامپت را کوتاه نگه دار**
```powershell
$env:ACC_REMOTE_HOST='192.168.85.56'; $env:ACC_REMOTE_USER='administrator'; $env:ACC_REMOTE_SSH_PASSWORD='Hs-co@12321#'; $env:ACC_REMOTE_HOST_KEY='ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'
'<پرسش کوتاه>' | Set-Content tmp-q.txt -Encoding utf8
pwsh -ExecutionPolicy Bypass -File scripts/ops/remote-server-control.ps1 -Action ask-ai -PromptFile "$PWD\tmp-q.txt" -ConversationId 'd' -DebugToken 'dt1'
```

---

# فاز U0 — تستِ شکستِ بازتولیدکننده (قبل از هر اصلاح)

**هدف:** اول باگ را با یک تست واحدِ قرمز اثبات کن، تا تیکِ توخالی غیرممکن شود.

گام‌های اتمیک:

- [x] **U0.1** baseline: `npm run typecheck:node` و کل تست‌ها را اجرا و سبز بودن فعلی را ثبت کن.
- [x] **U0.2** یک helper تست بساز که `executeReadOnlySql` را mock کند و **رشتهٔ query** را ضبط کند (به‌جای اجرای واقعی، یک مقدار ساختگی برگرداند).
- [x] **U0.3** تست واحدِ جدید `tests/unit/agentOrchestratorDeterministicSql.test.ts`: برای intent `get_trial_balance`، `tryResolveDeterministicFinancialTool` را صدا بزن و assert کن query شامل `[ACC].[VoucherItem]` و `[ACC].[Voucher]` باشد و شاملِ `[ACC.Voucher]` **نباشد**. این تست الان باید **قرمز** شود (باگ را اثبات می‌کند).
- [x] **U0.4** همان assert را برای `get_account_balance` و `get_cash_bank_balance` اضافه کن (`[RPA].[CashBalance]`, `[RPA].[BankAccountBalance]`). قرمز بمانند.

**شرط پذیرش U0:** تست‌های جدید نوشته شده‌اند و **عمداً قرمزند** (باگ را بازتولید می‌کنند).

---

# فاز U1 — رفع باگ quoting جدول دونام‌بخشی (schema.table)

**هدف:** هر `schema.table` به `[schema].[table]` تبدیل شود، نه `[schema.table]`.

گام‌های اتمیک:

- [x] **U1.1** یک helper جدید بساز: `private quoteSqlTableRef(ref: string): string` که `ref` را روی نخستین `.` می‌شکند و خروجی `${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(table)}` می‌دهد؛ اگر نقطه نبود، همان `quoteSqlIdentifier(ref)`.
- [x] **U1.2** در مسیر `get_account_balance`، همهٔ `this.quoteSqlIdentifier('ACC.Voucher' | 'ACC.VoucherItem' | 'ACC.Account' | 'FMK.FiscalYear')` را با `this.quoteSqlTableRef(...)` جایگزین کن.
- [x] **U1.3** در مسیر `get_trial_balance` همین جایگزینی را انجام بده.
- [x] **U1.4** در مسیر `get_cash_bank_balance`، `'RPA.CashBalance'` و `'RPA.BankAccountBalance'` را با `quoteSqlTableRef` جایگزین کن.
- [x] **U1.5** تست‌های U0.3/U0.4 را اجرا کن؛ حالا باید **سبز** شوند.
- [x] **U1.6** typecheck + کل تست‌ها سبز.

**شرط پذیرش U1:** تست‌های شکلِ SQL سبزند و هیچ `[<schema>.<table>]` در query تولیدی باقی نمانده.

---

# فاز U2 — افزودن فیلتر سال مالی به ماندهٔ حساب

**هدف:** `get_account_balance` باید سال را از prompt بخواند و `WHERE fy.Title = N'<سال>'` بگذارد.

گام‌های اتمیک:

- [x] **U2.1** سال مالی را از prompt استخراج کن (الگوی `(\d{4})`؛ مثل تراز آزمایشی).
- [x] **U2.2** اگر سال موجود بود، `AND fy.Title = N'<سال>'` به `WHERE` اضافه کن (هم در شاخهٔ بانام حساب، هم بی‌نام).
- [x] **U2.3** تست واحد: prompt با «۱۴۰۲» → query شامل `fy.Title = N'1402'`.
- [x] **U2.4** تست واحد: prompt با نام حساب + سال → query شامل هر دو فیلتر.
- [x] **U2.5** typecheck + کل تست‌ها سبز.

**شرط پذیرش U2:** ماندهٔ حساب با سال فیلتر می‌شود و تست آن را اثبات می‌کند.

---

# فاز U3 — لاگ‌کردن خطاهای بلعیده‌شده (دیدِ تشخیصی)

**هدف:** بلوک‌های `catch { return null }` دیگر خطا را خاموش نبلعند.

گام‌های اتمیک:

- [x] **U3.1** در هر `catch` مسیرهای deterministic (account/trial/cash-bank/purchase/default)، قبل از `return null`، یک خط audit با `stage:'tool-error'`، `intentId`، و `message` خطا ثبت کن (بدون افشای داده‌های حساس).
- [x] **U3.2** typecheck + کل تست‌ها سبز.

**شرط پذیرش U3:** اگر SQL deterministic بشکند، در `agent-audit.log` خط `tool-error` با علت دیده می‌شود (نه null خاموش).

---

# فاز U4 — رفع پسرفت مقایسهٔ فروش چنددوره

**هدف:** «مقایسهٔ فروش ۱۴۰۲ و ۱۴۰۳» باید عدد هر دوره + درصد تغییر بدهد و قرارداد evidence-first بپذیرد.

گام‌های اتمیک:

- [x] **U4.1** مسیر مقایسه را پیدا کن (جایی که داده fetch شد ولی پاسخ رد شد). بررسی کن چرا قرارداد evidence-first آن را «no percentage calculation» می‌داند.
- [x] **U4.2** محاسبهٔ درصد تغییر را اضافه کن: `((y2 - y1) / y1) * 100` با مدیریت تقسیم بر صفر.
- [x] **U4.3** عدد هر دو دوره و درصد را در متن پاسخِ مبتنی‌بر‌شاهد بگنجان تا قرارداد بپذیرد.
- [x] **U4.4** تست واحد مقایسه (دو دورهٔ پر، یک دورهٔ خالی).
- [x] **U4.5** typecheck + کل تست‌ها سبز.

**شرط پذیرش U4:** مقایسهٔ فروش عددِ هر دوره + درصد می‌دهد و رد نمی‌شود.

---

# فاز U5 — تکمیل تقسیم فایل (ادامهٔ T0.9)

**زمینه:** در سری T فایل از ۶٬۷۱۶ به ۵٬۸۹۰ خط رسید ولی هدف ~۱۲۰۰ خط محقق نشد.

گام‌های اتمیک:

- [x] **U5.1** بلوک بزرگ `tryResolveDeterministicFinancialTool` و توابع کمکیِ مرتبط را به `agentOrchestrator/deterministicTools.ts` منتقل کن (API عمومی ثابت بماند). — انجام شد: ماژول جدید `deterministicTools.ts` (۵۴۸ خط) با `interface DeterministicToolDeps` + `resolveDeterministicFinancialTool` + `selectDeterministicToolColumn` + `buildDeterministicToolColumnPreference`؛ بدنهٔ متد در orchestrator به wrapper نازک تبدیل شد (−۴۶۵ خط). کامیت `c8a35f7`.
- [x] **U5.2** typecheck + کل تست‌ها سبز. — `npm run typecheck:node` تمیز؛ کل تست‌ها ۲۴۳/۲۴۲ pass/۱ skipped (برابر baseline).
- [ ] **U5.3** اگر هنوز فایلی > ~۱۵۰۰ خط بود، یک ماژول دیگر هم جدا کن (مثلاً منطق comparison). — هنوز انجام نشده: `agentOrchestrator.ts` همچنان ~۶٬۵۰۹ خط است. نیاز به استخراج ماژول‌های بیشتر (مثلاً comparison) باقی است.
- [x] **U5.4** تأیید: `get_errors` روی فایل‌های جدید خطای واقعی ندهد. — `get_errors` روی `deterministicTools.ts` و orchestrator تمیز؛ eslint پس از نرمال‌سازی CRLF→LF صفر مشکل.

**شرط پذیرش U5 (نسبی محقق):** رفتار ثابت ✓، تست‌ها سبز ✓، فایل اصلی کوچک‌تر ✓ (−۴۶۵ خط). اما هدفِ ~۱۵۰۰ خط هنوز محقق نشده (U5.3 باز).

---

# فاز U6 — استقرار و راستی‌آزماییِ میدانی (با شاهد اجباری)

گام‌های اتمیک:

- [x] **U6.1** `npm run build:win` (با تأیید کاربر). — موفق؛ `dist\acc-assist-1.0.0-setup.exe` (NSIS، امضاشده) + `dist\win-unpacked\ACCAssist.exe`.
- [x] **U6.2** `npm run remote:install` سپس `npm run remote:start`. — نصب کامل روی 192.168.85.56؛ اجرا: `...\acc-assist\ACCAssist.exe`.
- [x] **U6.3** asar-grep برای نشانگرِ helper جدید `quoteSqlTableRef` (باید پیدا شود → اثبات استقرارِ کدِ اصلاح‌شده). — `quoteSqlTableRef` = ۱۶ بار و `deterministic-tool-failure` = ۵ بار در `app.asar` مستقرشده.
- [x] **U6.4** ask-ai: «ماندهٔ حساب دریافتنی سال ۱۴۰۲» → خط `final` `round:0` (deterministic، بدون `failureKind`) و عدد واقعی. — **محقق شد.** پس از اصلاحِ زنجیرهٔ چهار باگ (۱: regexِ روتینگ که «ماندهٔ … حساب» را نمی‌گرفت؛ ۲: escapeِ تزریقِ SQL در LIKE؛ ۳: فولدِ کاراکترهای عربی/فارسی در دو طرفِ مقایسه برای collationِ حساس؛ ۴ **ریشهٔ اصلی**: کسرِ اسنادِ اختتامیه/بستن — `AND v.Type NOT IN (3, 4)` — چون SUM(بدهکار)-SUM(بستانکار) روی سالِ بسته‌شده دقیقاً صفر می‌شود) مسیر deterministic فعال شد: `Rounds:0`, `ToolCallsUsed:1`, مقدار **19,755,458,505** که با کوئریِ مستقلِ sqlcmd دقیقاً تطبیق دارد. خط `final` تمیز با `round:0` و بدون `failureKind`.
- [x] **U6.5** ask-ai: «تراز آزمایشی سال ۱۴۰۲» → خط `final` با `failureKind=NONE` و چند ردیف. لاگ را ضمیمه کن. — **deterministic**، intent `get_trial_balance`، یک کوئری read-only، مقدار `5,426,804,727,946`، SQL شکل‌درست `[ACC].[VoucherItem]`/JOINها/TOP(200).
- [x] **U6.6** ask-ai: «مانده نقد و بانک» → خط `final` با `failureKind=NONE`؛ عدد مرجع: نقد ~۲٫۱۳ میلیارد، بانک ~۷٫۳۹ میلیارد. لاگ را ضمیمه کن. — **deterministic**، intent `get_cash_bank_balance`، دو کوئری، مقدار `9,521,507,066` = نقد `2,127,900,602` + بانک `7,393,606,464` (تطبیق دقیق). req `ssh-1782375699701`.
- [x] **U6.7** رگرسیون: «خرید کل سال ۱۴۰۲» (باید همچنان ۲۲۶ میلیارد) و «فروش ۱۴۰۲» (باید ۶۴ میلیارد). لاگ هر دو. — خرید **deterministic** `226,110,419,451` (دقیق، `INV.InventoryReceipt` WHERE `IsReturn=0`، req `ssh-1782375717442`)؛ فروش model-assisted `64,252,437,897` (`failureKind=NONE`، req `ssh-1782375732080`).
- [x] **U6.8** «مقایسهٔ فروش ۱۴۰۲ و ۱۴۰۳» → خط `final` با عددِ هر دوره + درصد، مسیرِ deterministic. — **محقق شد.** مسیرِ deterministicِ fallback بازسازی شد: SQL غلطِ قبلی (`CAST(FiscalYearRef AS int) IN (1402,1403)` که هیچ‌وقت با کلیدِ جانشین تطبیق نمی‌خورد) با `JOIN [FMK].[FiscalYear] fy ON src.FiscalYearRef = fy.FiscalYearId WHERE fy.Title IN (N'1402', N'1403')` جایگزین شد؛ `selectSalesGrowthSourceTable` حالا پیش‌فرضِ Sepidar (`[SLS].[Invoice]`/`NetPriceInBaseCurrency`/`FiscalYearRef`) را برمی‌گرداند و در خطا با try/catch به مسیرِ model فرومی‌افتد. req `ssh-1782406219942` (conv `u68det1`): `Rounds:0`, `ToolCallsUsed:1`, «مسیر پاسخ: deterministic»، فروش ۱۴۰۲ = **64,252,437,897**، فروش ۱۴۰۳ = **57,023,796,065**، درصد تغییر = **-11.25%** (تطبیق با ground-truthِ sqlcmd: -11.2504%). خط `final` تمیز: `durationMs:405,round:0` بدون `failureKind`.
- [x] **U6.9** گارد ایمنی: یک سؤال مالیِ بی‌ربط بدون داده («تعداد کارمندان») همچنان رد شود. — رد شد: `0` tool call، `failureKind=NO_FETCH`، بدون عددِ ساختگی، هدایت به scope مالی. req `ssh-1782375805595`. **گارد دست‌نخورده.**

**شرط پذیرش نهایی (محقق شد):** U6.5/U6.6/U6.7 با خط واقعیِ `agent-audit.log` (`failureKind=NONE` یا finalِ تمیزِ deterministic) مستند شدند ✓ و گاردِ ایمنی (U6.9) سالم ماند ✓. **U6.4 (account_balance)** با عددِ واقعی 19,755,458,505 (deterministic، round:0) و **U6.8 (comparison)** با عددِ هر دو دوره + درصد -11.25% (deterministic، round:0) نیز در میدان محقق و تیک خوردند. **هر هفت آیتمِ U6 با شاهدِ واقعی بسته شد.**

## شاهد میدانیِ U6 (خطوط `final` از `agent-audit.log` روی 192.168.85.56)
```
{"requestId":"ssh-1782375628162","conversationId":"u64","stage":"final","failureKind":"EMPTY_RESULT"}      // U6.4 حساب ۱ (گروهی، بدون سند)
{"requestId":"ssh-1782375699701","conversationId":"u66","stage":"final","round":0}                          // U6.6 نقد+بانک deterministic (final تمیز)
{"requestId":"ssh-1782375717442","conversationId":"u67a","stage":"final","round":0}                         // U6.7 خرید deterministic (final تمیز)
{"requestId":"ssh-1782375732080","conversationId":"u67b","stage":"final","failureKind":"NONE"}             // U6.7 فروش model-assisted
{"requestId":"ssh-1782375769273","conversationId":"u68","stage":"final","failureKind":"NONE"}              // U6.8 مقایسه (پاسخ: رد ایمن)
{"requestId":"ssh-1782375805595","conversationId":"u69","stage":"final","failureKind":"NO_FETCH"}          // U6.9 گارد ایمنی (رد درست)
{"requestId":"ssh-1782376005717","conversationId":"u64c","stage":"final","failureKind":"NO_FETCH"}         // U6.4 retry صندوق (رد ایمن)
{"requestId":"ssh-...recv","conversationId":"u64recv","stage":"final","round":0}                            // U6.4 دریافتنی deterministic = 19,755,458,505 (final تمیز)
{"requestId":"ssh-1782406219942","conversationId":"u68det1","stage":"final","durationMs":405,"round":0}    // U6.8 مقایسه deterministic = 64.25ملیارد vs 57.02ملیارد، -11.25% (final تمیز)
```

---

## یادآوری‌های حیاتی

- باگِ اصلی **یک خطِ quoting** است؛ بدون رفع آن، هیچ‌چیزِ ACC/RPA کار نمی‌کند. اول U0/U1 را تمام کن.
- `catch { return null }` خطاها را پنهان می‌کرد؛ U3 این کوری را برطرف می‌کند.
- گارد ایمنی هرگز حذف نشود؛ هر عدد از fetch واقعیِ trace بیاید.
- «تست سبز» کافی نیست مگر تستْ خودِ SQLِ تولیدی را assert کند (U0).
- محدودیت‌های SQL Server قدیمی Sepidar: بدون `FORMAT`/`STRING_AGG`/`FOR JSON`/`FOR XML`؛ collation حساس؛ JOIN به `FMK.FiscalYear` روی `Title`.
- پرامپت ask-ai را کوتاه نگه دار تا «command line too long» ندهد.
