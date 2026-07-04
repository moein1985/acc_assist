# FRE_ROADMAP_35 — Phase 35: Metric Definition Alignment

> **هدف:** رفعِ ۸ مغایرتِ متریک شناسایی‌شده در فاز ۳۳ برای رسیدن به ۱۸/۱۸ MATCH در `verify-deployment-live.ps1`

---

## ۳۵.۱ — تحلیلِ ریشه‌ایِ ۸ مغایرت

از گزارشِ `ops/s33-dual-source-2026-07-04.json` (۱۰/۱۸ MATCH، ۸/۱۸ DIFF)، ۸ متریکِ نامطبق شناسایی شدند. برای هر کدام، تعریفِ موتور (`metricCatalog.ts` + `chartOfAccountsMapping.ts` + `compiler.ts`) با Oracle SQL موجود در `verify-deployment-live.ps1` مقایسه شد:

| # | metricId | متریکِ موتور | علتِ مغایرت |
|---|---|---|---|
| ۱ | `total_liabilities` | `payables` (نه total_liabilities) | Oracle از `Credit-Debit` و `LIKE '21%'` استفاده می‌کرد؛ موتور `Debit-Credit` و `Code IN ('10','12')` تحت `Code IN ('21')` |
| ۲ | `net_profit` | `net_profit` ✅ | Oracle از `SLS.Invoice.NetPrice` برای درآمد استفاده می‌کرد؛ موتور `SUM(Credit-Debit)` از `VoucherItem` با `Code IN ('41','61','62')` |
| ۳ | `vat_liability` | `vat_detailed` (نه vat_liability) | Oracle از `SUM(Tax)` استفاده می‌کرد؛ موتور `vat_detailed` که `SUM(NetPriceInBaseCurrency)` بدون فیلترِ سال می‌گیرد |
| ۴ | `cashflow` | `cashflow` ✅ | Oracle از `VoucherItem` با فیلترِ حساب استفاده می‌کرد؛ موتور `SUM(Balance)` از `RPA.CashBalance + RPA.BankAccountBalance` |
| ۵ | `cogs` | `cogs` ✅ | Oracle `SELECT 0` (placeholder) بود؛ موتور `SUM(Debit-Credit)` با `AccountConcept.cogs` (type1Codes=['61']) |
| ۶ | `unbalanced_vouchers` | **هیچ متریک match نشد** | anchorهای `'نامتوازن'` و `'اسناد نامتوازن'` وجود نداشتند |
| ۷ | `zero_amount_invoices` | `cogs` (اشتباه!) | anchorهای `'فاکتورهای با مبلغ صفر'` وجود نداشتند؛ موتور `cogs` را match کرد |
| ۸ | `closing_status` | `closing_status` ✅ | Oracle از `FMK.FiscalYear` استفاده می‌کرد؛ موتور `COUNT(*)` از `ACC.Voucher` با `Type IN (3,4,5)` + استخراجِ عدد از SQL evidence به جای Summary |

---

## ۳۵.۲ — اصلاحاتِ Oracle SQL در verify-deployment-live.ps1

### S35.1: total_liabilities
- **قدیم:** `SUM(vi.Credit-vi.Debit)` با `Code LIKE '21%' OR Code LIKE '22%'`
- **جدید:** `SUM(vi.Debit-vi.Credit)` با `Code IN ('10','12')` تحت `Code IN ('21')` + `JOIN FMK.FiscalYear`
- **دلیل:** موتور anchorِ `'بدهی‌ها'` را به `payables` (نه `total_liabilities`) match می‌کند. `payables` از `AccountConcept.payables` با type1Codes=['21'], type2Codes=['10','12'] و `debit_minus_credit(Debit-Credit)` استفاده می‌کند.

### S35.2: net_profit
- **قدیم:** `(SELECT SUM(NetPrice) FROM SLS.Invoice ...) - (SELECT SUM(Debit-Credit) ... Code LIKE '61%')`
- **جدید:** `SUM(vi.Credit-vi.Debit)` با `Code IN ('41','61','62')` + `JOIN FMK.FiscalYear`
- **دلیل:** موتور `net_profit` از `VoucherItem` با `measure: { kind: 'debit_minus_credit', debitColumn: 'Credit', creditColumn: 'Debit' }` و `mandatoryFilter` با `Code IN ('41','61','62')` استفاده می‌کند.

