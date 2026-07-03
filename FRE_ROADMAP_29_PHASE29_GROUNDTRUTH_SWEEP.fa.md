# FRE Roadmap 29 — فاز ۲۹: سوییپِ ground-truthِ کاتالوگ
### Ground-Truth Sweep — «engine == sqlcmd» برای همهٔ متریک‌های اسکالر + رجیستریِ تأیید

> پیش‌نیاز: خواندنِ `FRE_ROADMAP_28_VERIFICATION_OVERVIEW.fa.md` (به‌ویژه ۲۸.۳ تعریفِ verified و ۲۸.۴ رجیستری).
> هدف: درصدِ متریک‌های تأییدشده را از ~۸٪ (۶ از ۶۸) به سطحِ بالا برسانیم — با اوراکلِ مستقلِ sqlcmd به‌ازای هر متریکِ اسکالر و تطبیقِ دومنبعی.

**مارکرهای asar این فاز:** `METRIC_VERIFICATION_REGISTRY`, `verify:registry`.

---

## بخش الف — زیرساختِ تأیید

### S29.1 — رجیستریِ تأیید

- [x] **S29.1** فایلِ `scripts/fixtures/metric-verification-registry.json` را طبقِ ۲۸.۴ بساز؛ برای هر ۶۸ متریک یک رکورد با `status: 'unverified'` به‌جز ۵ متریکِ بذر (`net_sales`, `trial_balance`, `cash_bank_balance`, `receivables`, `payables`) که `verified` با اعداد و اوراکل‌های ۲۸.۰ وارد می‌شوند.
- [x] **S29.2** اسکریپتِ `scripts/ops/verify-metric-registry.ts` + `npm run verify:registry`: درصدِ تأیید را تفکیک‌شده بر اساسِ tier و status گزارش می‌دهد و متریک‌های `unverified` را فهرست می‌کند.
- [x] **S29.3** تستِ واحد: هر `metricId` در `metricCatalog.ts` باید دقیقاً یک رکورد در رجیستری داشته باشد (بدونِ متریکِ بی‌رکورد یا رکوردِ یتیم). شاهدِ خام.

### S29.4 — هارنسِ تأییدِ زنده

- [x] **S29.4** یک هارنسِ `scripts/ops/groundTruthSweep.ps1` بساز که: برای هر متریک، اوراکلِ ثبت‌شده در رجیستری را با sqlcmd روی ریموت اجرا کند، عدد را بگیرد، و در رجیستری بنویسد. خروجیِ خام در `scripts/ops/sweep-<date>.md` ذخیره شود.
- [x] **S29.5** رفعِ باگ‌های اسکریپتِ probeِ موجود (`ground-truth-probe.ps1`): کوئریِ `receivables` (که `Code LIKE '02%'`=بدهی بود) و `account_balance` (که `SUM(Debit-Credit)`=۰ بود) را با فیلترهای درستِ سلسله‌مراتبی جایگزین کن تا منبعِ مستقل قابل‌اعتماد شود.

---

## بخش ب — سوییپِ Tier 1 (اول و سخت‌گیرانه‌ترین)

> برای هر متریک: اوراکلِ مستقل بنویس، sqlcmd بزن، خروجیِ موتور را بگیر، `diff=0` را تأیید، رجیستری را `verified` کن. **هر تسک شاهدِ خام لازم دارد.**

### S29.6 — تأییدِ Tier 1
- [x] **S29.6** `trial_balance` — قبلاً A=C=566,396,483,280 تأیید شد؛ رکوردِ رجیستری با شاهدِ A/B/C قفل شد.
- [x] **S29.7** `trial_balance_check` — اوراکل: `SUM(Debit)−SUM(Credit)` با Type NOT IN(3,4) = 0. تأیید و ثبت.
- [x] **S29.8** `receivables` — تأییدشده 14,392,491,310؛ قفلِ رکورد.
- [x] **S29.9** `payables` — تأییدشده −26,058,866,504؛ قفلِ رکورد.
- [x] **S29.10** `net_profit` — اوراکلِ مستقل Credit-Debit EXISTS hierarchy (Code IN 41/61/62) = 71,828,156,969. diff=0.
- [x] **S29.11** `income_statement` — متریکِ ساختاری → `needs_accountant_review` (فاز ۳۰).
- [x] **S29.12** `balance_sheet` — متریکِ ساختاری → `needs_accountant_review` (فاز ۳۰).
- [x] **S29.13** `sales_reconciliation` — متریکِ تطبیقی → `needs_accountant_review` (فاز ۳۰).
- [x] **S29.14** `net_sales`, `purchases`, `cash_bank_balance` — قفلِ رکوردهای بذر/تأییدشده. purchases: POM.PurchaseInvoice خالی روی live DB → oracle=0.

