# Sepidar Schema Research — Phase 13 (Advanced Management Metrics)

## SLS.InvoiceItem (46 columns)
Key columns for COGS:
- `InvoiceItemID` (PK)
- `InvoiceRef` (FK to SLS.Invoice)
- `ItemRef` (FK to INV.Item)
- `Quantity` (decimal) — quantity sold
- `Price` / `PriceInBaseCurrency` — unit price
- `NetPrice` / `NetPriceInBaseCurrency` — net price after discount
- `Tax` / `TaxInBaseCurrency` — tax amount
- `Discount` / `DiscountInBaseCurrency`
- `CostCenterRef` / `CostCenterCode` / `CostCenterTitle` — cost center tracking
- `ProductPackRef` — product pack reference

## SLS.Invoice
Key columns:
- `InvoiceId` (PK)
- `InvoiceDate`
- `FiscalYearRef`
- `PartnerRef`
- `NetPriceInBaseCurrency` — total net amount
- `TaxInBaseCurrency` — total tax
- `VoucherType` — voucher type

## INV.InventoryReceipt (33 columns)
- `InventoryReceiptID` (PK)
- `Type` (int) — receipt type (purchase, transfer, etc.)
- `IsReturn` (bit) — is return
- `StockRef` — warehouse
- `Date` — receipt date
- `FiscalYearRef`
- `TotalPrice`, `TotalNetPrice`, `TotalReturnedPrice`
- `TotalOtherCost`
- `AccountingVoucherRef` — link to ACC.Voucher

## INV.InventoryReceiptItem (42 columns)
- `InventoryReceiptItemID` (PK)
- `InventoryReceiptRef` (FK)
- `ItemRef` — item reference
- `Quantity` — quantity received
- `RemainingQuantity` — remaining in stock
- `Price` — purchase price
- `Fee` — actual cost
- `NetPrice`, `ReturnedNetPrice`
- `OtherCostsAmount`, `AllotmenedOtherCostInBaseCurrency`

## INV.vwItemStockSummary (22 columns)
- `ItemRef`, `ItemCode`, `ItemTitle`
- `StockRef`, `StockTitle`
- `Quantity` — current stock quantity
- `InputQuantity`, `OutputQuantity`
- `ItemMinimumAmount`, `ItemMaximumAmount` — min/max stock levels
- `SaleQuantity` — saleable quantity
- `FiscalYearRef`
- `UnitRef`, `UnitTitle`

## INV.Stock
- Physical stock table (warehouse definitions)

## INV.Item
- Item/product master data

## PAY (Payroll) tables
- `vwPayrollConfiguration` — payroll settings (insurance, tax, accounts)
- `vwSettlement` — payroll settlements
- `vwSettlementItem` — settlement line items
- `vwPersonnel` — personnel master data
- `vwMonthlyDataPersonnelElement` — monthly salary data

## Cost Centers
- Cost center fields exist in `SLS.InvoiceItem`: `CostCenterRef`, `CostCenterCode`, `CostCenterTitle`
- Also in `ACC.VoucherItem` (need to verify)

## COGS Calculation Strategy
Sepidar does NOT have a direct COGS table. Options:
1. **Simple approach**: Use `INV.InventoryReceiptItem` where `Type=purchase` to get total purchases cost, then subtract inventory change
2. **FIFO/Weighted Average**: Use `INV.vwItemStockSummary` for current stock value + `INV.InventoryReceiptItem` for purchase prices
3. **Account-based**: Use `ACC.VoucherItem` with account filter for "cost of goods sold" accounts (code prefix 5x)

**Recommended**: Account-based approach (code prefix 5) for COGS, consistent with existing expense metrics.

## Tax Columns
- `SLS.InvoiceItem.Tax` / `TaxInBaseCurrency` — sales tax per line
- `POM.PurchaseInvoiceItem` likely has similar tax fields
- Can also use account-based: filter ACC.VoucherItem for tax accounts
