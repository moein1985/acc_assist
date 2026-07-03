/**
 * Metric catalog registry for the Financial Reasoning Engine (FRE).
 *
 * Phase 1: no-op stub. Phase 2 will populate this with declarative
 * MetricDefinition entries for each migrated metric.
 *
 * @see FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md
 */

import type { MetricDefinition, MetricId } from './types'
import { AccountingConcept } from './schemaAdapter'
import { AccountConcept } from './chartOfAccountsMapping'

const catalog: MetricDefinition[] = [
  {
    id: 'net_sales',
    titleFa: 'فروش خالص',
    anchors: ['فروش', 'مبلغ فروش', 'درآمد فروش', 'فروختیم', 'فروخت', 'sales', 'revenue', 'total sales', 'net sales'],
    excludeSignals: ['خرید', 'هزینه', 'تعداد', 'چند', 'به تفکیک', 'بهای تمام', 'فروش‌رفته', 'فروش رفته', 'مالیات', 'تطبیق', 'تحلیل', 'نرخ رشد', 'CAGR', 'VAT', 'ارزش افزوده', 'purchase', 'expense', 'cost', 'گردش', 'مانده', 'تراز'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_month', 'by_quarter'],
    source: { primaryTable: 'SLS.Invoice', alias: 'src' },
    conceptSource: {
      concept: AccountingConcept.sales_invoice,
      alias: 'src',
      requiredJoins: [
        {
          concept: AccountingConcept.fiscal_year,
          alias: 'fy',
          on: { sourceColumn: 'fiscal_year_id', targetColumn: 'primary_key' }
        }
      ]
    },
    measure: { kind: 'sum', column: 'NetPriceInBaseCurrency' },
    conceptMeasure: { kind: 'sum', field: 'net_amount' },
    conceptDateColumn: { sourceAlias: 'src', field: 'date' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_month',
        labelColumn: 'MONTH(src.Date)',
        labelType: 'int'
      },
      {
        dimension: 'by_quarter',
        labelColumn: 'DATEPART(QUARTER, src.Date)',
        labelType: 'int'
      }
    ],
    conceptDimensions: [
      {
        dimension: 'by_year',
        conceptJoin: {
          concept: AccountingConcept.fiscal_year,
          alias: 'fy',
          on: { sourceColumn: 'fiscal_year_id', targetColumn: 'primary_key' }
        },
        conceptLabelField: 'title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_month',
        expression: 'MONTH(src.{dateColumn})',
        labelType: 'int'
      },
      {
        dimension: 'by_quarter',
        expression: 'DATEPART(QUARTER, src.{dateColumn})',
        labelType: 'int'
      }
    ],
    mandatoryFilters: [],
    dateColumn: 'src.Date'
  },
  {
    id: 'purchases',
    titleFa: 'خرید',
    anchors: ['خرید', 'مبلغ خرید', 'خرید کالا', 'purchases', 'buy', 'procurement'],
    excludeSignals: ['فروش', 'درآمد', 'تطبیق', 'اختلاف', 'sales', 'revenue'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'POM.PurchaseInvoice',
      alias: 'src',
      fallbackTables: [
        {
          table: 'INV.InventoryReceipt',
          alias: 'src',
          measure: { kind: 'sum', column: 'TotalPrice' },
          filters: [{ sql: 'src.IsReturn = 0', description: 'حذف مرجوعی' }]
        }
      ]
    },
    measure: { kind: 'sum', column: 'NetPriceInBaseCurrency' },
    mandatoryFilters: [],
    dimensions: [],
    dateColumn: 'src.Date'
  },
  {
    id: 'account_balance',
    titleFa: 'مانده حساب',
    anchors: ['مانده حساب', 'مانده سرفصل', 'بدهکار بستانکار حساب', 'account balance', 'balance', 'ledger balance'],
    excludeSignals: ['تراز', 'حساب‌ها', 'بانک', 'صندوق', 'کش', 'نقد', 'balance sheet'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_account'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_account',
        join: {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        labelColumn: 'a.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: 'vi.AccountSLRef IS NOT NULL', description: 'فقط آیتم‌های دارای حساب تفصیلی' }
    ],
    entityNameMatch: { column: 'a.Title', foldPersian: true },
    dateColumn: 'v.Date'
  },
  {
    id: 'trial_balance',
    titleFa: 'تراز آزمایشی',
    anchors: ['تراز آزمایشی', 'بدهکار بستانکار حساب‌ها', 'تراز', 'trial balance', 'ledger summary', 'balance sheet'],
    excludeSignals: ['ترازنامه', 'تراز نشده', 'تراز ندارن', 'تراز ندارند', 'ترازنشده', 'تراز نیستند', 'تراز نشده\u200cاند', 'ناتراز', 'می\u200cبندد', 'اختلاف تراز', 'بررسی تراز', 'گردش حساب'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_account'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'sum', column: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_account',
        join: {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        labelColumn: 'a.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }],
    dateColumn: 'v.Date'
  },
  {
    id: 'cash_bank_balance',
    titleFa: 'مانده نقد و بانک',
    anchors: ['مانده نقد', 'مانده بانک', 'مانده صندوق', 'مانده کش', 'مانده حساب بانکی', 'cash balance', 'bank balance', 'cash and bank'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'RPA.CashBalance',
      alias: 'cb',
      compositeSources: [
        {
          table: 'RPA.BankAccountBalance',
          alias: 'bb',
          measure: { kind: 'sum', column: 'Balance' }
        }
      ]
    },
    measure: { kind: 'sum', column: 'Balance' },
    dimensions: [],
    mandatoryFilters: []
  },
  {
    id: 'sales_count',
    titleFa: 'تعداد فاکتور فروش',
    anchors: ['تعداد فاکتور فروش', 'تعداد فاکتور', 'چند فاکتور فروش', 'چند فاکتور', 'چند تا فاکتور'],
    excludeSignals: ['خرید', 'مانده', 'تراز', 'صندوق', 'بانک'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'SLS.Invoice',
      alias: 'src'
    },
    measure: { kind: 'count' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    dateColumn: 'src.Date'
  },
  {
    id: 'fiscal_year_count',
    titleFa: 'تعداد سال‌های مالی',
    anchors: ['تعداد سال مالی', 'چند سال مالی', 'تعداد سال‌های مالی'],
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز', 'صندوق', 'بانک', 'فاکتور', 'گردش', 'حساب آقا', 'حساب خانم', 'حساب شخص', 'حساب شرکت'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'FMK.FiscalYear', alias: 'fy' },
    measure: { kind: 'count' },
    dimensions: [],
    mandatoryFilters: []
  },
  {
    id: 'fiscal_year_list',
    titleFa: 'فهرست سال‌های مالی',
    anchors: ['فهرست سال مالی', 'سال‌های مالی', 'لیست سال‌های مالی', 'چه سال‌هایی', 'سال مالی'],
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز', 'صندوق', 'بانک', 'فاکتور', 'تعداد', 'بستن', 'اختتامیه', 'افتتاحیه', 'گردش', 'حساب آقا', 'حساب خانم', 'حساب شخص', 'حساب شرکت'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'FMK.FiscalYear', alias: 'fy' },
    measure: { kind: 'list', columns: ['FiscalYearId', 'Title'] },
    dimensions: [],
    mandatoryFilters: [],
    orderBy: { column: 'fy.Title', direction: 'DESC' }
  },
  {
    id: 'party_balance',
    titleFa: 'مانده طرف حساب',
    anchors: ['مانده طرف حساب', 'مانده شخص', 'مانده مشتری', 'مانده فروشنده', 'مانده تأمین‌کننده'],
    excludeSignals: ['تراز', 'بانک', 'صندوق', 'نقد', 'حساب‌ها'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'GNR.Party',
          alias: 'p',
          on: { sourceColumn: 'DLRef', targetColumn: 'DLRef' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }],
    entityNameMatch: { column: 'p.Name', foldPersian: true },
    dateColumn: 'v.Date'
  },
  {
    id: 'receivables',
    titleFa: 'دریافتنی‌ها',
    anchors: ['دریافتنی', 'مانده دریافتنی', 'حساب‌های دریافتنی', 'طرف حساب دریافتنی'],
    excludeSignals: ['پرداختنی', 'فروش', 'خرید', 'تراز', 'بانک', 'صندوق', 'گردش', 'معوق', 'سررسید', 'تحلیل سنی'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.receivables,
    dateColumn: 'v.Date'
  },
  {
    id: 'payables',
    titleFa: 'پرداختنی‌ها',
    anchors: ['پرداختنی', 'مانده پرداختنی', 'حساب‌های پرداختنی', 'طرف حساب پرداختنی', 'بدهی', 'بدهی‌ها'],
    excludeSignals: ['دریافتنی', 'فروش', 'خرید', 'تراز', 'بانک', 'صندوق', 'گردش', 'کل', 'مجموع', 'معوق', 'سررسید', 'تحلیل سنی', 'VAT', 'ارزش افزوده', 'مالیاتی'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.payables,
    dateColumn: 'v.Date'
  },
  {
    id: 'cashflow',
    titleFa: 'جریان نقد',
    anchors: ['جریان نقد', 'جریان وجه نقد', 'نقد و بانک', 'جریان نقدی'],
    excludeSignals: ['فروش', 'خرید', 'تراز', 'دریافتنی', 'پرداختنی', 'مستقیم', 'وجوه نقد', 'صورت', 'نقدینگی'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'RPA.CashBalance',
      alias: 'cb',
      compositeSources: [
        {
          table: 'RPA.BankAccountBalance',
          alias: 'bb',
          measure: { kind: 'sum', column: 'Balance' }
        }
      ]
    },
    measure: { kind: 'sum', column: 'Balance' },
    dimensions: [],
    mandatoryFilters: []
  },
  {
    id: 'sales_by_period',
    titleFa: 'فروش به تفکیک دوره',
    anchors: ['فروش ماهانه', 'فروش فصلی', 'فروش به تفکیک ماه', 'فروش به تفکیک فصل', 'فروش به تفکیک سال', 'خلاصه فروش', 'فروش دوره', 'فروش به تفکیک مشتری', 'فروش مشتریان'],
    excludeSignals: ['خرید', 'مانده', 'تراز', 'تعداد', 'صندوق', 'بانک'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_month', 'by_quarter', 'by_customer'],
    source: { primaryTable: 'SLS.Invoice', alias: 'src' },
    measure: { kind: 'sum', column: 'NetPriceInBaseCurrency' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_month',
        labelColumn: 'MONTH(src.Date)',
        labelType: 'int'
      },
      {
        dimension: 'by_quarter',
        labelColumn: 'DATEPART(QUARTER, src.Date)',
        labelType: 'int'
      },
      {
        dimension: 'by_customer',
        join: {
          table: 'GNR.Party',
          alias: 'cust',
          on: { sourceColumn: 'CustomerPartyRef', targetColumn: 'PartyId' }
        },
        labelColumn: 'cust.Name',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    dateColumn: 'src.Date'
  },
  {
    id: 'account_turnover',
    titleFa: 'گردش حساب',
    anchors: ['گردش حساب', 'گردش سرفصل', 'بدهکار و بستانکار حساب', 'گردش معین', 'گردش تفصیلی'],
    excludeSignals: ['مانده', 'تراز', 'فروش', 'خرید', 'صندوق'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_account', 'by_voucher'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'sum', column: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_account',
        labelColumn: 'a.Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_voucher',
        labelColumn: 'v.Number',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }],
    entityNameMatch: { column: 'a.Title', foldPersian: true },
    dateColumn: 'v.Date'
  },
  {
    id: 'recent_documents',
    titleFa: 'اسناد اخیر',
    anchors: ['اسناد اخیر', 'آخرین اسناد', 'سندهای اخیر', 'سندهای اخیراً ثبت شده', 'آخرین سند ها', 'آخرین سند', 'سند اخیر', 'اسناد ثبت شده', 'سند ثبت شده'],
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز', 'گردش', 'تعداد'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'ACC.Voucher', alias: 'v' },
    measure: {
      kind: 'list',
      columns: ['VoucherId', 'Number', 'Date', 'Description']
    },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    orderBy: { column: 'v.Date', direction: 'DESC' },
    dateColumn: 'v.Date'
  },
  {
    id: 'balance_sheet',
    titleFa: 'ترازنامه',
    anchors: ['ترازنامه', 'ترازنامه شرکت', 'دارایی و بدهی', 'وضعیت مالی', 'صورت وضعیت مالی'],
    excludeSignals: ['آزمایشی', 'حساب‌ها', 'گردش حساب'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_account'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_account',
        join: {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        labelColumn: 'a.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.balance_sheet_accounts,
    dateColumn: 'v.Date'
  },
  {
    id: 'income_statement',
    titleFa: 'صورت سود و زیان',
    anchors: ['صورت سود و زیان', 'سود و زیان', 'صورت سود', 'درآمد و هزینه', 'صورت درآمد'],
    excludeSignals: ['ترازنامه', 'آزمایشی', 'سود خالص', 'سود نهایی'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_account'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_account',
        join: {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        labelColumn: 'a.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.revenue_and_expenses,
    dateColumn: 'v.Date'
  },
  {
    id: 'total_assets',
    titleFa: 'کل دارایی‌ها',
    anchors: ['کل دارایی', 'مجموع دارایی', 'دارایی کل', 'دارایی‌ها'],
    excludeSignals: ['بدهی', 'حقوق', 'درآمد', 'هزینه', 'ترازنامه', 'آزمایشی', 'ثابت'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.assets,
    dateColumn: 'v.Date'
  },
  {
    id: 'total_liabilities',
    titleFa: 'کل بدهی‌ها',
    anchors: ['کل بدهی‌ها', 'مجموع بدهی‌ها', 'کل بدهی', 'مجموع بدهی'],
    excludeSignals: ['دارایی', 'حقوق', 'درآمد', 'هزینه', 'ترازنامه', 'آزمایشی', 'پرداختنی', 'طرف حساب'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.liabilities,
    dateColumn: 'v.Date'
  },
  {
    id: 'total_equity',
    titleFa: 'حقوق صاحبان سهام',
    anchors: ['حقوق صاحبان سهام', 'حقوق سهامداران', 'سرمایه', 'حقوق صاحبان'],
    excludeSignals: ['دارایی', 'بدهی', 'درآمد', 'هزینه', 'ترازنامه', 'آزمایشی'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.equity,
    dateColumn: 'v.Date'
  },
  {
    id: 'total_revenue',
    titleFa: 'کل درآمد‌ها',
    anchors: ['کل درآمد', 'مجموع درآمد', 'درآمد کل', 'درآمدی', 'total revenue', 'total income'],
    excludeSignals: ['هزینه', 'دارایی', 'بدهی', 'حقوق', 'ترازنامه', 'فروش خالص', 'گردش', 'مانده', 'تراز'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.revenue,
    dateColumn: 'v.Date'
  },
  {
    id: 'total_expenses',
    titleFa: 'کل هزینه‌ها',
    anchors: ['کل هزینه', 'مجموع هزینه', 'هزینه کل', 'هزینه‌ها کل', 'total expenses', 'total costs', 'expenses'],
    excludeSignals: ['درآمد', 'دارایی', 'بدهی', 'حقوق', 'ترازنامه', 'خرید', 'گردش', 'مانده', 'تراز'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.expenses,
    dateColumn: 'v.Date'
  },
  {
    id: 'cogs',
    titleFa: 'بهای تمام‌شده کالای فروش‌رفته',
    anchors: ['بهای تمام شده', 'COGS', 'هزینه فروش', 'بهای کالای فروش‌رفته'],
    excludeSignals: ['فروش خالص', 'درآمد', 'خرید', 'تفصیلی'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.cogs,
    dateColumn: 'v.Date'
  },
  {
    id: 'payroll',
    titleFa: 'حقوق و دستمزد پرداختی',
    anchors: ['حقوق', 'دستمزد', 'حقوق پرداختی', 'حقوق و دستمزد', 'تنخواه حقوق'],
    excludeSignals: ['فروش', 'خرید', 'مالیات'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.payroll,
    dateColumn: 'v.Date'
  },
  {
    id: 'tax_paid',
    titleFa: 'مالیات پرداختی',
    anchors: ['مالیات پرداختی', 'مالات پرداختی', 'VAT پرداختی'],
    excludeSignals: ['مالیات دریافتی', 'فروش', 'خرید'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.tax_paid,
    dateColumn: 'v.Date'
  },
  {
    id: 'tax_collected',
    titleFa: 'مالیات دریافتی',
    anchors: ['مالیات دریافتی', 'مالات دریافتی', 'VAT دریافتی', 'مالیات فروش'],
    excludeSignals: ['مالیات پرداختی', 'فروش خالص', 'خرید'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Credit', creditColumn: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.tax_collected,
    dateColumn: 'v.Date'
  },
  {
    id: 'net_profit',
    titleFa: 'سود خالص',
    anchors: ['سود خالص', 'سود نهایی', 'profit', 'سود پس از کسر هزینه‌ها'],
    excludeSignals: ['حاشیه سود', 'نسبت سود', 'حاشیه'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Credit', creditColumn: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code IN ('41','61','62')))", description: 'درآمد و هزینه‌ها' }
    ],
    dateColumn: 'v.Date'
  },
  {
    id: 'inventory_value',
    titleFa: 'ارزش موجودی کالا',
    anchors: ['موجودی کالا', 'ارزش موجودی', 'موجودی انبار', 'ارزش انبار'],
    excludeSignals: ['فروش', 'خرید', 'مانده حساب', 'تطبیق', 'اختلاف'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_item', 'by_warehouse'],
    source: {
      primaryTable: 'INV.vwItemStockSummary',
      alias: 'ss'
    },
    measure: { kind: 'sum', column: 'Quantity' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_item',
        labelColumn: 'ItemTitle',
        labelType: 'nstring'
      },
      {
        dimension: 'by_warehouse',
        labelColumn: 'StockTitle',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: []
  },
  {
    id: 'inventory_turnover',
    titleFa: 'گردش کالا',
    anchors: ['گردش کالا', 'ورود خروج کالا', 'گردش انبار', 'تحریک کالا'],
    excludeSignals: ['موجودی کالا', 'ارزش موجودی', 'فروش'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_item', 'by_warehouse'],
    source: {
      primaryTable: 'INV.vwItemStockSummary',
      alias: 'ss'
    },
    measure: { kind: 'sum', column: 'OutputQuantity' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_item',
        labelColumn: 'ItemTitle',
        labelType: 'nstring'
      },
      {
        dimension: 'by_warehouse',
        labelColumn: 'StockTitle',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: []
  },
  {
    id: 'low_stock_items',
    titleFa: 'کالاهای کم‌موجود',
    anchors: ['کم موجود', 'کم‌موجود', 'کالای کم', 'نقص موجودی', 'زیر حداقل'],
    excludeSignals: ['موجودی کالا', 'ارزش موجودی', 'فروش'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'INV.vwItemStockSummary',
      alias: 'ss'
    },
    measure: { kind: 'list', columns: ['ItemCode', 'ItemTitle', 'Quantity', 'ItemMinimumAmount'] },
    dimensions: [],
    mandatoryFilters: [
      { sql: 'ss.ItemMinimumAmount > 0 AND ss.Quantity < ss.ItemMinimumAmount', description: 'موجودی زیر حداقل' }
    ]
  },
  {
    id: 'cost_center_summary',
    titleFa: 'خلاصه مرکز هزینه',
    anchors: ['مرکز هزینه', 'هزینه به تفکیک مرکز', 'گزارش مرکز هزینه'],
    excludeSignals: ['فروش', 'خرید', 'تراز'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_cost_center'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        {
          table: 'ACC.DL',
          alias: 'dl',
          on: { sourceColumn: 'DLRef', targetColumn: 'DLId' }
        },
        {
          table: 'GNR.CostCenter',
          alias: 'cc',
          on: { sourceColumn: 'DLId', targetColumn: 'DLRef' },
          sourceAlias: 'dl'
        }
      ]
    },
    measure: { kind: 'sum', column: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_cost_center',
        labelColumn: 'dl.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '61'))", description: 'فقط حساب‌های هزینه' },
      { sql: 'vi.DLRef IS NOT NULL', description: 'فقط آیتم‌های دارای تفصیلی' },
      { sql: 'cc.CostCenterId IS NOT NULL', description: 'فقط آیتم‌های مرتبط با مرکز هزینه' }
    ],
    dateColumn: 'v.Date'
  },
  {
    id: 'project_summary',
    titleFa: 'خلاصه پروژه',
    anchors: ['پروژه', 'هزینه پروژه', 'درآمد پروژه', 'گزارش پروژه'],
    excludeSignals: ['فروش', 'خرید', 'تراز', 'مرکز هزینه', 'سود پروژه', 'سودآوری', 'زیان پروژه', 'سود و زیان پروژه'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        {
          table: 'ACC.DL',
          alias: 'dl',
          on: { sourceColumn: 'DLRef', targetColumn: 'DLId' }
        },
        {
          table: 'CNT.Project',
          alias: 'prj',
          on: { sourceColumn: 'Code', targetColumn: 'Code' },
          sourceAlias: 'dl'
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: 'prj.ProjectID IS NOT NULL', description: 'فقط آیتم‌های مرتبط با پروژه' }
    ],
    dateColumn: 'v.Date'
  },
  {
    id: 'project_profitability',
    titleFa: 'سودآوری پروژه',
    anchors: ['سود پروژه', 'سودآوری پروژه', 'زیان پروژه', 'سود و زیان پروژه'],
    excludeSignals: ['فروش', 'خرید', 'تراز', 'مرکز هزینه', 'حاشیه'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        {
          table: 'ACC.DL',
          alias: 'dl',
          on: { sourceColumn: 'DLRef', targetColumn: 'DLId' }
        },
        {
          table: 'CNT.Project',
          alias: 'prj',
          on: { sourceColumn: 'Code', targetColumn: 'Code' },
          sourceAlias: 'dl'
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Credit', creditColumn: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code IN ('41','61','62')))", description: 'درآمد و هزینه‌ها' },
      { sql: 'prj.ProjectID IS NOT NULL', description: 'فقط آیتم‌های مرتبط با پروژه' }
    ],
    dateColumn: 'v.Date'
  },
  {
    id: 'cost_allocation',
    titleFa: 'تخصیص هزینه',
    anchors: ['تخصیص هزینه', 'هزینه تخصیصی', 'پراکندگی هزینه', 'سهم هزینه'],
    excludeSignals: ['فروش', 'خرید', 'تراز', 'پروژه'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_cost_center'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        {
          table: 'ACC.DL',
          alias: 'dl',
          on: { sourceColumn: 'DLRef', targetColumn: 'DLId' }
        },
        {
          table: 'GNR.CostCenter',
          alias: 'cc',
          on: { sourceColumn: 'DLId', targetColumn: 'DLRef' },
          sourceAlias: 'dl'
        }
      ]
    },
    measure: { kind: 'sum', column: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_cost_center',
        labelColumn: 'dl.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: 'cc.CostCenterId IS NOT NULL', description: 'فقط آیتم‌های مرتبط با مرکز هزینه' }
    ],
    accountConceptFilter: AccountConcept.expenses,
    dateColumn: 'v.Date'
  },
  {
    id: 'budget_variance',
    titleFa: 'انحراف بودجه',
    anchors: ['انحراف بودجه', 'بودجه vs واقعی', 'مقایسه بودجه', 'بودجه و واقعی'],
    excludeSignals: ['فروش', 'خرید', 'تراز', 'پروژه', 'مرکز هزینه'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'sum', column: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.expenses,
    dateColumn: 'v.Date'
  },
  {
    id: 'budget_report',
    titleFa: 'گزارش بودجه',
    anchors: ['گزارش بودجه', 'بودجه تفصیلی', 'بودجه سالانه', 'پلان بودجه'],
    excludeSignals: ['فروش', 'خرید', 'تراز', 'پروژه', 'مرکز هزینه', 'انحراف', 'هزینه'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'sum', column: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.revenue_and_expenses,
    dateColumn: 'v.Date'
  },
  {
    id: 'voucher_detail',
    titleFa: 'جزئیات سند',
    anchors: ['سند شماره', 'جزئیات سند', 'ردیف‌های سند', 'سند فلان', 'سند چند', 'سند چند است', 'محتوای سند', 'اقلام سند'],
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز', 'گردش', 'فاکتور', 'اسناد اخیر', 'آخرین سند'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: {
      kind: 'list',
      columns: ['v.VoucherId', 'v.Number', 'v.Date', 'v.Description', 'vi.Description', 'a.Code', 'a.Title', 'vi.Debit', 'vi.Credit']
    },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    orderBy: { column: 'vi.RowNumber', direction: 'ASC' },
    dateColumn: 'v.Date'
  },
  {
    id: 'vouchers_by_date',
    titleFa: 'اسناد در محدوده تاریخ',
    anchors: ['اسناد امروز', 'اسناد دیروز', 'اسناد این هفته', 'سندهای ثبت شده', 'چه سندهایی', 'اسناد این ماه', 'سندهای امروز', 'سندهای دیروز', 'سندهای ثبت شده', 'اسناد از', 'اسناد در محدوده'],
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز', 'فاکتور', 'جزئیات سند', 'سند شماره'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'ACC.Voucher', alias: 'v' },
    measure: {
      kind: 'list',
      columns: ['VoucherId', 'Number', 'Date', 'Type', 'Description']
    },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    orderBy: { column: 'v.Date', direction: 'DESC' },
    dateColumn: 'v.Date'
  },
  {
    id: 'vouchers_by_type',
    titleFa: 'اسناد بر اساس نوع',
    anchors: ['سندهای اختتامیه', 'سند اختتام', 'سندهای افتتاحیه', 'سندهای عملیاتی', 'اسناد بستن حساب', 'سندهای بستن', 'اختتامیه', 'افتتاحیه', 'سند بستن حساب'],
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز', 'فاکتور', 'جزئیات سند', 'اسناد اخیر'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: { primaryTable: 'ACC.Voucher', alias: 'v' },
    measure: {
      kind: 'list',
      columns: ['VoucherId', 'Number', 'Date', 'Type', 'Description']
    },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    orderBy: { column: 'v.Date', direction: 'DESC' },
    dateColumn: 'v.Date'
  },
  {
    id: 'unbalanced_vouchers',
    titleFa: 'سندهای ترازنشده',
    anchors: ['سند ترازنشده', 'سندهای تراز ندارند', 'اختلاف سند', 'سند با اختلاف', 'کدام سندها تراز نیستند', 'سندهای ناتراز', 'تراز نشده', 'تراز ندارن', 'ترازنشده', 'تراز ندارند'],
    excludeSignals: ['فروش', 'خرید', 'مانده', 'ترازنامه', 'فاکتور', 'اسناد اخیر', 'تراز آزمایشی'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        }
      ]
    },
    measure: {
      kind: 'list',
      columns: ['v.VoucherId', 'v.Number', 'v.Date', 'v.Description', 'SUM(vi.Debit)', 'SUM(vi.Credit)', 'SUM(vi.Debit) - SUM(vi.Credit)']
    },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    groupByColumns: ['v.VoucherId', 'v.Number', 'v.Date', 'v.Description'],
    havingClause: 'SUM(vi.Debit) <> SUM(vi.Credit)',
    orderBy: { column: 'v.Date', direction: 'DESC' },
    dateColumn: 'v.Date'
  },
  {
    id: 'zero_amount_invoices',
    titleFa: 'فاکتورهای مبلغ صفر',
    anchors: ['فاکتور صفر', 'فاکتور مبلغ صفر', 'فاکتور با مبلغ نامعتبر', 'فاکتورهای صفر', 'فاکتور صفر ریال', 'فاکتورهای مبلغ صفر', 'فاکتورها مبلغ صفر', 'فاکتور صفر کدام'],
    excludeSignals: ['سند', 'مانده', 'تراز', 'اسناد اخیر'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'SLS.Invoice', alias: 'inv' },
    measure: {
      kind: 'list',
      columns: ['InvoiceId', 'Number', 'Date', 'NetPriceInBaseCurrency', 'CustomerRealName']
    },
    dimensions: [],
    mandatoryFilters: [
      { sql: 'inv.NetPriceInBaseCurrency = 0', description: 'فاکتور با مبلغ صفر' }
    ],
    orderBy: { column: 'inv.Date', direction: 'DESC' },
    dateColumn: 'inv.Date'
  },
  {
    id: 'duplicate_vouchers',
    titleFa: 'سندهای تکراری',
    anchors: ['سند تکراری', 'سندهای تکراری', 'ثبت تکراری', 'سندهای مشابه', 'کدام سندها تکراری\u200cاند', 'سند مشابه'],
    excludeSignals: ['فروش', 'خرید', 'مانده', 'ترازنامه', 'فاکتور', 'اسناد اخیر'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        }
      ]
    },
    measure: {
      kind: 'list',
      columns: ['v.Date', 'v.Description', 'COUNT(*)', 'SUM(vi.Debit)']
    },
    dimensions: [],
    mandatoryFilters: [
      { sql: 'v.Type IN (1, 2)', description: 'فقط سندهای عملیاتی و خرید' }
    ],
    groupByColumns: ['v.Date', 'v.Description'],
    havingClause: 'COUNT(*) > 1',
    orderBy: { column: 'v.Date', direction: 'DESC' },
    dateColumn: 'v.Date'
  },
  {
    id: 'vouchers_without_account',
    titleFa: 'ردیف\u200cهای بدون حساب',
    anchors: ['ردیف بدون حساب', 'سند بدون حساب', 'حساب خالی', 'ردیف\u200cهای بدون سرفصل', 'سند بدون سرفصل', 'ردیف\u200cهای بدون حساب', 'حساب خالی دارند', 'بدون حساب'],
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز', 'فاکتور', 'اسناد اخیر'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        }
      ]
    },
    measure: {
      kind: 'list',
      columns: ['vi.VoucherItemId', 'v.Number', 'v.Date', 'vi.Description', 'vi.Debit', 'vi.Credit']
    },
    dimensions: [],
    mandatoryFilters: [
      { sql: 'vi.AccountSLRef IS NULL OR vi.AccountSLRef = 0', description: 'ردیف بدون حساب' }
    ],
    orderBy: { column: 'v.Date', direction: 'DESC' },
    dateColumn: 'v.Date'
  },
  {
    id: 'receivables_aging',
    titleFa: 'تحلیل سنی دریافتنی\u200cها',
    anchors: ['دریافتنی سررسیدشده', 'تحلیل سنی دریافتنی', 'دریافتنی\u200cهای معوق', 'دریافتنی\u200cهای overdue', 'چقدر دریافتنی سررسید گذشته', 'دریافتنی معوق', 'سنی دریافتنی'],
    excludeSignals: ['پرداختنی', 'فروش', 'خرید', 'تراز', 'فاکتور', 'اسناد اخیر'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_age_bucket'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: {
      kind: 'debit_minus_credit',
      debitColumn: 'Debit',
      creditColumn: 'Credit'
    },
    dimensions: [
      {
        dimension: 'by_age_bucket',
        labelColumn: 'period',
        labelType: 'nstring',
        expression: "CASE WHEN DATEDIFF(day, v.Date, GETDATE()) BETWEEN 0 AND 30 THEN '0-30' WHEN DATEDIFF(day, v.Date, GETDATE()) BETWEEN 31 AND 60 THEN '31-60' WHEN DATEDIFF(day, v.Date, GETDATE()) BETWEEN 61 AND 90 THEN '61-90' ELSE '90+' END"
      },
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    accountConceptFilter: AccountConcept.receivables,
    orderBy: { column: 'period', direction: 'ASC' },
    dateColumn: 'v.Date'
  },
  {
    id: 'payables_aging',
    titleFa: 'تحلیل سنی پرداختنی\u200cها',
    anchors: ['پرداختنی سررسیدشده', 'تحلیل سنی پرداختنی', 'پرداختنی\u200cهای معوق', 'چقدر پرداختنی سررسید گذشته', 'پرداختنی معوق', 'سنی پرداختنی'],
    excludeSignals: ['دریافتنی', 'فروش', 'خرید', 'تراز', 'فاکتور', 'اسناد اخیر'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_age_bucket'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: {
      kind: 'debit_minus_credit',
      debitColumn: 'Debit',
      creditColumn: 'Credit'
    },
    dimensions: [
      {
        dimension: 'by_age_bucket',
        labelColumn: 'period',
        labelType: 'nstring',
        expression: "CASE WHEN DATEDIFF(day, v.Date, GETDATE()) BETWEEN 0 AND 30 THEN '0-30' WHEN DATEDIFF(day, v.Date, GETDATE()) BETWEEN 31 AND 60 THEN '31-60' WHEN DATEDIFF(day, v.Date, GETDATE()) BETWEEN 61 AND 90 THEN '61-90' ELSE '90+' END"
      },
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    accountConceptFilter: AccountConcept.payables,
    orderBy: { column: 'period', direction: 'ASC' },
    dateColumn: 'v.Date'
  },
  {
    id: 'party_turnover',
    titleFa: 'گردش طرف حساب',
    anchors: ['گردش مشتری', 'تراکنش\u200cهای مشتری', 'گردش طرف حساب', 'گردش تأمین\u200cکننده', 'تراکنش\u200cهای شخص', 'گردش شخص', 'تراکنش\u200cهای طرف حساب', 'گردش حساب آقای', 'گردش حساب خانم', 'گردش حساب شخص'],
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز', 'فاکتور', 'اسناد اخیر', 'صندوق', 'بانک'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_voucher'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'GNR.Party',
          alias: 'p',
          on: { sourceColumn: 'DLRef', targetColumn: 'DLRef' }
        }
      ]
    },
    measure: {
      kind: 'list',
      columns: ['v.Number', 'v.Date', 'v.Description', 'vi.Description', 'vi.Debit', 'vi.Credit']
    },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_voucher',
        labelColumn: 'v.Number',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }],
    entityNameMatch: { column: 'p.Name', foldPersian: true },
    orderBy: { column: 'v.Date', direction: 'ASC' },
    dateColumn: 'v.Date'
  },
  {
    id: 'tax_monthly_summary',
    titleFa: 'خلاصه مالیات ماهانه',
    anchors: ['مالیات ماهانه', 'مالیات این ماه', 'VAT ماه', 'مالیات فروش ماه', 'خالص مالیات', 'خلاصه مالیات'],
    excludeSignals: ['فاکتور', 'بدون مالیات', 'بدهی', 'ارزش افزوده', 'VAT چقدر', 'پرداختنی'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_month'],
    source: {
      primaryTable: 'SLS.Invoice',
      alias: 'inv',
      requiredJoins: [
        {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        }
      ]
    },
    measure: { kind: 'sum', column: 'TaxInBaseCurrency' },
    dimensions: [
      {
        dimension: 'by_month',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        },
        labelColumn: 'fy.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    dateColumn: 'inv.Date'
  },
  {
    id: 'invoices_without_tax',
    titleFa: 'فاکتورهای بدون مالیات',
    anchors: ['فاکتور بدون مالیات', 'فاکتور بدون VAT', 'کدام فاکتورها مالیات ندارند', 'فاکتورهای معاف'],
    excludeSignals: ['ماهانه', 'بدهی', 'خالص'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'SLS.Invoice',
      alias: 'inv'
    },
    measure: {
      kind: 'list',
      columns: ['inv.InvoiceId', 'inv.Number', 'inv.Date', 'inv.CustomerRealName', 'inv.NetPriceInBaseCurrency', 'inv.TaxInBaseCurrency']
    },
    dimensions: [],
    mandatoryFilters: [{ sql: 'inv.TaxInBaseCurrency = 0 OR inv.TaxInBaseCurrency IS NULL', description: 'فاکتور با مالیات صفر یا نامعتبر' }],
    dateColumn: 'inv.Date'
  },
  {
    id: 'vat_liability',
    titleFa: 'بدهی مالیات ارزش افزوده',
    anchors: ['بدهی VAT', 'مالیات پرداختنی', 'خالص مالیات ارزش افزوده', 'چقدر مالیات باید بدهیم'],
    excludeSignals: ['ماهانه', 'فاکتور بدون', 'معاف'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'SLS.Invoice',
      alias: 'inv'
    },
    measure: { kind: 'sum', column: 'TaxInBaseCurrency' },
    dimensions: [],
    mandatoryFilters: [],
    dateColumn: 'inv.Date'
  },
  {
    id: 'checks_due',
    titleFa: 'چک\u200cهای سررسید',
    anchors: ['چک سررسید', 'چک\u200cهای این هفته', 'چک\u200cهای دریافتی سررسید', 'چک\u200cهای پرداختی سررسید', 'چک\u200cهای در جریان'],
    excludeSignals: ['برگشتی', 'مجموع'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: '(SELECT ReceiptChequeId AS CheckId, Number AS CheckNumber, Date AS DueDate, Amount, CAST(1 AS NVARCHAR(10)) AS Direction, State AS Status, DlRef FROM RPA.ReceiptCheque UNION ALL SELECT PaymentChequeId, Number, Date, Amount, CAST(2 AS NVARCHAR(10)), State, DlRef FROM RPA.PaymentCheque)',
      alias: 'chk'
    },
    measure: {
      kind: 'list',
      columns: ['chk.CheckId', 'chk.CheckNumber', 'chk.DueDate', 'chk.Amount', 'chk.Direction', 'chk.Status']
    },
    dimensions: [],
    mandatoryFilters: [{ sql: 'chk.Status = 1', description: 'فقط چک\u200cهای در جریان' }],
    dateColumn: 'chk.DueDate'
  },
  {
    id: 'checks_bounced',
    titleFa: 'چک\u200cهای برگشتی',
    anchors: ['چک برگشتی', 'چک\u200cهای برگشتی', 'چک\u200cهای برگشت خورده', 'چک ناموفق'],
    excludeSignals: ['سررسید', 'مجموع', 'در جریان'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: '(SELECT ReceiptChequeId AS CheckId, Number AS CheckNumber, Date AS DueDate, Amount, CAST(1 AS NVARCHAR(10)) AS Direction, State AS Status, DlRef FROM RPA.ReceiptCheque UNION ALL SELECT PaymentChequeId, Number, Date, Amount, CAST(2 AS NVARCHAR(10)), State, DlRef FROM RPA.PaymentCheque)',
      alias: 'chk'
    },
    measure: {
      kind: 'list',
      columns: ['chk.CheckId', 'chk.CheckNumber', 'chk.DueDate', 'chk.Amount', 'chk.Direction', 'chk.Status']
    },
    dimensions: [],
    mandatoryFilters: [{ sql: 'chk.Status = 2', description: 'فقط چک\u200cهای برگشتی' }],
    dateColumn: 'chk.DueDate'
  },
  {
    id: 'checks_summary',
    titleFa: 'خلاصه چک\u200cها',
    anchors: ['مجموع چک\u200cها', 'چک\u200cهای در جریان', 'چقدر چک داریم', 'خلاصه چک'],
    excludeSignals: ['برگشتی', 'سررسید'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_direction'],
    source: {
      primaryTable: '(SELECT ReceiptChequeId AS CheckId, Number AS CheckNumber, Date AS DueDate, Amount, CAST(1 AS NVARCHAR(10)) AS Direction, State AS Status, DlRef FROM RPA.ReceiptCheque UNION ALL SELECT PaymentChequeId, Number, Date, Amount, CAST(2 AS NVARCHAR(10)), State, DlRef FROM RPA.PaymentCheque)',
      alias: 'chk'
    },
    measure: { kind: 'sum', column: 'Amount' },
    dimensions: [
      {
        dimension: 'by_direction',
        labelColumn: 'chk.Direction',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [{ sql: 'chk.Status = 1', description: 'فقط چک\u200cهای در جریان' }],
    dateColumn: 'chk.DueDate'
  },
  {
    id: 'closing_status',
    titleFa: 'وضعیت بستن دوره',
    anchors: ['بستن دوره', 'اختتامیه', 'افتتاحیه', 'آیا اختتامیه ثبت شده', 'وضعیت بستن سال'],
    excludeSignals: ['تراز', 'اول دوره', 'آخر دوره'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.Voucher',
      alias: 'v',
      requiredJoins: [
        {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        }
      ]
    },
    measure: { kind: 'count' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [{ sql: 'v.Type IN (3, 4, 5)', description: 'فقط اسناد اختتامیه/افتتاحیه/بستن' }],
    dateColumn: 'v.Date'
  },
  {
    id: 'trial_balance_check',
    titleFa: 'بررسی تراز آزمایشی',
    anchors: ['تراز می\u200cبندد', 'آیا تراز آزمایشی می\u200cبندد', 'اختلاف تراز', 'بررسی تراز'],
    excludeSignals: ['اختتامیه', 'افتتاحیه', 'بستن دوره', 'اول دوره', 'آخر دوره'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [],
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }],
    dateColumn: 'v.Date'
  },
  {
    id: 'period_comparison',
    titleFa: 'مقایسه اول و آخر دوره',
    anchors: ['اول دوره', 'آخر دوره', 'تغییرات حساب', 'مقایسه اول و آخر دوره'],
    excludeSignals: ['اختتامیه', 'افتتاحیه', 'تراز می\u200cبندد'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_account'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_account',
        labelColumn: 'a.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }],
    entityNameMatch: { column: 'a.Title', foldPersian: true },
    dateColumn: 'v.Date'
  },
  {
    id: 'sales_reconciliation',
    titleFa: 'تطبیق فروش با دفتر کل',
    anchors: ['تطبیق فروش', 'آیا فاکتورها با دفتر کل می\u200cخواند', 'اختلاف فروش', 'reconciliation فروش'],
    excludeSignals: ['خرید', 'موجودی', 'انبار'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'SLS.Invoice',
      alias: 'inv'
    },
    measure: { kind: 'sum', column: 'NetPriceInBaseCurrency' },
    dimensions: [],
    mandatoryFilters: [],
    dateColumn: 'inv.IssueDate'
  },
  {
    id: 'purchase_reconciliation',
    titleFa: 'تطبیق خرید با دفتر کل',
    anchors: ['تطبیق خرید', 'آیا خرید با دفتر کل می\u200cخواند', 'اختلاف خرید'],
    excludeSignals: ['فروش', 'موجودی', 'انبار'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'INV.InventoryReceipt',
      alias: 'ir'
    },
    measure: { kind: 'sum', column: 'TotalPrice' },
    dimensions: [],
    mandatoryFilters: [{ sql: 'ir.IsReturn = 0', description: 'فقط حواله\u200cهای ورودی (خرید)' }],
    dateColumn: 'ir.IssueDate'
  },
  {
    id: 'inventory_reconciliation',
    titleFa: 'تطبیق موجودی انبار با حساب',
    anchors: ['تطبیق موجودی', 'آیا انبار با حساب می\u200cخواند', 'اختلاف موجودی'],
    excludeSignals: ['فروش', 'خرید', 'فاکتور'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'INV.InventoryReceipt',
      alias: 'ir'
    },
    measure: { kind: 'sum', column: 'TotalPrice' },
    dimensions: [],
    mandatoryFilters: [],
    dateColumn: 'ir.IssueDate'
  },
  // ── Phase 19: Advanced Financial Metrics ─────────────────────────────────
  {
    id: 'cash_flow_statement',
    titleFa: 'صورت جریان وجوه نقد',
    anchors: ['جریان وجوه نقد', 'صورت جریان نقد', 'cash flow', 'جریان نقدینگی', 'گردش نقد'],
    excludeSignals: ['ترازنامه', 'سود و زیان', 'تراز آزمایشی'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_category'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_category',
        labelColumn: "CASE WHEN (SELECT p1.Code FROM ACC.Account p2 JOIN ACC.Account p1 ON p2.ParentAccountRef=p1.AccountId WHERE p2.AccountId=a.ParentAccountRef)='11' THEN 'operating' WHEN (SELECT p1.Code FROM ACC.Account p2 JOIN ACC.Account p1 ON p2.ParentAccountRef=p1.AccountId WHERE p2.AccountId=a.ParentAccountRef)='12' THEN 'investing' WHEN (SELECT p1.Code FROM ACC.Account p2 JOIN ACC.Account p1 ON p2.ParentAccountRef=p1.AccountId WHERE p2.AccountId=a.ParentAccountRef) IN ('21','22') THEN 'financing' ELSE 'operating' END",
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    dateColumn: 'v.Date'
  },
  {
    id: 'cash_flow_direct',
    titleFa: 'جریان نقد مستقیم',
    anchors: ['جریان نقد مستقیم', 'ورود خروج نقد', 'جریان نقد عملیاتی', 'نقد ورودی و خروجی'],
    excludeSignals: ['ترازنامه', 'سود و زیان', 'تراز آزمایشی', 'صورت جریان وجوه نقد'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_account'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'sum', column: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_account',
        join: {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        labelColumn: 'a.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.cash_bank,
    dateColumn: 'v.Date'
  },
  {
    id: 'trend_analysis',
    titleFa: 'تحلیل روند',
    anchors: ['تحلیل روند', 'روند چند ساله', 'روند سالانه'],
    excludeSignals: ['ترازنامه', 'تراز آزمایشی'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'SLS.Invoice',
      alias: 'src'
    },
    measure: { kind: 'sum', column: 'NetPriceInBaseCurrency' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    dateColumn: 'src.Date'
  },
  {
    id: 'fixed_assets_register',
    titleFa: 'ثبت دارایی‌های ثابت',
    anchors: ['دارایی ثابت', 'ثبت دارایی ثابت', 'دارایی‌های ثابت', '固定资产', 'fixed assets'],
    excludeSignals: ['استهلاک', 'دارایی جاری', 'کل دارایی'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_account'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_account',
        join: {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        labelColumn: 'a.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.fixed_assets_register,
    dateColumn: 'v.Date'
  },
  {
    id: 'depreciation_summary',
    titleFa: 'خلاصه استهلاک',
    anchors: ['استهلاک', 'استهلاک تجمعی', 'خلاصه استهلاک', 'depreciation', 'کارکرد دارایی'],
    excludeSignals: ['دارایی ثابت', 'خرید دارایی'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_account'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Credit', creditColumn: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_account',
        join: {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        labelColumn: 'a.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.depreciation,
    dateColumn: 'v.Date'
  },
  {
    id: 'cost_center_detailed',
    titleFa: 'تحلیل تفصیلی مرکز هزینه',
    anchors: ['مرکز هزینه', 'تحلیل مرکز هزینه', 'هزینه به تفکیک مرکز', 'گزارش مرکز هزینه'],
    excludeSignals: ['بودجه', 'پروژه'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_cost_center', 'by_cost_type', 'by_month'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'sum', column: 'Credit' },
    dimensions: [
      {
        dimension: 'by_cost_center',
        labelColumn: 'vi.CostCenterRef',
        labelType: 'int'
      },
      {
        dimension: 'by_cost_type',
        join: {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        labelColumn: 'a.Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_month',
        labelColumn: 'MONTH(v.Date)',
        labelType: 'int'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '61'))", description: 'فقط حساب‌های هزینه' }
    ],
    dateColumn: 'v.Date'
  },
  {
    id: 'cogs_detailed',
    titleFa: 'بهای تمام‌شده تفصیلی',
    anchors: ['بهای تمام شده تفصیلی', 'تفکیک بهای تمام شده', 'اجزای بهای تمام شده', 'مواد دستمزد سربار'],
    excludeSignals: ['فروش', 'درآمد', 'خرید'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_component', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'sum', column: 'Debit' },
    dimensions: [
      {
        dimension: 'by_component',
        labelColumn: "CASE WHEN a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND Code = '01' AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '61')) THEN 'materials' WHEN a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND Code = '02' AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '61')) THEN 'labor' WHEN a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND Code = '03' AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '61')) THEN 'overhead' ELSE 'other' END",
        labelType: 'nstring'
      },
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '61'))", description: 'فقط حساب‌های هزینه' }
    ],
    dateColumn: 'v.Date'
  },
  {
    id: 'bank_reconciliation',
    titleFa: 'تطبیق حساب بانکی',
    anchors: ['تطبیق بانک', 'تطبیق حساب بانکی', 'اختلاف بانک', 'مانده بانک دفتری'],
    excludeSignals: ['تطبیق فروش', 'تطبیق خرید', 'تطبیق موجودی'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_account', 'by_month'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_account',
        join: {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        labelColumn: 'a.Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_month',
        labelColumn: 'MONTH(v.Date)',
        labelType: 'int'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND Code = '02' AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '11'))", description: 'فقط حساب‌های بانکی' }
    ],
    dateColumn: 'v.Date'
  },
  {
    id: 'vat_detailed',
    titleFa: 'تفکیک مالیات بر ارزش افزوده',
    anchors:['مالیات بر ارزش افزوده تفصیلی', 'VAT تفصیلی', 'تفکیک VAT', 'مالیات فروش تفصیلی', 'تفکیک مالیات بر ارزش افزوده', 'مالیات بر ارزش افزوده'],
    excludeSignals: ['تطبیق', 'اختلاف'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_rate', 'by_month', 'by_customer'],
    source: {
      primaryTable: 'SLS.Invoice',
      alias: 'inv'
    },
    measure: { kind: 'sum', column: 'NetPriceInBaseCurrency' },
    dimensions: [
      {
        dimension: 'by_rate',
        labelColumn: "CASE WHEN inv.TaxInBaseCurrency > 0 THEN 'standard' ELSE 'exempt' END",
        labelType: 'nstring'
      },
      {
        dimension: 'by_month',
        labelColumn: 'MONTH(inv.Date)',
        labelType: 'int'
      },
      {
        dimension: 'by_customer',
        join: {
          table: 'SLS.Customer',
          alias: 'c',
          on: { sourceColumn: 'CustomerRef', targetColumn: 'CustomerId' }
        },
        labelColumn: 'c.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    dateColumn: 'inv.Date'
  },
  {
    id: 'tax_liability_summary',
    titleFa: 'خلاصه بدهی مالیاتی',
    anchors: ['بدهی مالیاتی', 'مالیات پرداختنی', 'خالص مالیات', 'مالیات علی‌الحساب', 'VAT پرداختنی'],
    excludeSignals: ['تطبیق', 'اختلاف', 'تفصیلی'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        },
        {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Credit', creditColumn: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }
    ],
    accountConceptFilter: AccountConcept.tax_liability,
    dateColumn: 'v.Date'
  }
]

export function getMetricCatalog(): MetricDefinition[] {
  return catalog
}

export function findMetricById(id: MetricId): MetricDefinition | null {
  return catalog.find((m) => m.id === id) ?? null
}