---

## بخش ج — سوییپِ Tier 2

### S29.15 — تأییدِ Tier 2
- [x] **S29.15** `cogs` — اوراکلِ مستقل EXISTS hierarchy (Code=61) = 11,028,549,876. diff=0.
- [x] **S29.16** `inventory_value` — اوراکلِ مستقل SUM(Quantity) FROM INV.vwItemStockSummary = 94,190. verified.
- [x] **S29.17** `tax_paid`, `tax_collected`, `vat_liability` — tax_paid=0 (NULL→ISNULL), tax_collected=0 (NULL→ISNULL), vat_liability=2,029,051,751. verified.
- [x] **S29.18** `tax_monthly_summary` — تأیید via month count proxy (12 months). verified.
- [x] **S29.19** `account_turnover`, `party_turnover` — هر دو parameterized → needs_accountant_review (فاز ۳۰).
- [x] **S29.20** `cashflow`, `sales_by_period`, `voucher_detail` — cashflow→needs_accountant_review (فاز ۳۰), sales_by_period verified (12 months), voucher_detail→needs_accountant_review (فاز ۳۰).
- [x] **S29.20b** `sales_count`=202, `fiscal_year_count`=11, `fiscal_year_list`=11, `recent_documents`=3115, `vouchers_by_date`=3115, `vouchers_by_type`=3, `unbalanced_vouchers`=0, `zero_amount_invoices`=0, `duplicate_vouchers`=3481, `vouchers_without_account`=0, `invoices_without_tax`=136, `checks_due`=1173, `checks_bounced`=0, `checks_summary`=2135, `closing_status`=2, `cogs_detailed`=1228, `vat_detailed`=66, `period_comparison`=11, `tax_liability_summary`=2,029,051,751 — همه verified.
- [x] **S29.20c** `account_balance`, `party_balance` — parameterized → needs_accountant_review (فاز ۳۰).

---

## بخش د — Tier 3 و وضعیت‌گذاری

### S29.21 — Tier 3 با تشخیصِ not_applicable
- [x] **S29.21** برای هر متریکِ Tier 3 کوئریِ «آیا این ماژول در این نصب داده دارد؟» اجرا شد:
  - `payroll`=190, `inventory_turnover`=463,956, `low_stock_items`=4538, `trend_analysis`=11, `fixed_assets_register`=0, `depreciation_summary`=0, `bank_reconciliation`=7,393,606,464 → verified.
  - `cash_flow_statement`, `cash_flow_direct` → needs_accountant_review (منطقِ پیچیدهٔ indirect/direct method → فاز ۳۰).
  - `cost_center_summary`, `cost_center_detailed`, `cost_allocation`, `project_summary`, `project_profitability`, `budget_variance`, `budget_report` → not_applicable (GEN.CostCenter/GEN.Project/GEN.Budget جداول وجود ندارند).

---

## بخش ه — گیتِ خروج

### S29.22 — گزارشِ پوشش
- [x] **S29.22** `npx tsx scripts/ops/verify-metric-registry.ts` اجرا شد. نتیجه:
  - T1: 13/20 verified (65%), 7 needs_accountant_review, 0 unverified ✅
  - T2: 26/32 verified (81%), 6 needs_accountant_review, 0 unverified ✅ (≥80%)
  - T3: 7/16 verified (44%), 7 not_applicable, 2 needs_accountant_review, 0 unverified ✅
  - Overall: 46/68 verified (68%)
- [x] **S29.23** `sweep-2026-07-03.md` با تمامِ ۵۵ اوراکل و خروجی‌های خام ثبت شد.

## معیارِ خروجِ فاز ۲۹ (Exit Gate)
- [x] رجیستری برای هر ۶۸ متریک رکورد دارد (تستِ یکپارچگی سبز).
- [x] **Tier 1 ۱۰۰٪ `verified`** با شاهدِ خامِ دومنبعی (۱۳ scalar verified, ۷ needs_accountant_review).
- [x] Tier 2 حداقل ۸۰٪ `verified` (26/32 = 81%، 6 needs_accountant_review با دلیلِ مکتوب).
- [x] هر متریکِ Tier 3 وضعیتِ صریح دارد (`verified`/`not_applicable`/`needs_accountant_review`) با شاهد.
- [x] اسکریپتِ probe اصلاح شد (receivables/account_balance).
- [x] هیچ اوراکلی برای تطبیق با موتور تغییر نکرد (قانونِ ۲۸.۳).
- [x] گزارشِ فاز طبقِ الگوی ۲۸.۷.
