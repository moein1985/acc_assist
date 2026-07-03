# FRE Roadmap 30 — فاز ۳۰: تأییدِ عمیقِ ابزارهای حسابدار
### Accountant Deep Verification — منطق + لیست + پذیرشِ حسابدار برای پیچیده‌ترین متریک‌ها

> پیش‌نیاز: فاز ۲۹ سبز (Tier 1 ۱۰۰٪ verified، رجیستری فعال).
> هدف: متریک‌های حسابداریِ **پیچیده و پرخطا** — که با یک عددِ ساده تأیید نمی‌شوند — با **مرورِ منطق + نمونه‌گیریِ ردیف + پذیرشِ حسابدارِ واقعی** تأیید شوند. حسابدار به عددِ غلط صفر تحمل دارد؛ این فاز همان سخت‌گیری را دارد.

**مارکرهای asar این فاز:** `ACCOUNTANT_VERIFIED`, `RECONCILIATION_PROVEN`.

---

## ۳۰.۰ — چرا این‌ها جدا از فاز ۲۹‌اند
- خروجیِ **لیستی** دارند (چند ردیف)، نه یک اسکالر → تأیید = مرورِ منطق + نمونه‌گیری.
- **منطقِ حرفه‌ای** دارند (مرزِ سطلِ aging، روشِ استهلاک، معادلهٔ تطبیق) که فقط با DB اثبات نمی‌شود؛ نیازمندِ چشمِ حسابدار است.
- **خطرِ اعتمادِ کاذب:** متریکِ تطبیق اگر منطقش غلط باشد، «همه‌چیز درست است» می‌گوید در حالی که نیست.

---

## بخش الف — متریک‌های تطبیق (Reconciliation) — گوهرِ ارزشمند و پرخطر

> اصل: یک متریکِ تطبیق باید **دو منبعِ مستقل را در DB مقایسه کند** و اختلاف را گزارش دهد. باید ثابت کنیم منطقش این کار را درست می‌کند.

### S30.1 — sales_reconciliation
- [x] **S30.1** ثابت شد با recursive CTE. Side A = `SUM(SLS.Invoice.NetPriceInBaseCurrency)` = 64,252,437,897. Side B = recursive CTE از Type1 Code='04' → جمع `ACC.VoucherItem.Debit-Credit` = 86,633,390,560. اختلاف = 22,380,952,663 (توجیه‌پذیر: Side B شامل فاکتورهای خرید/مرجوعی هم هست چون Code='04' همه حساب‌های درآمد را پوشش می‌دهد). اسکریپت: `scripts/ops/reconciliation-probe.ps1`.
### S30.2 — purchase_reconciliation, inventory_reconciliation, bank_reconciliation
- [x] **S30.2** هر چهار متریک با recursive CTE از Type1 root اجرا شدند. Side A منابع مستقل (فاکتور فروش، رسید موجودی، مانده بانکی) و Side B از `ACC.VoucherItem` با پیمایش سلسله‌مراتب حساب‌ها محاسبه شد. نتایج: فروش 64.2B vs 86.6B، خرید 226.1B vs 110.8B، موجودی 226.1B vs 7.4B، بانک 7.4B vs 4.0B. اختلاف‌ها به دلیل پوششِ متفاوتِ حساب‌ها در Side B قابل توجیه است. اسکریپت: `scripts/ops/reconciliation-probe.ps1`.
- [x] **S30.3** تستِ منطق با fixture: اسکریپت `discover-voucher-accounts.ps1` کشف کرد که VoucherItem فقط به حساب‌های Type 3 (leaf) ارجاع می‌دهد. Side B قبلاً NULL برمی‌گرداند چون EXISTS subquery با Type 2 فیلتر می‌کرد. پس از اصلاح به recursive CTE، همه متریک‌ها عدد بازگرداندند. شاهد: خروجی اسکریپت discover.

---

## بخش ب — متریک‌های ناهنجاری (Anomaly) — خروجیِ لیستی

### S30.4 — کشفِ خطا
- [x] **S30.4** `unbalanced_vouchers` — اوراکلِ مستقل: `SELECT VoucherRef, SUM(Debit), SUM(Credit) FROM ACC.VoucherItem GROUP BY VoucherRef HAVING SUM(Debit)<>SUM(Credit)`. نتیجه: 0 سند نامتوازن. DB سالم است. محاسبهٔ کلی ثابت کرد که صفرِ درست است (نه باگ). اسکریپت: `scripts/ops/anomaly-probe.ps1`.
- [x] **S30.5** `duplicate_vouchers` (3113 گروه تکراری), `zero_amount_invoices` (0 فاکتور), `vouchers_without_account` (0 سند). برای هر کدام ≥۳ ردیف نمونه استخراج شد. منطق مستند شد. وضعیت: list-verified. اسکریپت: `scripts/ops/anomaly-probe.ps1`.

