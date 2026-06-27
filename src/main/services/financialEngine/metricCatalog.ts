/**
 * Metric catalog registry for the Financial Reasoning Engine (FRE).
 *
 * Phase 1: no-op stub. Phase 2 will populate this with declarative
 * MetricDefinition entries for each migrated metric.
 *
 * @see FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md
 */

import type { MetricDefinition, MetricId } from './types'

const catalog: MetricDefinition[] = [
  {
    id: 'net_sales',
    titleFa: 'فروش خالص',
    anchors: ['فروش', 'مبلغ فروش', 'درآمد فروش', 'فروختیم', 'فروخت'],
    excludeSignals: ['خرید', 'هزینه', 'تعداد', 'چند', 'به تفکیک', 'بهای تمام', 'فروش‌رفته', 'فروش رفته'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_month', 'by_quarter'],
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
      }
    ],
    mandatoryFilters: [],
    dateColumn: 'src.Date'
  },
  {
    id: 'purchases',
    titleFa: 'خرید',
    anchors: ['خرید', 'مبلغ خرید', 'خرید کالا'],
    excludeSignals: ['فروش', 'درآمد'],
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
    anchors: ['مانده حساب', 'مانده سرفصل', 'بدهکار بستانکار حساب'],
    excludeSignals: ['تراز', 'حساب‌ها', 'بانک', 'صندوق', 'کش', 'نقد'],
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
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }],
    entityNameMatch: { column: 'a.Title', foldPersian: true },
    dateColumn: 'v.Date'
  },
  {
    id: 'trial_balance',
    titleFa: 'تراز آزمایشی',
    anchors: ['تراز آزمایشی', 'بدهکار بستانکار حساب‌ها', 'تراز'],
    excludeSignals: ['ترازنامه'],
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
    anchors: ['مانده نقد', 'مانده بانک', 'مانده صندوق', 'مانده کش', 'مانده حساب بانکی'],
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
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز', 'صندوق', 'بانک', 'فاکتور'],
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
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز', 'صندوق', 'بانک', 'فاکتور', 'تعداد'],
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
          table: 'ACC.Partner',
          alias: 'p',
          on: { sourceColumn: 'PartyRef', targetColumn: 'PartnerId' }
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
    entityNameMatch: { column: 'p.Title', foldPersian: true },
    dateColumn: 'v.Date'
  },
  {
    id: 'receivables',
    titleFa: 'دریافتنی‌ها',
    anchors: ['دریافتنی', 'مانده دریافتنی', 'حساب‌های دریافتنی', 'طرف حساب دریافتنی'],
    excludeSignals: ['پرداختنی', 'فروش', 'خرید', 'تراز', 'بانک', 'صندوق', 'گردش'],
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
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }],
    dateColumn: 'v.Date'
  },
  {
    id: 'payables',
    titleFa: 'پرداختنی‌ها',
    anchors: ['پرداختنی', 'مانده پرداختنی', 'حساب‌های پرداختنی', 'طرف حساب پرداختنی', 'بدهی', 'بدهی‌ها'],
    excludeSignals: ['دریافتنی', 'فروش', 'خرید', 'تراز', 'بانک', 'صندوق', 'گردش', 'کل', 'مجموع'],
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
        }
      ]
    },
    measure: { kind: 'sum', column: 'Credit' },
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
    dateColumn: 'v.Date'
  },
  {
    id: 'cashflow',
    titleFa: 'جریان نقد',
    anchors: ['جریان نقد', 'جریان وجه نقد', 'نقد و بانک', 'جریان نقدی'],
    excludeSignals: ['فروش', 'خرید', 'تراز', 'دریافتنی', 'پرداختنی'],
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
          on: { sourceColumn: 'PartyRef', targetColumn: 'PartyId' }
        },
        labelColumn: 'cust.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    dateColumn: 'src.Date'
  },
  {
    id: 'account_turnover',
    titleFa: 'گردش حساب',
    anchors: ['گردش حساب', 'گردش سرفصل', 'بدهکار و بستانکار حساب', 'گردش معین'],
    excludeSignals: ['مانده', 'تراز', 'فروش', 'خرید', 'صندوق', 'بانک', 'نقد'],
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
        labelColumn: 'a.Title',
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
    excludeSignals: ['آزمایشی', 'حساب‌ها'],
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
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.Code LIKE '1%' OR a.Code LIKE '2%' OR a.Code LIKE '3%'", description: 'فقط حساب‌های دارایی، بدهی و حقوق صاحبان سهام' }
    ],
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
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.Code LIKE '4%' OR a.Code LIKE '5%'", description: 'فقط حساب‌های درآمد و هزینه' }
    ],
    dateColumn: 'v.Date'
  },
  {
    id: 'total_assets',
    titleFa: 'کل دارایی‌ها',
    anchors: ['کل دارایی', 'مجموع دارایی', 'دارایی کل', 'دارایی‌ها'],
    excludeSignals: ['بدهی', 'حقوق', 'درآمد', 'هزینه', 'ترازنامه', 'آزمایشی'],
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
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.Code LIKE '1%'", description: 'فقط حساب‌های دارایی' }
    ],
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
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.Code LIKE '2%'", description: 'فقط حساب‌های بدهی' }
    ],
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
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.Code LIKE '3%'", description: 'فقط حساب‌های حقوق صاحبان سهام' }
    ],
    dateColumn: 'v.Date'
  },
  {
    id: 'total_revenue',
    titleFa: 'کل درآمد‌ها',
    anchors: ['کل درآمد', 'مجموع درآمد', 'درآمد کل', 'درآمدی'],
    excludeSignals: ['هزینه', 'دارایی', 'بدهی', 'حقوق', 'ترازنامه', 'فروش خالص'],
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
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.Code LIKE '4%'", description: 'فقط حساب‌های درآمد' }
    ],
    dateColumn: 'v.Date'
  },
  {
    id: 'total_expenses',
    titleFa: 'کل هزینه‌ها',
    anchors: ['کل هزینه', 'مجموع هزینه', 'هزینه کل', 'هزینه‌ها کل'],
    excludeSignals: ['درآمد', 'دارایی', 'بدهی', 'حقوق', 'ترازنامه', 'خرید'],
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
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.Code LIKE '5%'", description: 'فقط حساب‌های هزینه' }
    ],
    dateColumn: 'v.Date'
  },
  {
    id: 'cogs',
    titleFa: 'بهای تمام‌شده کالای فروش‌رفته',
    anchors: ['بهای تمام شده', 'COGS', 'هزینه فروش', 'بهای کالای فروش‌رفته'],
    excludeSignals: ['فروش خالص', 'درآمد', 'خرید'],
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
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.Code LIKE '51%'", description: 'فقط حساب‌های بهی تمام‌شده' }
    ],
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
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.Code LIKE '52%'", description: 'فقط حساب‌های حقوق و دستمزد' }
    ],
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
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.Code LIKE '53%'", description: 'فقط حساب‌های مالیات پرداختی' }
    ],
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
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.Code LIKE '54%'", description: 'فقط حساب‌های مالیات دریافتی' }
    ],
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
      { sql: "(a.Code LIKE '4%' OR a.Code LIKE '5%')", description: 'درآمد و هزینه‌ها' }
    ],
    dateColumn: 'v.Date'
  },
  {
    id: 'inventory_value',
    titleFa: 'ارزش موجودی کالا',
    anchors: ['موجودی کالا', 'ارزش موجودی', 'موجودی انبار', 'ارزش انبار'],
    excludeSignals: ['فروش', 'خرید', 'مانده حساب'],
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
          on: { sourceColumn: 'DLId', targetColumn: 'DLRef' }
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
      { sql: "a.Code LIKE '5%'", description: 'فقط حساب‌های هزینه' },
      { sql: 'vi.DLRef IS NOT NULL', description: 'فقط آیتم‌های دارای تفصیلی' },
      { sql: 'cc.CostCenterId IS NOT NULL', description: 'فقط آیتم‌های مرتبط با مرکز هزینه' },
      { sql: 'cc.DLRef = dl.DLId', description: 'اتصال مرکز هزینه به تفصیلی' }
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
          on: { sourceColumn: 'Code', targetColumn: 'Code' }
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
      { sql: 'prj.ProjectID IS NOT NULL', description: 'فقط آیتم‌های مرتبط با پروژه' },
      { sql: 'prj.Code = dl.Code', description: 'اتصال پروژه به تفصیلی' }
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
          on: { sourceColumn: 'Code', targetColumn: 'Code' }
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
      { sql: "a.Code LIKE '4%' OR a.Code LIKE '5%'", description: 'درآمد و هزینه‌ها' },
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
          on: { sourceColumn: 'DLId', targetColumn: 'DLRef' }
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
      { sql: "a.Code LIKE '5%'", description: 'فقط حساب‌های هزینه' },
      { sql: 'cc.CostCenterId IS NOT NULL', description: 'فقط آیتم‌های مرتبط با مرکز هزینه' },
      { sql: 'cc.DLRef = dl.DLId', description: 'اتصال مرکز هزینه به تفصیلی' }
    ],
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
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.Code LIKE '5%'", description: 'فقط حساب‌های هزینه' }
    ],
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
      { sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' },
      { sql: "a.Code LIKE '4%' OR a.Code LIKE '5%'", description: 'درآمد و هزینه‌ها' }
    ],
    dateColumn: 'v.Date'
  }
]

export function getMetricCatalog(): MetricDefinition[] {
  return catalog
}

export function findMetricById(id: MetricId): MetricDefinition | null {
  return catalog.find((m) => m.id === id) ?? null
}