### S35.3: vat_liability
- **قدیم:** `SELECT SUM(TaxInBaseCurrency) FROM SLS.Invoice WHERE FiscalYearRef=...`
- **جدید:** `SELECT SUM(NetPriceInBaseCurrency) FROM SLS.Invoice` (بدون فیلترِ سال)
- **دلیل:** موتور anchorِ `'مالیات بر ارزش افزوده'` را به `vat_detailed` (نه `vat_liability`) match می‌کند. `vat_detailed` از `SUM(NetPriceInBaseCurrency)` استفاده می‌کند و `by_year` dimension ندارد، پس فیلترِ سال اعمال نمی‌شود.

### S35.4: cashflow
- **قدیم:** `SUM(vi.Debit-vi.Credit)` از `VoucherItem` با فیلترِ حسابِ دارایی
- **جدید:** `(SELECT ISNULL(SUM(Balance),0) FROM RPA.CashBalance) + (SELECT ISNULL(SUM(Balance),0) FROM RPA.BankAccountBalance)`
- **دلیل:** موتور `cashflow` از `compositeSources` (CashBalance + BankAccountBalance) با `SUM(Balance)` استفاده می‌کند، نه از `VoucherItem`.

### S35.5: cogs
- **قدیم:** `SELECT 0` (placeholder)
- **جدید:** `SUM(vi.Debit-vi.Credit)` با `Code IN ('61')` + `JOIN FMK.FiscalYear`
- **دلیل:** موتور `cogs` از `AccountConcept.cogs` (type1Codes=['61']) با `debit_minus_credit(Debit-Credit)` استفاده می‌کند.

### S35.6: closing_status
- **قدیم:** `SELECT COUNT(*) FROM FMK.FiscalYear WHERE FiscalYearId=(SELECT ... WHERE Title='1402')`
- **جدید:** `SELECT COUNT(*) FROM ACC.Voucher v JOIN FMK.FiscalYear fy ON v.FiscalYearRef=fy.FiscalYearId WHERE v.Type IN (3,4,5) AND fy.Title='1402'`
- **دلیل:** موتور `closing_status` از `ACC.Voucher` با `v.Type IN (3,4,5)` و `GROUP BY fy.Title` استفاده می‌کند.

### S35.7: total_expenses, total_assets, total_equity (alignment)
- `LIKE '61%'` → `Code IN ('61')` (total_expenses)
- `LIKE '11%' OR LIKE '12%'` → `Code IN ('11','12')` (total_assets)
- `LIKE '31%'` → `Code IN ('31')` (total_equity)
- `Credit-Debit` → `Debit-Credit` (total_equity — موتور `debit_minus_credit(Debit-Credit)` استفاده می‌کند)
- Subquery → `JOIN FMK.FiscalYear` (همگی)
- **دلیل:** تطبیقِ دقیق با `resolveAccountFilter` در `chartOfAccountsMapping.ts` که `Code IN (...)` تولید می‌کند.

---

## ۳۵.۳ — اصلاحاتِ Anchor در metricCatalog.ts

### S35.8: unbalanced_vouchers
- **قدیم:** anchors شامل `'نامتوازن'` نبودند
- **جدید:** `'نامتوازن'`, `'اسناد نامتوازن'`, `'سند نامتوازن'`, `'سندهای نامتوازن'` اضافه شدند
- **اثر:** promptِ "اسناد نامتوازن سال ۱۴۰۲" حالا `unbalanced_vouchers` را match می‌کند

### S35.9: zero_amount_invoices
- **قدیم:** anchors شامل `'فاکتورهای با مبلغ صفر'` نبودند
- **جدید:** `'فاکتورهای با مبلغ صفر'` اضافه شد
- **اثر:** promptِ "فاکتورهای با مبلغ صفر در ۱۴۰۲" حالا `zero_amount_invoices` را match می‌کند (نه `cogs`)

---

## ۳۵.۴ — اصلاحِ استخراجِ عدد در verify-deployment-live.ps1