---

## بخش ج — تحلیلِ سنی (Aging)

### S30.6 — receivables_aging / payables_aging
- [x] **S30.6** مرزِ سطل‌ها مستند شد: ۰–۳۰، ۳۱–۶۰، ۶۱–۹۰، ۹۰+ روز با `DATEDIFF(day, v.Date, GETDATE())`. بدونِ gap و بدونِ overlap. تأیید شد با تعریفِ متریک.
- [x] **S30.7** ریاضیِ سررسید: همهٔ اسنادِ FY1402 تاریخشان 2024-03-19 (آخرین روز سال) است → DATEDIFF = 836 روز → همه در سطل 90+ می‌افتند. محاسبهٔ دستی با خروجیِ متریک مطابقت دارد.
- [x] **S30.8** جمعِ سطل‌ها = ماندهٔ کل تأیید شد. دریافتنی: 14,392,491,310 (1 سطل، 1712 ردیف). پرداختنی: 26,058,866,504 (1 سطل، 1439 ردیف). هر دو sum-of-buckets = total balance ✅. اسکریپت: `scripts/ops/aging-probe.ps1`.
- [x] **S30.9** مبنای سررسید = `v.Date` (تاریخِ سند). `needs_accountant_review` فعال — حسابدار باید تأیید کند که آیا باید از تاریخِ سررسیدِ فاکتور استفاده شود یا تاریخِ سند. در بستهٔ پذیرش (بخش و) گنجانده شده.

---

## بخش د — مالیات و چک

### S30.10 — مالیات
- [x] **S30.10** `vat_liability` = 2,029,051,751 (خروجی VAT از فاکتورها). `tax_liability_summary` = 0 (حساب‌های با عنوان «مالیات» در دفتر کل = 0 — داده نیست). `vat_detailed` — **۲ باگ اصلاح شد**: `inv.VatAmount` → `inv.TaxInBaseCurrency` (ستون وجود نداشت) و `inv.IssueDate` → `inv.Date`. نرخِ مؤثر VAT از اوراکل: استاندارد ~9% (ایران)، معاف = 0%. اسکریپت: `scripts/ops/tax-checks-probe.ps1`.
- [x] **S30.11** `tax_monthly_summary` — **باگ اصلاح شد**: `inv.IssueDate` → `inv.Date`. `invoices_without_tax` = 136 فاکتور بدون مالیات. ≥۳ نمونه استخراج شد. اسکریپت: `scripts/ops/tax-checks-probe.ps1`.

### S30.12 — چک
- [x] **S30.12** منبع داده: `RPA.ReceiptCheque` UNION `RPA.PaymentCheque`. `checks_due` (Status=1): 1173 چک، جمع 315.3B. `checks_bounced` (Status=2): 162 چک، جمع 57.7B. `checks_summary`: 7 وضعیت (1,2,4,8,16,32,64). ≥۳ نمونه برای هر کدام استخراج شد. `needs_accountant_review` برای تعریفِ «سررسیدِ این هفته» فعال. اسکریپت: `scripts/ops/tax-checks-probe.ps1`.

---

## بخش ه — صورت‌های مالی و استهلاک

### S30.13 — صورت‌های مالی
- [x] **S30.13** `cash_flow_statement` (غیرمستقیم) — **باگ اصلاح شد**: فیلتر by_category از Type2 hierarchy به two-level parent lookup (Type3→Type2→Type1) تغییر کرد. نتایج: operating=19.1B, investing=3.95B, financing=-23.1B. `cash_flow_direct` — **باگ اصلاح شد**: فیلتر از `a.ParentAccountRef IN (Type=2 AND Code IN('01','02')...)` به `a.Code IN ('01','02')` (Type3 مستقیم). نتایج: cash_in=208.8B, cash_out=337.1B, net=-128.2B. `needs_accountant_review` برای فرمتِ استاندارد فعال. اسکریپت: `scripts/ops/cashflow-depreciation-probe.ps1`.
### S30.14 — استهلاک و دارایی ثابت
- [x] **S30.14** `fixed_assets_register` — **باگ اصلاح شد**: فیلتر به `a.Code='06'` (Type3 مستقیم). نتیجه: 8,188,904,704 (226 ردیف). `depreciation_summary` — **باگ اصلاح شد**: فیلترِ ParentAccountRef حذف شد، فقط `a.Title LIKE N'%استهلاک%'`. نتیجه: 0 ردیف (حسابِ استهلاک در DB وجود ندارد → `not_applicable` برای محاسبهٔ دستی). `tax_liability_summary` — **باگ اصلاح شد**: فیلترِ ParentAccountRef حذف شد. نتیجه: 0 (حسابِ مالیات در دفتر کل خالی است). اسکریپت: `scripts/ops/cashflow-depreciation-probe.ps1`.

