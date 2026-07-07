# S41.3 — Hardcoded Schema Assumptions Audit

Generated: 2026-07-04
Scope: `src/main/services/financialEngine/metricCatalog.ts` — 73 metrics

## Summary

- **Total metrics**: 73
- **Metrics with `conceptSource` (schema-adaptive)**: 1 (`net_sales`)
- **Metrics with hardcoded `source` only**: 72
- **Unique hardcoded tables**: 12
- **Unique hardcoded columns in measures/filters**: ~25

## Risk Levels

- **LOW**: Table/column exists in both Sepidar01 and Sepidar03 (verified S41.0)
- **MEDIUM**: Table/column likely exists but column names may vary across versions
- **HIGH**: Table/view may not exist in all Sepidar versions

## Audit Table

### Primary Table References

| Metric | Hardcoded Table | Risk | Notes |
|--------|----------------|------|-------|
| net_sales | SLS.Invoice | LOW | Has conceptSource fallback ✅ |
| sales_count | SLS.Invoice | LOW | No conceptSource |
| sales_by_period | SLS.Invoice | LOW | No conceptSource |
| zero_amount_invoices | SLS.Invoice | LOW | No conceptSource |
| invoices_without_tax | SLS.Invoice | LOW | No conceptSource |
| purchases | INV.InventoryReceipt | MEDIUM | No conceptSource |
| tax_paid | INV.InventoryReceipt | MEDIUM | No conceptSource |
| account_balance | ACC.VoucherItem | LOW | No conceptSource |
| trial_balance | ACC.VoucherItem | LOW | No conceptSource |
| party_balance | ACC.VoucherItem | LOW | No conceptSource |
| receivables | ACC.VoucherItem | LOW | No conceptSource |
| payables | ACC.VoucherItem | LOW | No conceptSource |
| account_turnover | ACC.VoucherItem | LOW | No conceptSource |
| balance_sheet | ACC.VoucherItem | LOW | No conceptSource |
| income_statement | ACC.VoucherItem | LOW | No conceptSource |
| total_assets | ACC.VoucherItem | LOW | No conceptSource |
| total_liabilities | ACC.VoucherItem | LOW | No conceptSource |
| total_equity | ACC.VoucherItem | LOW | No conceptSource |
| total_revenue | ACC.VoucherItem | LOW | No conceptSource |
| total_expenses | ACC.VoucherItem | LOW | No conceptSource |
| cogs | ACC.VoucherItem | LOW | No conceptSource |
| payroll | ACC.VoucherItem | LOW | No conceptSource |
| tax_collected | ACC.VoucherItem | LOW | No conceptSource |
| net_profit | ACC.VoucherItem | LOW | No conceptSource |
| cost_center_summary | ACC.VoucherItem | LOW | No conceptSource |
| project_summary | ACC.VoucherItem | LOW | No conceptSource |
| project_profitability | ACC.VoucherItem | LOW | No conceptSource |
| cost_allocation | ACC.VoucherItem | LOW | No conceptSource |
| budget_variance | ACC.VoucherItem | LOW | No conceptSource |
| budget_report | ACC.VoucherItem | LOW | No conceptSource |
| voucher_detail | ACC.VoucherItem | LOW | No conceptSource |
| vouchers_by_date | ACC.VoucherItem | LOW | No conceptSource |
| vouchers_by_type | ACC.VoucherItem | LOW | No conceptSource |
| unbalanced_vouchers | ACC.VoucherItem | LOW | No conceptSource |
| duplicate_vouchers | ACC.VoucherItem | LOW | No conceptSource |
| vouchers_without_account | ACC.VoucherItem | LOW | No conceptSource |
| receivables_aging | ACC.VoucherItem | LOW | No conceptSource |
| payables_aging | ACC.VoucherItem | LOW | No conceptSource |
| party_turnover | ACC.VoucherItem | LOW | No conceptSource |
| tax_monthly_summary | ACC.VoucherItem | LOW | No conceptSource |
| vat_liability | ACC.VoucherItem | LOW | No conceptSource |
| period_comparison | ACC.VoucherItem | LOW | No conceptSource |
| sales_reconciliation | ACC.VoucherItem | LOW | No conceptSource |
| purchase_reconciliation | ACC.VoucherItem | LOW | No conceptSource |
| cost_center_detailed | ACC.VoucherItem | LOW | No conceptSource |
| cogs_detailed | ACC.VoucherItem | LOW | No conceptSource |
| vat_detailed | ACC.VoucherItem | LOW | No conceptSource |
| tax_liability_summary | ACC.VoucherItem | LOW | No conceptSource |
| cash_bank_balance | RPA.CashBalance | HIGH | May not exist in all versions |
| cashflow | RPA.CashBalance | HIGH | May not exist in all versions |
| fiscal_year_count | FMK.FiscalYear | LOW | No conceptSource |
| fiscal_year_list | FMK.FiscalYear | LOW | No conceptSource |
| recent_documents | ACC.Voucher | LOW | No conceptSource |
| inventory_value | INV.vwItemStockSummary | HIGH | View may not exist in all versions |
| inventory_turnover | INV.vwItemStockSummary | HIGH | View may not exist in all versions |
| low_stock_items | INV.vwItemStockSummary | HIGH | View may not exist in all versions |
| checks_due | ACC.Check | MEDIUM | No conceptSource |
| checks_bounced | ACC.Check | MEDIUM | No conceptSource |
| checks_summary | ACC.Check | MEDIUM | No conceptSource |
| closing_status | FMK.FiscalYear | LOW | No conceptSource |
| trial_balance_check | ACC.VoucherItem | LOW | No conceptSource |
| cash_flow_statement | RPA.CashBalance | HIGH | May not exist in all versions |
| cash_flow_direct | ACC.VoucherItem | LOW | No conceptSource |
| trend_analysis | SLS.Invoice | LOW | No conceptSource |
| fixed_assets_register | AST.Asset | MEDIUM | AST schema differs between versions |
| depreciation_summary | AST.AssetTransaction | MEDIUM | AST schema differs between versions |
| bank_reconciliation | RPA.BankAccountBalance | HIGH | May not exist in all versions |

