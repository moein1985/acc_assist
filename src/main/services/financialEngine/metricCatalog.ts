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
    anchors: ['فروش', 'مبلغ فروش', 'درآمد فروش'],
    excludeSignals: ['خرید', 'هزینه', 'تعداد', 'چند', 'ماهانه', 'فصلی', 'به تفکیک'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_month'],
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
      }
    ],
    mandatoryFilters: []
  },
  {
    id: 'purchases',
    titleFa: 'خرید',
    anchors: ['خرید', 'مبلغ خرید', 'خرید کالا'],
    excludeSignals: ['فروش', 'درآمد'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'INV.InventoryReceipt',
      alias: 'src',
      fallbackTables: [
        {
          table: 'POM.PurchaseInvoice',
          alias: 'src',
          measure: { kind: 'sum', column: 'NetPriceInBaseCurrency' }
        }
      ]
    },
    measure: { kind: 'sum', column: 'TotalPrice' },
    mandatoryFilters: [{ sql: 'src.IsReturn = 0', description: 'حذف مرجوعی' }],
    dimensions: []
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
    entityNameMatch: { column: 'a.Title', foldPersian: true }
  },
  {
    id: 'trial_balance',
    titleFa: 'تراز آزمایشی',
    anchors: ['تراز آزمایشی', 'بدهکار بستانکار حساب‌ها'],
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
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }]
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
    anchors: ['تعداد فاکتور فروش', 'تعداد فاکتور', 'چند فاکتور فروش'],
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
    mandatoryFilters: []
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
    anchors: ['فهرست سال مالی', 'سال‌های مالی', 'لیست سال‌های مالی', 'چه سال‌هایی'],
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
    entityNameMatch: { column: 'p.Title', foldPersian: true }
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
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }]
  },
  {
    id: 'payables',
    titleFa: 'پرداختنی‌ها',
    anchors: ['پرداختنی', 'مانده پرداختنی', 'حساب‌های پرداختنی', 'طرف حساب پرداختنی'],
    excludeSignals: ['دریافتنی', 'فروش', 'خرید', 'تراز', 'بانک', 'صندوق', 'گردش'],
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
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }]
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
    anchors: ['فروش ماهانه', 'فروش فصلی', 'فروش به تفکیک ماه', 'خلاصه فروش', 'فروش دوره'],
    excludeSignals: ['خرید', 'مانده', 'تراز', 'تعداد', 'صندوق', 'بانک'],
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
    mandatoryFilters: []
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
    entityNameMatch: { column: 'a.Title', foldPersian: true }
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
      columns: ['v.VoucherId', 'v.VoucherNumber', 'v.Date', 'v.Description']
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
    orderBy: { column: 'v.Date', direction: 'DESC' }
  }
]

export function getMetricCatalog(): MetricDefinition[] {
  return catalog
}

export function findMetricById(id: MetricId): MetricDefinition | null {
  return catalog.find((m) => m.id === id) ?? null
}