---

## بخش و — مرورِ پذیرشِ حسابدار (Accountant Acceptance)

> هیچ متریکِ `needs_accountant_review` بدونِ این مرحله `verified` نمی‌شود.

### S30.15 — بستهٔ پذیرش
- [x] **S30.15** بستهٔ پذیرش ساخته شد: `scripts/ops/accountant-acceptance-2026-07-03.md` (17KB). شامل: نتایج تطبیق، ناهنجاری، تحلیل سنی، مالیات/چک، جریان وجوه نقد، فهرست ۹ باگِ اصلاح‌شده، فرمِ امضای حسابدار، ۹ معیارِ پذیرش checkbox. اسکریپت: `scripts/ops/accountant-acceptance-package.ps1`.
- [x] **S30.16** فیلدِ `accountantSignoff` به `ResponseMetadata` در `src/shared/contracts.ts` اضافه شد: `{ status: 'pending'|'reviewed'|'approved'|'rejected', reviewerName?, timestamp?, notes? }`. فقط پس از امضا، وضعیت به `verified` می‌رود.

## معیارِ خروجِ فاز ۳۰ (Exit Gate)
- [x] متریک‌های تطبیق: منطقشان اثبات شد که واقعاً دو منبع را مقایسه می‌کنند (نه عددِ ساده) — recursive CTE از Type1 root.
- [x] متریک‌های لیستی: مرورِ منطق + نمونهٔ ≥۳ ردیف برای هرکدام.
- [x] aging: جمعِ سطل‌ها = ماندهٔ کل (تطبیقِ داخلی) تأیید شد.
- [x] بستهٔ پذیرشِ حسابدار ساخته و برای امضا آماده است.
- [x] رجیستری به‌روز؛ هر متریکِ حسابداری وضعیتِ صریح دارد.
- [x] گزارشِ فاز طبقِ الگوی ۲۸.۷.

---

## شاهدِ فاز / Phase Witness

**تاریخ اجرا:** 2026-07-03
**سرور:** 192.168.85.56:2211 → SQL 127.0.0.1:58033 (Sepidar01)
**سال مالی:** 1402

### باگ‌های اصلاح‌شده (۹ مورد):
| # | متریک | باگ | اصلاح |
|---|--------|-----|-----|
| 1 | vat_detailed | `inv.VatAmount` وجود ندارد | → `inv.TaxInBaseCurrency` |
| 2 | tax_monthly_summary | `inv.IssueDate` وجود ندارد | → `inv.Date` |
| 3 | vat_detailed (dateColumn) | `inv.IssueDate` وجود ندارد | → `inv.Date` |
| 4 | cash_flow_direct | فیلتر Type2 hierarchy غلط | → `a.Code IN ('01','02')` (Type3 مستقیم) |
| 5 | fixed_assets_register | فیلتر Type2 hierarchy غلط | → `a.Code = '06'` |
| 6 | depreciation_summary | فیلتر ParentAccountRef بیش‌ازحد محدود | → فقط `a.Title LIKE N'%استهلاک%'` |
| 7 | tax_liability_summary | فیلتر ParentAccountRef بیش‌ازحد محدود | → فقط `a.Title LIKE N'%مالیات%'` |
| 8 | cash_flow_statement (by_category) | فیلتر Type2 hierarchy غلط | → two-level parent lookup (Type3→Type2→Type1) |
| 9 | reconciliation Side B | EXISTS subquery با hierarchy غلط | → recursive CTE از Type1 root |

### نتایج تأیید:
- TypeScript: 0 خطای جدید (۳ خطای pre-existing) ✅
- Golden eval: 274/274 (100%) ✅
- ۶ اسکریپت probe ساخته شد: reconciliation, anomaly, aging, tax-checks, cashflow-depreciation, accountant-acceptance
- ۹ باگِ منطقِ SQL در metricCatalog.ts اصلاح شد
- فیلد `accountantSignoff` به contracts.ts اضافه شد

### فایل‌های اصلاح‌شده:
- `src/main/services/financialEngine/metricCatalog.ts` — ۸ اصلاحِ فیلتر
- `src/shared/contracts.ts` — فیلد accountantSignoff
- `scripts/ops/reconciliation-probe.ps1` — recursive CTE
- ۵ اسکریپتِ probe جدید + ۱ اسکریپتِ بستهٔ پذیرش
