# Hamkaran Schema Research (S12.1)

## Database Engine
- **Sepidar**: SQL Server
- **Hamkaran**: SQL Server (همان engine اما schema متفاوت)

## Schema Comparison Table

| Concept | Sepidar | Hamkaran | Notes |
|---|---|---|---|
| sales_invoice | SLS.Invoice | HAM.SalesInvoice | Hamkaran از نام‌های کوتاه‌تر استفاده می‌کند |
| purchase_invoice | POM.PurchaseInvoice | HAM.PurchaseInvoice | مشابه |
| voucher | ACC.Voucher | HAM.Voucher | نام schema متفاوت |
| voucher_item | ACC.VoucherItem | HAM.VoucherItem | مشابه |
| account | ACC.Account | HAM.Account | مشابه |
| fiscal_year | FMK.FiscalYear | HAM.FiscalYear | Hamkaran schema جدا ندارد، مستقیم در HAM |
| partner | ACC.Partner | HAM.Partner | مشابه |
| cash_balance | RPA.CashBalance | HAM.CashBalance | Hamkaran همه در schema HAM |
| bank_balance | RPA.BankAccountBalance | HAM.BankAccountBalance | مشابه |

## Key Differences

1. **Schema Organization**: Sepidar از چند schema استفاده می‌کند (SLS, POM, ACC, FMK, RPA) در حالی که Hamkaran بیشتر در یک schema (HAM) متمرکز است.

2. **Fiscal Year Representation**: 
   - Sepidar: جدول جداگانه `FMK.FiscalYear` با `FiscalYearId` و `Title='1402'`
   - Hamkaran: احتمالاً ستون مستقیم `FiscalYear` در جداول اصلی یا جدول ساده‌تر

3. **Voucher Type Enum**:
   - Sepidar: `ACC.Voucher.VoucherType` با مقادیر 1=Sales, 2=Purchase, 3=Closing, 4=Opening
   - Hamkaran: احتمالاً enum متفاوت یا نام‌های متفاوت

4. **Account Classification**:
   - Sepidar: از پیشوند کد حساب استفاده می‌کند (1%=asset, 2%=liability, 3%=equity, 4%=revenue, 5%=expense)
   - Hamkaran: ممکن است از فیلد `AccountType` یا `Category` استفاده کند

5. **Column Naming**:
   - Sepidar: `NetPriceInBaseCurrency`, `FiscalYearRef`
   - Hamkaran: احتمالاً `NetAmount`, `FiscalYearId` (نام‌های کوتاه‌تر)

6. **Join Paths**:
   - Sepidar: VoucherItem → Voucher (VoucherRef), Voucher → FiscalYear (FiscalYearRef)
   - Hamkaran: احتمالاً نام‌های FK متفاوت

## Assumptions for Implementation

Since we don't have real Hamkaran database access, we'll make these assumptions for the initial implementation:

1. Hamkaran uses SQL Server (same as Sepidar)
2. Table names follow the pattern `HAM.<TableName>`
3. Fiscal year is represented as a simple table with `FiscalYearId` and `Title`
4. Voucher types are similar but may have different enum values
5. Account classification uses a `Type` field instead of code prefix

These assumptions will be validated when we get real Hamkaran database access.
