# S41.11 — چک‌لیستِ افزودنِ نسخهٔ جدیدِ سپیدار

> برای افزودنِ پشتیبانی از یک دیتابیسِ جدیدِ سپیدار، این مراحل را به‌ترتیب اجرا کن.

## ۱. اتصال
- [ ] دسترسیِ SQL به دیتابیسِ جدید را تأیید کن (server, port, user, password)
- [ ] با `sqlcmd` یک کوئریِ ساده اجرا کن: `SELECT @@VERSION; SELECT COUNT(*) FROM FMK.FiscalYear;`
- [ ] تعدادِ جدول و schema را بشمار: `SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES;`

## ۲. تشخیصِ نسخه
- [ ] اپ را با دیتابیسِ جدید استارت کن
- [ ] audit log را بررسی کن: stage `calibration-mapping` باید `versionId` و `confidence` را نشان دهد
- [ ] اگر `versionId` جدید است، `versionDetect.ts` را به‌روز کن

## ۳. کشف/کالیبراسیون
- [ ] `chartOfAccountsMapping` را اجرا کن — مطمئن شو account code prefixes درست تشخیص داده می‌شوند
- [ ] اگر schema متفاوت است، `SepidarAdapter` را بررسی کن — مفاهیمِ نگاشت‌نشده باید refusal بدهند نه error

## ۴. تأییدِ Tier 1 با sqlcmd
- [ ] ۸ متریکِ Tier 1 را با Oracle SQL مستقل راستی‌آزمایی کن:
  - `party_count`: `SELECT COUNT(*) FROM GNR.Party`
  - `voucher_count`: `SELECT COUNT(*) FROM ACC.Voucher WHERE Type NOT IN (3,4)` (با فیلترِ سال)
  - `fiscal_year_count`: `SELECT COUNT(*) FROM FMK.FiscalYear`
  - `sales_count`: `SELECT COUNT(*) FROM SLS.Invoice` (با فیلترِ سال)
  - `net_sales`: `SELECT SUM(NetPriceInBaseCurrency) FROM SLS.Invoice` (با فیلترِ سال)
  - `purchases`: `SELECT SUM(TotalPrice) FROM INV.InventoryReceipt WHERE IsReturn=0`
  - `tax_collected`: `SELECT SUM(TaxInBaseCurrency) FROM SLS.Invoice` (با فیلترِ سال)
  - `cashflow`: `SELECT ISNULL(SUM(Balance),0) FROM RPA.CashBalance + RPA.BankAccountBalance`
- [ ] همین ۸ متریک را با `remote:ask-ai` اجرا کن و مقادیر را مقایسه کن

## ۵. رگرسیون
- [ ] `npm run test:regression` را اجرا کن — باید ۹۷/۹۷ سبز باشد
- [ ] `npm run eval:metrics` را اجرا کن — باید ۲۷۴/۲۷۴ سبز باشد

## ۶. قفلِ رجیستری
- [ ] نسخهٔ جدید را در `ops/s41-supported-versions.md` اضافه کن
- [ ] در OVERVIEW فاز ۴۱ را به‌روز کن
- [ ] audit log را آرشیو کن: `ops/s41-tier1-{version}.csv`
