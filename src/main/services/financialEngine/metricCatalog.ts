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
    excludeSignals: ['خرید', 'هزینه', 'تعداد', 'چند', 'به تفکیک', 'بهای تمام', 'فروش‌رفته', 'فروش رفته', 'مالیات', 'تطبیق'],
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
    excludeSignals: ['فروش', 'درآمد', 'تطبیق', 'اختلاف'],
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
    excludeSignals: ['ترازنامه', 'تراز نشده', 'تراز ندارن', 'تراز ندارند', 'ترازنشده', 'تراز نیستند', 'تراز نشده\u200cاند', 'ناتراز', 'می\u200cبندد', 'اختلاف تراز', 'بررسی تراز'],
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
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز', 'صندوق', 'بانک', 'فاکتور', 'تعداد', 'بستن', 'اختتامیه', 'افتتاحیه'],
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
    excludeSignals: ['دریافتنی', 'فروش', 'خرید', 'تراز', 'بانک', 'صندوق', 'گردش', 'کل', 'مجموع', 'معوق', 'سررسید', 'تحلیل سنی', 'VAT', 'ارزش افزوده'],
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
      { sql: "a.Code LIKE '01%' OR a.Code LIKE '02%' OR a.Code LIKE '03%'", description: 'فقط حساب‌های دارایی، بدهی و حقوق صاحبان سهام' }
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
      { sql: "a.Code LIKE '04%' OR a.Code LIKE '05%'", description: 'فقط حساب‌های درآمد و هزینه' }
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
      { sql: "a.Code LIKE '01%'", description: 'فقط حساب‌های دارایی' }
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
      { sql: "a.Code LIKE '02%'", description: 'فقط حساب‌های بدهی' }
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
      { sql: "a.Code LIKE '03%'", description: 'فقط حساب‌های حقوق صاحبان سهام' }
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
      { sql: "a.Code LIKE '04%'", description: 'فقط حساب‌های درآمد' }
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
      { sql: "a.Code LIKE '05%'", description: 'فقط حساب‌های هزینه' }
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
      { sql: "(a.Code LIKE '04%' OR a.Code LIKE '05%')", description: 'درآمد و هزینه‌ها' }
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
      { sql: "a.Code LIKE '05%'", description: 'فقط حساب‌های هزینه' },
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
      { sql: "a.Code LIKE '04%' OR a.Code LIKE '05%'", description: 'درآمد و هزینه‌ها' },
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
      { sql: "a.Code LIKE '05%'", description: 'فقط حساب‌های هزینه' },
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
      { sql: "a.Code LIKE '05%'", description: 'فقط حساب‌های هزینه' }
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
      { sql: "a.Code LIKE '04%' OR a.Code LIKE '05%'", description: 'درآمد و هزینه‌ها' }
    ],
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
          on: { sourceColumn: 'AccountRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: {
      kind: 'list',
      columns: ['v.VoucherId', 'v.Number', 'v.Date', 'v.Description', 'vi.RowDescription', 'a.Code', 'a.Title', 'vi.Debit', 'vi.Credit']
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
    source: { primaryTable: 'SAL.Invoice', alias: 'inv' },
    measure: {
      kind: 'list',
      columns: ['InvoiceId', 'Number', 'Date', 'TotalAmount', 'PartyName']
    },
    dimensions: [],
    mandatoryFilters: [
      { sql: 'inv.TotalAmount = 0', description: 'فاکتور با مبلغ صفر' }
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
    groupByColumns: ['v.Date', 'v.Description', 'SUM(vi.Debit)'],
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
      columns: ['vi.VoucherItemId', 'v.Number', 'v.Date', 'vi.RowDescription', 'vi.Debit', 'vi.Credit']
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
          on: { sourceColumn: 'AccountRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: {
      kind: 'debit_minus_credit',
      debitColumn: 'vi.Debit',
      creditColumn: 'vi.Credit'
    },
    dimensions: [
      {
        dimension: 'by_age_bucket',
        labelColumn: 'AgeBucket',
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
    mandatoryFilters: [
      { sql: "a.Code LIKE '12%' OR a.Title LIKE N'%دریافتنی%'", description: 'فقط حساب\u200cهای دریافتنی' }
    ],
    orderBy: { column: 'AgeBucket', direction: 'ASC' },
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
          on: { sourceColumn: 'AccountRef', targetColumn: 'AccountId' }
        }
      ]
    },
    measure: {
      kind: 'debit_minus_credit',
      debitColumn: 'vi.Debit',
      creditColumn: 'vi.Credit'
    },
    dimensions: [
      {
        dimension: 'by_age_bucket',
        labelColumn: 'AgeBucket',
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
    mandatoryFilters: [
      { sql: "a.Code LIKE '22%' OR a.Title LIKE N'%پرداختنی%'", description: 'فقط حساب\u200cهای پرداختنی' }
    ],
    orderBy: { column: 'AgeBucket', direction: 'ASC' },
    dateColumn: 'v.Date'
  },
  {
    id: 'party_turnover',
    titleFa: 'گردش طرف حساب',
    anchors: ['گردش مشتری', 'تراکنش\u200cهای مشتری', 'گردش طرف حساب', 'گردش تأمین\u200cکننده', 'تراکنش\u200cهای شخص', 'گردش شخص', 'تراکنش\u200cهای طرف حساب'],
    excludeSignals: ['فروش', 'خرید', 'مانده', 'تراز', 'فاکتور', 'اسناد اخیر', 'صندوق', 'بانک'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_voucher'],
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
      columns: ['v.Number', 'v.Date', 'v.Description', 'vi.RowDescription', 'vi.Debit', 'vi.Credit']
    },
    dimensions: [
      {
        dimension: 'by_voucher',
        labelColumn: 'v.Number',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }],
    entityNameMatch: { column: 'a.Title', foldPersian: true },
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
    measure: { kind: 'sum', column: 'TaxAmount' },
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
    dateColumn: 'inv.IssueDate'
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
      columns: ['inv.InvoiceId', 'inv.Number', 'inv.IssueDate', 'inv.CustomerName', 'inv.NetPriceInBaseCurrency', 'inv.TaxAmount']
    },
    dimensions: [],
    mandatoryFilters: [{ sql: 'inv.TaxAmount = 0 OR inv.TaxAmount IS NULL', description: 'فاکتور با مالیات صفر یا نامعتبر' }],
    dateColumn: 'inv.IssueDate'
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
    measure: { kind: 'sum', column: 'TaxAmount' },
    dimensions: [],
    mandatoryFilters: [],
    dateColumn: 'inv.IssueDate'
  },
  {
    id: 'checks_due',
    titleFa: 'چک\u200cهای سررسید',
    anchors: ['چک سررسید', 'چک\u200cهای این هفته', 'چک\u200cهای دریافتی سررسید', 'چک\u200cهای پرداختی سررسید', 'چک\u200cهای در جریان'],
    excludeSignals: ['برگشتی', 'مجموع'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: {
      primaryTable: 'RPA.PaperCheck',
      alias: 'chk'
    },
    measure: {
      kind: 'list',
      columns: ['chk.CheckId', 'chk.CheckNumber', 'chk.DueDate', 'chk.Amount', 'chk.Direction', 'chk.Status', 'chk.PartyName']
    },
    dimensions: [],
    mandatoryFilters: [{ sql: "chk.Status = N'در جریان'", description: 'فقط چک\u200cهای در جریان' }],
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
      primaryTable: 'RPA.PaperCheck',
      alias: 'chk'
    },
    measure: {
      kind: 'list',
      columns: ['chk.CheckId', 'chk.CheckNumber', 'chk.DueDate', 'chk.Amount', 'chk.Direction', 'chk.PartyName']
    },
    dimensions: [],
    mandatoryFilters: [{ sql: "chk.Status = N'برگشتی'", description: 'فقط چک\u200cهای برگشتی' }],
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
      primaryTable: 'RPA.PaperCheck',
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
    mandatoryFilters: [{ sql: "chk.Status = N'در جریان'", description: 'فقط چک\u200cهای در جریان' }],
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
  }
]

export function getMetricCatalog(): MetricDefinition[] {
  return catalog
}

export function findMetricById(id: MetricId): MetricDefinition | null {
  return catalog.find((m) => m.id === id) ?? null
}