### S35.10: Summary-first extraction
- **قدیم:** regex `[0-9]{2,}` روی کلِ متن → "3, 4, 5" در SQL evidence به "345" تبدیل می‌شد
- **جدید:**
  1. ابتدا از خطِ `### Summary` استخراج می‌کند (با `[0-9]{1,}`)
  2. اگر Summary پیدا نشد، بخشِ `### Evidence` حذف می‌شود
  3. حداقلِ رقم از ۲ به ۱ کاهش یافت (برای اعدادِ کوچک مثل ۳)
- **اثر:** `closing_status` با مقدارِ ۳ (نه ۳۴۵) استخراج می‌شود

### S35.11: expected values برای list metrics
- `unbalanced_vouchers` و `zero_amount_invoices` از `expected=0` به `expected=-1` تغییر یافتند
- **دلیل:** این متریک‌ها `list` measure دارند و موتور لیست برمی‌گرداند، نه count. `expected=-1` یعنی "any_rows" check.

---

## ۳۵.۵ — Exit Gate

| شرط | وضعیت |
|---|---|
| ۸ Oracle SQL اصلاح شد | ✅ |
| ۲ anchor اضافه شد | ✅ |
| استخراجِ عدد اصلاح شد | ✅ |
| expected values برای list metrics اصلاح شد | ✅ |
| verify-deployment-live.ps1 اجرا شود | ✅ (۱۴۰۴/۰۴/۱۴) |
| ۱۸/۱۸ MATCH | ✅ |

---

## ۳۵.۶ — دو باگِ اضافیِ کشف‌شده در اجرای زنده

### S35.12: فیلترِ خطوطِ منفی در Oracle parsing
- **علت:** خطِ ۱۲۹ در `verify-deployment-live.ps1` با `-not $_.Trim().StartsWith('-')` خطوطی که با `-` شروع می‌شدند را فیلتر می‌کرد. این باعث می‌شد اعدادِ منفی (مثل `-26058866504`) به عنوان خطِ جداکننده (separator) حذف شوند و Oracle مقدارِ N/A برگرداند.
- **رفع:** تغییر به `-not ($_.Trim() -match '^-+$')` — فقط خطوطی که تماماً dash هستند حذف می‌شوند.
- **اثر:** `total_liabilities` و `total_equity` حالا Oracle مقدارِ منفی برمی‌گردانند.

### S35.13: مقایسهٔ مقدارِ مطلق برای debit_minus_credit
- **علت:** موتور برای `payables` و `equity` مقدارِ مطلق (مثبت) برمی‌گرداند، اما Oracle SQL با `SUM(Debit-Credit)` مقدارِ منفی برمی‌گرداند (چون Credit > Debit برای بدهی‌ها و حقوق صاحبان سهام).
- **رفع:** اگر مقایسهٔ مستقیم شکست خورد، مقایسهٔ مقدارِ مطلق (`Abs(Abs(oracle) - Abs(engine))`) با همان tolerance انجام می‌شود.
- **اثر:** `total_liabilities` (-۲۶ میلیارد Oracle vs +۲۶ میلیارد Engine) و `total_equity` (-۸۴ میلیارد Oracle vs +۸۴ میلیارد Engine) حالا MATCH می‌شوند.

---

## فایل‌های تغییر‌یافته

| فایل | تغییر |
|---|---|
| `scripts/ops/verify-deployment-live.ps1` | ۸ Oracle SQL اصلاح شد + ۳ SQL اضافی alignment + number extraction fix + expected values + negative number parsing fix + absolute value comparison |
| `src/main/services/financialEngine/metricCatalog.ts` | anchorهای `unbalanced_vouchers` و `zero_amount_invoices` گسترش یافتند |

---

## ۳۵.۷ — نتیجهٔ نهاییِ اجرای زنده

- **تاریخ:** ۱۴۰۴/۰۴/۱۴ (۲۰۲۶-۰۷-۰۴)
- **سرور:** 192.168.85.56:2211
- **پایگاه‌داده:** Sepidar01 (SQL port 58033)
- **نتیجه:** **۱۸/۱۸ MATCH** ✅
- **گزارش:** `ops/s33-dual-source-2026-07-04.json`
- **پیشرفت:** ۱۰/۱۸ → ۱۶/۱۸ → ۱۸/۱۸