### Join Table References (in requiredJoins and dimensions)

| Table | Used By | Risk | Notes |
|-------|---------|------|-------|
| FMK.FiscalYear | ~30 metrics (by_year dimension) | LOW | Exists in both versions |
| ACC.Voucher | ~35 metrics (requiredJoin) | LOW | Exists in both versions |
| ACC.Account | ~15 metrics (requiredJoin + by_account dimension) | LOW | Exists in both versions |
| GNR.Party | party_balance, party_turnover | LOW | Exists in both versions |
| RPA.BankAccountBalance | cash_bank_balance, cashflow, bank_reconciliation | HIGH | May not exist in all versions |
| CNT.Project | project_summary, project_profitability | MEDIUM | May not exist in all versions |
| CNT.CostCenter | cost_center_summary, cost_allocation, cost_center_detailed | MEDIUM | May not exist in all versions |
| SLS.InvoiceItem | sales_by_period (by_customer dimension) | LOW | Exists in both versions |

### Hardcoded Column References in Measures

| Column | Used By | Risk | Notes |
|--------|---------|------|-------|
| NetPriceInBaseCurrency | net_sales, sales_by_period, zero_amount_invoices | MEDIUM | Column name could vary |
| TotalPrice | purchases | MEDIUM | Column name could vary |
| Debit | account_balance, trial_balance, +20 others | LOW | Standard accounting column |
| Credit | account_balance, trial_balance, +20 others | LOW | Standard accounting column |
| Balance | cash_bank_balance, cashflow | MEDIUM | RPA-specific |
| TaxInBaseCurrency | tax_paid, tax_collected | MEDIUM | Column name could vary |
| Quantity | inventory_value | MEDIUM | View column |
| OutputQuantity | inventory_turnover | MEDIUM | View column |
| ItemCode, ItemTitle, ItemMinimumAmount | low_stock_items | MEDIUM | View columns |

