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

- [ ] **U5.1** بلوک بزرگ `tryResolveDeterministicFinancialTool` و توابع کمکیِ مرتبط را به `agentOrchestrator/deterministicTools.ts` منتقل کن (API عمومی ثابت بماند).
- [ ] **U5.2** typecheck + کل تست‌ها سبز.
- [ ] **U5.3** اگر هنوز فایلی > ~۱۵۰۰ خط بود، یک ماژول دیگر هم جدا کن (مثلاً منطق comparison).
- [ ] **U5.4** تأیید: `get_errors` روی فایل‌های جدید خطای واقعی ندهد.

**شرط پذیرش U5:** رفتار ثابت، تست‌ها سبز، فایل اصلی کوچک‌تر.

---

# فاز U6 — استقرار و راستی‌آزماییِ میدانی (با شاهد اجباری)

گام‌های اتمیک:

- [ ] **U6.1** `npm run build:win` (با تأیید کاربر).
- [ ] **U6.2** `npm run remote:install` سپس `npm run remote:start`.
- [ ] **U6.3** asar-grep برای نشانگرِ helper جدید `quoteSqlTableRef` (باید پیدا شود → اثبات استقرارِ کدِ اصلاح‌شده).
- [ ] **U6.4** ask-ai: «ماندهٔ بدهکار حساب ۱ سال ۱۴۰۲» → خط `final` با `failureKind=NONE` و عدد واقعی. لاگ را ضمیمه کن.
- [ ] **U6.5** ask-ai: «تراز آزمایشی سال ۱۴۰۲» → خط `final` با `failureKind=NONE` و چند ردیف. لاگ را ضمیمه کن.
- [ ] **U6.6** ask-ai: «مانده نقد و بانک» → خط `final` با `failureKind=NONE`؛ عدد مرجع: نقد ~۲٫۱۳ میلیارد، بانک ~۷٫۳۹ میلیارد. لاگ را ضمیمه کن.
- [ ] **U6.7** رگرسیون: «خرید کل سال ۱۴۰۲» (باید همچنان ۲۲۶ میلیارد) و «فروش ۱۴۰۲» (باید ۶۴ میلیارد). لاگ هر دو.
- [ ] **U6.8** «مقایسهٔ فروش ۱۴۰۲ و ۱۴۰۳» → خط `final` با عددِ هر دوره + درصد، `failureKind=NONE`. لاگ را ضمیمه کن.
- [ ] **U6.9** گارد ایمنی: یک سؤال مالیِ بی‌ربط بدون داده («تعداد کارمندان») همچنان رد شود.

**شرط پذیرش نهایی:** هر گام U6.4–U6.8 با خط واقعیِ `agent-audit.log` (requestId + failureKind=NONE) مستند شده باشد. بدون شاهد، تیک ممنوع. اگر حتی یکی هنوز `failureKind != NONE` بود، فاز مربوط را دوباره باز کن.

---

## یادآوری‌های حیاتی

- باگِ اصلی **یک خطِ quoting** است؛ بدون رفع آن، هیچ‌چیزِ ACC/RPA کار نمی‌کند. اول U0/U1 را تمام کن.
- `catch { return null }` خطاها را پنهان می‌کرد؛ U3 این کوری را برطرف می‌کند.
- گارد ایمنی هرگز حذف نشود؛ هر عدد از fetch واقعیِ trace بیاید.
- «تست سبز» کافی نیست مگر تستْ خودِ SQLِ تولیدی را assert کند (U0).
- محدودیت‌های SQL Server قدیمی Sepidar: بدون `FORMAT`/`STRING_AGG`/`FOR JSON`/`FOR XML`؛ collation حساس؛ JOIN به `FMK.FiscalYear` روی `Title`.
- پرامپت ask-ai را کوتاه نگه دار تا «command line too long» ندهد.