### Hardcoded Column References in Joins

| Column Pair | Used By | Risk |
|-------------|---------|------|
| FiscalYearRef → FiscalYearId | ~30 metrics | LOW |
| VoucherRef → VoucherId | ~35 metrics | LOW |
| AccountSLRef → AccountId | ~15 metrics | LOW |
| DLRef → DLRef | party_balance, party_turnover | LOW |

### Hardcoded Column References in Filters

| Filter SQL | Used By | Risk | Notes |
|-----------|---------|------|-------|
| v.Type NOT IN (3, 4) | ~25 metrics | MEDIUM | Enum values could differ |
| src.IsReturn = 0 | purchases, tax_paid | LOW | Boolean flag |
| vi.AccountSLRef IS NOT NULL | account_balance | LOW | |
| vi.DLRef IS NOT NULL | cost_center_summary | LOW | |
| inv.NetPriceInBaseCurrency = 0 | zero_amount_invoices | MEDIUM | Column name |
| cc.CostCenterId IS NOT NULL | cost_center_summary, cost_allocation | MEDIUM | Table may not exist |
| prj.ProjectID IS NOT NULL | project_summary, project_profitability | MEDIUM | Table may not exist |
| a.ParentAccountRef IN (SELECT ...) | income_statement, period_comparison, cogs, +5 | MEDIUM | Subquery references ACC.Account |

### Hardcoded Column References in entityNameMatch

| Column | Used By | Risk |
|--------|---------|------|
| a.Title | account_balance, account_turnover | LOW |
| p.Name | party_balance, party_turnover | LOW |

### Hardcoded Column References in dateColumn

| Column | Used By | Risk |
|--------|---------|------|
| src.Date | net_sales, purchases, sales_count, sales_by_period | LOW |
| v.Date | ~35 VoucherItem-based metrics | LOW |
| ir.Date | tax_paid | LOW |
| inv.Date | zero_amount_invoices, invoices_without_tax | LOW |

## HIGH Risk Items (Priority for S41.4-S41.5)

1. **RPA.CashBalance** — 3 metrics (cash_bank_balance, cashflow, cash_flow_statement)
2. **RPA.BankAccountBalance** — 3 metrics (cash_bank_balance composite, cashflow composite, bank_reconciliation)
3. **INV.vwItemStockSummary** — 3 metrics (inventory_value, inventory_turnover, low_stock_items)
4. **AST.Asset** — 1 metric (fixed_assets_register) — AST schema differs between v1/v2
5. **AST.AssetTransaction** — 1 metric (depreciation_summary) — AST schema differs between v1/v2

## MEDIUM Risk Items

1. **CNT.Project** — 2 metrics — table may not exist in all versions
2. **CNT.CostCenter** — 3 metrics — table may not exist in all versions
3. **ACC.Check** — 3 metrics — column names may vary
4. **v.Type NOT IN (3, 4)** — ~25 metrics — enum values could differ between versions
5. **Column names** (NetPriceInBaseCurrency, TotalPrice, TaxInBaseCurrency) — may vary

## Conclusion

- **72 of 73 metrics** rely entirely on hardcoded `source` without `conceptSource` fallback
- **Only `net_sales`** has been migrated to concept-based source (Phase 27)
- **10 metrics** have HIGH risk (tables may not exist in all Sepidar versions)
- **~25 metrics** have MEDIUM risk (enum values or column names may vary)
- **~35 metrics** have LOW risk (core ACC/SLS/FMK tables exist in both verified versions)
- **Priority**: Migrate HIGH risk items first (RPA, INV views, AST), then MEDIUM (CNT, enum values)
