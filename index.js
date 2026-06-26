"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const node_path = require("node:path");
const utils = require("@electron-toolkit/utils");
const nodeSqlParser = require("node-sql-parser");
const mssql = require("mssql");
const node_http = require("node:http");
const promises = require("node:fs/promises");
const node_crypto = require("node:crypto");
const ws = require("ws");
const XLSX = require("xlsx");
const net = require("node:net");
const ssh2 = require("ssh2");
const node_fs = require("node:fs");
const os = require("node:os");
const path = require("path");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const XLSX__namespace = /* @__PURE__ */ _interopNamespaceDefault(XLSX);
function normalizePersianDigits(value) {
  return value.replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));
}
function normalizePersianText(input) {
  return normalizePersianDigits(input).normalize("NFKC").replace(/[\u064a\u0649]/g, "ی").replace(/[\u0643]/g, "ک").replace(/\u06c0/g, "ه").replace(/[\u064b-\u0655]/g, "").replace(/\u200c/g, " ").replace(/\s+/g, " ").trim();
}
const SALES_KPI_CONTRACT_REGISTRY = [
  {
    id: "gross_sales",
    label: "فروش ناخالص",
    description: "فروش بدون کسر تخفیف و برگشت فروش",
    aliases: [/فروش\s*ناخالص|gross\s*sales|gross_sales/iu, /ناخالص\s*فروش/iu]
  },
  {
    id: "net_sales",
    label: "فروش خالص",
    description: "فروش پس از کسر تخفیف و برگشت فروش",
    aliases: [/فروش\s*خالص|net\s*sales|net_sales/iu, /خالص\s*فروش/iu]
  },
  {
    id: "booked_sales",
    label: "فروش دفتری",
    description: "فروش ثبت‌شده در اسناد حسابداری",
    aliases: [/فروش\s*دفتری|booked\s*sales|booked_sales/iu, /دفتری\s*فروش/iu]
  }
];
const FINANCIAL_INTENT_REGISTRY = [
  {
    id: "count_fiscal_years",
    description: "Count distinct fiscal years in the active database.",
    responseMode: "deterministic",
    requiredSlots: [],
    isGoldenFastPath: true,
    targetTables: ["documents"],
    requiredScopeFilters: ["fiscal_year"],
    aggregate: "COUNT(DISTINCT fiscal_year)",
    projection: ["fiscal_year"],
    patterns: [
      /\bhow\s+many\s+fiscal\s+years\b/iu,
      /\bfiscal\s+year\s+count\b/iu,
      /\bcount\s+of\s+fiscal\s+years\b/iu,
      /(?:تعداد|چند)\s*سال\s*مالی/iu,
      /سال\s*مالی\s*(?:چند|تعداد)/iu,
      /\b(?:how\s+many|what\s+is\s+the\s+count)\s+(?:fiscal\s+)?years?\b/iu,
      /\b(?:count|number)\s+of\s+(?:fiscal\s+)?years?\b/iu
    ]
  },
  {
    id: "list_fiscal_years",
    description: "List fiscal years in the active database.",
    responseMode: "deterministic",
    requiredSlots: [],
    isGoldenFastPath: true,
    targetTables: ["documents"],
    requiredScopeFilters: ["fiscal_year"],
    aggregate: "COUNT(DISTINCT fiscal_year)",
    projection: ["fiscal_year"],
    patterns: [
      /\b(?:list|show|display|find)\s+(?:the\s+)?(?:of\s+)?(?:available\s+)?fiscal\s+years\b/iu,
      /\bfiscal\s+years?\s+(?:available|list|show|display)\b/iu,
      /\bshow\s+the\s+fiscal\s+years\s+available\b/iu,
      /(?:لیست|فهرست|نمایش)\s*(?:سال(?:\s|\u200c)?های?|سال)\s*مالی/iu,
      /سال(?:\s|\u200c)?های?\s*مالی\s*را\s*(?:لیست|فهرست|نمایش)/iu,
      /(?:لیست|فهرست|نمایش)\s*(?:سال(?:\s|\u200c)?های?|سال)\s*مالی\s*(?:از|تا|موجود|در\s*دیتابیس)/iu,
      /سال(?:\s|\u200c)?های?\s*مالی\s*(?:از\s*\d{4}\s*تا\s*\d{4})/iu,
      /\b(?:available|existing|present)\s+(?:fiscal\s+)?years?\b/iu,
      /\b(?:لیست|فهرست|نمایش)\s+سال\s*های?\s*مالی\s*(?:موجود|در\s*دیتابیس)?\b/iu
    ]
  },
  {
    id: "get_party_balance",
    description: "Return balance for a person/counterparty.",
    responseMode: "deterministic",
    requiredSlots: ["partyName"],
    patterns: [
      /مانده\s*(?:شخص|طرف\s*حساب|مشتری|فروشنده|شریک)/iu,
      /\bparty\s+balance\b/iu,
      /\bcounterparty\s+balance\b/iu,
      /\b(?:balance|مانده)\s+(?:of\s+)?(?:party|counterparty|customer|vendor)\b/iu,
      /\b(?:party|counterparty|customer|vendor)\s+(?:balance|مانده)\b/iu,
      /\bمانده\s+طرف\s*حساب\b/iu
    ]
  },
  {
    id: "get_account_balance",
    description: "Return balance for an account/chart item from ACC.Voucher/ACC.VoucherItem.",
    responseMode: "deterministic",
    requiredSlots: ["accountCodeOrName"],
    isGoldenFastPath: true,
    targetTables: ["ACC.Voucher", "ACC.VoucherItem"],
    requiredScopeFilters: ["account_id", "fiscal_year"],
    aggregate: "SUM(Debit) - SUM(Credit)",
    projection: ["AccountRef", "AccountSLRef", "Debit", "Credit"],
    patterns: [
      /مانده\s*(?:بدهکار|بستانکار|خالص)?\s*(?:حساب|سرفصل|تنخواه|معین|تفضیلی)/iu,
      /\baccount\s+balance\b/iu,
      /\bbalance\s+of\s+(?:account|ledger|chart)\b/iu,
      /\b(?:ledger|chart)\s+(?:balance|مانده)\b/iu,
      /\b(?:حساب|سرفصل|معین|تفضیلی)\s+(?:مانده|balance)\b/iu
    ]
  },
  {
    id: "get_account_turnover",
    description: "Return account turnover in a date range.",
    responseMode: "model-assisted",
    requiredSlots: ["accountCodeOrName", "dateRange"],
    patterns: [/گردش\s*حساب/iu, /\baccount\s+turnover\b/iu]
  },
  {
    id: "get_cash_bank_balance",
    description: "Return cash and bank account balances from RPA.CashBalance and RPA.BankAccountBalance.",
    responseMode: "deterministic",
    requiredSlots: ["fiscalYear"],
    isGoldenFastPath: true,
    targetTables: ["RPA.CashBalance", "RPA.BankAccountBalance"],
    requiredScopeFilters: ["fiscal_year"],
    aggregate: "SUM(Balance)",
    projection: ["Balance", "FiscalYearRef"],
    patterns: [
      /مانده\s*(?:نقد|صندوق|کش|کیش|بانک|حساب\s*بانکی)/iu,
      /\b(?:cash|bank)\s+balance\b/iu,
      /\bbalance\s+(?:of\s+)?(?:cash|bank)\b/iu
    ]
  },
  {
    id: "get_trial_balance",
    description: "Return trial balance (sum of debit/credit by account) from ACC.VoucherItem.",
    responseMode: "deterministic",
    requiredSlots: ["fiscalYear"],
    isGoldenFastPath: true,
    targetTables: ["ACC.Voucher", "ACC.VoucherItem"],
    requiredScopeFilters: ["fiscal_year"],
    aggregate: "SUM(Debit), SUM(Credit)",
    projection: ["AccountRef", "AccountSLRef", "Debit", "Credit"],
    patterns: [
      /تراز\s*آزمایشی/iu,
      /\btrial\s+balance\b/iu,
      /بدهکار\s*بستانکار\s*حساب‌ها/iu
    ]
  },
  {
    id: "get_sales_summary_by_period",
    description: "Return monthly/quarterly/yearly sales summary from the sales facts table.",
    responseMode: "model-assisted",
    requiredSlots: ["period"],
    targetTables: ["MRP.SaleFacts"],
    patterns: [/فروش\s*(?:ماهانه|فصلی|سالانه)/iu, /\bsales\s+summary\b/iu],
    anchors: [
      // Standalone فروش (sales), but NOT the compound words فروشگاه (store) or فروشنده/فروشندگان (seller).
      { pattern: /فروش(?!گاه|نده|ند)/iu, weight: 3 },
      { pattern: /\bsales\b|\brevenue\b/iu, weight: 3 },
      { pattern: /فاکتور\s*فروش|\bsale\s+invoice\b/iu, weight: 2 }
    ],
    support: [{ pattern: /(?:ماهانه|فصلی|سالانه|monthly|quarterly|yearly)/iu, weight: 1 }],
    exclude: [/برگشت\s*از\s*فروش/iu, /\bsales\s+returns?\b/iu],
    minScore: 3
  },
  {
    id: "get_purchase_summary",
    description: "Return purchase summary. Fallback from POM.PurchaseInvoice to INV.InventoryReceipt (non-returns).",
    responseMode: "deterministic",
    requiredSlots: ["period"],
    isGoldenFastPath: true,
    targetTables: ["POM.PurchaseInvoice", "INV.InventoryReceipt"],
    requiredScopeFilters: ["fiscal_year"],
    patterns: [/خرید(?!ار)/iu, /\bpurchase\b/iu, /رسید\s*انبار/iu],
    anchors: [
      // Standalone خرید (purchase), but NOT خریدار/خریداران (buyer).
      { pattern: /خرید(?!ار)/iu, weight: 3 },
      { pattern: /\bpurchase\b|\bprocurement\b/iu, weight: 3 },
      // Inventory receipt vouchers ARE the purchase signal in this business process.
      { pattern: /رسید\s*انبار|\bgoods?\s*receipts?\b/iu, weight: 3 },
      { pattern: /فاکتور\s*خرید|\bpurchase\s+invoice\b/iu, weight: 2 }
    ],
    support: [{ pattern: /(?:ماهانه|فصلی|سالانه|monthly|quarterly|yearly)/iu, weight: 1 }],
    exclude: [/برگشت\s*از\s*خرید/iu, /\bpurchase\s+returns?\b/iu],
    minScore: 3
  },
  {
    id: "get_receivables_summary",
    description: "Return receivables summary.",
    responseMode: "deterministic",
    requiredSlots: [],
    isGoldenFastPath: true,
    targetTables: ["accounts", "documents"],
    requiredScopeFilters: ["fiscal_year"],
    aggregate: "SUM(balance)",
    projection: ["account_name", "balance"],
    patterns: [
      /\breceivables\b/iu,
      /\b(?:accounts?\s*receivable|debtors?)\b/iu,
      /(?:بدهکاران|دریافتنی|دریافتنی‌ها|دریافتنی ها)/iu,
      /(?:جمع|مجموع|خلاصه)\s*(?:بدهکاران|دریافتنی)/iu,
      /بدهکاران\s+ماهانه/iu
    ]
  },
  {
    id: "get_payables_summary",
    description: "Return payables summary.",
    responseMode: "deterministic",
    requiredSlots: [],
    isGoldenFastPath: true,
    targetTables: ["accounts", "documents"],
    requiredScopeFilters: ["fiscal_year"],
    aggregate: "SUM(balance)",
    projection: ["account_name", "balance"],
    patterns: [
      /\bpayables\b/iu,
      /\b(?:accounts?\s*payable|creditors?)\b/iu,
      /(?:بستانکاران|پرداختنی|پرداختنی‌ها|پرداختنی ها|به\s*پرداخت)/iu,
      /(?:جمع|مجموع|خلاصه)\s*(?:بستانکاران|پرداختنی)/iu,
      /بستانکاران\s+(?:این\s+)?ماه/iu
    ]
  },
  {
    id: "get_cashflow_summary",
    description: "Return cashflow summary.",
    responseMode: "deterministic",
    requiredSlots: ["dateRange"],
    patterns: [
      /جریان\s*نقد/iu,
      /جریان\s*وجه/iu,
      /\bcash\s*flow\b/iu,
      /\bcashflow\b/iu,
      /\b(?:خلاصه|جمع|مجموع)\s*(?:جریان\s*نقد|جریان\s*وجه|cashflow)\b/iu,
      /\b(?:cash|cashflow)\s+(?:summary|overview)\b/iu
    ]
  },
  {
    id: "get_recent_or_suspicious_documents",
    description: "Return recent or suspicious accounting documents.",
    responseMode: "model-assisted",
    requiredSlots: [],
    patterns: [/اسناد\s*(?:اخیر|مشکوک)/iu, /\b(?:recent|suspicious)\s+documents\b/iu]
  }
];
function listFinancialIntentDefinitions() {
  return FINANCIAL_INTENT_REGISTRY.map((entry) => {
    const copy = { ...entry, patterns: [...entry.patterns] };
    if (entry.anchors) {
      copy.anchors = entry.anchors.map((signal) => ({ ...signal }));
    }
    if (entry.support) {
      copy.support = entry.support.map((signal) => ({ ...signal }));
    }
    if (entry.exclude) {
      copy.exclude = [...entry.exclude];
    }
    return copy;
  });
}
function detectSalesKpiContractCandidates(prompt) {
  const normalizedPrompt = normalizeFinancialIntentPrompt(prompt);
  if (!normalizedPrompt) {
    return { contractIds: [], isAmbiguous: false };
  }
  const explicitMatches = SALES_KPI_CONTRACT_REGISTRY.filter(
    (entry) => entry.aliases.some((alias) => alias.test(normalizedPrompt))
  );
  if (explicitMatches.length > 0) {
    return {
      contractIds: explicitMatches.map((entry) => entry.id),
      isAmbiguous: false
    };
  }
  const hasSalesSignal = /(?:فروش|sales|revenue)/iu.test(normalizedPrompt);
  const hasAnnualSignal = /(?:سالانه|annual|yearly)/iu.test(normalizedPrompt);
  if (hasSalesSignal && hasAnnualSignal) {
    return {
      contractIds: SALES_KPI_CONTRACT_REGISTRY.map((entry) => entry.id),
      isAmbiguous: true
    };
  }
  return { contractIds: [], isAmbiguous: false };
}
function normalizeFinancialIntentPrompt(prompt) {
  return normalizePersianText(prompt);
}
function extractFinancialIntentSlots(prompt) {
  const normalizedPrompt = normalizeFinancialIntentPrompt(prompt);
  const slots = {};
  if (/(?:حساب|سرفصل|ledger|account)/iu.test(normalizedPrompt)) {
    slots.accountCodeOrName = "detected";
  }
  if (/(?:طرف\s*حساب|شخص|party|counterparty)/iu.test(normalizedPrompt)) {
    slots.partyName = "detected";
  }
  if (/(?:بازه|از\s+.*\s+تا|to\s+\d{4}|between\s+\d{4})/iu.test(normalizedPrompt)) {
    slots.dateRange = "detected";
  }
  if (/(?:سال\s*مالی|fiscal\s*year)/iu.test(normalizedPrompt)) {
    slots.fiscalYear = "detected";
  }
  if (/(?:ماهانه|فصلی|سالانه|monthly|quarterly|yearly)/iu.test(normalizedPrompt)) {
    slots.period = "detected";
  }
  return slots;
}
function resolveIntentAnchors(definition) {
  if (definition.anchors && definition.anchors.length > 0) {
    return definition.anchors;
  }
  return definition.patterns.map((pattern) => ({ pattern, weight: 1 }));
}
function resolveIntentMinScore(definition) {
  if (typeof definition.minScore === "number" && definition.minScore > 0) {
    return definition.minScore;
  }
  return 1;
}
function scoreIntent(normalizedText, definition) {
  if (!normalizedText) {
    return 0;
  }
  if (definition.exclude?.some((pattern) => pattern.test(normalizedText))) {
    return 0;
  }
  let anchorScore = 0;
  for (const { pattern, weight } of resolveIntentAnchors(definition)) {
    if (pattern.test(normalizedText)) {
      anchorScore += weight;
    }
  }
  if (anchorScore === 0) {
    return 0;
  }
  let score = anchorScore;
  for (const { pattern, weight } of definition.support ?? []) {
    if (pattern.test(normalizedText)) {
      score += weight;
    }
  }
  return score;
}
function scoreFinancialIntentCandidates(prompt) {
  const normalizedPrompt = normalizeFinancialIntentPrompt(prompt);
  if (!normalizedPrompt) {
    return [];
  }
  const matches = [];
  for (const intent of FINANCIAL_INTENT_REGISTRY) {
    const rawScore = scoreIntent(normalizedPrompt, intent);
    const minScore = resolveIntentMinScore(intent);
    if (rawScore < minScore) {
      continue;
    }
    matches.push({
      intentId: intent.id,
      confidence: 1 - Math.exp(-rawScore / minScore)
    });
  }
  return matches.sort((a, b) => b.confidence - a.confidence);
}
function detectFinancialIntent(prompt) {
  return scoreFinancialIntentCandidates(prompt)[0] ?? null;
}
const DEFAULT_POOL_MAX = 8;
const DEFAULT_POOL_MIN = 0;
const DEFAULT_POOL_IDLE_TIMEOUT_MS = 3e4;
const FORBIDDEN_SQL_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|MERGE|EXEC|EXECUTE|GRANT|REVOKE|DENY|BACKUP|RESTORE|DBCC|USE|WAITFOR)\b/i;
const FORBIDDEN_EXTERNAL_DATA_ACCESS_PATTERN = /\b(OPENROWSET|OPENQUERY|OPENDATASOURCE)\s*\(/i;
const SENSITIVE_METADATA_ACCESS_PATTERN = /\bINFORMATION_SCHEMA\b|\bSYS\.[A-Z_][A-Z0-9_]*\b|\bSYSOBJECTS\b|\bSYSCOLUMNS\b|\bSYSINDEXES\b/i;
const FORBIDDEN_SYSTEM_PROC_PATTERN = /\b(XP_|SP_|DS_)\w+/i;
const FORBIDDEN_TESSERACT_NESTING = /\b(GO|DECLARE|SET)\b/i;
const FORBIDDEN_QUERY_HINT_PATTERN = /\bOPTION\s*\(/i;
const FORBIDDEN_EXPORT_CLAUSE_PATTERN = /\bFOR\s+(XML|JSON)\b/i;
const AGGREGATION_SQL_PATTERN = /\b(COUNT|SUM|AVG|MIN|MAX|STRING_AGG)\s*\(|\bGROUP\s+BY\b|\bHAVING\b/i;
const RESULT_LIMIT_SQL_PATTERN = /\bTOP\s*\(\s*[^)]+\s*\)|\bTOP\s+[^\s;]+\b|\bFETCH\s+NEXT\s+[^;\n\r]+\s+ROWS?\s+ONLY\b/i;
const ORDER_BY_SQL_PATTERN = /\bORDER\s+BY\b/i;
const WILDCARD_SELECT_PATTERN = /\bSELECT\s+(?:TOP\s*\(\s*\d+\s*\)\s+|TOP\s+\d+\s+)?\*\s+FROM\b/i;
const READONLY_LOGIN_CACHE_TTL_MS = 6e4;
class SqlPolicyViolationError extends Error {
  code;
  category;
  constructor(code, category, message) {
    super(message);
    this.name = "SqlPolicyViolationError";
    this.code = code;
    this.category = category;
  }
  getPersianMessage() {
    switch (this.code) {
      case "SQL_POLICY_EMPTY_QUERY":
        return "کوئری ارسالی خالی است.";
      case "SQL_POLICY_NOT_SELECT":
        return "فقط کوئری‌های SELECT مجاز هستند.";
      case "SQL_POLICY_FORBIDDEN_KEYWORD":
        return "استفاده از کلمات کلیدی غیرمجاز (مانند INSERT/UPDATE/DELETE) در کوئری شناسایی شد.";
      case "SQL_POLICY_FORBIDDEN_HINT":
        return "استفاده از Query Hintها در این سطح دسترسی مجاز نیست.";
      case "SQL_POLICY_FORBIDDEN_EXPORT_CLAUSE":
        return "استفاده از خروجی‌های XML یا JSON در کوئری مجاز نیست.";
      case "SQL_POLICY_EXTERNAL_DATA_ACCESS":
        return "دسترسی به منابع داده خارجی (OpenRowset/OpenQuery) مسدود شده است.";
      case "SQL_POLICY_METADATA_SCOPE_BLOCK":
        return "دسترسی مستقیم به جدول‌های سیستم و متادیتا محدود شده است.";
      case "SQL_POLICY_WILDCARD_SELECT_BLOCKED":
        return "استفاده از SELECT * در این بخش مجاز نیست. لطفاً نام ستون‌ها را صریحاً ذکر کنید.";
      case "SQL_POLICY_SELECT_INTO":
        return "ساخت جدول جدید (SELECT INTO) مجاز نیست.";
      case "SQL_POLICY_MULTI_STATEMENT":
        return "اجرای همزمان چند دستور در یک کوئری مجاز نیست.";
      case "SQL_POLICY_REQUIRE_RESULT_LIMIT":
        return "برای جلوگیری از بار اضافی، کوئری باید دارای محدودیت تعداد ردیف (TOP یا FETCH NEXT) باشد.";
      case "SQL_POLICY_REQUIRE_ORDER_BY_FOR_LIMITED_QUERY":
        return "استفاده از محدودیت ردیف بدون ORDER BY مجاز نیست.";
      case "SQL_POLICY_NON_NUMERIC_LIMIT":
        return "مقدار محدودیت تعداد ردیف باید عدد باشد.";
      case "SQL_POLICY_INVALID_LIMIT":
        return "مقدار محدودیت تعداد ردیف نامعتبر است.";
      case "SQL_POLICY_QUERY_TIMEOUT":
        return "زمان اجرای کوئری بیش از حد مجاز طول کشید.";
      case "SQL_POLICY_SCOPE_LIMIT_EXCEEDED":
        return "تعداد ردیف‌های خروجی بیش از سقف مجاز برای این عملیات است.";
      case "SQL_POLICY_REQUIRE_READONLY_LOGIN":
        return "این عملیات مستلزم استفاده از یک دسترسی فقط-خواندنی (Read-Only) واقعی در سطح بانک اطلاعاتی است.";
      case "SQL_POLICY_SCOPE_FILTER_MISSING":
        return "کوئری Golden 5 فاقد فیلتر الزامی دامنه/سال مالی است.";
      case "SQL_POLICY_FORBIDDEN_SYSTEM_PROC":
        return "فراخوانی توابع و پروسیجرهای سیستمی (xp_*/sp_*) مجاز نیست.";
      case "SQL_POLICY_FORBIDDEN_BATCH_COMMAND":
        return "استفاده از دستورات دسته‌ای (مانند GO، DECLARE، SET) در کوئری‌های مالی مجاز نیست.";
      default:
        return "خطای سیاست امنیتی SQL رخ داده است.";
    }
  }
}
const MAX_READONLY_ROWS_BY_SCOPE = {
  generic: 500,
  "agent-data": 500,
  metadata: 5e3,
  discovery: 3e4
};
const MAX_READONLY_TIMEOUT_MS_BY_SCOPE = {
  generic: 3e4,
  "agent-data": 25e3,
  metadata: 2e4,
  discovery: 45e3
};
class SqlConnectionManager {
  pool = null;
  poolSignature = null;
  connectPromise = null;
  sqlParser = new nodeSqlParser.Parser();
  readonlyPermissionCache = /* @__PURE__ */ new Map();
  async testConnection(connection) {
    const pool = await this.getOrCreatePool(connection);
    const result = await pool.request().query("SELECT 1 AS ok");
    const okValue = result.recordset?.[0]?.ok;
    return okValue === 1 ? "SQL connection is healthy" : "SQL connection established";
  }
  async listDatabases(connection) {
    const pool = await this.getOrCreatePool(this.withDatabase(connection, "master"));
    const result = await pool.request().query(`
SELECT name
FROM sys.databases
WHERE state = 0
  AND HAS_DBACCESS(name) = 1
ORDER BY name`);
    const rows = Array.isArray(result.recordset) ? result.recordset : [];
    return rows.map((row) => {
      const name = row?.["name"];
      return typeof name === "string" ? name.trim() : "";
    }).filter((name) => name.length > 0);
  }
  async getHealthCheck(connection) {
    const pool = await this.getOrCreatePool(connection);
    const healthCheck = await this.getHealthCheckFromPool(pool, connection);
    this.updateReadOnlyCache(connection, healthCheck);
    return healthCheck;
  }
  async getHealthCheckFromPool(pool, connection) {
    const result = await pool.request().query(`
SELECT
  CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS server_version,
  DB_NAME() AS database_name,
  SUSER_SNAME() AS login_user,
  CAST(COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT'), 0) AS int) AS can_insert,
  CAST(COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE'), 0) AS int) AS can_update,
  CAST(COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE'), 0) AS int) AS can_delete,
  CAST(COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER'), 0) AS int) AS can_alter,
  CAST(COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CONTROL'), 0) AS int) AS can_control`);
    const row = Array.isArray(result.recordset) ? result.recordset[0] : void 0;
    const writeCapabilities = [];
    if (this.toInt(row?.["can_insert"]) === 1) {
      writeCapabilities.push("INSERT");
    }
    if (this.toInt(row?.["can_update"]) === 1) {
      writeCapabilities.push("UPDATE");
    }
    if (this.toInt(row?.["can_delete"]) === 1) {
      writeCapabilities.push("DELETE");
    }
    if (this.toInt(row?.["can_alter"]) === 1) {
      writeCapabilities.push("ALTER");
    }
    if (this.toInt(row?.["can_control"]) === 1) {
      writeCapabilities.push("CONTROL");
    }
    return {
      serverVersion: this.toStringValue(row?.["server_version"], "Unknown"),
      databaseName: this.toStringValue(row?.["database_name"], connection.database || "Unknown"),
      loginUser: this.toStringValue(row?.["login_user"], "Unknown"),
      isReadOnly: writeCapabilities.length === 0,
      writeCapabilities
    };
  }
  async query(payload) {
    if (!payload.query.trim()) {
      throw new Error("کوئری SQL خالی است.");
    }
    const pool = await this.getOrCreatePool(payload.connection);
    const request = pool.request();
    for (const parameter of payload.parameters ?? []) {
      request.input(this.normalizeParameterName(parameter.name), parameter.value);
    }
    const result = await request.query(payload.query);
    return this.toSqlQueryResult(result);
  }
  async executeReadOnlyQuery(connection, query, scope = "generic", signal, options) {
    const validatedQuery = this.validateReadOnlyQuery(query, scope, options);
    const pool = await this.getOrCreatePool(connection);
    if (options?.enforceReadOnlyLogin && (scope === "generic" || scope === "agent-data")) {
      await this.assertReadOnlyLogin(connection, pool);
    }
    const request = pool.request();
    const effectiveTimeoutMs = Math.min(
      Math.max(1e3, connection.requestTimeoutMs),
      MAX_READONLY_TIMEOUT_MS_BY_SCOPE[scope]
    );
    request.timeout = effectiveTimeoutMs;
    if (signal?.aborted) {
      throw this.createReadOnlyCancellationError(signal.reason);
    }
    const onAbort = () => {
      try {
        request.cancel?.();
      } catch {
      }
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    let result;
    try {
      result = await request.query(validatedQuery);
    } catch (error) {
      if (signal?.aborted) {
        throw this.createReadOnlyCancellationError(signal.reason);
      }
      throw this.mapReadOnlyExecutionError(error, effectiveTimeoutMs);
    } finally {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }
    if (!Array.isArray(result.recordset)) {
      return [];
    }
    return result.recordset.map((row) => {
      const serialized = this.toSerializable(row);
      return serialized ?? {};
    });
  }
  async close() {
    const pool = this.pool;
    const pending = this.connectPromise;
    this.pool = null;
    this.poolSignature = null;
    this.connectPromise = null;
    this.readonlyPermissionCache.clear();
    const resolvedPool = pending ? await pending.catch(() => null) : null;
    const poolToClose = pool ?? resolvedPool;
    if (poolToClose) {
      await poolToClose.close().catch(() => {
      });
    }
  }
  async getOrCreatePool(connection) {
    const signature = this.createSignature(connection);
    if (this.pool && this.poolSignature === signature && this.pool.connected) {
      return this.pool;
    }
    if (this.connectPromise && this.poolSignature === signature) {
      return this.connectPromise;
    }
    if (this.poolSignature && this.poolSignature !== signature) {
      await this.close();
    }
    const newPool = new mssql.ConnectionPool(this.createMssqlConfig(connection));
    this.poolSignature = signature;
    this.connectPromise = newPool.connect().then((connectedPool) => {
      this.pool = connectedPool;
      this.attachPoolListeners(connectedPool, signature);
      return connectedPool;
    }).catch(async (error) => {
      this.pool = null;
      this.poolSignature = null;
      await newPool.close().catch(() => {
      });
      throw error;
    }).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }
  createMssqlConfig(connection) {
    return {
      server: connection.server,
      database: connection.database,
      user: connection.user,
      password: connection.password,
      port: connection.port,
      options: {
        encrypt: connection.encrypt,
        trustServerCertificate: connection.trustServerCertificate
      },
      connectionTimeout: connection.connectionTimeoutMs,
      requestTimeout: connection.requestTimeoutMs,
      pool: {
        max: DEFAULT_POOL_MAX,
        min: DEFAULT_POOL_MIN,
        idleTimeoutMillis: DEFAULT_POOL_IDLE_TIMEOUT_MS
      }
    };
  }
  attachPoolListeners(pool, signature) {
    pool.on("error", (error) => {
      console.error("[SqlConnectionManager] Pool error:", error);
      if (this.poolSignature === signature) {
        this.pool = null;
        this.poolSignature = null;
      }
    });
  }
  normalizeParameterName(name) {
    return name.replace(/^@+/, "").trim();
  }
  toSqlQueryResult(result) {
    return {
      recordsetCount: result.recordsets.length,
      rowsAffected: result.rowsAffected,
      recordsets: this.serializeRecordsets(result.recordsets),
      output: this.toSerializable(result.output)
    };
  }
  serializeRecordsets(recordsets) {
    return recordsets.map((recordset) => {
      if (!Array.isArray(recordset)) {
        return [];
      }
      return recordset.map((row) => {
        const serializable = this.toSerializable(row);
        return serializable ?? {};
      });
    });
  }
  validateReadOnlyQuery(query, scope, options) {
    const trimmed = query.trim();
    if (options?.goldenFastPathMeta) {
      const fastPathResult = this.validateGoldenFastPathQuery(trimmed, options.goldenFastPathMeta);
      if (fastPathResult.reason === "scope-filter-missing") {
        throw new SqlPolicyViolationError(
          "SQL_POLICY_SCOPE_FILTER_MISSING",
          "read-only-policy",
          "Golden 5 query is missing the mandatory scope filter."
        );
      }
      if (fastPathResult.accepted) {
        return trimmed;
      }
    }
    if (!trimmed) {
      throw new SqlPolicyViolationError("SQL_POLICY_EMPTY_QUERY", "read-only-policy", "SQL query is empty.");
    }
    try {
      const ast = this.sqlParser.astify(trimmed, { database: "transactsql" });
      const astList = Array.isArray(ast) ? ast : [ast];
      if (astList.length > 1 && (scope === "generic" || scope === "agent-data")) {
        throw new SqlPolicyViolationError(
          "SQL_POLICY_MULTI_STATEMENT",
          "security-policy",
          "Multi-statement queries are not allowed for this operation."
        );
      }
      for (const statement of astList) {
        if (statement.type !== "select") {
          throw new SqlPolicyViolationError(
            "SQL_POLICY_NOT_SELECT",
            "security-policy",
            `Invalid statement type: ${statement.type}. Only SELECT is allowed.`
          );
        }
      }
    } catch (error) {
      if (error instanceof SqlPolicyViolationError) throw error;
      console.warn("[SqlConnectionManager] SQL AST parsing failed, falling back to regex:", error);
    }
    const normalized = this.stripSqlCommentsAndLiterals(trimmed).replace(/\s+/g, " ").trim();
    if (!normalized) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_EMPTY_QUERY",
        "read-only-policy",
        "SQL query is empty after normalization."
      );
    }
    const upper = normalized.toUpperCase();
    if (!(upper.startsWith("SELECT ") || upper.startsWith("SELECT\n") || upper === "SELECT" || upper.startsWith("WITH "))) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_NOT_SELECT",
        "read-only-policy",
        "Only read-only SELECT queries are allowed."
      );
    }
    if (FORBIDDEN_SQL_KEYWORDS.test(upper)) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_FORBIDDEN_KEYWORD",
        "security-policy",
        "Query contains forbidden SQL keyword. Only read-only SELECT is allowed."
      );
    }
    if (FORBIDDEN_SYSTEM_PROC_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_FORBIDDEN_SYSTEM_PROC",
        "security-policy",
        "System procedures (xp_*/sp_*) are not allowed."
      );
    }
    if (FORBIDDEN_TESSERACT_NESTING.test(upper)) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_FORBIDDEN_BATCH_COMMAND",
        "security-policy",
        "Batch commands (GO/DECLARE/SET) are not allowed."
      );
    }
    if ((options?.blockQueryHints ?? true) && FORBIDDEN_QUERY_HINT_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_FORBIDDEN_HINT",
        "security-policy",
        "Query hints are not allowed in read-only mode."
      );
    }
    if (FORBIDDEN_EXPORT_CLAUSE_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_FORBIDDEN_EXPORT_CLAUSE",
        "security-policy",
        "FOR JSON/FOR XML clauses are not allowed in read-only mode."
      );
    }
    if (FORBIDDEN_EXTERNAL_DATA_ACCESS_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_EXTERNAL_DATA_ACCESS",
        "security-policy",
        "External data source functions (OPENROWSET/OPENQUERY/OPENDATASOURCE) are not allowed."
      );
    }
    if (scope === "agent-data" && SENSITIVE_METADATA_ACCESS_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_METADATA_SCOPE_BLOCK",
        "security-policy",
        "Agent data queries cannot access SQL Server metadata schemas or system tables."
      );
    }
    if (FORBIDDEN_SYSTEM_PROC_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_FORBIDDEN_SYSTEM_PROC",
        "security-policy",
        "System procedures (xp_*/sp_*) are not allowed."
      );
    }
    if (FORBIDDEN_TESSERACT_NESTING.test(upper)) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_FORBIDDEN_BATCH_COMMAND",
        "security-policy",
        "Batch commands (GO/DECLARE/SET) are not allowed."
      );
    }
    if ((options?.forbidWildcardSelect ?? true) && scope === "agent-data" && WILDCARD_SELECT_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_WILDCARD_SELECT_BLOCKED",
        "security-policy",
        "Wildcard SELECT (*) is not allowed for agent data queries."
      );
    }
    if (/\bSELECT\b[\s\S]*\bINTO\b/i.test(upper)) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_SELECT_INTO",
        "security-policy",
        "SELECT INTO is not allowed in read-only mode."
      );
    }
    const semicolonClean = upper.replace(/;+\s*$/, "");
    if (semicolonClean.includes(";")) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_MULTI_STATEMENT",
        "security-policy",
        "Multiple SQL statements are not allowed in executeQuery."
      );
    }
    const isAggregatedQuery = AGGREGATION_SQL_PATTERN.test(upper);
    const hasResultLimit = RESULT_LIMIT_SQL_PATTERN.test(upper);
    const numericResultLimit = this.extractNumericResultLimit(upper);
    const hasOrderBy = ORDER_BY_SQL_PATTERN.test(upper);
    if (!isAggregatedQuery && !hasResultLimit) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_REQUIRE_RESULT_LIMIT",
        "read-only-policy",
        "Non-aggregated SELECT queries must include TOP or pagination (OFFSET/FETCH)."
      );
    }
    if (!isAggregatedQuery && hasResultLimit && numericResultLimit === null) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_NON_NUMERIC_LIMIT",
        "read-only-policy",
        "Result limit must be a numeric literal in TOP(...) or FETCH NEXT ... ROWS ONLY."
      );
    }
    if ((options?.requireOrderByWhenLimited ?? true) && (scope === "generic" || scope === "agent-data") && !isAggregatedQuery && hasResultLimit && !hasOrderBy) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_REQUIRE_ORDER_BY_FOR_LIMITED_QUERY",
        "read-only-policy",
        "Limited non-aggregated queries must include ORDER BY for deterministic results."
      );
    }
    if (numericResultLimit !== null && numericResultLimit < 1) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_INVALID_LIMIT",
        "read-only-policy",
        "Result limit must be greater than zero."
      );
    }
    const maxRows = MAX_READONLY_ROWS_BY_SCOPE[scope];
    if (numericResultLimit !== null && numericResultLimit > maxRows) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_SCOPE_LIMIT_EXCEEDED",
        "read-only-policy",
        `Result limit exceeds maximum allowed rows for this query scope (${maxRows}).`
      );
    }
    return trimmed;
  }
  validateGoldenFastPathQuery(query, meta) {
    const normalized = this.stripSqlCommentsAndLiterals(query).replace(/\s+/g, " ").trim();
    const commentsOnly = query.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ").replace(/\s+/g, " ").trim();
    if (!/^SELECT\b/i.test(normalized)) {
      return { accepted: false };
    }
    if (normalized.includes(";")) {
      return { accepted: false };
    }
    if (/\b(INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|DENY|INTO|UNION|PIVOT|UNPIVOT|OVER|ROW_NUMBER|DENSE_RANK|RANK)\b/i.test(normalized)) {
      return { accepted: false };
    }
    const fromMatch = normalized.match(/\bFROM\b\s+([A-Za-z_][\w\.]*)/i);
    const tables = fromMatch ? [fromMatch[1].split(".").pop() ?? fromMatch[1]] : [];
    if (tables.some((table) => !meta.targetTables.includes(table))) {
      return { accepted: false };
    }
    const hasScopeFilter = meta.requiredScopeFilters.some((filter) => {
      const scopePattern = new RegExp(`\\bWHERE\\b[\\s\\S]*?\\b${filter}\\b\\s*(?:=|<>|!=|>=|<=|>|<)`, "i");
      return scopePattern.test(commentsOnly);
    });
    if (!hasScopeFilter) {
      return { accepted: true, reason: "scope-filter-missing" };
    }
    return { accepted: true };
  }
  extractNumericResultLimit(sql) {
    const limits = [];
    const topWithParenthesesPattern = /\bTOP\s*\(\s*(\d+)\s*\)/gi;
    const topSimplePattern = /\bTOP\s+(\d+)\b/gi;
    const fetchNextPattern = /\bFETCH\s+NEXT\s+(\d+)\s+ROWS?\s+ONLY\b/gi;
    for (const pattern of [topWithParenthesesPattern, topSimplePattern, fetchNextPattern]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(sql)) !== null) {
        const parsed = Number.parseInt(match[1], 10);
        if (Number.isFinite(parsed)) {
          limits.push(parsed);
        }
      }
    }
    if (limits.length === 0) {
      return null;
    }
    return Math.min(...limits);
  }
  async assertReadOnlyLogin(connection, pool) {
    const signature = this.createSignature(connection);
    const cached = this.readonlyPermissionCache.get(signature);
    if (cached && Date.now() - cached.checkedAt <= READONLY_LOGIN_CACHE_TTL_MS) {
      if (!cached.isReadOnly) {
        throw new SqlPolicyViolationError(
          "SQL_POLICY_REQUIRE_READONLY_LOGIN",
          "security-policy",
          `Configured SQL login has write capabilities (${cached.writeCapabilities.join(", ") || "UNKNOWN"}). Use a read-only SQL login.`
        );
      }
      return;
    }
    const healthCheck = await this.getHealthCheckFromPool(pool, connection);
    this.updateReadOnlyCache(connection, healthCheck);
    if (!healthCheck.isReadOnly) {
      throw new SqlPolicyViolationError(
        "SQL_POLICY_REQUIRE_READONLY_LOGIN",
        "security-policy",
        `Configured SQL login has write capabilities (${healthCheck.writeCapabilities.join(", ") || "UNKNOWN"}). Use a read-only SQL login.`
      );
    }
  }
  updateReadOnlyCache(connection, healthCheck) {
    this.readonlyPermissionCache.set(this.createSignature(connection), {
      checkedAt: Date.now(),
      isReadOnly: healthCheck.isReadOnly,
      writeCapabilities: [...healthCheck.writeCapabilities]
    });
  }
  mapReadOnlyExecutionError(error, timeoutMs) {
    if (!(error instanceof Error)) {
      return new Error(String(error));
    }
    const typedError = error;
    const errorCode = typeof typedError.code === "string" ? typedError.code.toUpperCase() : "";
    const errorMessage = typedError.message.toLowerCase();
    if (errorCode === "ETIMEOUT" || errorMessage.includes("timeout") || errorMessage.includes("timed out")) {
      return new SqlPolicyViolationError(
        "SQL_POLICY_QUERY_TIMEOUT",
        "read-only-policy",
        `SQL query exceeded the maximum execution time (${timeoutMs} ms).`
      );
    }
    return error;
  }
  createReadOnlyCancellationError(reason) {
    const reasonText = typeof reason === "string" && reason.trim() ? reason.trim() : reason instanceof Error && reason.message.trim() ? reason.message.trim() : "Request canceled by user.";
    const error = new Error(reasonText);
    error.name = "AbortError";
    error.code = "AGENT_REQUEST_CANCELLED";
    error.category = "orchestration-control";
    return error;
  }
  stripSqlCommentsAndLiterals(sql) {
    return sql.replace(/--.*$/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/N?'(?:''|[^'])*'/g, "''").replace(/"(?:""|[^"])*"/g, '""');
  }
  toSerializable(value) {
    if (value === null || value === void 0) {
      return value;
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (Buffer.isBuffer(value)) {
      return value.toString("base64");
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.toSerializable(item));
    }
    if (typeof value === "object") {
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] = this.toSerializable(item);
      }
      return result;
    }
    return value;
  }
  withDatabase(connection, fallbackDatabase) {
    const database = connection.database.trim() || fallbackDatabase;
    return {
      ...connection,
      database
    };
  }
  toInt(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === "bigint") {
      return Number(value);
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }
  toStringValue(value, fallback) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" || typeof value === "bigint") {
      return String(value);
    }
    return fallback;
  }
  createSignature(connection) {
    return [
      connection.server,
      connection.database,
      connection.user,
      connection.password,
      connection.port,
      connection.encrypt,
      connection.trustServerCertificate,
      connection.connectionTimeoutMs,
      connection.requestTimeoutMs
    ].join("|");
  }
}
async function resolveDeterministicFinancialTool(deps, deterministicIntent, settings, conversationMemory, signal, onProgress, prompt) {
  const activeCatalog = deps.findActiveSchemaCatalog(settings);
  const hardcodedMappings = {
    get_purchase_summary: { tableRef: "INV.InventoryReceipt", columnName: "TotalPrice" },
    get_account_balance: { tableRef: "ACC.VoucherItem", columnName: "Debit,Credit" },
    get_party_balance: { tableRef: "ACC.VoucherItem", columnName: "Debit,Credit" },
    get_cashflow_summary: { tableRef: "RPA.CashBalance", columnName: "Balance" },
    get_receivables_summary: { tableRef: "ACC.VoucherItem", columnName: "Debit" },
    get_payables_summary: { tableRef: "ACC.VoucherItem", columnName: "Credit" },
    get_cash_bank_balance: { tableRef: "RPA.CashBalance", columnName: "Balance" },
    get_trial_balance: { tableRef: "ACC.VoucherItem", columnName: "Debit" }
  };
  let mapping = null;
  if (activeCatalog) {
    const conceptKey = deterministicIntent === "get_account_balance" ? "accounts" : deterministicIntent === "get_party_balance" ? "counterparties" : deterministicIntent === "get_cashflow_summary" ? "cashTransactions" : deterministicIntent === "get_purchase_summary" ? "documents" : deterministicIntent === "get_receivables_summary" || deterministicIntent === "get_payables_summary" ? "documents" : "documents";
    mapping = deps.resolvePreferredMapping(activeCatalog, conceptKey);
  } else {
    const hardcoded = hardcodedMappings[deterministicIntent];
    if (hardcoded) {
      mapping = { tableRef: hardcoded.tableRef, source: "hardcoded" };
    }
  }
  if (!mapping) {
    return null;
  }
  const tableRef = deps.parseSqlTableReference(mapping.tableRef);
  if (!tableRef?.schemaName || !tableRef.tableName) {
    return null;
  }
  const schemaName = tableRef.schemaName.trim().toLowerCase();
  const tableName = tableRef.tableName.trim().toLowerCase();
  let column = null;
  if (activeCatalog) {
    const catalogTable = activeCatalog.tables.find((entry) => {
      return entry.schemaName.trim().toLowerCase() === schemaName && entry.tableName.trim().toLowerCase() === tableName;
    });
    const candidateColumns = (catalogTable?.columns ?? []).filter((col) => {
      const columnName = col.name.toLowerCase();
      const dataType = col.dataType.toLowerCase();
      return /(?:amount|balance|debit|credit|total|sum|net|value)/iu.test(columnName) && /(?:int|decimal|numeric|money|float|real)/iu.test(dataType);
    });
    column = selectDeterministicToolColumn(deterministicIntent, candidateColumns) ?? catalogTable?.columns[0] ?? null;
  } else {
    const hardcoded = hardcodedMappings[deterministicIntent];
    if (hardcoded) {
      const columnNames = hardcoded.columnName.split(",");
      column = { name: columnNames[0].trim(), dataType: "decimal" };
    }
  }
  if (!column) {
    return null;
  }
  const schemaIdentifier = deps.quoteSqlIdentifier(schemaName);
  const tableIdentifier = deps.quoteSqlIdentifier(tableName);
  const columnIdentifier = deps.quoteSqlIdentifier(column.name);
  let query;
  let actualTableRef = mapping.tableRef;
  let actualColumnName = column.name;
  let toolCallsUsed = 1;
  if (deterministicIntent === "get_purchase_summary") {
    const pomSchema = deps.quoteSqlIdentifier("POM");
    const pomTable = deps.quoteSqlIdentifier("PurchaseInvoice");
    const countQuery = `SELECT COUNT(*) AS row_count FROM ${pomSchema}.${pomTable}`;
    try {
      const countRows = await deps.executeReadOnlySql(countQuery, signal);
      const rowCount = Number(countRows[0]?.["row_count"]) || 0;
      if (rowCount > 0) {
        const primaryQuery = `SELECT SUM(CAST(${columnIdentifier} AS decimal(18,2))) AS result_value FROM ${schemaIdentifier}.${tableIdentifier}`;
        const primaryRows = await deps.executeReadOnlySql(primaryQuery, signal);
        const primaryValue = deps.toOptionalFiniteInteger(primaryRows[0]?.["result_value"]);
        if (primaryValue !== null && primaryValue > 0) {
          query = primaryQuery;
          const value = primaryValue;
          toolCallsUsed = 2;
          deps.rememberToolTrace(
            conversationMemory,
            `tool:${deterministicIntent} table=${actualTableRef} column=${actualColumnName} value=${value} source=pom_purchase_invoice`
          );
          deps.emitProgress(onProgress, {
            type: "tool-success",
            message: `✅ ابزار ${deterministicIntent} اجرا شد: ${value} در ${actualTableRef}.${actualColumnName}`,
            toolName: deterministicIntent,
            rowCount: 1
          });
          return {
            intentId: deterministicIntent,
            value,
            tableRef: actualTableRef,
            columnName: actualColumnName,
            query,
            toolCallsUsed
          };
        }
      }
      const invSchema = deps.quoteSqlIdentifier("INV");
      const invTable = deps.quoteSqlIdentifier("InventoryReceipt");
      const invColumn = deps.quoteSqlIdentifier("TotalPrice");
      const fallbackQuery = `SELECT SUM(CAST(${invColumn} AS decimal(18,2))) AS result_value FROM ${invSchema}.${invTable} WHERE IsReturn = 0`;
      const fallbackRows = await deps.executeReadOnlySql(fallbackQuery, signal);
      const fallbackValue = deps.toOptionalFiniteInteger(fallbackRows[0]?.["result_value"]);
      if (fallbackValue !== null && fallbackValue > 0) {
        query = fallbackQuery;
        actualTableRef = "INV.InventoryReceipt";
        actualColumnName = "TotalPrice";
        toolCallsUsed = rowCount > 0 ? 3 : 2;
        deps.rememberToolTrace(
          conversationMemory,
          `tool:${deterministicIntent} table=${actualTableRef} column=${actualColumnName} value=${fallbackValue} source=inventory_receipt_fallback`
        );
        deps.emitProgress(onProgress, {
          type: "tool-success",
          message: `✅ ابزار ${deterministicIntent} اجرا شد: ${fallbackValue} در ${actualTableRef}.${actualColumnName} (fallback)`,
          toolName: deterministicIntent,
          rowCount: 1
        });
        return {
          intentId: deterministicIntent,
          value: fallbackValue,
          tableRef: actualTableRef,
          columnName: actualColumnName,
          query,
          toolCallsUsed
        };
      }
      return null;
    } catch (error) {
      await deps.safeAuditWrite({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        requestId: conversationMemory.conversationId,
        stage: "tool-error",
        toolName: deterministicIntent,
        error: error instanceof Error ? error.message : String(error),
        errorCategory: "deterministic-tool-failure"
      });
      return null;
    }
  }
  if (deterministicIntent === "get_account_balance") {
    const debitColumn = deps.quoteSqlIdentifier("Debit");
    const creditColumn = deps.quoteSqlIdentifier("Credit");
    const voucherTable = deps.quoteSqlTableRef("ACC.Voucher");
    const voucherItemTable = deps.quoteSqlTableRef("ACC.VoucherItem");
    const fiscalYearTable = deps.quoteSqlTableRef("FMK.FiscalYear");
    const accountTable = deps.quoteSqlTableRef("ACC.Account");
    const accountNameMatch = prompt?.match(/(?:حساب|سرفصل)\s*([^\s]+)/iu);
    const accountName = accountNameMatch ? normalizePersianText(accountNameMatch[1]) : null;
    const accountNameSql = accountName ? accountName.replace(/'/g, "''") : null;
    const normalizedTitleExpr = "REPLACE(REPLACE(REPLACE(a.Title, NCHAR(1610), NCHAR(1740)), NCHAR(1609), NCHAR(1740)), NCHAR(1603), NCHAR(1705))";
    const normalizedPrompt = normalizePersianDigits(prompt || "");
    const fiscalYearMatch = normalizedPrompt.match(/(?:سال|سال\s+)?(\d{4})/iu);
    const fiscalYear = fiscalYearMatch ? fiscalYearMatch[1] : null;
    let whereClause = "";
    if (fiscalYear) {
      whereClause = ` AND fy.Title = N'${fiscalYear}'`;
    }
    whereClause += " AND v.Type NOT IN (3, 4)";
    if (accountName) {
      whereClause += ` AND ${normalizedTitleExpr} LIKE N'%${accountNameSql}%'`;
      query = `SELECT SUM(CAST(vi.${debitColumn} AS decimal(18,2))) - SUM(CAST(vi.${creditColumn} AS decimal(18,2))) AS result_value
                 FROM ${voucherItemTable} vi
                 JOIN ${voucherTable} v ON vi.VoucherRef = v.VoucherId
                 JOIN ${accountTable} a ON vi.AccountSLRef = a.AccountId
                 JOIN ${fiscalYearTable} fy ON v.FiscalYearRef = fy.FiscalYearId
                 WHERE 1=1${whereClause}`;
    } else {
      query = `SELECT SUM(CAST(vi.${debitColumn} AS decimal(18,2))) - SUM(CAST(vi.${creditColumn} AS decimal(18,2))) AS result_value
                 FROM ${voucherItemTable} vi
                 JOIN ${voucherTable} v ON vi.VoucherRef = v.VoucherId
                 JOIN ${fiscalYearTable} fy ON v.FiscalYearRef = fy.FiscalYearId
                 WHERE 1=1${whereClause}`;
    }
    try {
      const rows = await deps.executeReadOnlySql(query, signal);
      const row = rows[0];
      const value = deps.toOptionalFiniteInteger(row?.["result_value"]);
      if (value === null) {
        return null;
      }
      deps.rememberToolTrace(
        conversationMemory,
        `tool:${deterministicIntent} table=ACC.VoucherItem column=Debit,Credit value=${value}${accountName ? ` account=${accountName}` : ""}`
      );
      deps.emitProgress(onProgress, {
        type: "tool-success",
        message: `✅ ابزار ${deterministicIntent} اجرا شد: ${value} در ACC.VoucherItem (Debit-Credit)${accountName ? ` برای حساب ${accountName}` : ""}`,
        toolName: deterministicIntent,
        rowCount: 1
      });
      return {
        intentId: deterministicIntent,
        value,
        tableRef: "ACC.VoucherItem",
        columnName: "Debit,Credit",
        query,
        toolCallsUsed
      };
    } catch (error) {
      await deps.safeAuditWrite({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        requestId: conversationMemory.conversationId,
        stage: "tool-error",
        toolName: deterministicIntent,
        error: error instanceof Error ? error.message : String(error),
        errorCategory: "deterministic-tool-failure"
      });
      return null;
    }
  }
  if (deterministicIntent === "get_trial_balance") {
    const debitColumn = deps.quoteSqlIdentifier("Debit");
    const creditColumn = deps.quoteSqlIdentifier("Credit");
    const accountTable = deps.quoteSqlTableRef("ACC.Account");
    const voucherTable = deps.quoteSqlTableRef("ACC.Voucher");
    const voucherItemTable = deps.quoteSqlTableRef("ACC.VoucherItem");
    const fiscalYearTable = deps.quoteSqlTableRef("FMK.FiscalYear");
    const fiscalYearMatch = prompt?.match(/(?:سال|سال\s+)?(\d{4})/iu);
    const fiscalYear = fiscalYearMatch ? fiscalYearMatch[1] : null;
    let whereClause = "";
    if (fiscalYear) {
      whereClause = ` AND fy.Title = N'${fiscalYear}'`;
    }
    query = `SELECT TOP (200) a.Title AS AccountTitle,
               SUM(CAST(vi.${debitColumn} AS decimal(18,2))) AS TotalDebit,
               SUM(CAST(vi.${creditColumn} AS decimal(18,2))) AS TotalCredit
               FROM ${voucherItemTable} vi
               JOIN ${voucherTable} v ON vi.VoucherRef = v.VoucherId
               JOIN ${accountTable} a ON vi.AccountSLRef = a.AccountId
               JOIN ${fiscalYearTable} fy ON v.FiscalYearRef = fy.FiscalYearId
               WHERE 1=1${whereClause}
               GROUP BY a.Title`;
    try {
      const rows = await deps.executeReadOnlySql(query, signal);
      if (rows.length === 0) {
        return null;
      }
      const totalDebit = rows.reduce((sum, row) => sum + (Number(row["TotalDebit"]) || 0), 0);
      const totalCredit = rows.reduce((sum, row) => sum + (Number(row["TotalCredit"]) || 0), 0);
      const value = totalDebit;
      deps.rememberToolTrace(
        conversationMemory,
        `tool:${deterministicIntent} table=ACC.VoucherItem column=Debit,Credit rows=${rows.length} totalDebit=${totalDebit} totalCredit=${totalCredit}`
      );
      deps.emitProgress(onProgress, {
        type: "tool-success",
        message: `✅ ابزار ${deterministicIntent} اجرا شد: ${rows.length} حساب، بدهکار=${totalDebit}، بستانکار=${totalCredit}`,
        toolName: deterministicIntent,
        rowCount: rows.length
      });
      return {
        intentId: deterministicIntent,
        value,
        tableRef: "ACC.VoucherItem",
        columnName: "Debit,Credit",
        query,
        toolCallsUsed
      };
    } catch (error) {
      await deps.safeAuditWrite({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        requestId: conversationMemory.conversationId,
        stage: "tool-error",
        toolName: deterministicIntent,
        error: error instanceof Error ? error.message : String(error),
        errorCategory: "deterministic-tool-failure"
      });
      return null;
    }
  }
  if (deterministicIntent === "get_cash_bank_balance") {
    const cashTable = deps.quoteSqlTableRef("RPA.CashBalance");
    const bankTable = deps.quoteSqlTableRef("RPA.BankAccountBalance");
    const balanceColumn = deps.quoteSqlIdentifier("Balance");
    const cashQuery = `SELECT SUM(CAST(${balanceColumn} AS decimal(18,2))) AS result_value FROM ${cashTable}`;
    const bankQuery = `SELECT SUM(CAST(${balanceColumn} AS decimal(18,2))) AS result_value FROM ${bankTable}`;
    try {
      const cashRows = await deps.executeReadOnlySql(cashQuery, signal);
      const bankRows = await deps.executeReadOnlySql(bankQuery, signal);
      const cashValue = deps.toOptionalFiniteInteger(cashRows[0]?.["result_value"]) || 0;
      const bankValue = deps.toOptionalFiniteInteger(bankRows[0]?.["result_value"]) || 0;
      const totalValue = cashValue + bankValue;
      if (totalValue === 0) {
        return null;
      }
      query = `${cashQuery}; ${bankQuery}`;
      toolCallsUsed = 2;
      deps.rememberToolTrace(
        conversationMemory,
        `tool:${deterministicIntent} cash=${cashValue} bank=${bankValue} total=${totalValue}`
      );
      deps.emitProgress(onProgress, {
        type: "tool-success",
        message: `✅ ابزار ${deterministicIntent} اجرا شد: نقد=${cashValue}، بانک=${bankValue}، مجموع=${totalValue}`,
        toolName: deterministicIntent,
        rowCount: 2
      });
      return {
        intentId: deterministicIntent,
        value: totalValue,
        tableRef: "RPA.CashBalance,RPA.BankAccountBalance",
        columnName: "Balance",
        query,
        toolCallsUsed
      };
    } catch (error) {
      await deps.safeAuditWrite({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        requestId: conversationMemory.conversationId,
        stage: "tool-error",
        toolName: deterministicIntent,
        error: error instanceof Error ? error.message : String(error),
        errorCategory: "deterministic-tool-failure"
      });
      return null;
    }
  }
  query = `SELECT SUM(CAST(${columnIdentifier} AS decimal(18,2))) AS result_value FROM ${schemaIdentifier}.${tableIdentifier}`;
  try {
    const rows = await deps.executeReadOnlySql(query, signal);
    const row = rows[0];
    const value = deps.toOptionalFiniteInteger(row?.["result_value"]);
    if (value === null) {
      return null;
    }
    deps.rememberToolTrace(
      conversationMemory,
      `tool:${deterministicIntent} table=${mapping.tableRef} column=${column.name} value=${value}`
    );
    deps.emitProgress(onProgress, {
      type: "tool-success",
      message: `✅ ابزار ${deterministicIntent} اجرا شد: ${value} در ${mapping.tableRef}.${column.name}`,
      toolName: deterministicIntent,
      rowCount: 1
    });
    return {
      intentId: deterministicIntent,
      value,
      tableRef: mapping.tableRef,
      columnName: column.name,
      query,
      toolCallsUsed
    };
  } catch (error) {
    await deps.safeAuditWrite({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      requestId: conversationMemory.conversationId,
      stage: "tool-error",
      toolName: deterministicIntent,
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "deterministic-tool-failure"
    });
    return null;
  }
}
function selectDeterministicToolColumn(deterministicIntent, candidateColumns) {
  if (candidateColumns.length === 0) {
    return null;
  }
  const intentSpecificOrder = buildDeterministicToolColumnPreference(deterministicIntent);
  if (intentSpecificOrder.length === 0) {
    return candidateColumns[0] ?? null;
  }
  const normalizedCandidates = candidateColumns.map((column) => ({
    column,
    name: column.name.toLowerCase()
  }));
  for (const preferredPattern of intentSpecificOrder) {
    const match = normalizedCandidates.find((entry) => preferredPattern.test(entry.name));
    if (match) {
      return match.column;
    }
  }
  return candidateColumns[0] ?? null;
}
function buildDeterministicToolColumnPreference(deterministicIntent) {
  switch (deterministicIntent) {
    case "get_receivables_summary":
      return [/credit_amount|receivable|debt|bedehkar|debtor/i, /amount|balance|total/i];
    case "get_payables_summary":
      return [/debit_amount|payable|bedehkar|creditor|bastankar/i, /amount|balance|total/i];
    case "get_cashflow_summary":
      return [/cash_amount|cash|flow|jaryan/i, /amount|balance|total/i];
    case "get_account_balance":
    case "get_party_balance":
    default:
      return [/balance|amount|total|sum|net|value/i];
  }
}
function appearsToContainFinancialClaim(text) {
  const normalized = normalizePersianDigits(text);
  const strongFinancialSignal = /(?:total|amount|balance|sales|revenue|cash\s*flow|receivable|payable|debit|credit|موجودی|مانده|مبلغ|فروش|درآمد|دریافت|پرداخت|جمع|گردش|بدهکار|بستانکار|account|جریان\s*نقد|حساب|ledger|voucher|invoice)/iu.test(
    normalized
  );
  const fiscalYearSignal = /(?:سال\s*مالی|fiscal\s*year|financial\s*year)/iu.test(normalized) && /(?:چند|تعداد|لیست|فهرست|کدام|وجود|قرار|دارد|count|list|year)/iu.test(normalized);
  return strongFinancialSignal || fiscalYearSignal;
}
function isComparativeMultiPeriodPrompt(prompt) {
  const normalizedPrompt = normalizePersianText(prompt);
  const years = normalizedPrompt.match(/\b(?:13|14|19|20)\d{2}\b/g) ?? [];
  const uniqueYears = new Set(years);
  if (uniqueYears.size < 2) {
    return false;
  }
  const hasComparativeKeyword = /(?:نسبت\s*به|در\s*مقابل|مقایسه|قیاس|رشد|کاهش|افزایش|افت|change|growth|decline|versus|\bvs\.?\b|year\s*over\s*year|yoy)/iu.test(
    normalizedPrompt
  );
  const hasFinancialContext = appearsToContainFinancialClaim(normalizedPrompt) || /(?:خرید|purchase|sales|درآمد|revenue)/iu.test(normalizedPrompt);
  return hasComparativeKeyword && hasFinancialContext;
}
function isSalesGrowthPercentPrompt(prompt) {
  const normalizedPrompt = normalizePersianText(prompt);
  const hasSalesSignal = /(?:فروش|sales|revenue)/iu.test(normalizedPrompt);
  const hasPercentSignal = /(?:درصد|percent|percentage|%)/iu.test(normalizedPrompt);
  const hasChangeSignal = /(?:رشد|کاهش|افزایش|افت|change|growth|decline|نسبت\s*به|مقایسه)/iu.test(
    normalizedPrompt
  );
  const yearMatches = normalizedPrompt.match(/\b(?:13|14|19|20)\d{2}\b/g) ?? [];
  const isComparativeMultiPeriod = isComparativeMultiPeriodPrompt(prompt);
  return hasSalesSignal && hasPercentSignal && hasChangeSignal && yearMatches.length >= 2 || isComparativeMultiPeriod && hasSalesSignal && yearMatches.length >= 2;
}
function extractYearComparison(prompt) {
  const normalizedPrompt = normalizePersianText(prompt);
  const explicitMatch = normalizedPrompt.match(
    /\b((?:13|14|19|20)\d{2})\b.{0,40}?نسبت\s*به.{0,40}?\b((?:13|14|19|20)\d{2})\b/iu
  );
  if (explicitMatch) {
    return {
      targetYear: Number(explicitMatch[1]),
      baseYear: Number(explicitMatch[2])
    };
  }
  const years = (normalizedPrompt.match(/\b(?:13|14|19|20)\d{2}\b/g) ?? []).map(
    (item) => Number(item)
  );
  const uniqueYears = Array.from(new Set(years));
  if (uniqueYears.length < 2) {
    return null;
  }
  uniqueYears.sort((a, b) => a - b);
  return {
    targetYear: uniqueYears[uniqueYears.length - 1],
    baseYear: uniqueYears[uniqueYears.length - 2]
  };
}
function selectSalesGrowthSourceTable(deps, activeCatalog) {
  if (activeCatalog) {
    const preferredConcepts = ["documentLines", "documents", "accounts"];
    const preferredMappings = preferredConcepts.map((conceptKey) => deps.resolvePreferredMapping(activeCatalog, conceptKey)).filter((mapping) => Boolean(mapping));
    const catalogMappings = activeCatalog.tables.filter((table) => table.tags.length > 0).map((table) => ({
      tableRef: deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`),
      source: "suggested"
    })).filter((mapping) => Boolean(mapping.tableRef));
    const tableCandidates = [...preferredMappings, ...catalogMappings];
    const seen = /* @__PURE__ */ new Set();
    for (const candidate of tableCandidates) {
      const normalizedRef = deps.normalizeTableRef(candidate.tableRef);
      if (!normalizedRef || seen.has(normalizedRef)) {
        continue;
      }
      seen.add(normalizedRef);
      const table = activeCatalog.tables.find((entry) => {
        return deps.normalizeTableRef(`${entry.schemaName}.${entry.tableName}`) === normalizedRef;
      });
      if (!table) {
        continue;
      }
      const yearColumn = table.columns.find(
        (column) => /(?:fiscal|year|period|سال|مالی|دوره)/iu.test(column.name)
      )?.name;
      const amountColumn = table.columns.find(
        (column) => /(?:amount|price|netprice|gross|revenue|total|sale|sum)/iu.test(column.name)
      )?.name;
      if (yearColumn && amountColumn) {
        return {
          tableRef: deps.quoteSqlTableRef(normalizedRef),
          yearRefColumn: yearColumn,
          amountColumn
        };
      }
    }
  }
  return {
    tableRef: deps.quoteSqlTableRef("SLS.Invoice"),
    yearRefColumn: "FiscalYearRef",
    amountColumn: "NetPriceInBaseCurrency"
  };
}
function composeSalesGrowthFallbackMarkdown(deps, result) {
  const direction = result.percentChange == null ? "نامشخص" : result.percentChange > 0 ? "رشد" : result.percentChange < 0 ? "کاهش" : "بدون تغییر";
  const signedPercent = result.percentChange == null ? "N/A" : `${result.percentChange >= 0 ? "+" : ""}${result.percentChange.toFixed(2)}%`;
  const assumptionsLine = result.percentChange == null ? "- فروش سال مبنا صفر یا ناموجود بوده است؛ درصد تغییر قابل محاسبه نیست." : "- درصد تغییر طبق فرمول ((فروش سال هدف - فروش سال مبنا) / فروش سال مبنا) * 100 محاسبه شد.";
  return [
    "### Summary",
    `فروش سال ${result.targetYear} نسبت به ${result.baseYear}: ${signedPercent} (${direction}) (نوع KPI: فروش سالانه)`,
    "",
    "### Findings",
    "- مسیر پاسخ: deterministic",
    `- فروش سال ${result.baseYear}: ${result.salesBase.toLocaleString("en-US")}`,
    `- فروش سال ${result.targetYear}: ${result.salesTarget.toLocaleString("en-US")}`,
    `- درصد تغییر: ${signedPercent}`,
    "",
    "### Evidence",
    "- منبع داده: ابزار fetch_financial_data با تجمیع جدول مالی انتخاب‌شده از catalog و ستون‌های سال/مبلغ",
    `- سال های مقایسه: ${result.baseYear} و ${result.targetYear}`,
    `- SQL: ${deps.compactText(result.query.replace(/\s+/g, " "), 220)}`,
    "",
    "### Assumptions",
    assumptionsLine,
    "",
    "### Actions",
    "- در صورت نیاز، همین مقایسه را به تفکیک ماه/شعبه/شرکت هم می‌توانم ارائه کنم.",
    "- اگر تعریف فروش (مثلا NetPrice vs GrossPrice) باید تغییر کند، اعلام کنید تا کوئری اصلاح شود."
  ].join("\n");
}
async function tryResolveSalesGrowthPercentFallback(deps, prompt, settings, conversationMemory, signal) {
  const yearComparison = extractYearComparison(prompt);
  if (!yearComparison) {
    return null;
  }
  const baseYear = yearComparison.baseYear;
  const targetYear = yearComparison.targetYear;
  if (!Number.isFinite(baseYear) || !Number.isFinite(targetYear)) {
    return null;
  }
  const activeCatalog = deps.findActiveSchemaCatalog(settings);
  const salesSource = selectSalesGrowthSourceTable(deps, activeCatalog);
  const fiscalYearTable = deps.quoteSqlTableRef("FMK.FiscalYear");
  const sqlQuery = `WITH yearly_sales AS (
  SELECT
    fy.Title AS FiscalYearTitle,
    SUM(CAST(src.${salesSource.amountColumn} AS decimal(18, 4))) AS TotalSales
  FROM ${salesSource.tableRef} src
  JOIN ${fiscalYearTable} fy ON src.${salesSource.yearRefColumn} = fy.FiscalYearId
  WHERE fy.Title IN (N'${baseYear}', N'${targetYear}')
  GROUP BY fy.Title
),
pivoted AS (
  SELECT
    MAX(CASE WHEN FiscalYearTitle = N'${baseYear}' THEN TotalSales END) AS SalesBase,
    MAX(CASE WHEN FiscalYearTitle = N'${targetYear}' THEN TotalSales END) AS SalesTarget
  FROM yearly_sales
)
SELECT
  ISNULL(SalesBase, 0) AS SalesBase,
  ISNULL(SalesTarget, 0) AS SalesTarget,
  CASE
    WHEN SalesBase IS NULL OR SalesBase = 0 THEN NULL
    ELSE CAST(((SalesTarget - SalesBase) * 100.0 / SalesBase) AS decimal(18, 4))
  END AS PercentChange
FROM pivoted`;
  let firstRow = {};
  try {
    const rows = await deps.executeReadOnlySql(sqlQuery, signal);
    firstRow = rows[0] ?? {};
  } catch (error) {
    await deps.safeAuditWrite({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      requestId: conversationMemory.conversationId,
      stage: "tool-error",
      toolName: "sales_growth_fallback",
      error: error instanceof Error ? error.message : String(error),
      errorCategory: "deterministic-tool-failure"
    });
    return null;
  }
  deps.throwIfRequestCanceled(signal);
  const salesBase = deps.toSafeNumber(firstRow["SalesBase"]);
  const salesTarget = deps.toSafeNumber(firstRow["SalesTarget"]);
  if (salesBase === 0 && salesTarget === 0) {
    return null;
  }
  const percentRaw = deps.toSafeNumber(firstRow["PercentChange"]);
  const percentChange = Number.isFinite(percentRaw) ? percentRaw : null;
  deps.rememberToolTrace(
    conversationMemory,
    `sales_growth_fallback base=${baseYear} target=${targetYear} pct=${percentChange ?? "null"}`
  );
  return {
    baseYear,
    targetYear,
    salesBase,
    salesTarget,
    percentChange,
    query: sqlQuery,
    toolCallsUsed: 1
  };
}
const COMPANY_SCOPE_CAPTURE_PATTERNS = [
  /شرکت(?:\s*های|\s*ها|‌های|‌ها)?\s*[:-]?\s*([^\n\r؛;:.!?]{2,120})/giu,
  /\bcompan(?:y|ies)\b\s*[:-]?\s*([^\n\r؛;:.!?]{2,120})/gi
];
const BRANCH_SCOPE_CAPTURE_PATTERNS = [
  /شعبه(?:\s*های|\s*ها|‌های|‌ها)?\s*[:-]?\s*([^\n\r؛;:.!?]{1,120})/giu,
  /\bbranch(?:es)?\b\s*[:-]?\s*([^\n\r؛;:.!?]{1,120})/gi
];
const RUNTIME_SCOPE_STOP_PATTERNS = [
  /\s+در\s+/iu,
  /\s+برای\s+/iu,
  /\s+از\s+/iu,
  /\s+تا\s+/iu,
  /\s+سال(?:\s*مالی)?\s+/iu,
  /\s+from\s+/i,
  /\s+to\s+/i,
  /\s+for\s+/i,
  /\s+fiscal\s*year\s+/i,
  /\s+where\s+/i,
  /\s+with\s+/i,
  /\s+(?:گزارش|تحلیل|مقایسه|نمایش|بررسی)(?=\s|$|[،؛,.!?])/iu,
  /\s+(?:بده|بدید|کن|کنید|بکن)(?=\s|$|[،؛,.!?])/iu,
  /\s+(?:report|show|compare|analy[sz]e)\b/i
];
const RUNTIME_SCOPE_SPLIT_PATTERN = /(?:\s*(?:,|،|;|؛|\/|\||&)\s*|\s+(?:and|و)(?:\s+|$))/iu;
const RUNTIME_SCOPE_YEAR_CAPTURE_PATTERN = /\b((?:13|14|19|20)\d{2})\b/g;
const RUNTIME_SCOPE_YEAR_CONTEXT_PATTERN = /(?:سال(?:\s*مالی)?(?:\s*های|\s*ها|\s*\(ها\))?|fiscal\s*year(?:s)?)\s*[:-]?\s*([^\n\r؛;:.!?]{1,120})/giu;
const RUNTIME_SCOPE_YEAR_RANGE_PATTERN = /((?:13|14|19|20)\d{2})\s*(?:تا|to|-|–|—)\s*((?:13|14|19|20)\d{2})/giu;
const MAX_SCOPE_VALUES_PER_DIMENSION = 8;
const MAX_CONVERSATION_MEMORY_NOTES = 12;
const MAX_CONVERSATION_MEMORY_SESSIONS = 24;
const MAX_CONVERSATION_TOOL_TRACES = 10;
function createInitialConversationMemory(conversationId) {
  return {
    conversationId,
    notes: [],
    facts: {
      companyNames: [],
      fiscalYears: [],
      branchNames: [],
      dateRange: null,
      confirmedMappings: {}
    },
    lastUserPrompt: null,
    lastAssistantOutcome: null,
    lastToolTrace: [],
    touchedAt: Date.now()
  };
}
function getOrCreateConversationMemory(map, conversationId) {
  const existing = map.get(conversationId);
  if (existing) {
    existing.touchedAt = Date.now();
    return existing;
  }
  const created = createInitialConversationMemory(conversationId);
  map.set(conversationId, created);
  return created;
}
function createConversationMemorySnapshot(memory) {
  return {
    notes: [...memory.notes],
    facts: {
      companyNames: [...memory.facts.companyNames],
      fiscalYears: [...memory.facts.fiscalYears],
      branchNames: [...memory.facts.branchNames],
      dateRange: memory.facts.dateRange,
      confirmedMappings: {
        ...memory.facts.confirmedMappings
      }
    },
    lastUserPrompt: memory.lastUserPrompt,
    lastAssistantOutcome: memory.lastAssistantOutcome,
    lastToolTrace: [...memory.lastToolTrace]
  };
}
function pruneConversationMemory(map) {
  if (map.size <= MAX_CONVERSATION_MEMORY_SESSIONS) {
    return;
  }
  const overflowCount = map.size - MAX_CONVERSATION_MEMORY_SESSIONS;
  const staleConversationIds = [...map.values()].sort((left, right) => left.touchedAt - right.touchedAt).slice(0, overflowCount).map((memory) => memory.conversationId);
  for (const conversationId of staleConversationIds) {
    map.delete(conversationId);
  }
}
function pushConversationMemoryNote(memory, note) {
  const normalizedNote = note.trim();
  if (!normalizedNote) {
    return;
  }
  const existingIndex = memory.notes.findIndex((entry) => entry === normalizedNote);
  if (existingIndex >= 0) {
    memory.notes.splice(existingIndex, 1);
  }
  memory.notes.push(normalizedNote);
  if (memory.notes.length > MAX_CONVERSATION_MEMORY_NOTES) {
    memory.notes.splice(0, memory.notes.length - MAX_CONVERSATION_MEMORY_NOTES);
  }
}
function rememberToolTrace(deps, memory, trace) {
  const normalizedTrace = deps.compactText(trace.replace(/\s+/g, " ").trim(), 220);
  if (!normalizedTrace) {
    return;
  }
  const existingIndex = memory.lastToolTrace.findIndex((entry) => entry === normalizedTrace);
  if (existingIndex >= 0) {
    memory.lastToolTrace.splice(existingIndex, 1);
  }
  memory.lastToolTrace.push(normalizedTrace);
  if (memory.lastToolTrace.length > MAX_CONVERSATION_TOOL_TRACES) {
    memory.lastToolTrace.splice(0, memory.lastToolTrace.length - MAX_CONVERSATION_TOOL_TRACES);
  }
  pushConversationMemoryNote(memory, `Tool trace: ${normalizedTrace}`);
}
function updateConversationMemoryFromAssistant(deps, memory, finalText) {
  memory.touchedAt = Date.now();
  if (!finalText.trim()) {
    return;
  }
  memory.lastAssistantOutcome = deps.compactText(finalText, 280);
  pushConversationMemoryNote(
    memory,
    `Latest assistant outcome: ${deps.compactText(finalText, 220)}`
  );
}
function extractConversationFacts(text) {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (!normalizedText) {
    return {
      companyNames: [],
      fiscalYears: [],
      branchNames: []
    };
  }
  const normalizedDigitsText = normalizePersianDigits(normalizedText);
  const facts = {
    companyNames: extractNamedScopeValues(normalizedText, COMPANY_SCOPE_CAPTURE_PATTERNS),
    fiscalYears: extractFiscalYears(normalizedDigitsText),
    branchNames: extractNamedScopeValues(normalizedText, BRANCH_SCOPE_CAPTURE_PATTERNS)
  };
  const dateRangeFaMatch = normalizedText.match(/از\s+([^\n\r]{1,24})\s+تا\s+([^\n\r]{1,24})/u);
  if (dateRangeFaMatch?.[1] && dateRangeFaMatch?.[2]) {
    facts.dateRange = `از ${dateRangeFaMatch[1].trim()} تا ${dateRangeFaMatch[2].trim()}`;
  } else {
    const dateRangeEnMatch = normalizedDigitsText.match(
      /\bfrom\s+([a-z0-9/-]{2,20})\s+to\s+([a-z0-9/-]{2,20})/i
    );
    if (dateRangeEnMatch?.[1] && dateRangeEnMatch?.[2]) {
      facts.dateRange = `from ${dateRangeEnMatch[1]} to ${dateRangeEnMatch[2]}`;
    }
  }
  return facts;
}
function extractNamedScopeValues(text, patterns) {
  const values = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const captured = match[1];
      if (typeof captured !== "string" || !captured.trim()) {
        continue;
      }
      const normalizedChunk = trimScopeChunk(captured);
      if (!normalizedChunk) {
        continue;
      }
      const parts = normalizedChunk.split(RUNTIME_SCOPE_SPLIT_PATTERN).map((part) => normalizeScopeToken(part)).filter((part) => isValidScopeToken(part));
      values.push(...parts);
    }
  }
  return uniqueScopeValues(values);
}
function trimScopeChunk(value) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  let minStopIndex = compact.length;
  for (const pattern of RUNTIME_SCOPE_STOP_PATTERNS) {
    const match = pattern.exec(compact);
    if (!match || match.index < 0) {
      continue;
    }
    minStopIndex = Math.min(minStopIndex, match.index);
  }
  return compact.slice(0, minStopIndex).trim();
}
function normalizeScopeToken(value) {
  return value.replace(/^['"""''()[]{}]+|['"""''()[]{}]+$/g, "").replace(/^(?:شرکت|company|companies|شعبه|branch|branches)\s+/iu, "").replace(/\s+/g, " ").trim();
}
function isValidScopeToken(value) {
  if (!value) {
    return false;
  }
  if (value.length > 48) {
    return false;
  }
  if (/^(?:and|و|or|یا)$/iu.test(value)) {
    return false;
  }
  if (/^\d+$/u.test(value)) {
    return false;
  }
  return true;
}
function extractFiscalYears(text) {
  const years = [];
  RUNTIME_SCOPE_YEAR_RANGE_PATTERN.lastIndex = 0;
  for (const rangeMatch of text.matchAll(RUNTIME_SCOPE_YEAR_RANGE_PATTERN)) {
    const startYear = Number.parseInt(rangeMatch[1] ?? "", 10);
    const endYear = Number.parseInt(rangeMatch[2] ?? "", 10);
    if (Number.isNaN(startYear) || Number.isNaN(endYear)) {
      continue;
    }
    const delta = endYear - startYear;
    if (delta >= 0 && delta <= 5) {
      for (let year = startYear; year <= endYear; year += 1) {
        years.push(String(year));
      }
    } else {
      years.push(String(startYear), String(endYear));
    }
  }
  RUNTIME_SCOPE_YEAR_CONTEXT_PATTERN.lastIndex = 0;
  for (const contextMatch of text.matchAll(RUNTIME_SCOPE_YEAR_CONTEXT_PATTERN)) {
    const segment = contextMatch[1] ?? "";
    const segmentYears = segment.match(RUNTIME_SCOPE_YEAR_CAPTURE_PATTERN) ?? [];
    years.push(...segmentYears);
  }
  return uniqueScopeValues(years);
}
function mergeScopeValues(currentValues, incomingValues) {
  return uniqueScopeValues([...currentValues, ...incomingValues]).slice(
    0,
    MAX_SCOPE_VALUES_PER_DIMENSION
  );
}
function uniqueScopeValues(values) {
  const deduped = [];
  const seen = /* @__PURE__ */ new Set();
  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}
function classifyToolFailure(evidence, lastErrorCode, lastErrorMessage) {
  const scopedSuccesses = evidence.filter((entry) => entry.status === "ok" && entry.scopeApplied);
  if (scopedSuccesses.some((entry) => entry.rowsReturned > 0 && entry.nonNullValue)) {
    return "NONE";
  }
  const errorText = [lastErrorCode, lastErrorMessage].filter(Boolean).join(" | ");
  if (errorText) {
    if (/SQL_POLICY/i.test(errorText)) {
      return "POLICY_ERROR";
    }
    if (/NOT_IN_CATALOG|CATALOG/i.test(errorText)) {
      return "NOT_IN_CATALOG";
    }
    if (/invalid object name|invalid column name/i.test(errorText)) {
      return "UNKNOWN_OBJECT";
    }
    if (/not a recognized built-in function|built-in function|gregoriantoshamsi|format\s*\(/i.test(errorText)) {
      return "UNSUPPORTED_FUNCTION";
    }
    if (/TIMEOUT|PROVIDER|NETWORK|CONNECT/i.test(errorText)) {
      return "PROVIDER_ERROR";
    }
  }
  if (scopedSuccesses.some((entry) => entry.status === "ok" && entry.scopeApplied)) {
    return "EMPTY_RESULT";
  }
  return "NO_FETCH";
}
function evaluateEvidence(trace) {
  const scopedSuccesses = trace.evidence.filter((entry) => entry.status === "ok" && entry.scopeApplied);
  if (scopedSuccesses.length === 0) {
    return { kind: "INSUFFICIENT", reason: "no successfully executed, scoped query" };
  }
  if (scopedSuccesses.some((entry) => entry.rowsReturned > 0 && entry.nonNullValue)) {
    return { kind: "POSITIVE_DATA" };
  }
  return {
    kind: "VALID_EMPTY",
    reason: "query executed within scope but returned 0 rows / NULL"
  };
}
function renderValidEmptyFinancialAnswer(finalText, sections, statesNoData) {
  if (statesNoData) {
    return finalText;
  }
  const affirmation = "بر اساس کوئری اجرا شده در محدوده (scope) مشخص، در این بازه زمانی یا سال مالی رکوردی ثبت نشده است (۰ ردیف).";
  if (sections.summary.includes(affirmation)) {
    return finalText;
  }
  return finalText.replace(/### Summary\n/u, `### Summary
${affirmation}

`);
}
function buildEvidenceContractFailureResponse(reason, compactedPrompt, recoveryAttempts) {
  const recoveryLine = recoveryAttempts && recoveryAttempts > 0 ? `- تلاش‌های بازپروری: ${recoveryAttempts} تلاش.` : "";
  return [
    "### Summary",
    "Cannot answer reliably: پاسخ مالی بدون شواهد کافی مجاز نیست.",
    "",
    "### Findings",
    `- دلیل ساده: ${reason}`,
    recoveryLine,
    "",
    "### Evidence",
    "- Evidence-first contract فعال شد و از ارائه پاسخ مالی غیرقابل اتکا جلوگیری کرد.",
    "",
    "### Assumptions",
    "- پاسخ رد شده به دلیل فقدان شواهد ساخت یافته و/یا ابزار read-only قابل اتکا متوقف شد.",
    "",
    "### Actions",
    `- اقدام بعدی: سوال را با scope دقیق‌تر تکرار کنید: ${compactedPrompt}`,
    "- اگر داده‌ای وجود ندارد، بازه زمانی/سال مالی/شرکت/شعبه را مشخص کنید تا ابزارها بتوانند پاسخ قابل اتکا تولید کنند."
  ].filter((line) => line !== "").join("\n");
}
function annotateManagerUx(deps, rawText, routeMode) {
  const normalizedText = deps.normalizePersianDigits(rawText);
  if (/^### Summary\n/i.test(normalizedText)) {
    const routeLine = `- مسیر پاسخ: ${routeMode}`;
    if (normalizedText.includes("نوع KPI:")) {
      return rawText.replace(
        "### Findings",
        `${routeLine}
- نوع KPI: ${rawText.match(/نوع KPI: ([^\n]+)/)?.[1] ?? "نامشخص"}

### Findings`
      );
    }
    return rawText.replace("### Findings", `${routeLine}

### Findings`);
  }
  return [
    "### Summary",
    "مدیریت پاسخ با شفافیت مسیر و KPI فعال شد.",
    "",
    "### Findings",
    `- مسیر پاسخ: ${routeMode}`,
    "",
    "### Evidence",
    rawText,
    "",
    "### Actions",
    "- برای بررسی بیشتر، خروجی را با شواهد و scope مقایسه کنید."
  ].join("\n");
}
function finalizeFinancialResponse(deps, prompt, rawText, conversationMemory, totalToolCallCount, successfulDataFetchCount, routeMode = "model-assisted", executionTrace, recoveryContext, requestId) {
  const templatedText = deps.ensureFinancialResponseTemplate(
    rawText,
    conversationMemory,
    totalToolCallCount
  );
  const alignedText = deps.enforcePromptIntentAlignment(prompt, templatedText);
  const routedText = annotateManagerUx(deps, alignedText, routeMode);
  if (routeMode === "deterministic") {
    return routedText;
  }
  const finalizedText = enforceEvidenceFirstContract(
    deps,
    prompt,
    routedText,
    totalToolCallCount,
    successfulDataFetchCount,
    executionTrace,
    recoveryContext,
    requestId,
    conversationMemory.conversationId
  );
  return finalizedText;
}
function enforceEvidenceFirstContract(deps, prompt, finalText, totalToolCallCount, successfulDataFetchCount, executionTrace, recoveryContext, requestId, conversationId) {
  const normalizedText = deps.normalizePersianDigits(finalText);
  if (/cannot\s+answer\s+reliably/iu.test(normalizedText)) {
    return finalText;
  }
  if (executionTrace && executionTrace.intentId) {
    const intentMismatch = deps.validateIntentTableMatch(
      executionTrace.intentId,
      executionTrace.evidence
    );
    if (intentMismatch) {
      const failureText = buildEvidenceContractFailureResponse(
        `تطابق intent و جدول برقرار نیست: ${intentMismatch}`,
        prompt,
        recoveryContext?.attempts
      );
      deps.emitEvidenceContractTelemetry(
        requestId,
        conversationId,
        failureText,
        recoveryContext?.attempts
      );
      return failureText;
    }
  }
  const hasFinancialNumericClaimInResponse = /(?:[+-]?\d+(?:[.,]\d+)?(?:\s*%|\s*درصد)|\b(?:تومان|ریال|مبلغ|موجودی|مانده|جمع|مجموع|تعداد|سهم|نسبت|amount|balance|total|count)\b)/iu.test(
    normalizedText
  );
  const isClarificationOnlyResponse = /برای\s+پاسخ\s+دقیق|برای\s+جلوگیری\s+از\s+حدس\s+زدن|برای\s+جلوگیری\s+از\s+تحلیل\s+اشتباه|لطفا\s+یکی\s+از\s+این\s+گزینه‌ها|سال\s+مالی\s+دقیق|تاریخ\s+شروع\s+و\s+پایان|درخواست\s+صرفاً\s+استعلامی/i.test(
    normalizedText
  ) && !hasFinancialNumericClaimInResponse;
  if (isClarificationOnlyResponse) {
    return finalText;
  }
  const sections = deps.parseFinancialTemplateSections(finalText);
  const narrative = `${sections.summary}
${sections.findings}`.trim();
  const evidence = sections.evidence;
  const appearsFinancialClaim = deps.appearsToContainFinancialClaim(prompt) || deps.appearsToContainFinancialClaim(narrative);
  const hasRequiredContractSections = deps.hasRequiredFinancialResponseSections(sections);
  const hasStructuredEvidence2 = deps.hasStructuredEvidence(evidence);
  const requiresStrictFinancialFetch = deps.requiresStrictFinancialDataFetch(prompt, narrative);
  const requiresStrictQuantResult = deps.requiresStrictQuantitativeDataFetch(prompt);
  const hasQuantitativeResult = deps.hasQuantitativeResultSignal(narrative);
  const statesNoData = deps.appearsToBeNoDataResult(narrative);
  const numericClaims = deps.extractNumericClaims(narrative);
  const needsStrictData = requiresStrictFinancialFetch || requiresStrictQuantResult;
  if (appearsFinancialClaim && !hasRequiredContractSections) {
    const failureText = buildEvidenceContractFailureResponse(
      "پاسخ مالی فاقد بلوک‌های قرارداد استاندارد Summary/Findings/Evidence/Assumptions/Actions بود.",
      prompt,
      recoveryContext?.attempts
    );
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    );
    return failureText;
  }
  if (totalToolCallCount === 0 && appearsFinancialClaim && !statesNoData) {
    const failureText = buildEvidenceContractFailureResponse(
      "پاسخ مالی عددی بدون اجرای ابزار read-only تولید شد و قابل اتکا نیست.",
      prompt,
      recoveryContext?.attempts
    );
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    );
    return failureText;
  }
  if (deps.containsUnsupportedNumericClaim(narrative, evidence, sections)) {
    const failureText = buildEvidenceContractFailureResponse(
      "پاسخ شامل ادعای عددی/درصدی بدون شواهد ساخت‌یافته و بدون داده‌ی اجرا شده بود.",
      prompt,
      recoveryContext?.attempts
    );
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    );
    return failureText;
  }
  const hasFinancialMarkedClaim = deps.containsFinancialMarkedNumericClaim(narrative);
  if (executionTrace && numericClaims.length > 0 && hasFinancialMarkedClaim && !statesNoData && (appearsFinancialClaim || needsStrictData)) {
    if (!deps.traceSupportsNumericClaim(executionTrace)) {
      const failureText = buildEvidenceContractFailureResponse(
        "پاسخ شامل عدد/درصدی است که در trace اجرای واقعی وجود ندارد و بنابراین به‌عنوان ادعای بی‌شاهد رد می‌شود. برای پذیرش، عدد باید از اجرای واقعی و شواهد trace پشتیبانی شود.",
        prompt,
        recoveryContext?.attempts
      );
      deps.emitEvidenceContractTelemetry(
        requestId,
        conversationId,
        failureText,
        recoveryContext?.attempts
      );
      return failureText;
    }
  }
  if (totalToolCallCount > 0 && !hasStructuredEvidence2 && (appearsFinancialClaim || needsStrictData || hasQuantitativeResult)) {
    const failureText = buildEvidenceContractFailureResponse(
      "پاسخ مالی فاقد شواهد ساخت یافته کافی (ابزار/کوئری/جدول/ردیف) بود.",
      prompt,
      recoveryContext?.attempts
    );
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    );
    return failureText;
  }
  if (executionTrace && needsStrictData) {
    const verdict = evaluateEvidence(executionTrace);
    if (verdict.kind === "INSUFFICIENT") {
      const failureText = buildEvidenceContractFailureResponse(
        "برای پاسخ عددی/مقایسه ای مالی، اجرای موفق و scope دار fetch_financial_data الزامی است و مسیرهای بدون آن معتبر نیستند.",
        prompt,
        recoveryContext?.attempts
      );
      deps.emitEvidenceContractTelemetry(
        requestId,
        conversationId,
        failureText,
        recoveryContext?.attempts
      );
      return failureText;
    }
    if (verdict.kind === "VALID_EMPTY") {
      return renderValidEmptyFinancialAnswer(finalText, sections, statesNoData);
    }
    if (requiresStrictQuantResult && !hasQuantitativeResult && !statesNoData) {
      const failureText = buildEvidenceContractFailureResponse(
        "برای سوال درصد رشد/کاهش، پاسخ نهایی باید عدد درصد معتبر (+x% یا -x%) یا پیام صریح نبود داده داشته باشد.",
        prompt
      );
      deps.emitEvidenceContractTelemetry(
        requestId,
        conversationId,
        failureText,
        recoveryContext?.attempts
      );
      return failureText;
    }
    return finalText;
  }
  if (requiresStrictFinancialFetch && successfulDataFetchCount === 0 && !statesNoData) {
    const failureText = buildEvidenceContractFailureResponse(
      "برای پاسخ عددی/مقایسه ای مالی، اجرای موفق fetch_financial_data الزامی است و مسیرهای بدون آن معتبر نیستند.",
      prompt,
      recoveryContext?.attempts
    );
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    );
    return failureText;
  }
  if (requiresStrictQuantResult && successfulDataFetchCount === 0 && !statesNoData) {
    const failureText = buildEvidenceContractFailureResponse(
      "برای سوال درصد رشد/کاهش، پاسخ نهایی بدون اجرای موفق fetch_financial_data مجاز نیست.",
      prompt,
      recoveryContext?.attempts
    );
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    );
    return failureText;
  }
  if (requiresStrictQuantResult && !hasQuantitativeResult && !statesNoData) {
    const failureText = buildEvidenceContractFailureResponse(
      "برای سوال درصد رشد/کاهش، پاسخ نهایی باید عدد درصد معتبر (+x% یا -x%) یا پیام صریح نبود داده داشته باشد.",
      prompt,
      recoveryContext?.attempts
    );
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    );
    return failureText;
  }
  return finalText;
}
function createCancellationError(reason) {
  const normalizedReason = reason.trim() || "Request canceled by user.";
  const error = new Error(normalizedReason);
  error.name = "AbortError";
  error.code = "AGENT_REQUEST_CANCELLED";
  error.category = "orchestration-control";
  return error;
}
function toCancellationReason(reason) {
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }
  if (reason instanceof Error && reason.message.trim()) {
    return reason.message.trim();
  }
  return "Request canceled by user.";
}
function throwIfRequestCanceled(signal) {
  if (!signal.aborted) {
    return;
  }
  throw createCancellationError(toCancellationReason(signal.reason));
}
function isCancellationLikeError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  const typedError = error;
  if (typedError.name === "AbortError") {
    return true;
  }
  if (typeof typedError.code === "string" && typedError.code.toUpperCase() === "AGENT_REQUEST_CANCELLED") {
    return true;
  }
  const message = error.message.toLowerCase();
  return message.includes("request canceled by user") || message.includes("request cancelled by user");
}
function resolveCancellationError(error, signal) {
  if (signal.aborted) {
    return createCancellationError(toCancellationReason(signal.reason));
  }
  if (isCancellationLikeError(error)) {
    if (error instanceof Error) {
      return createCancellationError(error.message);
    }
    return createCancellationError("Request canceled by user.");
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
function normalizeSqlIdentifier(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).replace(/]]/g, "]").trim().toLowerCase();
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim().toLowerCase();
  }
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1).trim().toLowerCase();
  }
  return trimmed.toLowerCase();
}
function stripSqlComments(sql) {
  return sql.replace(/--.*$/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}
function stripSqlCommentsAndLiterals(sql) {
  return stripSqlComments(sql).replace(/N?'(?:''|[^'])*'/g, "''").replace(/"(?:""|[^"])*"/g, '""');
}
function escapeRegexPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function splitSqlIdentifierParts(rawRef) {
  const parts = [];
  let current = "";
  let mode = "normal";
  for (let index = 0; index < rawRef.length; index += 1) {
    const char = rawRef[index];
    if (mode === "normal") {
      if (char === ".") {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = "";
        continue;
      }
      if (char === "[") {
        mode = "bracket";
        current += char;
        continue;
      }
      if (char === '"') {
        mode = "doubleQuote";
        current += char;
        continue;
      }
      if (char === "`") {
        mode = "backtick";
        current += char;
        continue;
      }
      current += char;
      continue;
    }
    current += char;
    if (mode === "bracket" && char === "]") {
      if (index + 1 < rawRef.length && rawRef[index + 1] === "]") {
        current += rawRef[index + 1];
        index += 1;
      } else {
        mode = "normal";
      }
      continue;
    }
    if (mode === "doubleQuote" && char === '"') {
      if (index + 1 < rawRef.length && rawRef[index + 1] === '"') {
        current += rawRef[index + 1];
        index += 1;
      } else {
        mode = "normal";
      }
      continue;
    }
    if (mode === "backtick" && char === "`") {
      mode = "normal";
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}
function parseSqlTableReference(rawRef) {
  const segments = splitSqlIdentifierParts(rawRef).map((segment) => normalizeSqlIdentifier(segment)).filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  const tableName = segments[segments.length - 1];
  const schemaName = segments.length >= 2 ? segments[segments.length - 2] : null;
  const databaseName = segments.length >= 3 ? segments[segments.length - 3] : null;
  const serverName = segments.length >= 4 ? segments[segments.length - 4] : null;
  const schemaTable = schemaName ? `${schemaName}.${segments[segments.length - 1]}` : null;
  return {
    raw: rawRef.trim(),
    schemaTable,
    schemaName,
    databaseName,
    serverName,
    tableName,
    partCount: segments.length
  };
}
function extractReferencedTableRefs(sqlQuery) {
  const sanitizedSql = stripSqlCommentsAndLiterals(sqlQuery);
  const pattern = /\b(?:FROM|JOIN|APPLY)\s+((?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[A-Z0-9_#@]+)(?:\s*\.\s*(?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[A-Z0-9_#@]+)){0,3})/gi;
  const tableRefs = [];
  let match;
  while ((match = pattern.exec(sanitizedSql)) !== null) {
    const parsed = parseSqlTableReference(match[1]);
    if (parsed) {
      tableRefs.push(parsed);
    }
  }
  return tableRefs;
}
function extractCteNames(sqlQuery) {
  const sanitizedSql = stripSqlCommentsAndLiterals(sqlQuery);
  const cteNames = /* @__PURE__ */ new Set();
  const ctePattern = /(?:\bWITH\b|,)\s*([A-Z0-9_["`]+)\s+AS\s*\(/gi;
  let match;
  while ((match = ctePattern.exec(sanitizedSql)) !== null) {
    const normalizedName = normalizeSqlIdentifier(match[1]);
    if (normalizedName) {
      cteNames.add(normalizedName);
    }
  }
  return cteNames;
}
function buildCatalogTableNameIndex(deps, activeCatalog) {
  const index = /* @__PURE__ */ new Map();
  for (const table of activeCatalog.tables) {
    const tableName = table.tableName.trim().toLowerCase();
    const schemaTableRef = deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`);
    if (!tableName || !schemaTableRef) {
      continue;
    }
    const bucket = index.get(tableName);
    if (bucket) {
      bucket.add(schemaTableRef);
    } else {
      index.set(tableName, /* @__PURE__ */ new Set([schemaTableRef]));
    }
  }
  return index;
}
function buildAllowedFinancialTableRefs(deps, activeCatalog) {
  const catalogRefs = new Set(
    activeCatalog.tables.map(
      (table) => deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`)
    )
  );
  if (catalogRefs.size === 0) {
    return catalogRefs;
  }
  const seedRefs = /* @__PURE__ */ new Set();
  for (const conceptKey of deps.schemaContextConceptOrder) {
    const selectedRef = activeCatalog.selectedMappings[conceptKey]?.trim() ?? "";
    const selectedNormalized = deps.normalizeTableRef(selectedRef);
    if (selectedRef && catalogRefs.has(selectedNormalized)) {
      seedRefs.add(selectedNormalized);
    }
    const suggestions = activeCatalog.suggestedMappings[conceptKey] ?? [];
    for (const suggestionRef of suggestions) {
      const normalizedSuggestion = deps.normalizeTableRef(suggestionRef);
      if (normalizedSuggestion && catalogRefs.has(normalizedSuggestion)) {
        seedRefs.add(normalizedSuggestion);
      }
    }
  }
  for (const table of activeCatalog.tables) {
    if (table.tags.length > 0) {
      seedRefs.add(deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`));
    }
  }
  if (seedRefs.size === 0) {
    return catalogRefs;
  }
  const expandedRefs = new Set(seedRefs);
  for (const table of activeCatalog.tables) {
    const currentRef = deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`);
    const referencedRefs = table.foreignKeys.map((fk) => deps.normalizeTableRef(`${fk.referencedSchema}.${fk.referencedTable}`)).filter((ref) => catalogRefs.has(ref));
    const touchesSeed = seedRefs.has(currentRef) || referencedRefs.some((ref) => seedRefs.has(ref));
    if (!touchesSeed) {
      continue;
    }
    expandedRefs.add(currentRef);
    for (const referencedRef of referencedRefs) {
      expandedRefs.add(referencedRef);
    }
  }
  return expandedRefs;
}
function validateCatalogColumnReferences(deps, sqlQuery, activeCatalog, allowedRefs, cteNames) {
  let ast;
  try {
    ast = deps.sqlParser.astify(sqlQuery);
  } catch {
    return;
  }
  const tableMap = buildCatalogTableAliasMap(deps, activeCatalog, allowedRefs, cteNames);
  visitSqlAstColumns(ast, tableMap, activeCatalog);
}
function buildCatalogTableAliasMap(deps, activeCatalog, allowedRefs, _cteNames) {
  const aliasMap = /* @__PURE__ */ new Map();
  for (const table of activeCatalog.tables) {
    const normalizedRef = deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`);
    if (!allowedRefs.has(normalizedRef)) {
      continue;
    }
    aliasMap.set(table.tableName.trim().toLowerCase(), {
      schemaName: table.schemaName,
      tableName: table.tableName
    });
    aliasMap.set(`${table.schemaName}.${table.tableName}`.trim().toLowerCase(), {
      schemaName: table.schemaName,
      tableName: table.tableName
    });
  }
  for (const table of activeCatalog.tables) {
    const normalizedRef = deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`);
    if (!allowedRefs.has(normalizedRef) || _cteNames.has(table.tableName.trim().toLowerCase())) {
      continue;
    }
  }
  return aliasMap;
}
function visitSqlAstColumns(node, aliasMap, activeCatalog) {
  if (!node || typeof node !== "object") {
    return;
  }
  const record = node;
  if (record.type === "column_ref" && typeof record.column === "string") {
    const tableName = typeof record.table === "string" ? record.table.trim().toLowerCase() : null;
    const columnName = record.column.trim().toLowerCase();
    const resolvedTable = resolveCatalogTableForColumnRef(tableName, aliasMap, activeCatalog);
    if (!resolvedTable) {
      return;
    }
    const catalogTable = activeCatalog.tables.find((entry) => {
      return entry.schemaName.trim().toLowerCase() === resolvedTable.schemaName.trim().toLowerCase() && entry.tableName.trim().toLowerCase() === resolvedTable.tableName.trim().toLowerCase();
    });
    if (!catalogTable) {
      return;
    }
    const columnExists = catalogTable.columns.some(
      (column) => column.name.trim().toLowerCase() === columnName
    );
    if (!columnExists) {
      throw new Error(
        `Column [${columnName}] is not available in table [${catalogTable.schemaName}.${catalogTable.tableName}].`
      );
    }
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        visitSqlAstColumns(item, aliasMap, activeCatalog);
      }
      continue;
    }
    if (value && typeof value === "object") {
      visitSqlAstColumns(value, aliasMap, activeCatalog);
    }
  }
}
function resolveCatalogTableForColumnRef(tableAlias, aliasMap, activeCatalog) {
  if (tableAlias) {
    return aliasMap.get(tableAlias) ?? null;
  }
  const candidates = [...aliasMap.values()];
  if (candidates.length === 1) {
    return candidates[0];
  }
  const inScopeTables = activeCatalog.tables.filter(
    (entry) => aliasMap.has(entry.tableName.trim().toLowerCase())
  );
  if (inScopeTables.length === 1) {
    return {
      schemaName: inScopeTables[0].schemaName,
      tableName: inScopeTables[0].tableName
    };
  }
  return null;
}
function ensurePersonNameSearchPolicy(deps, sqlQuery) {
  const normalizedQuery = deps.normalizePersianDigits(sqlQuery);
  const personNameColumnSignal = /(?:\bLastName\b|\bFirstName\b|\bFullName\b|\bPartyName\b|\bPersonName\b|\bCustomerName\b|\bSurname\b|\bFamilyName\b|\bName\b|نام(?:\s*خانوادگی)?|طرف\s*حساب)/iu.test(
    normalizedQuery
  );
  if (!personNameColumnSignal) {
    return;
  }
  const exactNameEqualityPattern = /(?:\b(?:LastName|FirstName|FullName|PartyName|PersonName|CustomerName|Surname|FamilyName|Name)\b\s*=\s*N?'[^']+'|N?'[^']+'\s*=\s*\b(?:LastName|FirstName|FullName|PartyName|PersonName|CustomerName|Surname|FamilyName|Name)\b)/iu;
  if (exactNameEqualityPattern.test(normalizedQuery)) {
    throw new Error(
      "Exact equality on person name/surname is not allowed. Use robust token-based matching with LIKE and proper Unicode prefixes (N'...') for compound names."
    );
  }
}
function buildRuntimeScopeFilterRequirements(deps, settings, conversationMemory) {
  const activeCatalog = deps.findActiveSchemaCatalog(settings);
  if (!activeCatalog) {
    return [];
  }
  const scopeColumnCandidates = deps.collectRuntimeScopeColumnCandidates(activeCatalog);
  const requirements = [];
  const dimensionEntries = [
    {
      dimension: "company",
      values: conversationMemory.facts.companyNames
    },
    {
      dimension: "fiscalYear",
      values: conversationMemory.facts.fiscalYears
    },
    {
      dimension: "branch",
      values: conversationMemory.facts.branchNames
    }
  ];
  for (const entry of dimensionEntries) {
    if (entry.values.length === 0) {
      continue;
    }
    const candidateColumnNames = [];
    const seenColumnNames = /* @__PURE__ */ new Set();
    for (const candidate of scopeColumnCandidates) {
      if (candidate.dimension !== entry.dimension) {
        continue;
      }
      const normalizedColumnName = candidate.columnName.trim().toLowerCase();
      if (!normalizedColumnName || seenColumnNames.has(normalizedColumnName)) {
        continue;
      }
      seenColumnNames.add(normalizedColumnName);
      candidateColumnNames.push(normalizedColumnName);
      if (candidateColumnNames.length >= 6) {
        break;
      }
    }
    if (candidateColumnNames.length === 0) {
      continue;
    }
    requirements.push({
      dimension: entry.dimension,
      values: [...entry.values],
      candidateColumnNames
    });
  }
  return requirements;
}
function toRuntimeScopeDimensionLabel(dimension) {
  switch (dimension) {
    case "company":
      return "company";
    case "fiscalYear":
      return "fiscal-year";
    case "branch":
      return "branch";
    default:
      return "runtime scope";
  }
}
function hasColumnPredicateInWhereClause(normalizedSql, columnName) {
  if (!normalizedSql || !columnName) {
    return false;
  }
  const whereSections = normalizedSql.split(/\bwhere\b/gi).slice(1);
  if (whereSections.length === 0) {
    return false;
  }
  const escapedColumnName = escapeRegexPattern(columnName);
  const predicatePattern = new RegExp(
    `(?:\\.|\\b)${escapedColumnName}\\b[^;]{0,120}?(?:=|in\\s*\\(|like\\b|between\\b|>=|<=|<>|>|<)`,
    "i"
  );
  for (const section of whereSections) {
    const boundedSection = section.split(
      /\border\s+by\b|\bgroup\s+by\b|\bhaving\b|\boffset\b|\bfetch\b|\bunion\b|\bexcept\b|\bintersect\b/i
    )[0];
    if (!boundedSection) {
      continue;
    }
    if (predicatePattern.test(boundedSection)) {
      return true;
    }
  }
  return false;
}
function hasScopeValueConstraintInExpression(deps, normalizedExpression, requirement) {
  if (!normalizedExpression || requirement.values.length === 0 || requirement.candidateColumnNames.length === 0) {
    return false;
  }
  for (const columnName of requirement.candidateColumnNames) {
    const escapedColumnName = escapeRegexPattern(columnName);
    const columnMentionPattern = new RegExp(`(?:\\.|\\b)${escapedColumnName}\\b`, "i");
    if (!columnMentionPattern.test(normalizedExpression)) {
      continue;
    }
    for (const value of requirement.values) {
      const normalizedValue = deps.normalizePersianDigits(value).trim().toLowerCase();
      if (!normalizedValue) {
        continue;
      }
      const escapedValue = escapeRegexPattern(normalizedValue);
      const valueNearColumnPattern = new RegExp(
        `(?:\\.|\\b)${escapedColumnName}\\b[^;]{0,220}?${escapedValue}`,
        "i"
      );
      if (valueNearColumnPattern.test(normalizedExpression)) {
        return true;
      }
    }
  }
  return false;
}
function hasScopeValueConstraintInWhereClause(deps, normalizedSqlWithValues, requirement) {
  if (!normalizedSqlWithValues || requirement.values.length === 0 || requirement.candidateColumnNames.length === 0) {
    return false;
  }
  const whereSections = normalizedSqlWithValues.split(/\bwhere\b/gi).slice(1);
  if (whereSections.length === 0) {
    return false;
  }
  for (const section of whereSections) {
    const boundedSection = section.split(
      /\border\s+by\b|\bgroup\s+by\b|\bhaving\b|\boffset\b|\bfetch\b|\bunion\b|\bexcept\b|\bintersect\b/i
    )[0];
    if (!boundedSection) {
      continue;
    }
    if (hasScopeValueConstraintInExpression(deps, boundedSection, requirement)) {
      return true;
    }
  }
  return false;
}
function startsWithLogicalOperator(expression, index, operator) {
  const token = expression.slice(index, index + operator.length).toLowerCase();
  if (token !== operator) {
    return false;
  }
  const previousChar = index > 0 ? expression[index - 1] : " ";
  const nextChar = index + operator.length < expression.length ? expression[index + operator.length] : " ";
  const previousIsBoundary = !/[a-z0-9_]/i.test(previousChar);
  const nextIsBoundary = !/[a-z0-9_]/i.test(nextChar);
  return previousIsBoundary && nextIsBoundary;
}
function splitTopLevelDisjunction(expression) {
  const branches = [];
  let buffer = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (inSingleQuote) {
      buffer += char;
      if (char === "'") {
        if (index + 1 < expression.length && expression[index + 1] === "'") {
          buffer += expression[index + 1];
          index += 1;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }
    if (inDoubleQuote) {
      buffer += char;
      if (char === '"') {
        if (index + 1 < expression.length && expression[index + 1] === '"') {
          buffer += expression[index + 1];
          index += 1;
        } else {
          inDoubleQuote = false;
        }
      }
      continue;
    }
    if (char === "'") {
      inSingleQuote = true;
      buffer += char;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      buffer += char;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      buffer += char;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      buffer += char;
      continue;
    }
    if (bracketDepth === 0) {
      if (char === "(") {
        parenDepth += 1;
        buffer += char;
        continue;
      }
      if (char === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
        buffer += char;
        continue;
      }
    }
    if (parenDepth === 0 && bracketDepth === 0 && startsWithLogicalOperator(expression, index, "or")) {
      const trimmedBranch = buffer.trim();
      if (trimmedBranch) {
        branches.push(trimmedBranch);
      }
      buffer = "";
      index += 1;
      continue;
    }
    buffer += char;
  }
  const trailingBranch = buffer.trim();
  if (trailingBranch) {
    branches.push(trailingBranch);
  }
  return branches;
}
function hasWeakScopeDisjunctionInWhereClause(deps, normalizedSqlWithValues, requirement) {
  if (!normalizedSqlWithValues || requirement.values.length === 0 || requirement.candidateColumnNames.length === 0) {
    return false;
  }
  const whereSections = normalizedSqlWithValues.split(/\bwhere\b/gi).slice(1);
  if (whereSections.length === 0) {
    return false;
  }
  for (const section of whereSections) {
    const boundedSection = section.split(
      /\border\s+by\b|\bgroup\s+by\b|\bhaving\b|\boffset\b|\bfetch\b|\bunion\b|\bexcept\b|\bintersect\b/i
    )[0];
    if (!boundedSection) {
      continue;
    }
    const disjunctionBranches = splitTopLevelDisjunction(boundedSection);
    if (disjunctionBranches.length <= 1) {
      continue;
    }
    for (const branch of disjunctionBranches) {
      if (!hasScopeValueConstraintInExpression(deps, branch, requirement)) {
        return true;
      }
    }
  }
  return false;
}
function ensureRuntimeScopeFilters(deps, sqlQuery, requirements) {
  const normalizedSql = stripSqlCommentsAndLiterals(sqlQuery).replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedSqlWithValues = stripSqlComments(sqlQuery).replace(/\s+/g, " ").trim().toLowerCase();
  for (const requirement of requirements) {
    const hasPredicate = requirement.candidateColumnNames.some((columnName) => {
      return hasColumnPredicateInWhereClause(normalizedSql, columnName);
    });
    if (!hasPredicate) {
      const scopeLabel = toRuntimeScopeDimensionLabel(requirement.dimension);
      const valuesText = requirement.values.join(" | ");
      const columnsText = requirement.candidateColumnNames.slice(0, 4).join(", ");
      throw deps.createAgentPolicyError(
        "AGENT_SCOPE_FILTER_REQUIRED",
        `Query is missing required ${scopeLabel} filter. Scope values: ${valuesText}. Add WHERE predicate using one of: ${columnsText}.`
      );
    }
    const hasScopeValueConstraint = hasScopeValueConstraintInWhereClause(
      deps,
      normalizedSqlWithValues,
      requirement
    );
    if (!hasScopeValueConstraint) {
      const scopeLabel = toRuntimeScopeDimensionLabel(requirement.dimension);
      const valuesText = requirement.values.join(" | ");
      throw deps.createAgentPolicyError(
        "AGENT_SCOPE_VALUE_FILTER_REQUIRED",
        `Query has ${scopeLabel} predicate but does not constrain requested scope values. Scope values: ${valuesText}.`
      );
    }
    const hasWeakDisjunction = hasWeakScopeDisjunctionInWhereClause(
      deps,
      normalizedSqlWithValues,
      requirement
    );
    if (hasWeakDisjunction) {
      const scopeLabel = toRuntimeScopeDimensionLabel(requirement.dimension);
      const valuesText = requirement.values.join(" | ");
      throw deps.createAgentPolicyError(
        "AGENT_SCOPE_FILTER_WEAK_CONSTRAINT",
        `Query contains weak OR branches that can bypass ${scopeLabel} scope constraints. Scope values: ${valuesText}.`
      );
    }
  }
}
function ensureFinancialQueryAllowed(deps, sqlQuery, settings, conversationMemory) {
  const activeCatalog = deps.findActiveSchemaCatalog(settings);
  if (!activeCatalog || activeCatalog.tables.length === 0) {
    return;
  }
  const referencedTables = extractReferencedTableRefs(sqlQuery);
  if (referencedTables.length === 0) {
    throw new Error(
      "Financial query must reference at least one base table in FROM/JOIN/APPLY clauses."
    );
  }
  const allowedRefs = buildAllowedFinancialTableRefs(deps, activeCatalog);
  const catalogTableNameIndex = buildCatalogTableNameIndex(deps, activeCatalog);
  const cteNames = extractCteNames(sqlQuery);
  validateCatalogColumnReferences(deps, sqlQuery, activeCatalog, allowedRefs, cteNames);
  const activeDatabaseName = normalizeSqlIdentifier(activeCatalog.databaseName);
  let validatedRefCount = 0;
  for (const tableRef of referencedTables) {
    if (tableRef.partCount > 4) {
      throw new Error(
        `Table reference [${tableRef.raw}] is invalid. Maximum identifier depth is 4 parts.`
      );
    }
    if (tableRef.serverName) {
      throw new Error(
        `Linked-server reference [${tableRef.raw}] is not allowed in financial data queries.`
      );
    }
    if (tableRef.databaseName && activeDatabaseName && tableRef.databaseName !== activeDatabaseName) {
      throw new Error(
        `Cross-database reference [${tableRef.raw}] is not allowed. Active database is [${activeCatalog.databaseName}].`
      );
    }
    if (tableRef.schemaTable) {
      if (!allowedRefs.has(tableRef.schemaTable)) {
        throw new Error(
          `Table reference [${tableRef.raw}] is outside the allowed financial catalog scope.`
        );
      }
      validatedRefCount += 1;
      continue;
    }
    if (cteNames.has(tableRef.tableName)) {
      continue;
    }
    const catalogMatches = catalogTableNameIndex.get(tableRef.tableName);
    if (!catalogMatches || catalogMatches.size === 0) {
      continue;
    }
    const hasAllowedMatch = [...catalogMatches].some((candidate) => allowedRefs.has(candidate));
    if (!hasAllowedMatch) {
      throw new Error(
        `Table reference [${tableRef.raw}] is outside the allowed financial catalog scope.`
      );
    }
    validatedRefCount += 1;
  }
  if (validatedRefCount === 0) {
    throw new Error(
      "Financial query must reference at least one allowed base table (schema.table) from discovered catalog."
    );
  }
  if (conversationMemory) {
    const scopeRequirements = buildRuntimeScopeFilterRequirements(
      deps,
      settings,
      conversationMemory
    );
    if (scopeRequirements.length > 0) {
      ensureRuntimeScopeFilters(deps, sqlQuery, scopeRequirements);
    }
  }
  ensurePersonNameSearchPolicy(deps, sqlQuery);
}
const FINANCIAL_SCHEMA_GUIDE = [
  "Database schema context (logical map; verify actual tables and columns before final SELECT):",
  "- Accounts / Chart of Accounts: account_id, account_code (کل/معین/تفضیلی), account_name, account_type, parent_account_id, is_active",
  "- Documents / Voucher Headers: document_id, document_no, document_date, fiscal_year, branch_id, status",
  "- Ledger / Journal Lines: line_id, document_id, account_id, debit_amount, credit_amount, line_description, cost_center_id",
  "- Transactions / Cashflow: transaction_id, transaction_date, amount, direction, account_id, counterparty_id, reference_no",
  "- Parties / Counterparties: party_id, party_code, party_name, category, national_id",
  "- Optional dimensions: project_id, cost_center_id, currency_code, exchange_rate, tax_amount",
  "Vendor schema-prefix hints (apply when the connected product matches; always verify with get_database_schema):",
  "- Sepidar: discovery tools (list_database_tables / catalog_scan) filter TABLE_NAME only, so search lowercase table-name tokens like '%invoice%', '%purchase%', '%account%', '%cash%' (NOT the schema name). The schema appears in the result's TABLE_SCHEMA column, then call get_database_schema(table_name, schema_name). Sepidar schemas: sales=SLS (Invoice/InvoiceItem), purchases=POM (PurchaseInvoice/PurchaseCost), accounts=ACC (Account), cash/bank=RPA (CashBalance/BankAccountBalance), inventory=Inv (Voucher).",
  "- Fiscal-year filtering (CRITICAL): columns ending in 'Ref' (e.g. SLS.Invoice.FiscalYearRef) are SURROGATE foreign keys, NOT the literal Shamsi year. NEVER write `WHERE FiscalYearRef = 1403` — it returns 0 rows because FiscalYearRef holds an internal id (e.g. 1, 2, 3...), not 1403. To filter by a fiscal year, JOIN the fiscal-year definition table and filter on its TITLE. For Sepidar the definition table is FMK.FiscalYear (FiscalYearId = PK, Title = the actual year text like '1403', StartDate/EndDate = the period). Example: `SELECT SUM(i.NetPriceInBaseCurrency) AS TotalSales FROM SLS.Invoice i JOIN FMK.FiscalYear fy ON i.FiscalYearRef = fy.FiscalYearId WHERE fy.Title = N'1403'`. Always verify the join column and Title value with get_database_schema before the final SELECT.",
  "- Unsupported SQL functions on this SQL Server: FORMAT(), dbo.GregorianToShamsi, FOR JSON, FOR XML, DATEFROMPARTS(), and EOMONTH() are not available. For monthly grouping use MONTH(Date)/YEAR(Date) or explicit Gregorian date ranges instead.",
  "- Sales KPI lock: for net sales use SLS.Invoice.NetPriceInBaseCurrency. PriceInBaseCurrency is gross price, not the default KPI. If the user does not specify gross vs net, assume net sales.",
  "- Purchases KPI lock: for total purchase amounts prefer POM.PurchaseInvoice.PriceInBaseCurrency or the confirmed purchase cost table/column from schema inspection; if a purchase question asks for a total and the first candidate is NULL, inspect an alternate numeric purchase column/table before finalizing.",
  '- Purchase data-source fallback: if POM.PurchaseInvoice returns 0 rows, check INV.InventoryReceipt (TotalPrice) as the actual purchase source for this business process. INV.InventoryReceipt has Type/PurchaseType/IsReturn columns to filter for actual purchases (exclude returns). If data is found in INV.InventoryReceipt, explicitly state that the amount comes from inventory receipts, not purchase invoices. If both sources are empty, return VALID_EMPTY with an honest "no purchase documents" message.',
  "- Debt / receivables mapping start point: for debt or receivables questions (بدهی/مطالبات/دریافتنی), start from the general ledger / voucher tables (for Sepidar, ACC/Voucher or related voucher items) and verify the balance column with get_database_schema before writing the final SELECT; if the meaning is ambiguous, ask for clarification instead of guessing.",
  "- Account balance / turnover (مانده حساب / گردش حساب / بدهکار / بستانکار): map to ACC.Voucher (header, holds fiscal-year scope) JOIN ACC.VoucherItem (lines, hold per-account debit/credit). Compute balance as SUM(Debit) - SUM(Credit) grouped by AccountRef. Always read the actual debit/credit column names with get_database_schema before the final SELECT — do not guess between Debit/DebitAmount/DebitBaseCurrency. Scope the query by joining the fiscal-year table on Title (e.g. FMK.FiscalYear.Title = N'1403') rather than passing the Shamsi year directly to FiscalYearRef.",
  "Date and type handling policy:",
  "- Always identify if dates are Gregorian (DATE/DATETIME) or Shamsi/Persian text values before filtering.",
  "- For Shamsi text dates (e.g. 1403/01/15), keep format-consistent comparisons and avoid unsafe casts.",
  "- For Gregorian datetime columns, use precise range predicates and explicit ORDER BY.",
  "- Validate numeric/text code types (especially account codes) before joins or predicates."
].join("\n");
const RESPONSE_POLICY_GUIDE = [
  "Tool usage and reporting policy:",
  "- Always use tools when data is required. Never invent rows, totals, or schema fields.",
  "- The financial schema map is a logical guide, not a guaranteed physical schema for every customer database.",
  "- Discovery strategy for unknown databases: Step 1) call list_database_tables or catalog_scan for candidate tables, Step 2) call get_database_schema, Step 3) write final SELECT with fetch_financial_data.",
  "- Tool-call budget: maximum 5 tool calls per round and maximum 10 tool calls per request.",
  "- For fetch_financial_data, use in-scope financial catalog tables from current database only; cross-database/server references are blocked.",
  "- If unsure about columns or table names, never guess; discover metadata with tools first.",
  "- If the user specifies multiple companies/fiscal years/branches, preserve all scopes in SQL filters and keep scope labels visible in the output.",
  "- Analyze tool responses carefully before writing conclusions or recommendations.",
  "- Sensitive identifiers (national ID, mobile, account/card/IBAN values) may be redacted in tool outputs for privacy.",
  "- Return final answers in clean Markdown with sections: Summary, Findings, Evidence, Actions.",
  "- When trend data exists, include a compact text chart (ASCII) plus a short interpretation.",
  "- Explicitly state assumptions about date format, account-code level, and currency."
].join("\n");
const SYSTEM_PROMPT = [
  "You are ACC Assist, an enterprise financial analyst assistant specialized in SQL Server financial databases.",
  "You can use these tools: catalog_scan(table_pattern?, limit?), list_database_tables(table_pattern?), get_database_schema(table_name, schema_name?), and fetch_financial_data(sql_query).",
  "Use only read-only SELECT/CTE SELECT queries. Never request UPDATE/DELETE/INSERT/DDL statements.",
  "Treat FINANCIAL_SCHEMA_GUIDE as a logical reference only; real table names may differ across databases.",
  "If the database is unknown, follow this strategy strictly: Step 1 catalog_scan or list_database_tables to find candidate tables, Step 2 get_database_schema, Step 3 fetch_financial_data.",
  "Before generating SQL, reason about data types, date calendar format (Shamsi vs Gregorian), and account code hierarchy.",
  FINANCIAL_SCHEMA_GUIDE,
  RESPONSE_POLICY_GUIDE
].join("\n\n");
const MAX_CHAT_HISTORY = 28;
const REFINEMENT_INTENT_PATTERNS = [
  /^(نه|نخیر|اصلاح|دقیقا|منظورم|همین|همان|فقط|با این تفاوت)/iu,
  /\b(قبلی|مثل قبل|همون قبلی|همان قبلی)\b/iu,
  /\b(instead|same as before|previous|correction|adjust)\b/i
];
function compactHistory(deps, history, memory) {
  const clean = history.filter((message) => message.role !== "system");
  if (clean.length <= MAX_CHAT_HISTORY) {
    return clean;
  }
  const tailCount = MAX_CHAT_HISTORY - 1;
  const tail = clean.slice(-tailCount);
  const head = clean.slice(0, clean.length - tailCount);
  const summary = buildHistorySummary(deps, head);
  if (memory) {
    deps.pushConversationMemoryNote(
      memory,
      `Trimmed history summary: ${deps.compactText(summary.replace(/\s+/g, " "), 220)}`
    );
  }
  return [
    {
      role: "assistant",
      content: summary
    },
    ...tail
  ];
}
function buildHistorySummary(deps, messages) {
  if (messages.length === 0) {
    return "Conversation summary: earlier context was trimmed.";
  }
  const userMessages = messages.filter((message) => message.role === "user").slice(-6).map((message) => deps.compactText(message.content, 160));
  const assistantMessages = messages.filter((message) => message.role === "assistant" && !message.toolCalls).slice(-4).map((message) => deps.compactText(message.content, 160));
  const lines = ["Conversation summary from earlier turns:"];
  for (const userMessage of userMessages) {
    lines.push(`- User request: ${userMessage}`);
  }
  for (const assistantMessage of assistantMessages) {
    lines.push(`- Assistant insight: ${assistantMessage}`);
  }
  lines.push("Use this summary with the recent messages to continue accurately.");
  return lines.join("\n");
}
function buildRuntimeSystemPrompt(deps, settings, prompt, conversationMemory, previousMemorySnapshot) {
  const schemaContext = deps.buildSchemaCatalogContext(settings);
  const isRefinementPrompt = isLikelyRefinementPrompt(previousMemorySnapshot, prompt);
  const historyWindowContext = buildHistoryWindowContext(isRefinementPrompt);
  const memoryContext = buildConversationMemoryContext(
    conversationMemory,
    isRefinementPrompt
  );
  const refinementContext = isRefinementPrompt ? buildRefinementContext(deps, previousMemorySnapshot, prompt) : null;
  const freshContext = buildFreshConversationContext(previousMemorySnapshot, prompt);
  const intentContext = buildPromptIntentContext(deps, settings, prompt);
  const segments = [SYSTEM_PROMPT];
  if (schemaContext) {
    segments.push(schemaContext);
  }
  if (historyWindowContext) {
    segments.push(historyWindowContext);
  }
  if (memoryContext) {
    segments.push(memoryContext);
  }
  if (refinementContext) {
    segments.push(refinementContext);
  } else if (freshContext) {
    segments.push(freshContext);
  }
  if (intentContext) {
    segments.push(intentContext);
  }
  return segments.join("\n\n");
}
function buildHistoryWindowContext(isRefinementPrompt) {
  const modeLabel = isRefinementPrompt ? "refinement" : "fresh";
  return [
    "Effective history window:",
    `- Current mode: ${modeLabel}.`,
    "- Keep the latest 6 user turns and 4 assistant turns in the active working context.",
    "- Summarize earlier turns into compact context, and do not let stale prior-memory assumptions override a fresh prompt unless the user explicitly asks to continue."
  ].join("\n");
}
function buildConversationMemoryContext(memory, usePersistentHeader = true) {
  const mappingEntries = Object.entries(memory.facts.confirmedMappings).filter(([, tableRef]) => typeof tableRef === "string" && tableRef.trim()).slice(0, 6).map(([conceptKey, tableRef]) => `${conceptKey}=${tableRef}`);
  const lines = [];
  if (memory.facts.companyNames.length > 0) {
    lines.push(`- Company scope: ${memory.facts.companyNames.join(" | ")}`);
  }
  if (memory.facts.fiscalYears.length > 0) {
    lines.push(`- Fiscal year scope: ${memory.facts.fiscalYears.join(" | ")}`);
  }
  if (memory.facts.branchNames.length > 0) {
    lines.push(`- Branch scope: ${memory.facts.branchNames.join(" | ")}`);
  }
  if (memory.facts.companyNames.length > 1 || memory.facts.fiscalYears.length > 1 || memory.facts.branchNames.length > 1) {
    lines.push(
      "- Multi-scope runtime policy: keep all scope values in SQL filters (prefer IN clauses) and label output rows by company/fiscal year/branch when available."
    );
  }
  if (memory.facts.dateRange) {
    lines.push(`- Date range focus: ${memory.facts.dateRange}`);
  }
  if (mappingEntries.length > 0) {
    lines.push(`- Confirmed mappings: ${mappingEntries.join(" | ")}`);
  }
  if (memory.lastUserPrompt) {
    lines.push(`- Last user prompt: ${memory.lastUserPrompt}`);
  }
  if (memory.lastAssistantOutcome) {
    lines.push(`- Last assistant outcome: ${memory.lastAssistantOutcome}`);
  }
  if (memory.lastToolTrace.length > 0) {
    lines.push(`- Recent tool traces: ${memory.lastToolTrace.slice(-3).join(" || ")}`);
  }
  const memoryNotes = memory.notes.slice(-4);
  for (const note of memoryNotes) {
    lines.push(`- ${note}`);
  }
  if (lines.length === 0) {
    return null;
  }
  if (!usePersistentHeader) {
    return lines.join("\n");
  }
  return ["Persistent conversation memory (survives trimmed history):", ...lines].join("\n");
}
function buildFreshConversationContext(previousMemory, prompt) {
  if (isLikelyRefinementPrompt(previousMemory, prompt)) {
    return null;
  }
  const hasPriorContext = Boolean(
    previousMemory.lastUserPrompt || previousMemory.lastAssistantOutcome
  );
  if (!hasPriorContext) {
    return [
      "Fresh conversation mode is active:",
      "- Treat this prompt as a new analysis request unless the user explicitly says to reuse the previous answer.",
      "- Use only the current question, current schema catalog, and current tool outputs for planning.",
      "- Do not assume prior turn facts or KPI choices are still valid."
    ].join("\n");
  }
  return [
    "Fresh conversation mode is active:",
    "- The current prompt is not a refinement request, so reset the working assumption set before planning.",
    "- Re-derive KPI intent and scope from the current question only.",
    "- Keep prior memory as fallback context only when the user explicitly references it."
  ].join("\n");
}
function buildRefinementContext(deps, previousMemory, prompt) {
  if (!isLikelyRefinementPrompt(previousMemory, prompt)) {
    return null;
  }
  const extractedFacts = deps.extractConversationFacts(prompt);
  const lines = [
    "Multi-turn refinement mode is active:",
    "- Treat this prompt as an incremental correction to the previous answer, not a brand-new analysis.",
    "- Preserve prior assumptions/tables unless user explicitly changes them."
  ];
  if (previousMemory.lastUserPrompt) {
    lines.push(`- Previous user prompt: ${previousMemory.lastUserPrompt}`);
  }
  if (previousMemory.lastAssistantOutcome) {
    lines.push(`- Previous assistant outcome: ${previousMemory.lastAssistantOutcome}`);
  }
  if (previousMemory.lastToolTrace.length > 0) {
    lines.push(`- Previous tool traces: ${previousMemory.lastToolTrace.slice(-3).join(" || ")}`);
  }
  const overrides = [];
  if (extractedFacts.companyNames.length > 0) {
    overrides.push(`companies=${extractedFacts.companyNames.join(",")}`);
  }
  if (extractedFacts.fiscalYears.length > 0) {
    overrides.push(`fiscal_years=${extractedFacts.fiscalYears.join(",")}`);
  }
  if (extractedFacts.branchNames.length > 0) {
    overrides.push(`branches=${extractedFacts.branchNames.join(",")}`);
  }
  if (extractedFacts.dateRange) {
    overrides.push(`date_range=${extractedFacts.dateRange}`);
  }
  if (overrides.length > 0) {
    lines.push(`- Explicit user overrides in this turn: ${overrides.join(" | ")}`);
  }
  return lines.join("\n");
}
function isLikelyRefinementPrompt(previousMemory, prompt) {
  const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
  if (!normalizedPrompt) {
    return false;
  }
  const hasPriorContext = Boolean(
    previousMemory.lastUserPrompt || previousMemory.lastAssistantOutcome
  );
  if (!hasPriorContext) {
    return false;
  }
  if (REFINEMENT_INTENT_PATTERNS.some((pattern) => pattern.test(normalizedPrompt))) {
    return true;
  }
  if (normalizedPrompt.length <= 90 && /^(برای|فقط|با|بدون|روی|نه|این|آن|همین|همان|and|only|for)\b/iu.test(normalizedPrompt)) {
    return true;
  }
  return false;
}
function buildPromptIntentContext(deps, settings, prompt) {
  const activeCatalog = deps.findActiveSchemaCatalog(settings);
  if (!activeCatalog) {
    return null;
  }
  const detectedConcepts = deps.detectPromptConcepts(prompt);
  if (detectedConcepts.length === 0) {
    return null;
  }
  const lines = [
    "Prompt intent context derived from Persian/English finance synonyms:",
    `- Detected concepts: ${detectedConcepts.map((concept) => deps.schemaContextConceptLabels[concept]).join(", ")}`,
    "- Tool planning policy for this request:",
    "  - Prefer mapped tables for detected concepts.",
    "  - Call get_database_schema on mapped tables first before writing final SELECT when possible.",
    "  - Use list_database_tables only if mapped tables are missing or do not contain required fields.",
    "- Concept-to-table runtime hints:"
  ];
  let hasPreferredMapping = false;
  for (const conceptKey of detectedConcepts) {
    const preferredMapping = deps.resolvePreferredMapping(activeCatalog, conceptKey, prompt);
    if (!preferredMapping) {
      lines.push(`  - ${deps.schemaContextConceptLabels[conceptKey]}: no mapped table available.`);
      continue;
    }
    hasPreferredMapping = true;
    const dateHint = deps.inferDateHintForTable(activeCatalog, preferredMapping.tableRef);
    const dateText = dateHint ? `; date_hint=${dateHint}` : "";
    lines.push(
      `  - ${deps.schemaContextConceptLabels[conceptKey]}: ${preferredMapping.tableRef} (source=${preferredMapping.source}${dateText})`
    );
  }
  if (!hasPreferredMapping) {
    lines.push(
      "  - No preferred mappings for detected concepts; proceed with standard discovery flow."
    );
  }
  return lines.join("\n");
}
const CONFIDENCE_TIE_EPSILON = 1e-9;
const MEMORY_INHERITED_SLOT_VALUE = "memory";
function transition(prompt, mem) {
  const candidates = scoreFinancialIntentCandidates(prompt);
  if (candidates.length === 0) {
    return { kind: "unroutable" };
  }
  const definitions = listFinancialIntentDefinitions();
  const responseModeOf = (intentId) => definitions.find((definition2) => definition2.id === intentId)?.responseMode;
  const winner = candidates[0];
  const tiedAtTop = candidates.filter(
    (candidate) => Math.abs(candidate.confidence - winner.confidence) < CONFIDENCE_TIE_EPSILON
  );
  if (tiedAtTop.length >= 2) {
    const winnerMode = responseModeOf(winner.intentId);
    const tiedSameMode = tiedAtTop.filter((candidate) => responseModeOf(candidate.intentId) === winnerMode);
    if (tiedSameMode.length >= 2) {
      return {
        kind: "ambiguous",
        candidates: tiedSameMode.map((candidate) => candidate.intentId)
      };
    }
  }
  const definition = definitions.find((entry) => entry.id === winner.intentId);
  if (!definition) {
    return { kind: "unroutable" };
  }
  const slots = { ...extractFinancialIntentSlots(prompt) };
  if (!slots.fiscalYear && mem.facts.fiscalYears.length > 0) {
    slots.fiscalYear = MEMORY_INHERITED_SLOT_VALUE;
  }
  if (!slots.dateRange && mem.facts.dateRange) {
    slots.dateRange = MEMORY_INHERITED_SLOT_VALUE;
  }
  const missing = definition.requiredSlots.find((slot) => !slots[slot]);
  if (missing) {
    return { kind: "need-slot", intentId: winner.intentId, missing };
  }
  return { kind: "classified", intentId: winner.intentId, slots };
}
const RELAXED_EXPLORATORY_INTENTS = /* @__PURE__ */ new Set([
  "get_account_balance",
  "get_cash_bank_balance",
  "get_trial_balance",
  "get_purchase_summary"
]);
const FISCAL_INTENTS = ["count_fiscal_years", "list_fiscal_years"];
const TOOL_INTENTS = [
  "get_account_balance",
  "get_party_balance",
  "get_cashflow_summary",
  "get_receivables_summary",
  "get_payables_summary",
  "get_purchase_summary",
  "get_trial_balance",
  "get_cash_bank_balance"
];
function classifyDeterministicIntent(deterministicIntent) {
  if (!deterministicIntent) {
    return { fiscalIntent: null, toolIntent: null, nonFiscalIntent: null };
  }
  const fiscalIntent = FISCAL_INTENTS.includes(deterministicIntent) ? deterministicIntent : null;
  const toolIntent = TOOL_INTENTS.includes(deterministicIntent) ? deterministicIntent : null;
  const nonFiscalIntent = !fiscalIntent && !toolIntent ? deterministicIntent : null;
  return { fiscalIntent, toolIntent, nonFiscalIntent };
}
function isRelaxedExploratoryIntent(intent) {
  return RELAXED_EXPLORATORY_INTENTS.has(intent);
}
const FINANCIAL_INTENT_FA_LABELS = {
  count_fiscal_years: "تعداد سال‌های مالی",
  list_fiscal_years: "فهرست سال‌های مالی",
  get_party_balance: "مانده طرف حساب",
  get_account_balance: "مانده حساب",
  get_account_turnover: "گردش حساب",
  get_cash_bank_balance: "مانده نقد و بانک",
  get_trial_balance: "تراز آزمایشی",
  get_sales_summary_by_period: "خلاصه فروش",
  get_purchase_summary: "خلاصه خرید",
  get_receivables_summary: "خلاصه دریافتنی‌ها",
  get_payables_summary: "خلاصه پرداختنی‌ها",
  get_cashflow_summary: "خلاصه جریان نقد",
  get_recent_or_suspicious_documents: "اسناد اخیر یا مشکوک"
};
const DATE_RANGE_AMBIGUITY_SIGNAL_PATTERN = /(بازه(?:\s*زمانی)?|دوره(?:\s*زمانی)?|range|period|date\s*range|time\s*range)/iu;
const DATE_RANGE_EXPLICIT_SCOPE_PATTERN = /((?:13|14|19|20)\d{2}|this|current|today|امسال|سال\s*جاری|ماه\s*جاری|فصل\s*جاری|month\s*to\s*date|quarter\s*to\s*date)/iu;
function buildDeterministicIntentClarificationResponse(intentId) {
  return [
    "### Summary",
    "Cannot answer reliably: این intent نیاز به مسیر deterministic و mapping دقیق schema دارد.",
    "",
    "### Findings",
    `- intent شناسایی شده: ${intentId}`,
    "- پاسخ بدون نگاشت و شواهد read-only قابل اتکا نیست.",
    "",
    "### Evidence",
    "- مسیر قطعی برای این intent در نسخه فعلی نیاز به validation دقیق schema و query دارد.",
    "",
    "### Actions",
    "- نگاشت جدول/ستون مربوطه را در schema catalog تکمیل کنید و سپس دوباره امتحان کنید."
  ].join("\n");
}
function buildClarificationResponseIfNeeded(deps, settings, prompt, conversationMemory) {
  const memorySnapshot = deps.createConversationMemorySnapshot(conversationMemory);
  const routeState = transition(prompt, memorySnapshot);
  const intentClarification = buildRouteStateClarification(prompt, routeState);
  if (intentClarification) {
    return intentClarification;
  }
  return buildSchemaReadinessClarificationIfNeeded(deps, settings, prompt, conversationMemory);
}
function buildRouteStateClarification(prompt, routeState) {
  switch (routeState.kind) {
    case "ambiguous":
      return buildAmbiguousIntentClarificationResponse(routeState.candidates);
    case "classified":
      if (routeState.intentId === "get_sales_summary_by_period") {
        return buildSalesKpiClarificationResponseIfNeeded(prompt);
      }
      return null;
    case "need-slot":
    case "unroutable":
    default:
      return null;
  }
}
function buildSchemaReadinessClarificationIfNeeded(deps, settings, prompt, conversationMemory) {
  const detectedConcepts = deps.detectPromptConcepts(prompt);
  if (detectedConcepts.length === 0) {
    return null;
  }
  const activeCatalog = deps.findActiveSchemaCatalog(settings);
  if (!activeCatalog) {
    return null;
  }
  const detectedExploratoryIntent = deps.detectDeterministicFinancialIntent(prompt);
  if (detectedExploratoryIntent && isRelaxedExploratoryIntent(detectedExploratoryIntent)) {
    return null;
  }
  const missingConceptMappings = detectedConcepts.filter(
    (conceptKey) => !deps.resolvePreferredMapping(activeCatalog, conceptKey, prompt)
  );
  if (missingConceptMappings.length > 0) {
    return buildMissingMappingsClarificationResponse(
      deps.schemaContextConceptLabels,
      activeCatalog,
      missingConceptMappings
    );
  }
  const extractedFacts = deps.extractConversationFacts(prompt);
  const hasPromptDateScope = extractedFacts.fiscalYears.length > 0 || Boolean(extractedFacts.dateRange);
  const hasMemoryDateScope = conversationMemory.facts.fiscalYears.length > 0 || Boolean(conversationMemory.facts.dateRange);
  const normalizedPromptDigits = deps.normalizePersianDigits(prompt);
  const hasAmbiguousDateSignal = DATE_RANGE_AMBIGUITY_SIGNAL_PATTERN.test(normalizedPromptDigits);
  const hasExplicitDateScope = DATE_RANGE_EXPLICIT_SCOPE_PATTERN.test(normalizedPromptDigits);
  if (hasAmbiguousDateSignal && !hasPromptDateScope && !hasMemoryDateScope && !hasExplicitDateScope) {
    return buildDateRangeClarificationResponse(activeCatalog);
  }
  return null;
}
function buildAmbiguousIntentClarificationResponse(candidates) {
  const optionLabels = candidates.map(
    (intentId) => FINANCIAL_INTENT_FA_LABELS[intentId] ?? intentId
  );
  return [
    "### Summary",
    "پرسش شما به بیش از یک گزارش مالی هم‌رده اشاره دارد و باید یکی را انتخاب کنید.",
    "",
    "### Findings",
    `- گزینه‌های محتمل: ${optionLabels.join("، ")}.`,
    "",
    "### Evidence",
    "- موتور وزنی تشخیص نیت این گزینه‌ها را با امتیاز یکسان و هم‌رده تشخیص داد.",
    "",
    "### Actions",
    "- لطفا مشخص کنید کدام‌یک از گزارش‌های بالا مدنظر شماست تا همان مسیر اجرا شود."
  ].join("\n");
}
function buildSalesKpiClarificationResponseIfNeeded(prompt) {
  const detection = detectSalesKpiContractCandidates(prompt);
  if (!detection.isAmbiguous) {
    return null;
  }
  const contractLabels = ["فروش ناخالص", "فروش خالص", "فروش دفتری"];
  return [
    "### Summary",
    "برای پاسخ دقیق فروش سالانه، باید نوع KPI را مشخص کنید.",
    "",
    "### Findings",
    "- پرسش شما بدون تعیین نوع فروش مطرح شده است.",
    `- گزینه‌های قابل قبول: ${contractLabels.join("، ")}.`,
    "",
    "### Evidence",
    "- در متن سوال، «فروش سالانه» به‌صورت کلی آمده و به بیش از یک قرارداد KPI اشاره می‌کند.",
    "",
    "### Actions",
    "- لطفا یکی از این گزینه‌ها را انتخاب کنید:",
    "- 1) فروش ناخالص",
    "- 2) فروش خالص",
    "- 3) فروش دفتری"
  ].join("\n");
}
function buildMissingMappingsClarificationResponse(schemaContextConceptLabels, activeCatalog, missingConceptMappings) {
  const missingLabels = missingConceptMappings.slice(0, 4).map((conceptKey) => schemaContextConceptLabels[conceptKey]).join(", ");
  return [
    "### Summary",
    "برای جلوگیری از تحلیل اشتباه، قبل از اجرای SQL باید نگاشت چند مفهوم مالی تایید شود.",
    "",
    "### Findings",
    `- دیتابیس فعال: ${activeCatalog.databaseName}.`,
    `- برای این مفاهیم نگاشت معتبر پیدا نشد: ${missingLabels}.`,
    "",
    "### Evidence",
    "- در catalog فعلی برای این مفاهیم neither selected mapping nor suggested mapping موجود نیست.",
    "",
    "### Actions",
    "- در بخش نگاشت schema، جدول مربوط به مفاهیم بالا را انتخاب و ذخیره کنید.",
    "- سپس همین سوال را دوباره ارسال کنید تا استخراج داده واقعی انجام شود."
  ].join("\n");
}
function buildDateRangeClarificationResponse(activeCatalog) {
  return [
    "### Summary",
    "برای جلوگیری از حدس زدن بازه زمانی، قبل از اجرای کوئری به تعیین بازه دقیق نیاز دارم.",
    "",
    "### Findings",
    `- دیتابیس فعال: ${activeCatalog.databaseName}.`,
    "- در پیام فعلی، بازه زمانی به صورت مبهم بیان شده است.",
    "",
    "### Evidence",
    "- هیچ سال مالی یا تاریخ شروع/پایان صریح در این turn پیدا نشد.",
    "",
    "### Actions",
    "- لطفا یکی از این دو حالت را مشخص کنید:",
    "- حالت ۱) سال مالی دقیق (مثل 1402 یا 1403).",
    "- حالت ۲) تاریخ شروع و پایان دقیق (مثل 1403/01/01 تا 1403/03/31)."
  ].join("\n");
}
const COMPANY_SCOPE_COLUMN_NAME_PATTERN = /company|firm|entity|organization|organisation|org|شرکت/iu;
const FISCAL_SCOPE_COLUMN_NAME_PATTERN = /fiscal|year|period|دوره|سال|مالی/iu;
const BRANCH_SCOPE_COLUMN_NAME_PATTERN = /branch|store|warehouse|شعبه|انبار/iu;
const YEAR_SAMPLE_PATTERN = /^(?:13|14|19|20)\d{2}$/;
const SHAMSI_DATE_SAMPLE_PATTERN = /^(?:13|14)\d{2}[\/-](?:0?[1-9]|1[0-2])[\/-](?:0?[1-9]|[12]\d|3[01])$/;
const SCHEMA_CONTEXT_CONCEPT_ORDER = [
  "accounts",
  "documents",
  "documentLines",
  "counterparties",
  "cashTransactions",
  "costCenters",
  "projects",
  "banks",
  "pettyCash"
];
const SCHEMA_CONTEXT_CONCEPT_LABELS = {
  accounts: "Accounts",
  documents: "Documents",
  documentLines: "Document lines",
  counterparties: "Counterparties",
  cashTransactions: "Cash transactions",
  costCenters: "Cost centers",
  projects: "Projects",
  banks: "Banks",
  pettyCash: "Petty cash"
};
const PROMPT_INTENT_SYNONYMS = {
  accounts: [/حساب/iu, /سرفصل/iu, /معین/iu, /تفضیلی/iu, /\baccount(s)?\b/i, /\bledger\b/i],
  documents: [
    /سند/iu,
    /دفتر\s*روزنامه/iu,
    /خرید/iu,
    /فروش/iu,
    /\bdocument(s)?\b/i,
    /\bvoucher(s)?\b/i,
    /\binvoice(s)?\b/i,
    /\breceipt(s)?\b/i
  ],
  documentLines: [/ردیف\s*سند/iu, /تفصیلی\s*سند/iu, /\bdocument\s*line(s)?\b/i, /\bvoucher\s*item(s)?\b/i, /\binvoice\s*line(s)?\b/i],
  counterparties: [/طرف\s*حساب/iu, /مشتری/iu, /تأمین\s*کننده/iu, /\bcounterpart(y|ies)\b/i, /\bcustomer(s)?\b/i, /\bsupplier(s)?\b/i, /\bvendor(s)?\b/i, /\bparty\b/i],
  cashTransactions: [/نقد/iu, /جریان\s*نقد/iu, /\bcash\b/i, /\btransaction(s)?\b/i],
  costCenters: [/مرکز\s*هزینه/iu, /\bcost\s*center(s)?\b/i, /\bcost_center(s)?\b/i],
  projects: [/پروژه/iu, /\bproject(s)?\b/i],
  banks: [/بانک/iu, /چک/iu, /\bbank(s)?\b/i],
  pettyCash: [/تنخواه/iu, /صندوق/iu, /\bpetty\s*cash\b/i, /\bimprest\b/i]
};
function resolvePreferredMapping(deps, activeCatalog, conceptKey, prompt) {
  const semanticOverride = resolvePromptSemanticMappingOverride(
    deps,
    activeCatalog,
    conceptKey,
    prompt
  );
  if (semanticOverride) {
    return semanticOverride;
  }
  const selectedTable = activeCatalog.selectedMappings[conceptKey]?.trim() ?? "";
  if (selectedTable) {
    return {
      tableRef: selectedTable,
      source: "selected"
    };
  }
  const suggestedTable = activeCatalog.suggestedMappings[conceptKey]?.[0]?.trim() ?? "";
  if (suggestedTable) {
    return {
      tableRef: suggestedTable,
      source: "suggested"
    };
  }
  return null;
}
function resolvePromptSemanticMappingOverride(deps, activeCatalog, conceptKey, prompt) {
  if (conceptKey !== "documents" || !prompt) {
    return null;
  }
  const normalizedPrompt = deps.normalizePersianDigits(prompt).trim().toLowerCase();
  const purchaseSignals = /(خرید|purchase|purchases|buy|procure|procurement|supplier|vendors?|receipts?|رسید|انبار|inventory|voucher|purchaseinvoice)/iu;
  const salesSignals = /(فروش|sale|sales|revenue|customer|salefacts)/iu;
  const candidates = (activeCatalog.suggestedMappings[conceptKey] ?? []).map((tableRef) => tableRef?.trim() ?? "").filter(Boolean);
  if (purchaseSignals.test(normalizedPrompt)) {
    const purchaseCandidate = candidates.find(
      (tableRef) => /(voucher|receipt|inventory|purchase|buy|procure|supplier|vendor|item)/iu.test(tableRef)
    );
    if (purchaseCandidate) {
      return {
        tableRef: purchaseCandidate,
        source: "suggested"
      };
    }
  }
  if (salesSignals.test(normalizedPrompt)) {
    const salesCandidate = candidates.find(
      (tableRef) => /(sale|sales|revenue|mrp)/iu.test(tableRef)
    );
    if (salesCandidate) {
      return {
        tableRef: salesCandidate,
        source: "suggested"
      };
    }
  }
  return null;
}
function detectPromptConcepts(prompt) {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return [];
  }
  return SCHEMA_CONTEXT_CONCEPT_ORDER.filter((conceptKey) => {
    const patterns = PROMPT_INTENT_SYNONYMS[conceptKey];
    return patterns.some((pattern) => pattern.test(normalizedPrompt));
  });
}
function inferDateHintForTable(activeCatalog, tableRef) {
  const selectedDateMode = normalizeSchemaDateMode$1(activeCatalog.selectedDateMode);
  if (selectedDateMode && selectedDateMode !== "unknown") {
    return `${toDateModeHintText(selectedDateMode)} (catalog selected mode)`;
  }
  const normalizedTableRef = normalizeTableRef(tableRef);
  const targetTable = activeCatalog.tables.find((table) => {
    return normalizeTableRef(`${table.schemaName}.${table.tableName}`) === normalizedTableRef;
  });
  if (!targetTable) {
    return null;
  }
  const shamsiTextPattern = /^(13|14)\d{2}[/-](0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])$/;
  const shamsiNumericPattern = /^(13|14)\d{6}$/;
  let hasGregorianDateType = false;
  let hasShamsiText = false;
  let hasShamsiNumeric = false;
  let hasFiscalPeriod = false;
  const relatedDateColumns = [];
  for (const column of targetTable.columns) {
    const dataType = column.dataType.toLowerCase();
    const columnName = column.name.toLowerCase();
    const samples = column.sampleValues.map((value) => value.trim());
    if (dataType.includes("date") || dataType.includes("time")) {
      hasGregorianDateType = true;
      relatedDateColumns.push(column.name);
    }
    if (columnName.includes("fiscal") || columnName.includes("period") || columnName.includes("دوره") || columnName.includes("سال")) {
      hasFiscalPeriod = true;
      relatedDateColumns.push(column.name);
    }
    if (samples.some((sample) => shamsiTextPattern.test(sample))) {
      hasShamsiText = true;
      relatedDateColumns.push(column.name);
    }
    if (samples.some((sample) => shamsiNumericPattern.test(sample))) {
      hasShamsiNumeric = true;
      relatedDateColumns.push(column.name);
    }
  }
  const uniqueDateColumns = [...new Set(relatedDateColumns)].slice(0, 3);
  const columnHint = uniqueDateColumns.length > 0 ? ` (columns: ${uniqueDateColumns.join(", ")})` : "";
  if (hasFiscalPeriod) {
    return `fiscal period${columnHint}`;
  }
  if (hasShamsiText) {
    return `shamsi text date${columnHint}`;
  }
  if (hasShamsiNumeric) {
    return `shamsi numeric date${columnHint}`;
  }
  if (hasGregorianDateType) {
    return `gregorian date/datetime${columnHint}`;
  }
  const detectedDateMode = normalizeSchemaDateMode$1(activeCatalog.detectedDateMode);
  if (detectedDateMode && detectedDateMode !== "unknown") {
    return `${toDateModeHintText(detectedDateMode)} (catalog detected mode)`;
  }
  return null;
}
function normalizeSchemaDateMode$1(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  switch (normalized) {
    case "unknown":
    case "gregorian":
    case "shamsiText":
    case "shamsiNumeric":
    case "fiscalPeriod":
    case "mixed":
      return normalized;
    default:
      return null;
  }
}
function toDateModeHintText(mode) {
  switch (mode) {
    case "gregorian":
      return "gregorian date/datetime";
    case "shamsiText":
      return "shamsi text date";
    case "shamsiNumeric":
      return "shamsi numeric date";
    case "fiscalPeriod":
      return "fiscal period";
    case "mixed":
      return "mixed date formats";
    case "unknown":
    default:
      return "unknown date mode";
  }
}
function normalizeTableRef(tableRef) {
  return tableRef.trim().toLowerCase();
}
function buildSchemaCatalogContext(deps, settings) {
  const activeCatalog = findActiveSchemaCatalog(settings);
  if (!activeCatalog) {
    return null;
  }
  const contextLines = [
    "Runtime schema catalog context (active connection profile):",
    `- Profile ID: ${activeCatalog.profileId}`,
    `- Database: ${activeCatalog.databaseName}`,
    `- Catalog discovered at: ${activeCatalog.discoveredAt}`,
    "- Mapping policy: user-selected mappings are higher priority than suggestions.",
    "- When selected mapping exists, prefer that table and verify columns with get_database_schema before final SELECT."
  ];
  const detectedSoftware = activeCatalog.detectedSoftware;
  const selectedSoftwareId = activeCatalog.selectedSoftwareId ?? null;
  const selectedSoftwareName = selectedSoftwareId ? toAccountingSoftwareDisplayName(selectedSoftwareId) : null;
  const effectiveSoftwareId = selectedSoftwareId ?? detectedSoftware?.id ?? null;
  const effectiveSoftwareName = selectedSoftwareName ?? detectedSoftware?.name ?? null;
  const effectiveSoftwareSource = selectedSoftwareId ? "manual override" : detectedSoftware ? "auto-detected" : "not-detected";
  const candidateText = (activeCatalog.softwareCandidates ?? []).slice(0, 3).map((candidate) => `${candidate.name}:${candidate.confidence.toFixed(2)}`).join(" | ");
  const effectiveCandidate = effectiveSoftwareId ? (activeCatalog.softwareCandidates ?? []).find(
    (candidate) => candidate.id === effectiveSoftwareId
  ) : void 0;
  if (effectiveSoftwareId && effectiveSoftwareName) {
    const confidenceText = effectiveCandidate ? `, confidence=${effectiveCandidate.confidence.toFixed(2)}` : "";
    contextLines.splice(
      4,
      0,
      `- Effective accounting software: ${effectiveSoftwareName} (id=${effectiveSoftwareId}, source=${effectiveSoftwareSource}${confidenceText}${candidateText ? `; candidates=${candidateText}` : ""}).`
    );
  } else {
    contextLines.splice(
      4,
      0,
      "- Accounting software detection: no reliable software profile detected yet."
    );
  }
  if (effectiveSoftwareId === "sepidar") {
    contextLines.splice(5, 0, ...buildSepidarSchemaHintLines());
  }
  const detectedDateMode = normalizeSchemaDateMode$1(activeCatalog.detectedDateMode) ?? "unknown";
  const selectedDateMode = normalizeSchemaDateMode$1(activeCatalog.selectedDateMode);
  const effectiveDateMode = selectedDateMode ?? detectedDateMode;
  const dateModeSource = selectedDateMode ? "selected override" : "detected mode";
  contextLines.splice(
    6,
    0,
    `- Date mode policy: effective=${effectiveDateMode}; source=${dateModeSource}; detected=${detectedDateMode}; selected=${selectedDateMode ?? "(auto)"}.`
  );
  if (activeCatalog.dateEvidence && activeCatalog.dateEvidence.length > 0) {
    contextLines.splice(
      7,
      0,
      `- Date mode evidence: ${activeCatalog.dateEvidence.slice(0, 3).join(" | ")}`
    );
  }
  contextLines.push("- Runtime scope hints (multi-company / multi-fiscal / multi-branch):");
  contextLines.push(...buildRuntimeScopeHintLines(deps, activeCatalog));
  contextLines.push("- Concept mapping hints:");
  let hasMappingLine = false;
  for (const conceptKey of SCHEMA_CONTEXT_CONCEPT_ORDER) {
    const selectedTable = activeCatalog.selectedMappings[conceptKey]?.trim() ?? "";
    const suggestedPrimary = activeCatalog.suggestedMappings[conceptKey]?.[0]?.trim() ?? "";
    if (!selectedTable && !suggestedPrimary) {
      continue;
    }
    const selectedText = selectedTable || "(none)";
    const suggestedText = suggestedPrimary || "(none)";
    contextLines.push(
      `  - ${SCHEMA_CONTEXT_CONCEPT_LABELS[conceptKey]}: selected=${selectedText}; suggested=${suggestedText}`
    );
    hasMappingLine = true;
  }
  if (!hasMappingLine) {
    contextLines.push("  - No selected/suggested mappings available for this database yet.");
  }
  return contextLines.join("\n");
}
function buildSepidarSchemaHintLines() {
  return [
    "- Sepidar schema-prefix map (discovery tools filter TABLE_NAME only — search lowercase table-name tokens, never the schema name; the schema is returned in the TABLE_SCHEMA column):",
    "  - Sales (فروش / فاکتور فروش / فاکتورهای فروش): table-name tokens '%invoice%' (Invoice, InvoiceItem); schema = SLS. Then get_database_schema(table_name 'Invoice', schema_name 'SLS').",
    "  - Purchases (خرید / فاکتور خرید / هزینه خرید): table-name tokens '%purchase%' (PurchaseInvoice, PurchaseCost, PurchaseCostItem); schema = POM.",
    "  - Accounts / Chart of accounts (حساب / سرفصل / دفتر کل): table-name token '%account%' (Account); schema = ACC.",
    "  - Accounting vouchers / ledger lines (مانده حساب / گردش حساب / بدهکار / بستانکار / سند حسابداری): table-name tokens '%voucher%' / '%voucheritem%' (Voucher, VoucherItem); schema = ACC. For balance use SUM(Debit) - SUM(Credit) on ACC.VoucherItem grouped by AccountRef, JOIN ACC.Voucher header for fiscal-year scope. Always read the actual debit/credit column names with get_database_schema before writing the SELECT — do not guess between Debit/DebitAmount/DebitBaseCurrency.",
    "  - Cash and bank (نقد / بانک / موجودی): table-name tokens '%cash%' / '%bank%' (CashBalance, BankAccountBalance); schema = RPA.",
    "  - Inventory receipts / vouchers (انبار / رسید کالا): table-name token '%voucher%' (Voucher); schema = Inv. (Note: distinct from ACC vouchers.)",
    "  - Fiscal-year columns (e.g. FiscalYearRef) may be surrogate keys, not the literal Shamsi year; if a year filter returns 0 rows, inspect the fiscal-year lookup table to resolve the correct ref id before concluding no data exists.",
    "  - Prefer the schema-qualified domain table (e.g. SLS.Invoice) over generic dbo tables for sales/purchase summaries."
  ];
}
function toAccountingSoftwareDisplayName(softwareId) {
  switch (softwareId) {
    case "sepidar":
      return "Sepidar";
    case "mahak":
      return "Mahak";
    default:
      return softwareId;
  }
}
function findActiveSchemaCatalog(settings) {
  const activeProfileId = settings.activeConnectionProfileId?.trim();
  const activeDatabaseName = settings.sql.database?.trim().toLowerCase();
  if (!activeProfileId || !activeDatabaseName) {
    return null;
  }
  const activeCatalog = settings.schemaCatalogs.find((entry) => {
    return entry.profileId === activeProfileId && entry.databaseName.trim().toLowerCase() === activeDatabaseName;
  });
  return activeCatalog ?? null;
}
function buildRuntimeScopeHintLines(deps, activeCatalog) {
  const candidates = collectRuntimeScopeColumnCandidates(deps, activeCatalog);
  const companyHints = formatRuntimeScopeDimensionHints(
    deps,
    candidates.filter((candidate) => candidate.dimension === "company")
  );
  const fiscalHints = formatRuntimeScopeDimensionHints(
    deps,
    candidates.filter((candidate) => candidate.dimension === "fiscalYear")
  );
  const branchHints = formatRuntimeScopeDimensionHints(
    deps,
    candidates.filter((candidate) => candidate.dimension === "branch")
  );
  const lines = [];
  if (companyHints) {
    lines.push(`  - Company columns: ${companyHints}`);
  }
  if (fiscalHints) {
    lines.push(`  - Fiscal-year columns: ${fiscalHints}`);
  }
  if (branchHints) {
    lines.push(`  - Branch columns: ${branchHints}`);
  }
  if (lines.length === 0) {
    lines.push(
      "  - Scope columns were not detected confidently; inspect mapped tables with get_database_schema before applying company/year/branch filters."
    );
  }
  return lines;
}
function collectRuntimeScopeColumnCandidates(deps, activeCatalog) {
  const candidates = [];
  for (const table of activeCatalog.tables) {
    const tableRef = `${table.schemaName}.${table.tableName}`;
    for (const column of table.columns) {
      const sampleValues = column.sampleValues.map((sample) => sample.trim()).filter((sample) => Boolean(sample));
      const score = scoreRuntimeScopeColumn(deps, column.name, sampleValues);
      const samplePreview = sampleValues.slice(0, 2).join(", ") || null;
      if (score.company > 0) {
        candidates.push({
          dimension: "company",
          tableRef,
          columnName: column.name,
          score: score.company,
          samplePreview
        });
      }
      if (score.fiscalYear > 0) {
        candidates.push({
          dimension: "fiscalYear",
          tableRef,
          columnName: column.name,
          score: score.fiscalYear,
          samplePreview
        });
      }
      if (score.branch > 0) {
        candidates.push({
          dimension: "branch",
          tableRef,
          columnName: column.name,
          score: score.branch,
          samplePreview
        });
      }
    }
  }
  const dedupedByDimensionAndColumn = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    const key = `${candidate.dimension}:${normalizeTableRef(candidate.tableRef)}.${candidate.columnName.toLowerCase()}`;
    const existing = dedupedByDimensionAndColumn.get(key);
    if (!existing || candidate.score > existing.score) {
      dedupedByDimensionAndColumn.set(key, candidate);
    }
  }
  return [...dedupedByDimensionAndColumn.values()].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    const leftRef = `${left.tableRef}.${left.columnName}`.toLowerCase();
    const rightRef = `${right.tableRef}.${right.columnName}`.toLowerCase();
    return leftRef.localeCompare(rightRef);
  });
}
function scoreRuntimeScopeColumn(deps, columnName, sampleValues) {
  const normalizedName = normalizeColumnNameForScopeDetection(deps, columnName);
  const normalizedSamples = sampleValues.map((value) => deps.normalizePersianDigits(value));
  const hasTextualSample = normalizedSamples.some(
    (value) => /[a-z\u0600-\u06ff]{2,}/iu.test(value)
  );
  const hasYearLikeSample = normalizedSamples.some(
    (value) => YEAR_SAMPLE_PATTERN.test(value) || SHAMSI_DATE_SAMPLE_PATTERN.test(value)
  );
  let company = 0;
  let fiscalYear = 0;
  let branch = 0;
  if (COMPANY_SCOPE_COLUMN_NAME_PATTERN.test(normalizedName)) {
    company += 4;
    if (/(?:name|title|code|نام|کد)/iu.test(normalizedName)) {
      company += 1;
    }
  }
  if (FISCAL_SCOPE_COLUMN_NAME_PATTERN.test(normalizedName)) {
    fiscalYear += 4;
  }
  if (BRANCH_SCOPE_COLUMN_NAME_PATTERN.test(normalizedName)) {
    branch += 4;
    if (/(?:name|title|code|نام|کد)/iu.test(normalizedName)) {
      branch += 1;
    }
  }
  if (hasTextualSample) {
    if (company > 0) {
      company += 1;
    }
    if (branch > 0) {
      branch += 1;
    }
  }
  if (hasYearLikeSample && fiscalYear > 0) {
    fiscalYear += 2;
  }
  return {
    company,
    fiscalYear,
    branch
  };
}
function formatRuntimeScopeDimensionHints(deps, candidates) {
  if (candidates.length === 0) {
    return "";
  }
  return candidates.slice(0, 4).map((candidate) => {
    const columnRef = `${candidate.tableRef}.${candidate.columnName}`;
    const sampleText = candidate.samplePreview ? ` (samples=${deps.compactText(candidate.samplePreview, 44)})` : "";
    return `${columnRef}${sampleText}`;
  }).join(" | ");
}
function normalizeColumnNameForScopeDetection(deps, value) {
  return deps.normalizePersianDigits(value).replace(/[_\-.\[\]{}()]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
async function tryResolveFiscalYearFallback(deps, deterministicIntent, settings, conversationMemory, signal, onProgress) {
  const activeCatalog = deps.findActiveSchemaCatalog(settings);
  let toolCallsUsed = 0;
  let metadataRows = [];
  let fiscalCandidates = [];
  if (activeCatalog) {
    fiscalCandidates = deps.collectRuntimeScopeColumnCandidates(activeCatalog).filter((candidate) => candidate.dimension === "fiscalYear").slice(0, 8);
  }
  if (fiscalCandidates.length === 0) {
    metadataRows = await deps.executeMetadataSql(
      `SELECT TOP (48)
  c.TABLE_SCHEMA AS table_schema,
  c.TABLE_NAME AS table_name,
  c.COLUMN_NAME AS column_name
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')
  AND (
    c.COLUMN_NAME LIKE N'%fiscal%'
    OR c.COLUMN_NAME LIKE N'%year%'
    OR c.COLUMN_NAME LIKE N'%period%'
    OR c.COLUMN_NAME LIKE N'%سال%'
    OR c.COLUMN_NAME LIKE N'%مالی%'
    OR c.COLUMN_NAME LIKE N'%دوره%'
    OR c.TABLE_NAME LIKE N'%FiscalYear%'
    OR c.TABLE_NAME LIKE N'%Fiscal_Year%'
    OR c.TABLE_NAME LIKE N'%سال%مالی%'
    OR c.TABLE_NAME LIKE N'%دوره%مالی%'
  )
ORDER BY
  CASE WHEN c.TABLE_SCHEMA IN ('ACC', 'RPA') THEN 0 ELSE 1 END,
  c.TABLE_SCHEMA,
  c.TABLE_NAME,
  c.ORDINAL_POSITION`,
      signal
    );
    toolCallsUsed += 1;
    const metadataCandidates = [];
    for (const row of metadataRows) {
      const schemaName = String(row["table_schema"] ?? "").trim();
      const tableName = String(row["table_name"] ?? "").trim();
      const columnName = String(row["column_name"] ?? "").trim();
      if (!schemaName || !tableName || !columnName) {
        continue;
      }
      metadataCandidates.push({
        dimension: "fiscalYear",
        tableRef: `${schemaName}.${tableName}`,
        columnName,
        score: schemaName === "ACC" || schemaName === "RPA" ? 8 : 5,
        samplePreview: null
      });
    }
    fiscalCandidates = metadataCandidates.slice(0, 10);
  }
  if (fiscalCandidates.length === 0) {
    return null;
  }
  const successfulStats = [];
  for (const candidate of fiscalCandidates) {
    deps.throwIfRequestCanceled(signal);
    const tableRef = deps.parseSqlTableReference(candidate.tableRef);
    if (!tableRef?.schemaName || !tableRef.tableName) {
      continue;
    }
    const schemaIdentifier = deps.quoteSqlIdentifier(tableRef.schemaName);
    const tableIdentifier = deps.quoteSqlIdentifier(tableRef.tableName);
    const columnIdentifier = deps.quoteSqlIdentifier(candidate.columnName);
    const fromClause = `${schemaIdentifier}.${tableIdentifier}`;
    const statsQuery = `WITH fiscal_values AS (
  SELECT TRY_CONVERT(NVARCHAR(32), ${columnIdentifier}) AS fiscal_text
  FROM ${fromClause}
)
SELECT
  COUNT(DISTINCT TRY_CONVERT(INT, fiscal_text)) AS fiscal_year_count,
  MIN(TRY_CONVERT(INT, fiscal_text)) AS min_fiscal_year,
  MAX(TRY_CONVERT(INT, fiscal_text)) AS max_fiscal_year
FROM fiscal_values
WHERE fiscal_text LIKE '[12][0-9][0-9][0-9]'
  AND TRY_CONVERT(INT, fiscal_text) BETWEEN 1300 AND 2099`;
    try {
      const rows = await deps.executeReadOnlySql(statsQuery, signal);
      toolCallsUsed += 1;
      const row = rows[0];
      const count = deps.toFiniteInteger(row?.["fiscal_year_count"]);
      if (count <= 0) {
        continue;
      }
      successfulStats.push({
        candidate,
        count,
        minYear: deps.toOptionalFiniteInteger(row?.["min_fiscal_year"]),
        maxYear: deps.toOptionalFiniteInteger(row?.["max_fiscal_year"])
      });
    } catch {
    }
  }
  if (successfulStats.length === 0) {
    const fiscalTableRows = await deps.executeMetadataSql(
      `SELECT TOP (240)
  t.TABLE_SCHEMA AS table_schema,
  t.TABLE_NAME AS table_name
FROM INFORMATION_SCHEMA.TABLES t
WHERE t.TABLE_TYPE = 'BASE TABLE'
  AND t.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')
  AND (
    t.TABLE_NAME LIKE N'%FiscalYear%'
    OR t.TABLE_NAME LIKE N'%Fiscal_Year%'
    OR t.TABLE_NAME LIKE N'%Year%'
    OR t.TABLE_NAME LIKE N'%Period%'
    OR t.TABLE_NAME LIKE N'%سال%'
    OR t.TABLE_NAME LIKE N'%مالی%'
    OR t.TABLE_NAME LIKE N'%دوره%'
  )
ORDER BY
  CASE WHEN t.TABLE_SCHEMA IN ('FMK', 'ACC', 'RPA') THEN 0 ELSE 1 END,
  t.TABLE_SCHEMA,
  t.TABLE_NAME`,
      signal
    );
    toolCallsUsed += 1;
    if (metadataRows.length === 0) {
      metadataRows = await deps.executeMetadataSql(
        `SELECT TOP (240)
  c.TABLE_SCHEMA AS table_schema,
  c.TABLE_NAME AS table_name,
  c.COLUMN_NAME AS column_name
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')
ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
        signal
      );
      toolCallsUsed += 1;
    }
    for (const tableRow of fiscalTableRows) {
      const schemaName = String(tableRow["table_schema"] ?? "").trim();
      const tableName = String(tableRow["table_name"] ?? "").trim();
      if (!schemaName || !tableName) {
        continue;
      }
      metadataRows.push({
        table_schema: schemaName,
        table_name: tableName,
        column_name: ""
      });
    }
    const tableCandidates = /* @__PURE__ */ new Map();
    for (const row of metadataRows) {
      const schemaName = String(row["table_schema"] ?? "").trim();
      const tableName = String(row["table_name"] ?? "").trim();
      if (!schemaName || !tableName) {
        continue;
      }
      const normalizedTable = tableName.toLowerCase();
      const normalizedSchema = schemaName.toLowerCase();
      let score = 0;
      if (/fiscal\s*_?\s*year|سال\s*مالی|دوره\s*مالی/iu.test(tableName)) {
        score += 10;
      }
      if (/year|period|سال|دوره/iu.test(tableName)) {
        score += 4;
      }
      if (["fmk", "acc", "rpa"].includes(normalizedSchema)) {
        score += 3;
      }
      if (score <= 0) {
        continue;
      }
      const key = `${normalizedSchema}.${normalizedTable}`;
      const existing = tableCandidates.get(key);
      if (!existing || score > existing.score) {
        tableCandidates.set(key, {
          schemaName,
          tableName,
          score
        });
      }
    }
    const rankedTables = [...tableCandidates.values()].sort(
      (left, right) => right.score - left.score
    );
    for (const candidate of rankedTables.slice(0, 6)) {
      deps.throwIfRequestCanceled(signal);
      const fromClause = `${deps.quoteSqlIdentifier(candidate.schemaName)}.${deps.quoteSqlIdentifier(candidate.tableName)}`;
      const countQuery = `SELECT COUNT(1) AS fiscal_year_count FROM ${fromClause}`;
      try {
        const rows = await deps.executeReadOnlySql(countQuery, signal);
        toolCallsUsed += 1;
        const count = deps.toFiniteInteger(
          rows[0]?.["fiscal_year_count"]
        );
        if (count <= 0 || count > 300) {
          continue;
        }
        const tableRef = `${candidate.schemaName}.${candidate.tableName}`;
        deps.rememberToolTrace(
          conversationMemory,
          `fallback:${deterministicIntent} table=${tableRef} row_count=${count}`
        );
        deps.emitProgress(onProgress, {
          type: "tool-success",
          message: `✅ ابزار ${deterministicIntent} اجرا شد: ${count} سال مالی (row-count fallback) در ${tableRef}`,
          toolName: deterministicIntent,
          rowCount: count
        });
        return {
          count,
          years: [],
          tableRef,
          columnName: "(row-count)",
          minYear: null,
          maxYear: null,
          toolCallsUsed
        };
      } catch {
      }
    }
    return null;
  }
  successfulStats.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    if (right.candidate.score !== left.candidate.score) {
      return right.candidate.score - left.candidate.score;
    }
    return left.candidate.tableRef.localeCompare(right.candidate.tableRef);
  });
  const best = successfulStats[0];
  const bestRef = deps.parseSqlTableReference(best.candidate.tableRef);
  if (!bestRef?.schemaName || !bestRef.tableName) {
    return null;
  }
  const previewQuery = `WITH fiscal_values AS (
  SELECT DISTINCT TRY_CONVERT(INT, TRY_CONVERT(NVARCHAR(32), ${deps.quoteSqlIdentifier(best.candidate.columnName)})) AS fiscal_year
  FROM ${deps.quoteSqlIdentifier(bestRef.schemaName)}.${deps.quoteSqlIdentifier(bestRef.tableName)}
  WHERE TRY_CONVERT(NVARCHAR(32), ${deps.quoteSqlIdentifier(best.candidate.columnName)}) LIKE '[12][0-9][0-9][0-9]'
)
SELECT TOP (48) fiscal_year
FROM fiscal_values
WHERE fiscal_year BETWEEN 1300 AND 2099
ORDER BY fiscal_year DESC`;
  let previewYears = [];
  try {
    const previewRows = await deps.executeReadOnlySql(previewQuery, signal);
    toolCallsUsed += 1;
    previewYears = previewRows.map((row) => deps.toOptionalFiniteInteger(row["fiscal_year"])).filter((value) => value !== null);
  } catch {
    previewYears = [];
  }
  deps.rememberToolTrace(
    conversationMemory,
    `fallback:${deterministicIntent} table=${best.candidate.tableRef} column=${best.candidate.columnName} count=${best.count}`
  );
  deps.emitProgress(onProgress, {
    type: "tool-success",
    message: `✅ ابزار ${deterministicIntent} اجرا شد: ${best.count} سال مالی در ${best.candidate.tableRef}.${best.candidate.columnName}`,
    toolName: deterministicIntent,
    rowCount: best.count
  });
  return {
    count: best.count,
    years: previewYears,
    tableRef: best.candidate.tableRef,
    columnName: best.candidate.columnName,
    minYear: best.minYear,
    maxYear: best.maxYear,
    toolCallsUsed
  };
}
function composeDeterministicFinancialToolMarkdown(deterministicIntent, result) {
  const label = deterministicIntent === "get_account_balance" ? "مانده حساب" : deterministicIntent === "get_party_balance" ? "مانده طرف حساب" : deterministicIntent === "get_purchase_summary" ? "خلاصه خرید" : deterministicIntent === "get_receivables_summary" ? "خلاصه بدهکاران" : deterministicIntent === "get_payables_summary" ? "خلاصه بستانکاران" : "خلاصه جریان نقد";
  const isPurchaseFromInventory = deterministicIntent === "get_purchase_summary" && result.tableRef === "INV.InventoryReceipt";
  const hasNoData = result.value === null || result.value === 0;
  const summaryText = hasNoData ? `این گزارش با داده‌های موجود قابل تولید نیست. ${label} در جدول ${result.tableRef} خالی است.` : isPurchaseFromInventory ? `فاکتور خرید رسمی ثبت نشده؛ بر اساس رسید انبار (غیرمرجوعی)، ${label} محاسبه شد: ${result.value}` : `${label} بر اساس داده‌های read-only و mapping schema محاسبه شد: ${result.value} (نوع KPI: ${label})`;
  const assumptionsText = isPurchaseFromInventory ? "- مبلغ از رسید انبار `TotalPrice` با `IsReturn=0` است، نه فاکتور خرید رسمی." : "- از mapping انتخاب‌شده schema و ستون عددی قابل‌محاسبه استفاده شد؛ در صورت تفاوت نام ستون، نتیجه ممکن است محدود شود.";
  return [
    "### Summary",
    summaryText,
    "",
    "### Findings",
    `- مسیر پاسخ: deterministic`,
    `- intent قطعی: ${deterministicIntent}`,
    `- جدول/ستون مبنا: ${result.tableRef}.${result.columnName}`,
    "",
    "### Evidence",
    `- ابزار قطعی ${deterministicIntent} با ${result.toolCallsUsed} کوئری read-only اجرا شد.`,
    `- query: ${result.query}`,
    "",
    "### Assumptions",
    assumptionsText,
    "",
    "### Actions",
    "- اگر منظورتان حساب یا بازه زمانی خاصی است، scope دقیق‌تر را مشخص کنید."
  ].join("\n");
}
function composeFiscalYearDeterministicMarkdown(deterministicIntent, result) {
  const yearSpanText = result.minYear !== null && result.maxYear !== null ? `${result.minYear} تا ${result.maxYear}` : "نامشخص";
  const previewText = result.years.length > 0 ? result.years.join("، ") : "نمونه معتبر بازیابی نشد.";
  if (deterministicIntent === "list_fiscal_years") {
    const listedYears = result.years.length > 0 ? result.years.join("، ") : "سال مالی قابل اتکا یافت نشد.";
    return [
      "### Summary",
      `فهرست سال های مالی شناسایی شده (fiscal years): ${listedYears} (نوع KPI: سال مالی)`,
      "",
      "### Findings",
      "- مسیر پاسخ: deterministic",
      `- تعداد کل سال های مالی متمایز: ${result.count}`,
      `- بازه سال ها: ${yearSpanText}`,
      `- جدول/ستون مبنا: ${result.tableRef}.${result.columnName}`,
      "",
      "### Evidence",
      `- ابزار قطعی list_fiscal_years با ${result.toolCallsUsed} کوئری read-only اجرا شد.`,
      "- Listed distinct fiscal_year values from the detected fiscal-year column using the read-only path.",
      "- فقط مقادیر 4 رقمی در بازه 1300 تا 2099 در خروجی لحاظ شدند.",
      "",
      "### Assumptions",
      "- فرض اصلی: از جدول/ستون شناسایی‌شده برای سال مالی و مسیر read-only استفاده شده است؛ اگر schema متفاوت باشد، نتیجه ممکن است محدود شود.",
      "",
      "### Actions",
      "- اگر منظور شما شرکت یا شعبه خاصی است، scope را مشخص کنید تا لیست محدودشده ارائه شود."
    ].join("\n");
  }
  return [
    "### Summary",
    `در دیتابیس فعلی ${result.count} سال مالی متمایز شناسایی شد (${result.count} fiscal years).`,
    "",
    "### Findings",
    "- مسیر پاسخ: deterministic",
    `- جدول/ستون مبنا: ${result.tableRef}.${result.columnName}`,
    `- بازه سال ها: ${yearSpanText}`,
    `- نمونه سال های بازیابی شده (نزولی): ${previewText}`,
    "",
    "### Evidence",
    `- ابزار قطعی count_fiscal_years با ${result.toolCallsUsed} کوئری read-only اجرا شد.`,
    "- Counted distinct fiscal_year values from the detected fiscal-year column using the read-only path.",
    "- فقط مقادیر 4 رقمی در بازه 1300 تا 2099 در شمارش لحاظ شدند.",
    "",
    "### Assumptions",
    "- فرض اصلی: از جدول/ستون شناسایی‌شده برای سال مالی و مسیر read-only استفاده شده است؛ اگر schema متفاوت باشد، نتیجه ممکن است محدود شود.",
    "",
    "### Actions",
    "- اگر منظورتان سال مالی یک شرکت یا شعبه خاص است، نام شرکت/شعبه را اعلام کنید تا شمارش scope-based انجام شود."
  ].join("\n");
}
const SENSITIVE_IDENTIFIER_FIELD_TOKENS = [
  "nationalid",
  "nationalcode",
  "melicode",
  "mobile",
  "mobileno",
  "phonenumber",
  "phone",
  "telephone",
  "tel",
  "cellphone",
  "cell",
  "accountnumber",
  "accountno",
  "bankaccountnumber",
  "cardnumber",
  "bankcardnumber",
  "iban",
  "sheba"
];
const SENSITIVE_IDENTIFIER_FIELD_TOKENS_FA = [
  "کدملی",
  "شمارهملی",
  "موبایل",
  "شمارهموبایل",
  "تلفن",
  "شمارهتلفن",
  "شمارهحساب",
  "حساببانکی",
  "شمارهکارت",
  "شبا",
  "شمارهشبا"
];
function isSensitiveIdentifierField(columnName) {
  const normalized = columnName.toLowerCase().replace(/[\s_.-]/g, "");
  if (SENSITIVE_IDENTIFIER_FIELD_TOKENS.some((token) => normalized.includes(token))) {
    return true;
  }
  const normalizedFa = columnName.replace(/[\s_.-]/g, "");
  return SENSITIVE_IDENTIFIER_FIELD_TOKENS_FA.some((token) => normalizedFa.includes(token));
}
function redactSensitiveIdentifiers(rows) {
  let redactedCells = 0;
  const sanitizedRows = rows.map((row) => {
    const sanitizedRow = {};
    for (const [columnName, value] of Object.entries(row)) {
      if (isSensitiveIdentifierField(columnName) && value !== null && value !== void 0 && `${value}`.trim()) {
        sanitizedRow[columnName] = "[REDACTED]";
        redactedCells += 1;
        continue;
      }
      sanitizedRow[columnName] = value;
    }
    return sanitizedRow;
  });
  return {
    rows: sanitizedRows,
    redactedCells
  };
}
function limitRowsForModel(rows, maxToolPayloadChars, maxToolValueChars) {
  const limitedRows = [];
  let payloadSize = 2;
  let payloadTruncated = false;
  let valueTruncatedCells = 0;
  for (const row of rows) {
    const normalizedRow = {};
    for (const [columnName, value] of Object.entries(row)) {
      if (typeof value === "string" && value.length > maxToolValueChars) {
        normalizedRow[columnName] = `${value.slice(0, maxToolValueChars - 1)}…`;
        valueTruncatedCells += 1;
        continue;
      }
      normalizedRow[columnName] = value;
    }
    const serializedRow = JSON.stringify(normalizedRow);
    const projectedPayloadSize = payloadSize + (limitedRows.length > 0 ? 1 : 0) + serializedRow.length;
    if (projectedPayloadSize > maxToolPayloadChars) {
      payloadTruncated = true;
      break;
    }
    limitedRows.push(normalizedRow);
    payloadSize = projectedPayloadSize;
  }
  return {
    rows: limitedRows,
    payloadTruncated,
    valueTruncatedCells
  };
}
function rowsContainNonNullValue(rows) {
  return rows.some(
    (row) => Object.values(row).some((value) => value !== null && value !== void 0 && value !== "")
  );
}
function normalizeEvidenceCellValue(value) {
  if (typeof value === "string" && value.length > 180) {
    return `${value.slice(0, 179)}…`;
  }
  return value;
}
function createEvidencePreview(deps, sqlQuery, rows, rowCount, truncated) {
  const columnNames = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 10);
  const previewRows = rows.slice(0, 10).map((row) => {
    const previewRow = {};
    for (const columnName of columnNames) {
      const value = row[columnName];
      previewRow[columnName] = normalizeEvidenceCellValue(value);
    }
    return previewRow;
  });
  return {
    queryPreview: deps.compactText(sqlQuery.replace(/\s+/g, " "), 260),
    columns: columnNames,
    rows: previewRows,
    rowCount,
    truncated
  };
}
function requiresStrictFinancialDataFetch(deps, prompt, narrative) {
  const normalizedPrompt = deps.normalizePersianDigits(prompt);
  const normalizedNarrative = deps.normalizePersianDigits(narrative);
  const hasFinancialContext = appearsToContainFinancialClaim(normalizedPrompt) || appearsToContainFinancialClaim(normalizedNarrative);
  if (!hasFinancialContext) {
    return false;
  }
  const hasQuantOrComparativeSignal = /(?:درصد|percent|percentage|رشد|کاهش|افزایش|افت|change|growth|decline|نسبت\s*به|مقایسه|year\s*over\s*year|yoy|total|sum|avg|average|min|max|top|rank|count|تعداد|جمع|مجموع|میانگین|حداقل|حداکثر|بیشترین|کمترین|چه\s*قدر|چقدر|how\s*much)/iu.test(
    normalizedPrompt
  ) || /(?:\b\d[\d,.]*\b|[+-]?\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*درصد)/iu.test(normalizedNarrative);
  return hasQuantOrComparativeSignal;
}
function requiresStrictQuantitativeDataFetch(deps, prompt) {
  const normalized = deps.normalizePersianDigits(prompt);
  return /(?:درصد|percent|percentage|رشد|کاهش|افزایش|افت|change|growth|decline|نسبت\s*به|مقایسه|year\s*over\s*year|yoy)/iu.test(
    normalized
  );
}
function hasQuantitativeResultSignal(deps, text) {
  const normalized = deps.normalizePersianDigits(text);
  return /(?:[+-]?\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*درصد|درصد\s*[+-]?\d+(?:\.\d+)?)/iu.test(
    normalized
  );
}
function appearsToBeNoDataResult(deps, text) {
  const normalized = deps.normalizePersianDigits(text);
  return /(?:یافت\s*نشد|داده(?:\s*ای)?\s*وجود\s*ندارد|اطلاعات\s*کافی\s*وجود\s*ندارد|نتیجه\s*خالی|رکوردی\s*ثبت\s*نشده|هیچ\s*داده(?:\s*ای)?|no\s*data|insufficient\s*data|no\s+records)/iu.test(
    normalized
  );
}
function hasRequiredFinancialResponseSections(sections) {
  return Boolean(
    sections.summary.trim() && sections.findings.trim() && sections.evidence.trim() && sections.assumptions.trim() && sections.actions.trim()
  );
}
function hasStructuredEvidence(deps, evidenceSection) {
  const normalized = deps.normalizePersianDigits(evidenceSection);
  return /(?:query|tool|read-only|table|column|row|runtime\s*scope|catalog_scan|list_database_tables|get_database_schema|fetch_financial_data|count_fiscal_years|list_fiscal_years|کوئری|ابزار|جدول|ستون|ردیف|شواهد|شاهد)/iu.test(
    normalized
  );
}
function containsUnsupportedNumericClaim(deps, narrative, evidence, sections) {
  const normalizedNarrative = deps.normalizePersianDigits(narrative);
  const normalizedEvidence = deps.normalizePersianDigits(evidence);
  const hasNumericSignal = /(?:[+-]?\d+(?:[.,]\d+)?(?:\s*%|\s*درصد)|\b\d+(?:[.,]\d+)?\b)/u.test(
    normalizedNarrative
  );
  const hasPositiveEvidenceSignal = /(?:tool:|read-only\s+query|query\s+executed|query\s+used|scope\s+applied|table\s+name|column\s+name|row\s+count|schema\s+check|via\s+read-only|via\s+query|ابزار\s+اجرایی|کوئری\s+اجرا|کوئری\s+read-only|executed|used)/iu.test(
    normalizedEvidence
  );
  const hasExplicitNoEvidenceSignal = /(?:بدون\s+(?:اجرای|استفاده\s+از|شواهد|کوئری|ابزار|داده|تأیید)|without\s+(?:evidence|tool|query|data)|no\s+(?:evidence|tool|query|data|financial\s+data\s+fetch)|هیچ\s+(?:fetch_financial_data|کوئری|ابزار|داده|شواهد)|not\s+executed|didn['']?t\s+run|not\s+run|حدس|برآورد|model\s+assumption|assumption)/iu.test(
    normalizedEvidence
  );
  const hasExplicitNoData = appearsToBeNoDataResult(deps, normalizedNarrative);
  const hasRequiredSections = hasRequiredFinancialResponseSections(sections);
  return Boolean(
    hasNumericSignal && !hasPositiveEvidenceSignal && (hasExplicitNoEvidenceSignal || !normalizedEvidence.trim()) && !hasExplicitNoData && hasRequiredSections
  );
}
function containsFinancialMarkedNumericClaim(deps, narrative) {
  const normalized = deps.normalizePersianDigits(narrative);
  if (/[+-]?\d+(?:[.,]\d+)?\s*(?:%|درصد)/iu.test(normalized)) {
    return true;
  }
  if (/\d[\d,]*\s*(?:تومان|ریال|IRR|USD|EUR|\$)/iu.test(normalized)) {
    return true;
  }
  const financialNoun = "(?:مبلغ|موجودی|مانده|جمع|مجموع|سهم|نسبت|amount|balance|total)";
  const adjacencyPattern = new RegExp(
    `(?:${financialNoun}[^\\n]{0,40}?\\d[\\d,]*(?:[.,]\\d+)?|\\d[\\d,]*(?:[.,]\\d+)?[^\\n]{0,40}?${financialNoun})`,
    "iu"
  );
  return adjacencyPattern.test(normalized);
}
function extractNumericClaims(deps, text) {
  const normalized = deps.normalizePersianDigits(text);
  const matches = normalized.match(/(?:[+-]?\d+(?:[.,]\d+)?(?:\s*%|\s*درصد)|\b\d+(?:[.,]\d+)?\b)/gu) ?? [];
  return matches.map((value) => value.trim());
}
function traceSupportsNumericClaim(trace) {
  if (!trace) {
    return false;
  }
  const verdict = evaluateEvidence(trace);
  return verdict.kind === "POSITIVE_DATA";
}
function enforcePromptIntentAlignment(deps, prompt, finalText) {
  const expectedIntent = deps.detectDeterministicFinancialIntent(prompt);
  if (!expectedIntent || !["count_fiscal_years", "list_fiscal_years"].includes(expectedIntent)) {
    return finalText;
  }
  const sections = parseFinancialTemplateSections(finalText);
  const intentSourceText = `${sections.summary}
${sections.findings}
${sections.evidence}`;
  const normalizedText = deps.normalizePersianDigits(intentSourceText);
  const hasFiscalYearPhrase = /(?:سال(?:\s*های?)?\s*مالی|fiscal\s+years?)/iu.test(normalizedText);
  const hasCountSignal = /(?:تعداد|count|شمارش|متمایز)/iu.test(normalizedText);
  const hasListSignal = /(?:لیست|فهرست|list)/iu.test(normalizedText);
  const yearTokenMatches = normalizedText.match(/\b(?:13|14|19|20)\d{2}\b/g) ?? [];
  const hasYearToken = yearTokenMatches.length > 0;
  const hasMultipleYearTokens = yearTokenMatches.length >= 2;
  const hasNumericCount = /\b\d+\b/.test(normalizedText);
  const countLike = hasFiscalYearPhrase && (hasCountSignal || hasNumericCount);
  const listLike = hasFiscalYearPhrase && (hasListSignal || hasMultipleYearTokens);
  const matchedIntent = countLike && listLike ? expectedIntent : countLike ? "count_fiscal_years" : listLike || hasFiscalYearPhrase && hasYearToken ? "list_fiscal_years" : null;
  if (matchedIntent === expectedIntent) {
    return finalText;
  }
  return [
    "### Summary",
    "Cannot answer reliably: پاسخ مدل با intent سوال کاربر هم راستا نیست.",
    "",
    "### Findings",
    `- intent مورد انتظار: ${expectedIntent}`,
    `- intent تشخیص داده شده در پاسخ: ${matchedIntent ?? "unknown"}`,
    "",
    "### Evidence",
    "- قاعده کنترل کیفیت intent پاسخ فعال شد و از ارائه پاسخ مالی نامعتبر جلوگیری کرد.",
    "",
    "### Actions",
    "- لطفا سوال را دقیق تر بیان کنید (مثال: تعداد سال های مالی یا لیست سال های مالی)."
  ].join("\n");
}
function mapFinancialSectionHeading(heading) {
  const normalized = heading.toLowerCase().replace(/[:：]/g, "").trim();
  if (/^(summary|خلاصه|جمع\s*بندی)$/iu.test(normalized)) {
    return "summary";
  }
  if (/^(findings?|یافته\s*ها|یافته‌ها|نتایج)$/iu.test(normalized)) {
    return "findings";
  }
  if (/^(evidence|evidences|شواهد|مدارک)$/iu.test(normalized)) {
    return "evidence";
  }
  if (/^(assumptions?|فرض\s*ها|فرضیات)$/iu.test(normalized)) {
    return "assumptions";
  }
  if (/^(actions?|اقدامات|پیشنهادها|گام\s*های\s*بعدی|گامهای\s*بعدی)$/iu.test(normalized)) {
    return "actions";
  }
  return null;
}
function parseFinancialTemplateSections(text) {
  const sections = {
    summary: "",
    findings: "",
    evidence: "",
    assumptions: "",
    actions: "",
    freeform: ""
  };
  if (!text) {
    return sections;
  }
  let activeSection = "freeform";
  for (const rawLine of text.split("\n")) {
    const headingMatch = rawLine.trim().match(/^#{1,4}\s*(.+?)\s*$/u);
    if (headingMatch) {
      const mappedSection = mapFinancialSectionHeading(headingMatch[1] ?? "");
      if (mappedSection) {
        activeSection = mappedSection;
        continue;
      }
      activeSection = "freeform";
    }
    const previous = sections[activeSection];
    sections[activeSection] = previous ? `${previous}
${rawLine}` : rawLine;
  }
  return {
    summary: sections.summary.trim(),
    findings: sections.findings.trim(),
    evidence: sections.evidence.trim(),
    assumptions: sections.assumptions.trim(),
    actions: sections.actions.trim(),
    freeform: sections.freeform.trim()
  };
}
function buildFinancialEvidenceFallback(conversationMemory, totalToolCallCount) {
  const lines = [];
  if (conversationMemory.lastToolTrace.length > 0) {
    for (const trace of conversationMemory.lastToolTrace.slice(-3)) {
      lines.push(`- ${trace}`);
    }
  }
  const scopeParts = [];
  if (conversationMemory.facts.companyNames.length > 0) {
    scopeParts.push(`company=${conversationMemory.facts.companyNames.join("|")}`);
  }
  if (conversationMemory.facts.fiscalYears.length > 0) {
    scopeParts.push(`fiscal_year=${conversationMemory.facts.fiscalYears.join("|")}`);
  }
  if (conversationMemory.facts.branchNames.length > 0) {
    scopeParts.push(`branch=${conversationMemory.facts.branchNames.join("|")}`);
  }
  if (scopeParts.length > 0) {
    lines.push(`- Runtime scope: ${scopeParts.join(" ; ")}`);
  }
  if (totalToolCallCount === 0) {
    lines.push("- ابزار مالی اجرا نشد؛ پاسخ باید با احتیاط بازبینی شود.");
  }
  if (lines.length === 0) {
    lines.push("- شواهد ابزاری در این مرحله ثبت نشده است.");
  }
  return lines.join("\n");
}
function ensureFinancialResponseTemplate(deps, rawText, conversationMemory, totalToolCallCount) {
  const normalizedText = rawText.replace(/\r\n?/g, "\n").trim();
  const sections = parseFinancialTemplateSections(normalizedText);
  const hasAllSections = sections.summary.length > 0 && sections.findings.length > 0 && sections.evidence.length > 0 && sections.assumptions.length > 0 && sections.actions.length > 0;
  if (hasAllSections) {
    return normalizedText;
  }
  const summarySource = sections.summary || sections.freeform || normalizedText;
  const summaryText = summarySource.trim() ? deps.compactText(
    summarySource.replace(/[`*_>#]/g, " ").replace(/\s+/g, " ").trim(),
    420
  ) : "پاسخ مدل خالی بود.";
  const findingsText = sections.findings || (totalToolCallCount > 0 ? "- تحلیل بر پایه داده واقعی ابزارها انجام شد." : "- این پاسخ بدون اجرای ابزار مالی تولید شده است و باید با احتیاط بازبینی شود.");
  const evidenceText = sections.evidence || buildFinancialEvidenceFallback(conversationMemory, totalToolCallCount);
  const assumptionsText = sections.assumptions || "- فرض اصلی: پاسخ بر پایه داده و شواهد ابزارهای read-only است و در صورت نبود mapping دقیق، نتیجه قابل اتکا نیست.";
  const actionsText = sections.actions || "- در صورت نیاز، بازه زمانی یا scope شرکت/سال مالی/شعبه را دقیق‌تر مشخص کنید تا تحلیل بهینه‌تر شود.";
  return [
    "### Summary",
    summaryText,
    "",
    "### Findings",
    findingsText,
    "",
    "### Evidence",
    evidenceText,
    "",
    "### Assumptions",
    assumptionsText,
    "",
    "### Actions",
    actionsText
  ].join("\n").trim();
}
function emitEvidenceContractTelemetry(deps, requestId, conversationId, finalText, recoveryAttempts) {
  const effectiveRecoveryAttempts = recoveryAttempts ?? 0;
  deps.capture?.({
    event: "agent.orchestrator.audit",
    category: "agent.orchestrator",
    level: "warn",
    process: "main",
    message: "evidence-contract-failure",
    details: {
      failureKind: "evidence_contract",
      recoveryAttempts: effectiveRecoveryAttempts,
      finalText,
      requestId,
      conversationId
    },
    requestId,
    conversationId
  });
}
function emitGuardrailTelemetry(deps, kind, requestId, conversationId, details) {
  deps.capture?.({
    event: "agent.orchestrator.guardrail",
    category: "agent.orchestrator",
    level: "warn",
    process: "main",
    message: kind,
    details: {
      kind,
      requestId,
      conversationId,
      ...details
    },
    requestId,
    conversationId
  });
}
function emitGuardrailCounterTelemetry(deps, kind, requestId, conversationId, count) {
  deps.capture?.({
    event: "agent.orchestrator.guardrail.count",
    category: "agent.orchestrator",
    level: "info",
    process: "main",
    message: kind,
    details: {
      kind,
      count,
      requestId,
      conversationId
    },
    requestId,
    conversationId
  });
}
const DEFAULT_SCHEMA_ROW_LIMIT = 240;
function buildDatabaseSchemaQuery(tableName, schemaName, maxSchemaRows = DEFAULT_SCHEMA_ROW_LIMIT) {
  const tableValue = escapeSqlStringLiteral(tableName);
  const schemaFilter = schemaName ? `  AND c.TABLE_SCHEMA = N'${escapeSqlStringLiteral(schemaName)}'
` : "";
  return `SELECT TOP (${maxSchemaRows})
  c.TABLE_SCHEMA AS table_schema,
  c.TABLE_NAME AS table_name,
  c.ORDINAL_POSITION AS ordinal_position,
  c.COLUMN_NAME AS column_name,
  c.DATA_TYPE AS data_type,
  c.CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
  c.NUMERIC_PRECISION AS numeric_precision,
  c.NUMERIC_SCALE AS numeric_scale,
  c.DATETIME_PRECISION AS datetime_precision,
  c.IS_NULLABLE AS is_nullable,
  COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS is_identity
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME = N'${tableValue}'
${schemaFilter}ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`;
}
function escapeSqlStringLiteral(value) {
  return value.replace(/'/g, "''");
}
function normalizeTablePattern(value) {
  if (!value) {
    return null;
  }
  return value.replace(/\*/g, "%");
}
function readRequiredStringArg(args, key, maxLength) {
  const value = args[key];
  if (typeof value !== "string") {
    throw new Error(`Missing required argument: ${key}`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Missing required argument: ${key}`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`Argument ${key} exceeds max length (${maxLength}).`);
  }
  return trimmed;
}
function readOptionalStringArg(args, key, maxLength) {
  const value = args[key];
  if (value === void 0 || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Argument ${key} must be a string when provided.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new Error(`Argument ${key} exceeds max length (${maxLength}).`);
  }
  return trimmed;
}
function readOptionalNumberArg(args, key, { min, max, fallback }) {
  const value = args[key];
  if (value === void 0 || value === null) {
    return fallback;
  }
  let parsed;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }
    parsed = Number(trimmed);
  } else {
    return fallback;
  }
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}
function parseToolArguments(argumentText) {
  if (!argumentText.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(argumentText);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}
function quoteSqlIdentifier(value) {
  return `[${value.replace(/\]/g, "]]")}]`;
}
function quoteSqlTableRef(ref) {
  const dotIndex = ref.indexOf(".");
  if (dotIndex === -1) {
    return quoteSqlIdentifier(ref);
  }
  const schema = ref.slice(0, dotIndex);
  const table = ref.slice(dotIndex + 1);
  return `${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(table)}`;
}
function toSafeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
function toOptionalFiniteInteger(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function toFiniteInteger(value) {
  const parsed = toOptionalFiniteInteger(value);
  return parsed ?? 0;
}
function buildPendingToolStatusText(toolName, args) {
  if (toolName === "list_database_tables") {
    return "🔍 در حال جستجو و استخراج لیست جداول دیتابیس...";
  }
  if (toolName === "get_database_schema") {
    const tableNameArg = args["table_name"];
    const tableName = typeof tableNameArg === "string" && tableNameArg.trim() ? tableNameArg.trim() : "نامشخص";
    return `📋 در حال تحلیل ساختار و ستون‌های جدول [${tableName}]...`;
  }
  if (toolName === "fetch_financial_data") {
    return "📊 در حال اجرای کوئری مالی روی دیتابیس و استخراج ردیف‌ها...";
  }
  return `🧩 در حال اجرای ابزار ${toolName}...`;
}
function buildCatalogScanQuery(tablePattern, limit) {
  const normalizedPattern = normalizeTablePattern(tablePattern);
  const patternFilter = normalizedPattern ? `AND LOWER(t.TABLE_NAME) LIKE LOWER(N'${escapeSqlStringLiteral(normalizedPattern)}')` : "";
  return `SELECT TOP (${Math.max(1, Math.min(limit, 24))})
  t.TABLE_SCHEMA,
  t.TABLE_NAME,
  CAST(COALESCE(SUM(p.rows), 0) AS bigint) AS estimated_row_count
FROM INFORMATION_SCHEMA.TABLES t
LEFT JOIN sys.partitions p
  ON p.object_id = OBJECT_ID(QUOTENAME(t.TABLE_SCHEMA) + '.' + QUOTENAME(t.TABLE_NAME))
 AND p.index_id IN (0, 1)
WHERE t.TABLE_TYPE = 'BASE TABLE'
  ${patternFilter}
  AND t.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')
GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME
ORDER BY estimated_row_count DESC, t.TABLE_SCHEMA, t.TABLE_NAME`;
}
function buildListDatabaseTablesQuery(tablePattern, maxTableListRows) {
  const normalizedPattern = normalizeTablePattern(tablePattern);
  const patternFilter = normalizedPattern ? `
  AND LOWER(TABLE_NAME) LIKE LOWER(N'${escapeSqlStringLiteral(normalizedPattern)}')` : "";
  return `SELECT TOP (${maxTableListRows}) TABLE_SCHEMA, TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'${patternFilter}
ORDER BY TABLE_SCHEMA, TABLE_NAME`;
}
function buildDatabaseSchemaQueryWrapper(tableName, schemaName, maxSchemaRows) {
  return buildDatabaseSchemaQuery(tableName, schemaName, maxSchemaRows);
}
const COMMENT_NORMALIZATION_PATTERN = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_NORMALIZATION_PATTERN = /--[^\r\n]*/g;
const UNSUPPORTED_FUNCTION_RULES = [
  {
    pattern: /\bFORMAT\s*\(/i,
    functionName: "FORMAT",
    correction: "این SQL Server FORMAT ندارد. برای گروه‌بندی ماهانه از YEAR(col) و MONTH(col) یا DATEPART(year, col)/DATEPART(month, col) استفاده کن؛ برای بازهٔ تاریخ از شرط col >= '<start>' AND col <= '<end>' استفاده کن."
  },
  {
    pattern: /\bSTRING_AGG\s*\(/i,
    functionName: "STRING_AGG",
    correction: "این SQL Server STRING_AGG را پشتیبانی نمی‌کند. برای ادغام متن از روش جایگزین در سطح برنامه یا کوئری‌های چندمرحله‌ای استفاده کن."
  },
  {
    pattern: /\bGregorianToShamsi\b/i,
    functionName: "GregorianToShamsi",
    correction: "این SQL Server تابع dbo.GregorianToShamsi را پشتیبانی نمی‌کند. برای تبدیل تاریخ از میلادی به شمسی از منطق برنامه یا توابع جایگزین استفاده کن."
  },
  {
    pattern: /\bFOR\s+JSON\b/i,
    functionName: "FOR JSON",
    correction: "این SQL Server FOR JSON را پشتیبانی نمی‌کند. خروجی را به‌صورت ردیف/ستون معمولی بازگردان و در سطح برنامه پردازش کن."
  },
  {
    pattern: /\bFOR\s+XML\b/i,
    functionName: "FOR XML",
    correction: "این SQL Server FOR XML را پشتیبانی نمی‌کند. خروجی را به‌صورت ردیف/ستون معمولی بازگردان."
  },
  {
    pattern: /\bDATEFROMPARTS\s*\(/i,
    functionName: "DATEFROMPARTS",
    correction: "این SQL Server DATEFROMPARTS را پشتیبانی نمی‌کند. برای ساخت تاریخ از اجزای جداگانه از ترکیب dateadd و cast استفاده کن."
  },
  {
    pattern: /\bEOMONTH\s*\(/i,
    functionName: "EOMONTH",
    correction: "این SQL Server EOMONTH را پشتیبانی نمی‌کند. برای پایان ماه از بازهٔ تاریخ واضح یا محاسبهٔ دستی استفاده کن."
  }
];
function detectUnsupportedSqlFunctions(sql) {
  const normalized = sql.replace(COMMENT_NORMALIZATION_PATTERN, " ").replace(LINE_COMMENT_NORMALIZATION_PATTERN, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { found: false };
  }
  for (const rule of UNSUPPORTED_FUNCTION_RULES) {
    if (rule.pattern.test(normalized)) {
      return {
        found: true,
        functionName: rule.functionName,
        correction: rule.correction
      };
    }
  }
  return { found: false };
}
const MAX_TABLE_LIST_ROWS$1 = 500;
const MAX_TOOL_ROWS = 120;
const MAX_SCHEMA_ROWS$1 = 240;
async function executeFinancialToolCalls(deps, params) {
  const {
    requestId,
    conversationId,
    round,
    toolCalls,
    settings,
    conversationMemory,
    onProgress,
    abortSignal
  } = params;
  const toolMessages = [];
  const evidence = [];
  let successfulDataFetches = 0;
  for (const toolCall of toolCalls) {
    deps.throwIfRequestCanceled(abortSignal);
    const toolName = toolCall.function.name;
    const args = parseToolArguments(toolCall.function.arguments);
    const pendingMessage = deps.buildPendingToolStatusText(toolName, args);
    deps.emitProgress(onProgress, {
      type: "tool-start",
      message: pendingMessage,
      toolName,
      toolCallId: toolCall.id,
      args
    });
    await deps.safeAuditWrite({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      requestId,
      stage: "tool-start",
      toolName,
      round
    });
    try {
      if (toolName === "catalog_scan") {
        const tablePattern = readOptionalStringArg(args, "table_pattern", 256);
        const limit = readOptionalNumberArg(args, "limit", { min: 1, max: 24, fallback: 8 });
        const sqlQuery = deps.buildCatalogScanQuery(tablePattern, limit);
        const rows = await deps.executeMetadataSql(sqlQuery, abortSignal);
        deps.throwIfRequestCanceled(abortSignal);
        deps.rememberToolTrace(
          conversationMemory,
          `catalog_scan rows=${rows.length} pattern=${tablePattern ?? "*"} limit=${limit}`
        );
        evidence.push({
          tool: "catalog_scan",
          status: "ok",
          rowsReturned: rows.length,
          nonNullValue: rows.length > 0,
          scopeApplied: false
        });
        const boundedRows = rows.slice(0, MAX_TABLE_LIST_ROWS$1);
        const limitedRows = deps.limitRowsForModel(boundedRows);
        deps.emitProgress(onProgress, {
          type: "tool-success",
          message: `✅ فهرست کاندیدهای کشف‌شده با ${rows.length} جدول بازگردانده شد.`,
          toolName,
          toolCallId: toolCall.id,
          args,
          rowCount: rows.length
        });
        await deps.safeAuditWrite({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          requestId,
          stage: "tool-success",
          toolName,
          sqlQuery,
          rowCount: rows.length,
          round
        });
        toolMessages.push(
          deps.createToolResponseMessage(toolCall, {
            ok: true,
            table_pattern: tablePattern,
            limit,
            row_count: rows.length,
            rows: limitedRows.rows
          })
        );
        continue;
      }
      if (toolName === "list_database_tables") {
        const tablePattern = readOptionalStringArg(args, "table_pattern", 256);
        const sqlQuery = deps.buildListDatabaseTablesQuery(tablePattern);
        const rows = await deps.fetchTableListCached(tablePattern, sqlQuery, abortSignal);
        deps.throwIfRequestCanceled(abortSignal);
        deps.rememberToolTrace(
          conversationMemory,
          `list_database_tables rows=${rows.length} pattern=${tablePattern ?? "*"}`
        );
        evidence.push({
          tool: "list_database_tables",
          status: "ok",
          rowsReturned: rows.length,
          nonNullValue: rows.length > 0,
          scopeApplied: false
        });
        const boundedRows = rows.slice(0, MAX_TABLE_LIST_ROWS$1);
        const limitedRows = deps.limitRowsForModel(boundedRows);
        const outputTruncated = rows.length > boundedRows.length || limitedRows.payloadTruncated;
        const compactedText = limitedRows.payloadTruncated || limitedRows.valueTruncatedCells > 0 ? " | خروجی برای مدل خلاصه شد." : "";
        deps.emitProgress(onProgress, {
          type: "tool-success",
          message: `✅ تعداد ${rows.length} جدول یافت شد.${compactedText}`,
          toolName,
          toolCallId: toolCall.id,
          args,
          rowCount: rows.length
        });
        await deps.safeAuditWrite({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          requestId,
          stage: "tool-success",
          toolName,
          sqlQuery,
          rowCount: rows.length,
          round
        });
        toolMessages.push(
          deps.createToolResponseMessage(toolCall, {
            ok: true,
            table_pattern: tablePattern,
            row_count: rows.length,
            truncated: outputTruncated,
            payload_truncated: limitedRows.payloadTruncated,
            value_truncated_cells: limitedRows.valueTruncatedCells,
            rows: limitedRows.rows
          })
        );
        continue;
      }
      if (toolName === "fetch_financial_data") {
        const sqlQuery = readRequiredStringArg(args, "sql_query", 16e3);
        const unsupportedSql = detectUnsupportedSqlFunctions(sqlQuery);
        if (unsupportedSql.found) {
          const correctionMessage = unsupportedSql.correction ?? "این کوئری از توابع پشتیبانی‌نشده استفاده می‌کند.";
          deps.emitGuardrailTelemetry("unsupported-function", requestId, conversationId, {
            functionName: unsupportedSql.functionName ?? "unknown",
            correction: correctionMessage,
            sqlQuery: deps.compactText(sqlQuery.replace(/\s+/g, " "), 400)
          });
          deps.emitGuardrailCounterTelemetry("unsupported-function", requestId, conversationId, 1);
          const guardedError = deps.createAgentPolicyError(
            "AGENT_UNSUPPORTED_SQL_FUNCTION",
            correctionMessage
          );
          guardedError.message = correctionMessage;
          throw guardedError;
        }
        const prevalidatedSql = deps.prevalidateFinancialQuery(sqlQuery, settings);
        deps.ensureFinancialQueryAllowed(prevalidatedSql, settings, conversationMemory);
        const unsupportedSqlAfterPrevalidation = detectUnsupportedSqlFunctions(prevalidatedSql);
        if (unsupportedSqlAfterPrevalidation.found) {
          const correctionMessage = unsupportedSqlAfterPrevalidation.correction ?? "این کوئری از توابع پشتیبانی‌نشده استفاده می‌کند.";
          deps.emitGuardrailTelemetry("unsupported-function", requestId, conversationId, {
            functionName: unsupportedSqlAfterPrevalidation.functionName ?? "unknown",
            correction: correctionMessage,
            sqlQuery: deps.compactText(prevalidatedSql.replace(/\s+/g, " "), 400)
          });
          const guardedError = deps.createAgentPolicyError(
            "AGENT_UNSUPPORTED_SQL_FUNCTION",
            correctionMessage
          );
          guardedError.message = correctionMessage;
          throw guardedError;
        }
        const rows = await deps.executeReadOnlySql(prevalidatedSql, abortSignal);
        successfulDataFetches += 1;
        deps.throwIfRequestCanceled(abortSignal);
        deps.rememberToolTrace(
          conversationMemory,
          `fetch_financial_data rows=${rows.length} sql=${deps.compactText(sqlQuery.replace(/\s+/g, " "), 180)}`
        );
        evidence.push({
          tool: "fetch_financial_data",
          status: "ok",
          rowsReturned: rows.length,
          nonNullValue: deps.rowsContainNonNullValue(rows),
          scopeApplied: true,
          query: deps.compactText(prevalidatedSql.replace(/\s+/g, " "), 400)
        });
        const redacted = deps.redactSensitiveIdentifiers(rows);
        const boundedRows = redacted.rows.slice(0, MAX_TOOL_ROWS);
        const limitedRows = deps.limitRowsForModel(boundedRows);
        const outputTruncated = rows.length > boundedRows.length || limitedRows.payloadTruncated;
        const redactionText = redacted.redactedCells > 0 ? ` | ${redacted.redactedCells} فیلد حساس پیش از ارسال به مدل پوشانده شد.` : "";
        const compactedText = limitedRows.payloadTruncated || limitedRows.valueTruncatedCells > 0 ? " | خروجی برای مدل خلاصه شد." : "";
        const evidencePreview = deps.createEvidencePreview(
          prevalidatedSql,
          limitedRows.rows,
          rows.length,
          outputTruncated
        );
        deps.emitProgress(onProgress, {
          type: "tool-success",
          message: `✅ تعداد ${rows.length} ردیف مالی استخراج شد.${redactionText}${compactedText}`,
          toolName,
          toolCallId: toolCall.id,
          args,
          rowCount: rows.length,
          evidencePreview
        });
        await deps.safeAuditWrite({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          requestId,
          stage: "tool-success",
          toolName,
          sqlQuery,
          rowCount: rows.length,
          round
        });
        toolMessages.push(
          deps.createToolResponseMessage(toolCall, {
            ok: true,
            row_count: rows.length,
            redacted_cells: redacted.redactedCells,
            truncated: outputTruncated,
            payload_truncated: limitedRows.payloadTruncated,
            value_truncated_cells: limitedRows.valueTruncatedCells,
            rows: limitedRows.rows
          })
        );
        continue;
      }
      if (toolName === "get_database_schema") {
        const tableName = readRequiredStringArg(args, "table_name", 128);
        const schemaName = readOptionalStringArg(args, "schema_name", 128);
        const cacheKey = `${schemaName || "dbo"}.${tableName}`;
        const cached = deps.schemaCacheByTableKey.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < deps.SCHEMA_CACHE_TTL_MS) {
          const rows2 = cached.schema.map((col, idx) => ({
            table_schema: schemaName || "dbo",
            table_name: tableName,
            ordinal_position: (idx + 1).toString(),
            column_name: col.name,
            data_type: col.dataType,
            character_maximum_length: null,
            numeric_precision: null,
            numeric_scale: null,
            datetime_precision: null,
            is_nullable: col.isNullable ? 1 : 0,
            is_identity: col.isIdentity ? 1 : 0
          }));
          deps.rememberToolTrace(
            conversationMemory,
            `get_database_schema rows=${rows2.length} table=${cacheKey} (cached)`
          );
          evidence.push({
            tool: "get_database_schema",
            status: "ok",
            rowsReturned: rows2.length,
            nonNullValue: rows2.length > 0,
            scopeApplied: false
          });
          toolMessages.push(
            deps.createToolResponseMessage(toolCall, {
              ok: true,
              table_name: tableName,
              schema_name: schemaName ?? null,
              row_count: rows2.length,
              truncated: false,
              payload_truncated: false,
              value_truncated_cells: 0,
              rows: rows2.slice(0, MAX_SCHEMA_ROWS$1)
            })
          );
          deps.emitProgress(onProgress, {
            type: "tool-success",
            message: `✅ ساختار جدول [${tableName}] با ${rows2.length} ستون بازیابی شد (از کش).`,
            toolName,
            toolCallId: toolCall.id,
            args,
            rowCount: rows2.length
          });
          continue;
        }
        const sqlQuery = deps.buildDatabaseSchemaQuery(tableName, schemaName);
        const cachedSchema = await deps.getCachedSchemaSnapshot(cacheKey, sqlQuery, abortSignal);
        const rows = cachedSchema.rows;
        deps.throwIfRequestCanceled(abortSignal);
        const schemaColumns = rows.map((row) => {
          const colName = row["column_name"];
          const dataType = row["data_type"];
          const maxLen = row["character_maximum_length"];
          const isNullable = row["is_nullable"];
          const isIdentity = row["is_identity"];
          return {
            name: typeof colName === "string" ? colName : String(colName || ""),
            dataType: typeof dataType === "string" ? dataType : "unknown",
            isNullable: Boolean(isNullable),
            maxLength: typeof maxLen === "number" && maxLen > 0 ? maxLen : null,
            isIdentity: Boolean(isIdentity),
            isPrimaryKey: false,
            hasForeignKey: false,
            sampleValues: []
          };
        });
        deps.schemaCacheByTableKey.set(cacheKey, { schema: schemaColumns, timestamp: Date.now() });
        deps.rememberToolTrace(
          conversationMemory,
          `get_database_schema rows=${rows.length} table=${schemaName ? `${schemaName}.` : ""}${tableName}`
        );
        evidence.push({
          tool: "get_database_schema",
          status: "ok",
          rowsReturned: rows.length,
          nonNullValue: rows.length > 0,
          scopeApplied: false
        });
        const boundedRows = rows.slice(0, MAX_SCHEMA_ROWS$1);
        const limitedRows = deps.limitRowsForModel(boundedRows);
        const outputTruncated = rows.length > boundedRows.length || limitedRows.payloadTruncated;
        const compactedText = limitedRows.payloadTruncated || limitedRows.valueTruncatedCells > 0 ? " | خروجی برای مدل خلاصه شد." : "";
        deps.emitProgress(onProgress, {
          type: "tool-success",
          message: `✅ ساختار جدول [${tableName}] با ${rows.length} ستون استخراج شد.${compactedText}`,
          toolName,
          toolCallId: toolCall.id,
          args,
          rowCount: rows.length
        });
        await deps.safeAuditWrite({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          requestId,
          stage: "tool-success",
          toolName,
          sqlQuery,
          rowCount: rows.length,
          round
        });
        toolMessages.push(
          deps.createToolResponseMessage(toolCall, {
            ok: true,
            table_name: tableName,
            schema_name: schemaName ?? null,
            row_count: rows.length,
            truncated: outputTruncated,
            payload_truncated: limitedRows.payloadTruncated,
            value_truncated_cells: limitedRows.valueTruncatedCells,
            rows: limitedRows.rows
          })
        );
        continue;
      }
      const unsupportedToolError = `Unsupported tool requested: ${toolName}`;
      const unsupportedToolCode = "AGENT_UNSUPPORTED_TOOL";
      evidence.push({
        tool: toolName,
        status: "error",
        rowsReturned: 0,
        nonNullValue: false,
        scopeApplied: false,
        errorCode: unsupportedToolCode,
        errorMessage: unsupportedToolError
      });
      deps.emitProgress(onProgress, {
        type: "tool-error",
        message: `❌ ابزار ناشناخته: ${toolName}`,
        toolName,
        toolCallId: toolCall.id,
        args,
        errorCode: unsupportedToolCode,
        errorCategory: "orchestration-policy"
      });
      await deps.safeAuditWrite({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        requestId,
        stage: "tool-error",
        toolName,
        round,
        error: unsupportedToolError,
        errorCode: unsupportedToolCode,
        errorCategory: "orchestration-policy"
      });
      toolMessages.push(
        deps.createToolResponseMessage(toolCall, {
          ok: false,
          error: unsupportedToolError,
          error_code: unsupportedToolCode
        })
      );
    } catch (error) {
      if (abortSignal.aborted || deps.isCancellationLikeError(error)) {
        throw deps.resolveCancellationError(error, abortSignal);
      }
      const errorInfo = deps.toErrorInfo(error);
      evidence.push({
        tool: toolName,
        status: "error",
        rowsReturned: 0,
        nonNullValue: false,
        scopeApplied: false,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message
      });
      deps.emitProgress(onProgress, {
        type: "tool-error",
        message: `❌ خطا در اجرای ابزار ${toolName}: ${errorInfo.message}`,
        toolName,
        toolCallId: toolCall.id,
        args,
        errorCode: errorInfo.code,
        errorCategory: errorInfo.category
      });
      await deps.safeAuditWrite({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        requestId,
        stage: "tool-error",
        toolName,
        round,
        error: errorInfo.message,
        errorCode: errorInfo.code,
        errorCategory: errorInfo.category
      });
      toolMessages.push(
        deps.createToolResponseMessage(toolCall, {
          ok: false,
          error: errorInfo.message,
          error_code: errorInfo.code ?? null
        })
      );
    }
  }
  return {
    toolMessages,
    successfulDataFetches,
    evidence
  };
}
const MAX_FINANCIAL_RECOVERY_ATTEMPTS = 2;
function mapRecoveryErrorHint(lastErrorCode) {
  switch (lastErrorCode) {
    case "SQL_POLICY_REQUIRE_ORDER_BY_FOR_LIMITED_QUERY":
      return "کوئری محدود باید ORDER BY داشته باشد.";
    case "SQL_POLICY_REQUIRE_RESULT_LIMIT":
      return "کوئری غیرتجمیعی باید TOP یا OFFSET/FETCH داشته باشد.";
    case "SQL_POLICY_SCOPE_LIMIT_EXCEEDED":
      return "حداکثر ردیف مجاز ۵۰۰ است؛ از تابع تجمیعی استفاده کن.";
    default:
      return "کوئری با محدودیت‌های read-only سازگار نیست.";
  }
}
const FINANCIAL_TOOLS = [
  {
    type: "function",
    function: {
      name: "catalog_scan",
      description: "Run a low-cost read-only catalog scan for candidate financial or purchase tables, including estimated row counts and sample columns for discovery.",
      parameters: {
        type: "object",
        properties: {
          table_pattern: {
            type: "string",
            description: "Optional LIKE pattern such as '%purchase%' or '%receipt%'."
          },
          limit: {
            type: "integer",
            description: "Maximum number of candidate tables to return. Default is 8."
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_database_tables",
      description: "List base tables in the current SQL Server database. Call this first when table names are unknown, then choose relevant financial tables for schema inspection.",
      parameters: {
        type: "object",
        properties: {
          table_pattern: {
            type: "string",
            description: "Optional LIKE pattern for table names. Example: '%ledger%' or 'acc_%'"
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fetch_financial_data",
      description: "Execute a read-only SQL SELECT query on the configured SQL Server financial database and return serialized rows.",
      parameters: {
        type: "object",
        properties: {
          sql_query: {
            type: "string",
            description: "Read-only SQL query. Must be SELECT/CTE SELECT only. Example: SELECT TOP 50 date, amount FROM Ledger ORDER BY date DESC"
          }
        },
        required: ["sql_query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_database_schema",
      description: "Fetch SQL Server table schema metadata (columns, types, nullability, order) for a target table to help build correct SELECT queries.",
      parameters: {
        type: "object",
        properties: {
          table_name: {
            type: "string",
            description: "Target table name to inspect. Example: Ledger or Acc_DocumentLines"
          },
          schema_name: {
            type: "string",
            description: "Optional schema name. Example: dbo"
          }
        },
        required: ["table_name"],
        additionalProperties: false
      }
    }
  }
];
const MAX_TOOL_CALL_ROUNDS$1 = 4;
const MAX_TOOL_CALLS_PER_ROUND$1 = 7;
const MAX_TOTAL_TOOL_CALLS$1 = 14;
async function sendMessage(deps, payload, onProgress) {
  const requestId = payload.requestId.trim();
  const conversationId = payload.conversationId?.trim() || `conversation-${requestId}`;
  const prompt = payload.prompt.trim();
  if (!requestId) {
    throw new Error("requestId is required for agent orchestration.");
  }
  if (deps.activeExecutions.has(requestId)) {
    throw new Error(`Request [${requestId}] is already running.`);
  }
  if (!prompt) {
    throw new Error("Prompt is empty.");
  }
  const execution = {
    requestId,
    conversationId,
    abortController: new AbortController()
  };
  const requestTelemetrySummary = {
    intentId: null,
    confidence: null,
    verdictKind: null,
    recoveryAttempts: 0,
    failureKind: null,
    roundsUsed: 0
  };
  deps.activeExecutions.set(requestId, execution);
  const conversationMemory = deps.getOrCreateConversationMemory(conversationId);
  const previousMemorySnapshot = deps.createConversationMemorySnapshot(conversationMemory);
  deps.pruneConversationMemory();
  const startedAt = Date.now();
  const isRefinementPrompt = deps.isLikelyRefinementPrompt(previousMemorySnapshot, prompt);
  const contextMode = isRefinementPrompt ? "refinement" : "fresh";
  const contextReason = isRefinementPrompt ? "Refinement cues detected in the current prompt, so prior turn context remains active." : "No refinement cues detected; the prompt should be treated as a fresh analysis request.";
  await deps.safeAuditWrite({
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    requestId,
    conversationId,
    stage: "start",
    prompt,
    contextMode,
    contextReason
  });
  deps.emitProgress(onProgress, {
    type: "thinking",
    message: payload.mode === "dry-run" ? "Dry-run: در حال بررسی مسیر کامل ابزارها در main process..." : "در حال تحلیل پرسش و برنامه‌ریزی اجرای ابزارها..."
  });
  try {
    deps.throwIfRequestCanceled(execution.abortController.signal);
    const settings = deps.getSettings();
    deps.refreshConversationMemory(conversationMemory, settings, payload.history, prompt);
    const runtimeSystemPrompt = deps.buildRuntimeSystemPrompt(
      settings,
      prompt,
      conversationMemory,
      previousMemorySnapshot
    );
    let workingHistory = deps.compactHistory(
      [...payload.history, { role: "user", content: prompt }],
      conversationMemory
    );
    let totalToolCallCount = 0;
    let totalSuccessfulDataFetches = 0;
    let financialRecoveryAttempts = 0;
    let discoveryWithoutFetchCount = 0;
    let lastToolErrorCode = null;
    let lastToolErrorMessage = null;
    const executionEvidence = [];
    const deterministicIntent = payload.mode === "dry-run" ? null : deps.detectDeterministicFinancialIntent(prompt);
    const {
      fiscalIntent: deterministicFiscalIntent,
      toolIntent: deterministicToolIntent,
      nonFiscalIntent: deterministicNonFiscalIntent
    } = classifyDeterministicIntent(deterministicIntent);
    const clarificationResponse = payload.mode === "manual" ? deps.buildClarificationResponseIfNeeded(settings, prompt, conversationMemory) : null;
    if (deterministicToolIntent) {
      const toolResult = await deps.tryResolveDeterministicFinancialTool(
        deterministicToolIntent,
        settings,
        conversationMemory,
        execution.abortController.signal,
        onProgress,
        prompt
      );
      if (toolResult) {
        const finalText2 = deps.finalizeFinancialResponse(
          prompt,
          deps.composeDeterministicFinancialToolMarkdown(deterministicToolIntent, toolResult),
          conversationMemory,
          toolResult.toolCallsUsed,
          toolResult.toolCallsUsed > 0 ? 1 : 0,
          "deterministic"
        );
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText2);
        const finalHistory2 = deps.compactHistory(
          [...workingHistory, { role: "assistant", content: finalText2 }],
          conversationMemory
        );
        await deps.safeAuditWrite({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          requestId,
          conversationId,
          stage: "final",
          durationMs: Date.now() - startedAt,
          round: 0
        });
        deps.emitProgress(onProgress, {
          type: "final",
          message: finalText2
        });
        return {
          history: finalHistory2,
          finalText: finalText2,
          rounds: 0,
          toolCallsUsed: toolResult.toolCallsUsed
        };
      }
      if (!isRelaxedExploratoryIntent(deterministicToolIntent)) {
        const finalText2 = deps.buildDeterministicIntentClarificationResponse(deterministicToolIntent);
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText2);
        const finalHistory2 = deps.compactHistory(
          [...workingHistory, { role: "assistant", content: finalText2 }],
          conversationMemory
        );
        await deps.safeAuditWrite({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          requestId,
          conversationId,
          stage: "final",
          durationMs: Date.now() - startedAt,
          round: 0
        });
        deps.emitProgress(onProgress, {
          type: "final",
          message: finalText2
        });
        return {
          history: finalHistory2,
          finalText: finalText2,
          rounds: 0,
          toolCallsUsed: 0
        };
      }
    }
    if (deterministicNonFiscalIntent) {
      const finalText2 = deps.buildDeterministicIntentClarificationResponse(
        deterministicNonFiscalIntent
      );
      deps.updateConversationMemoryFromAssistant(conversationMemory, finalText2);
      const finalHistory2 = deps.compactHistory(
        [...workingHistory, { role: "assistant", content: finalText2 }],
        conversationMemory
      );
      await deps.safeAuditWrite({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        requestId,
        conversationId,
        stage: "final",
        durationMs: Date.now() - startedAt,
        round: 0
      });
      deps.emitProgress(onProgress, {
        type: "final",
        message: finalText2
      });
      return {
        history: finalHistory2,
        finalText: finalText2,
        rounds: 0,
        toolCallsUsed: 0
      };
    }
    if (deterministicFiscalIntent) {
      deps.emitProgress(onProgress, {
        type: "thinking",
        message: deterministicFiscalIntent === "count_fiscal_years" ? "در حال اجرای ابزار قطعی شمارش سال مالی از دیتابیس..." : "در حال اجرای ابزار قطعی فهرست سال های مالی از دیتابیس..."
      });
      const fallbackResult = await deps.tryResolveFiscalYearFallback(
        deterministicFiscalIntent,
        settings,
        conversationMemory,
        execution.abortController.signal,
        onProgress
      );
      if (fallbackResult) {
        totalToolCallCount += fallbackResult.toolCallsUsed;
        const finalText2 = deps.finalizeFinancialResponse(
          prompt,
          deps.composeFiscalYearDeterministicMarkdown(deterministicFiscalIntent, fallbackResult),
          conversationMemory,
          totalToolCallCount,
          1,
          "deterministic"
        );
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText2);
        const finalHistory2 = deps.compactHistory(
          [...workingHistory, { role: "assistant", content: finalText2 }],
          conversationMemory
        );
        await deps.safeAuditWrite({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          requestId,
          conversationId,
          stage: "final",
          durationMs: Date.now() - startedAt,
          round: 0
        });
        deps.emitProgress(onProgress, {
          type: "final",
          message: finalText2
        });
        return {
          history: finalHistory2,
          finalText: finalText2,
          rounds: 0,
          toolCallsUsed: totalToolCallCount
        };
      }
    }
    if (deps.isSalesGrowthPercentPrompt(prompt)) {
      deps.emitProgress(onProgress, {
        type: "thinking",
        message: "در حال محاسبه مستقیم درصد رشد/کاهش فروش از داده واقعی دیتابیس..."
      });
      const growthFallback = await deps.tryResolveSalesGrowthPercentFallback(
        prompt,
        conversationMemory,
        execution.abortController.signal
      );
      if (growthFallback) {
        totalToolCallCount += growthFallback.toolCallsUsed;
        totalSuccessfulDataFetches += 1;
        const finalText2 = deps.finalizeFinancialResponse(
          prompt,
          deps.composeSalesGrowthFallbackMarkdown(growthFallback),
          conversationMemory,
          totalToolCallCount,
          totalSuccessfulDataFetches,
          "deterministic"
        );
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText2);
        const finalHistory2 = deps.compactHistory(
          [...workingHistory, { role: "assistant", content: finalText2 }],
          conversationMemory
        );
        await deps.safeAuditWrite({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          requestId,
          conversationId,
          stage: "final",
          durationMs: Date.now() - startedAt,
          round: 0
        });
        deps.emitProgress(onProgress, {
          type: "final",
          message: finalText2
        });
        return {
          history: finalHistory2,
          finalText: finalText2,
          rounds: 0,
          toolCallsUsed: totalToolCallCount
        };
      }
    }
    if (clarificationResponse) {
      const finalText2 = deps.finalizeFinancialResponse(
        prompt,
        clarificationResponse,
        conversationMemory,
        totalToolCallCount,
        totalSuccessfulDataFetches,
        "clarification"
      );
      deps.updateConversationMemoryFromAssistant(conversationMemory, finalText2);
      const finalHistory2 = deps.compactHistory(
        [...workingHistory, { role: "assistant", content: finalText2 }],
        conversationMemory
      );
      await deps.safeAuditWrite({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        requestId,
        conversationId,
        stage: "final",
        durationMs: Date.now() - startedAt,
        round: 0
      });
      deps.emitProgress(onProgress, {
        type: "final",
        message: finalText2
      });
      return {
        history: finalHistory2,
        finalText: finalText2,
        rounds: 0,
        toolCallsUsed: 0
      };
    }
    for (let round = 0; round < MAX_TOOL_CALL_ROUNDS$1; round += 1) {
      deps.throwIfRequestCanceled(execution.abortController.signal);
      const isFinalRound = round === MAX_TOOL_CALL_ROUNDS$1 - 1;
      const finalRoundPrompt = isFinalRound ? `${runtimeSystemPrompt}

This is the final tool round. If the required data is still missing, answer with the best partial result and explicitly state what is missing.` : runtimeSystemPrompt;
      let response;
      try {
        response = await deps.callGeminiWithProviderRetry(
          {
            messages: [{ role: "system", content: finalRoundPrompt }, ...workingHistory],
            temperature: 0.2,
            tools: isFinalRound ? void 0 : FINANCIAL_TOOLS
          },
          settings.gemini,
          execution.abortController.signal,
          onProgress
        );
      } catch (error) {
        const errorInfo = deps.toErrorInfo(error);
        if (deps.shouldReturnDegradedFallback(error)) {
          deps.emitGuardrailTelemetry("provider-error", requestId, conversationId, {
            errorCode: errorInfo.code ?? "AGENT_PROVIDER_FAILURE_DEGRADED",
            errorMessage: errorInfo.message
          });
          deps.emitGuardrailCounterTelemetry("provider-error", requestId, conversationId, 1);
          const finalText2 = deps.buildRuntimeFailureFallbackAnswer(
            prompt,
            errorInfo.message,
            totalToolCallCount,
            totalSuccessfulDataFetches
          );
          deps.updateConversationMemoryFromAssistant(conversationMemory, finalText2);
          const finalHistory2 = deps.compactHistory(
            [...workingHistory, { role: "assistant", content: finalText2 }],
            conversationMemory
          );
          deps.emitProgress(onProgress, {
            type: "tool-error",
            message: "⚠️ پاسخ جزئی بازگردانده شد زیرا خطای ارتباط یا زمان‌بندی در مسیر هوش مصنوعی رخ داد.",
            errorCode: "AGENT_PROVIDER_FAILURE_DEGRADED",
            errorCategory: "orchestration-runtime"
          });
          await deps.safeAuditWrite({
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            requestId,
            conversationId,
            stage: "error",
            durationMs: Date.now() - startedAt,
            error: errorInfo.message,
            errorCode: "AGENT_PROVIDER_FAILURE_DEGRADED",
            errorCategory: "orchestration-runtime"
          });
          deps.emitProgress(onProgress, {
            type: "final",
            message: finalText2
          });
          return {
            history: finalHistory2,
            finalText: finalText2,
            rounds: 0,
            toolCallsUsed: totalToolCallCount
          };
        }
        throw error;
      }
      deps.throwIfRequestCanceled(execution.abortController.signal);
      const toolCalls = deps.extractToolCallsFromResponse(response);
      if (toolCalls.length > MAX_TOOL_CALLS_PER_ROUND$1) {
        const finalText2 = deps.buildRuntimeFailureFallbackAnswer(
          prompt,
          `محدودیت ابزارها: این دور ${toolCalls.length} ابزار درخواست کرد در حالی که حد مجاز ${MAX_TOOL_CALLS_PER_ROUND$1} است.`,
          totalToolCallCount,
          totalSuccessfulDataFetches,
          "budget"
        );
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText2);
        const finalHistory2 = deps.compactHistory(
          [...workingHistory, { role: "assistant", content: finalText2 }],
          conversationMemory
        );
        deps.emitProgress(onProgress, {
          type: "tool-error",
          message: "⚠️ پاسخ جزئی بازگردانده شد زیرا محدودیت ابزارهای هر دور از حد مجاز عبور کرد.",
          errorCode: "AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED",
          errorCategory: "orchestration-policy"
        });
        await deps.safeAuditWrite({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          requestId,
          conversationId,
          stage: "error",
          durationMs: Date.now() - startedAt,
          error: "AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED",
          errorCode: "AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED",
          errorCategory: "orchestration-policy"
        });
        deps.emitProgress(onProgress, {
          type: "final",
          message: finalText2
        });
        return {
          history: finalHistory2,
          finalText: finalText2,
          rounds: round + 1,
          toolCallsUsed: totalToolCallCount
        };
      }
      const projectedTotalToolCalls = totalToolCallCount + toolCalls.length;
      if (projectedTotalToolCalls > MAX_TOTAL_TOOL_CALLS$1) {
        const finalText2 = deps.buildRuntimeFailureFallbackAnswer(
          prompt,
          `محدودیت ابزارها: در کل ${projectedTotalToolCalls} ابزار درخواست شد در حالی که حد مجاز ${MAX_TOTAL_TOOL_CALLS$1} است.`,
          totalToolCallCount,
          totalSuccessfulDataFetches,
          "budget"
        );
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText2);
        const finalHistory2 = deps.compactHistory(
          [...workingHistory, { role: "assistant", content: finalText2 }],
          conversationMemory
        );
        deps.emitProgress(onProgress, {
          type: "tool-error",
          message: "⚠️ پاسخ جزئی بازگردانده شد زیرا محدودیت ابزارهای کل درخواست از حد مجاز عبور کرد.",
          errorCode: "AGENT_TOTAL_TOOL_CALLS_EXCEEDED",
          errorCategory: "orchestration-policy"
        });
        await deps.safeAuditWrite({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          requestId,
          conversationId,
          stage: "error",
          durationMs: Date.now() - startedAt,
          error: "AGENT_TOTAL_TOOL_CALLS_EXCEEDED",
          errorCode: "AGENT_TOTAL_TOOL_CALLS_EXCEEDED",
          errorCategory: "orchestration-policy"
        });
        deps.emitProgress(onProgress, {
          type: "final",
          message: finalText2
        });
        return {
          history: finalHistory2,
          finalText: finalText2,
          rounds: round + 1,
          toolCallsUsed: totalToolCallCount
        };
      }
      if (toolCalls.length === 0) {
        const failureKind = classifyToolFailure(
          executionEvidence,
          lastToolErrorCode ?? void 0,
          lastToolErrorMessage ?? void 0
        );
        const numericFinancialQuestion = deps.requiresStrictFinancialDataFetch(
          prompt,
          response.text
        );
        const shouldRecoverEmptyResult = failureKind === "EMPTY_RESULT" && numericFinancialQuestion;
        const shouldForceFetchAfterDiscovery = discoveryWithoutFetchCount >= 2 && totalSuccessfulDataFetches === 0 && !isFinalRound && !deps.isLikelyRefinementPrompt(conversationMemory, prompt);
        const isComparativeMultiPeriod = deps.isComparativeMultiPeriodPrompt(prompt);
        const shouldForceComparativeFetch = isComparativeMultiPeriod && totalSuccessfulDataFetches < 2 && !isFinalRound && !deps.isLikelyRefinementPrompt(conversationMemory, prompt);
        if (deterministicFiscalIntent && totalToolCallCount === 0) {
          deps.emitProgress(onProgress, {
            type: "thinking",
            message: deterministicFiscalIntent === "count_fiscal_years" ? "در حال اجرای ابزار پشتیبان شمارش سال مالی از داده واقعی دیتابیس..." : "در حال اجرای ابزار پشتیبان فهرست سال های مالی از داده واقعی دیتابیس..."
          });
          const fallbackResult = await deps.tryResolveFiscalYearFallback(
            deterministicFiscalIntent,
            settings,
            conversationMemory,
            execution.abortController.signal,
            onProgress
          );
          if (fallbackResult) {
            totalToolCallCount += fallbackResult.toolCallsUsed;
            const finalText3 = deps.finalizeFinancialResponse(
              prompt,
              deps.composeFiscalYearDeterministicMarkdown(
                deterministicFiscalIntent,
                fallbackResult
              ),
              conversationMemory,
              totalToolCallCount,
              1
            );
            deps.updateConversationMemoryFromAssistant(conversationMemory, finalText3);
            const finalHistory3 = deps.compactHistory(
              [...workingHistory, { role: "assistant", content: finalText3 }],
              conversationMemory
            );
            await deps.safeAuditWrite({
              timestamp: (/* @__PURE__ */ new Date()).toISOString(),
              requestId,
              conversationId,
              stage: "final",
              durationMs: Date.now() - startedAt,
              round: round + 1,
              recoveryAttempts: financialRecoveryAttempts,
              failureKind
            });
            deps.emitProgress(onProgress, {
              type: "final",
              message: finalText3
            });
            return {
              history: finalHistory3,
              finalText: finalText3,
              rounds: round + 1,
              toolCallsUsed: totalToolCallCount
            };
          }
        }
        const rawFinalText = response.text.trim() || "Model returned an empty response.";
        const shouldAttemptRecovery = financialRecoveryAttempts < MAX_FINANCIAL_RECOVERY_ATTEMPTS && !isFinalRound && totalToolCallCount < MAX_TOTAL_TOOL_CALLS$1 && (shouldRecoverEmptyResult || totalSuccessfulDataFetches === 0 && deps.requiresStrictFinancialDataFetch(prompt, rawFinalText) && !deps.isLikelyRefinementPrompt(conversationMemory, prompt) || shouldForceFetchAfterDiscovery || shouldForceComparativeFetch);
        if (shouldAttemptRecovery) {
          financialRecoveryAttempts += 1;
          const recoveryHint = deps.buildRecoveryHint(
            failureKind,
            lastToolErrorCode ?? void 0,
            lastToolErrorMessage ?? void 0,
            executionEvidence,
            {
              comparativeMultiPeriod: isComparativeMultiPeriod,
              successfulFetches: totalSuccessfulDataFetches
            },
            prompt
          );
          if (failureKind === "EMPTY_RESULT" && deps.requiresStrictFinancialDataFetch(prompt, rawFinalText)) {
            deps.emitGuardrailTelemetry("empty-result-recovery", requestId, conversationId, {
              recoveryAttempts: financialRecoveryAttempts,
              failureKind,
              hint: recoveryHint
            });
            deps.emitGuardrailCounterTelemetry(
              "empty-result-recovery",
              requestId,
              conversationId,
              financialRecoveryAttempts
            );
          }
          workingHistory = deps.compactHistory(
            [
              ...workingHistory,
              { role: "assistant", content: rawFinalText },
              {
                role: "user",
                content: `برای پاسخ مالی نهایی باید عددِ خواسته‌شده را مستقیماً از دیتابیس استخراج کنی. این ${financialRecoveryAttempts} از ${MAX_FINANCIAL_RECOVERY_ATTEMPTS} تلاش بازپروری است. ${recoveryHint} سپس بر اساس نتیجهٔ واقعی پاسخ نهایی بده. بدون اجرای fetch_financial_data پاسخ نده.`
              }
            ],
            conversationMemory
          );
          deps.emitProgress(onProgress, {
            type: "thinking",
            message: `در حال امتحان روش دیگر برای استخراج داده... (تلاش ${financialRecoveryAttempts} از ${MAX_FINANCIAL_RECOVERY_ATTEMPTS})`
          });
          continue;
        }
        const finalText2 = deps.finalizeFinancialResponse(
          prompt,
          rawFinalText,
          conversationMemory,
          totalToolCallCount,
          totalSuccessfulDataFetches,
          "model-assisted",
          {
            intentId: deterministicIntent ?? null,
            toolCallsUsed: totalToolCallCount,
            rounds: round + 1,
            evidence: executionEvidence
          },
          { attempts: financialRecoveryAttempts }
        );
        requestTelemetrySummary.intentId = deterministicIntent ?? null;
        requestTelemetrySummary.confidence = deterministicIntent ? 1 : 0.5;
        requestTelemetrySummary.recoveryAttempts = financialRecoveryAttempts;
        requestTelemetrySummary.failureKind = failureKind ?? null;
        requestTelemetrySummary.roundsUsed = round + 1;
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText2);
        const finalHistory2 = deps.compactHistory(
          [...workingHistory, { role: "assistant", content: finalText2 }],
          conversationMemory
        );
        await deps.safeAuditWrite({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          requestId,
          conversationId,
          stage: "final",
          durationMs: Date.now() - startedAt,
          round: round + 1,
          recoveryAttempts: financialRecoveryAttempts,
          failureKind
        });
        deps.emitProgress(onProgress, {
          type: "final",
          message: finalText2
        });
        return {
          history: finalHistory2,
          finalText: finalText2,
          rounds: round + 1,
          toolCallsUsed: totalToolCallCount
        };
      }
      if (isFinalRound) {
        deps.emitProgress(onProgress, {
          type: "tool-error",
          message: "⚠️ این آخرین دور ابزار است؛ خروجی فعلی به‌عنوان نتیجه جزئی بازگردانده می‌شود.",
          errorCode: "AGENT_LOOP_BUDGET_EXHAUSTED",
          errorCategory: "orchestration-control"
        });
        break;
      }
      deps.emitProgress(onProgress, {
        type: "thinking",
        message: "هوش مصنوعی در حال استخراج داده از دیتابیس است..."
      });
      workingHistory.push({
        role: "assistant",
        content: response.text ?? "",
        toolCalls
      });
      const toolExecution = await deps.executeFinancialToolCalls({
        requestId,
        conversationId,
        round: round + 1,
        toolCalls,
        settings,
        conversationMemory,
        onProgress,
        abortSignal: execution.abortController.signal
      });
      totalToolCallCount = projectedTotalToolCalls;
      totalSuccessfulDataFetches += toolExecution.successfulDataFetches;
      executionEvidence.push(...toolExecution.evidence);
      const discoveryToolsUsed = toolExecution.evidence.filter(
        (entry) => entry.tool === "catalog_scan" || entry.tool === "list_database_tables"
      );
      if (discoveryToolsUsed.some((entry) => entry.status === "ok")) {
        const hadFetchInRound = toolExecution.evidence.some(
          (entry) => entry.tool === "fetch_financial_data" && entry.status === "ok"
        );
        if (!hadFetchInRound) {
          discoveryWithoutFetchCount += 1;
        }
      }
      const lastToolEvidence = toolExecution.evidence.filter((entry) => entry.status === "error").at(-1);
      if (lastToolEvidence) {
        lastToolErrorCode = lastToolEvidence.errorCode ?? (lastToolEvidence.query ? "TOOL_ERROR" : null);
        lastToolErrorMessage = lastToolEvidence.errorMessage ?? null;
      }
      workingHistory = deps.compactHistory(
        [...workingHistory, ...toolExecution.toolMessages],
        conversationMemory
      );
    }
    const finalText = deps.buildExhaustionFallbackAnswer(
      prompt,
      workingHistory,
      totalToolCallCount,
      totalSuccessfulDataFetches
    );
    deps.updateConversationMemoryFromAssistant(conversationMemory, finalText);
    const finalHistory = deps.compactHistory(
      [...workingHistory, { role: "assistant", content: finalText }],
      conversationMemory
    );
    deps.emitProgress(onProgress, {
      type: "tool-error",
      message: "⚠️ محدودیت دورهای ابزار به پایان رسید؛ پاسخ جزئی با جزئیات موجود بازگردانده شد.",
      errorCode: "AGENT_LOOP_BUDGET_EXHAUSTED",
      errorCategory: "orchestration-control"
    });
    await deps.safeAuditWrite({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      requestId,
      conversationId,
      stage: "error",
      durationMs: Date.now() - startedAt,
      error: "AGENT_LOOP_BUDGET_EXHAUSTED",
      errorCode: "AGENT_LOOP_BUDGET_EXHAUSTED",
      errorCategory: "orchestration-control"
    });
    deps.telemetryCapture?.({
      event: "agent.orchestrator.request-summary",
      category: "agent.orchestrator",
      level: "warn",
      process: "main",
      message: "request-complete",
      details: {
        ...requestTelemetrySummary,
        requestId,
        conversationId,
        stage: "error"
      },
      requestId,
      conversationId
    });
    deps.emitProgress(onProgress, {
      type: "final",
      message: finalText
    });
    return {
      history: finalHistory,
      finalText,
      rounds: MAX_TOOL_CALL_ROUNDS$1,
      toolCallsUsed: totalToolCallCount
    };
  } catch (error) {
    const resolvedError = deps.resolveCancellationError(error, execution.abortController.signal);
    const errorInfo = deps.toErrorInfo(resolvedError);
    if (errorInfo.code === "AGENT_REQUEST_CANCELLED") {
      deps.emitProgress(onProgress, {
        type: "cancelled",
        message: "⏹️ درخواست جاری با موفقیت متوقف شد."
      });
    }
    await deps.safeAuditWrite({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      requestId,
      conversationId,
      stage: "error",
      durationMs: Date.now() - startedAt,
      error: errorInfo.message,
      errorCode: errorInfo.code,
      errorCategory: errorInfo.category
    });
    deps.telemetryCapture?.({
      event: "agent.orchestrator.request-summary",
      category: "agent.orchestrator",
      level: "warn",
      process: "main",
      message: "request-complete",
      details: {
        ...requestTelemetrySummary,
        requestId,
        conversationId,
        stage: "error"
      },
      requestId,
      conversationId
    });
    throw resolvedError;
  } finally {
    deps.activeExecutions.delete(requestId);
  }
}
function buildExhaustionFallbackAnswer(deps, prompt, _history, toolCallsUsed, successfulDataFetches) {
  return [
    "### Summary",
    "در این دور ابزار، محدودیت ابزار به پایان رسید و پاسخ جزئی بازگردانده شد.",
    "",
    "### Findings",
    `تعداد ابزارهای استفاده‌شده ${toolCallsUsed} و داده‌های موفق استخراج‌شده ${successfulDataFetches} مورد ثبت شد.`,
    "",
    "### Evidence",
    `پرسش کاربر: ${deps.compactText(prompt, 220)}`,
    "",
    "### Assumptions",
    "برای ادامه، لازم است پرسش را محدودتر یا با جدول/ستون دقیق‌تر بازفرموله کنید.",
    "",
    "### Actions",
    "پرسش را با نام جدول/ستون دقیق‌تر یا دامنه زمانی محدودتر ارسال کنید."
  ].join("\n");
}
async function callGeminiWithProviderRetry(deps, payload, savedConfig, abortSignal, onProgress) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await deps.geminiClient.chat(payload, savedConfig, {
        onTextChunk: (chunkText) => {
          if (!chunkText) {
            return;
          }
          deps.emitProgress(onProgress, {
            type: "response-chunk",
            message: chunkText
          });
        },
        signal: abortSignal
      });
    } catch (error) {
      const errorInfo = deps.toErrorInfo(error);
      const message = (errorInfo.message || "").toLowerCase();
      const transient = message.includes("provider") || message.includes("overloaded") || message.includes("unavailable") || message.includes("service unavailable") || message.includes("bad gateway") || message.includes("gateway timeout") || message.includes("timeout") || message.includes("connect") || message.includes("network") || /\b(4\d\d|5\d\d)\b/.test(message);
      if (!transient || attempt >= maxAttempts) {
        throw error;
      }
      const delayMs = 250 * attempt + Math.floor(Math.random() * 150);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Provider request failed after retries.");
}
function shouldReturnDegradedFallback(deps, error) {
  const errorInfo = deps.toErrorInfo(error);
  const message = (errorInfo.message || "").toLowerCase();
  if (errorInfo.code === "AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED" || errorInfo.code === "AGENT_TOTAL_TOOL_CALLS_EXCEEDED") {
    return true;
  }
  return message.includes("خطای ارتباط") || message.includes("زمان انتظار برای هوش مصنوعی") || message.includes("timeout") || message.includes("connect") || message.includes("network") || message.includes("provider") || message.includes("overloaded") || message.includes("unavailable") || message.includes("service unavailable") || message.includes("bad gateway") || message.includes("gateway timeout") || /\b(4\d\d|5\d\d)\b/.test(message);
}
function buildRuntimeFailureFallbackAnswer(deps, prompt, detail, toolCallsUsed, successfulDataFetches, kind = "provider") {
  const summary = kind === "budget" ? "پاسخ جزئی بازگردانده شد زیرا محدودیت ابزارها از حد مجاز عبور کرد." : "پاسخ جزئی بازگردانده شد زیرا خطای ارتباط یا زمان‌بندی در مسیر هوش مصنوعی رخ داد.";
  const findings = kind === "budget" ? `محدودیت ابزارهای این درخواست باعث توقف قبل از تکمیل تحلیل شد. تعداد ابزارهای استفاده‌شده ${toolCallsUsed} و داده‌های موفق استخراج‌شده ${successfulDataFetches} مورد ثبت شد.` : `خطای ارتباط یا زمان‌بندی باعث توقف قبل از تکمیل تحلیل شد. تعداد ابزارهای استفاده‌شده ${toolCallsUsed} و داده‌های موفق استخراج‌شده ${successfulDataFetches} مورد ثبت شد.`;
  return [
    "### Summary",
    summary,
    "",
    "### Findings",
    findings,
    "",
    "### Evidence",
    `جزئیات خطا: ${deps.compactText(detail, 240)}`,
    `پرسش کاربر: ${deps.compactText(prompt, 220)}`,
    "",
    "### Assumptions",
    "برای ادامه، لازم است پرسش را محدودتر یا با جدول/ستون دقیق‌تر بازفرموله کنید.",
    "",
    "### Actions",
    "پرسش را دوباره با دامنه زمانی محدودتر یا شرح دقیق‌تر ارسال کنید."
  ].join("\n");
}
function validateIntentTableMatch(intentId, evidence) {
  if (!intentId) return null;
  const intentTableMap = {
    get_purchase_summary: [
      "INV.InventoryReceipt",
      "INV.InventoryReceiptItem",
      "POM.PurchaseInvoice",
      "Inv.Voucher"
    ],
    get_sales_summary_by_period: ["SLS.Invoice", "MRP.SaleFacts"],
    get_account_balance: ["ACC.Voucher", "ACC.VoucherItem", "FMK.FiscalYear", "ACC.Account"],
    get_cash_bank_balance: ["RPA.CashBalance", "RPA.BankAccountBalance"],
    get_trial_balance: ["ACC.Voucher", "ACC.VoucherItem", "FMK.FiscalYear", "ACC.Account"],
    get_party_balance: ["ACC.Voucher", "ACC.VoucherItem", "FMK.FiscalYear"],
    get_receivables_summary: ["accounts", "documents"],
    get_payables_summary: ["accounts", "documents"]
  };
  const allowedTables = intentTableMap[intentId];
  if (!allowedTables) return null;
  for (const entry of evidence) {
    if (entry.tool === "fetch_financial_data" && entry.query) {
      const query = entry.query;
      const usesAllowedTable = allowedTables.some((table) => query.includes(table));
      if (!usesAllowedTable) {
        return `Intent mismatch: detected intent "${intentId}" but query uses tables not in the allowed set [${allowedTables.join(", ")}]. Query: ${query}`;
      }
    }
  }
  return null;
}
function buildRecoveryHint(failureKind, lastErrorCode, lastErrorMessage, evidence = [], context, prompt) {
  const discoveryOnly = evidence.length > 0 && evidence.every((entry) => entry.tool !== "fetch_financial_data");
  if (context?.comparativeMultiPeriod && (context.successfulFetches ?? 0) < 2) {
    const remaining = Math.max(0, 2 - (context.successfulFetches ?? 0));
    return `این یک سوال مقایسه‌ای چنددوره‌ای است: برای هر دوره/سال یک fetch_financial_data جداگانه با یک SELECT SUM/COUNT/AVG و فیلتر FiscalYearRef متفاوت اجرا کن (مثلاً WHERE FiscalYearRef = <Title1> و یک کوئری دوم WHERE FiscalYearRef = <Title2>). حداقل ${remaining} fetch موفق دیگر لازم است.`;
  }
  const isPurchaseIntent = prompt && /خرید|purchase/iu.test(prompt);
  const usedPurchaseInvoice = evidence.some(
    (entry) => entry.tool === "fetch_financial_data" && entry.query?.includes("POM.PurchaseInvoice")
  );
  switch (failureKind) {
    case "NO_FETCH":
      return discoveryOnly ? "تو فقط جدول‌ها را دیدی ولی عدد نگرفتی. حالا حتماً fetch_financial_data را با یک SELECT SUM/COUNT/AVG روی جدول پیدا شده اجرا کن و نتیجه را از دیتابیس بگیر." : "برای پاسخ عددی باید fetch_financial_data را با یک کوئری SUM/COUNT/AVG اجرا کنی.";
    case "EMPTY_RESULT":
      if (isPurchaseIntent && usedPurchaseInvoice) {
        return "POM.PurchaseInvoice خالی است. برای این فرآیند کسب‌وکار، خرید در INV.InventoryReceipt ثبت می‌شود. INV.InventoryReceipt را با ستون TotalPrice بررسی کن (فقط ردیف‌های غیر مرجوعی با IsReturn = 0 یا Type = خرید). اگر داده یافت شد، در پاسخ صریحاً ذکر کن که مبلغ از رسید انبار است نه فاکتور خرید.";
      }
      return "مجموع NULL شد. ممکن است ستون مبلغ اشتباه باشد. ستون‌های عددی جایگزین جدول را با get_database_schema بررسی کن (مثلاً PriceInBaseCurrency در برابر NetPriceInBaseCurrency) یا جدول مرتبط دیگر (مثل POM.PurchaseCost) را امتحان کن.";
    case "NOT_IN_CATALOG":
      return "جدول مجاز نیست. اول با list_database_tables و get_database_schema جدول درست را پیدا کن.";
    case "UNKNOWN_OBJECT":
      return "نام جدول/ستون وجود ندارد. اول با list_database_tables و get_database_schema نام دقیق را پیدا کن، بعد کوئری بزن و نام را از خودت نساز.";
    case "UNSUPPORTED_FUNCTION":
      return "این SQL Server توابع FORMAT و dbo.GregorianToShamsi را پشتیبانی نمی‌کند. برای ماه از MONTH(Date) و YEAR(Date) یا بازهٔ تاریخ میلادی صریح استفاده کن.";
    case "POLICY_ERROR":
      return `${mapRecoveryErrorHint(lastErrorCode)} کوئری را اصلاح کن و دوباره اجرا کن.`;
    case "PROVIDER_ERROR":
      return "دوباره با همان مسیر تلاش کن.";
    case "NONE":
    default:
      return "برای پاسخ عددی باید fetch_financial_data را با یک کوئری SUM/COUNT/AVG اجرا کنی.";
  }
}
async function fetchTableListCached(deps, tablePattern, sqlQuery, abortSignal) {
  const normalized = (tablePattern ?? "").trim().toLowerCase();
  const cacheKey = normalized ? `pattern:${normalized}` : "all";
  const cached = deps.schemaTableListCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp <= deps.SCHEMA_CACHE_TTL_MS) {
    return [...cached.rows];
  }
  const rows = await deps.executeMetadataSql(sqlQuery, abortSignal);
  deps.schemaTableListCache.set(cacheKey, { rows, timestamp: Date.now() });
  return rows;
}
function prevalidateFinancialQuery(deps, sqlQuery, settings) {
  const activeCatalog = deps.findActiveSchemaCatalog(settings);
  if (!activeCatalog) {
    return sqlQuery;
  }
  let rewritten = sqlQuery;
  const identifierPattern = /\b(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\b/g;
  for (const table of activeCatalog.tables) {
    const tableName = table.tableName.trim();
    const schemaName = table.schemaName.trim();
    const cacheKey = `${schemaName || "dbo"}.${tableName}`;
    const cachedColumnList = deps.schemaCacheByTableKey.get(cacheKey);
    const availableColumns = cachedColumnList?.schema.length ? cachedColumnList.schema.map((column) => column.name.trim()).filter(Boolean) : table.columns.map((column) => column.name.trim()).filter(Boolean);
    if (availableColumns.length === 0) {
      continue;
    }
    const normalizedTableRef = normalizeTableReference(
      deps.normalizeTableRef,
      `${schemaName}.${tableName}`
    );
    const tableRefPattern = new RegExp(
      `\\b(?:\\[${schemaName}\\]\\.|${schemaName}\\.)?\\[?${tableName}\\]?\\b`,
      "gi"
    );
    rewritten = rewritten.replace(tableRefPattern, (match) => match);
    rewritten = rewritten.replace(identifierPattern, (match) => {
      const rawName = match.replace(/\[|\]|`/g, "");
      const canonical = resolveColumnNameAlias(rawName, availableColumns);
      if (!canonical || canonical.trim().toLowerCase() === rawName.trim().toLowerCase()) {
        return match;
      }
      const candidate = canonical.trim().toLowerCase();
      const normalizedMatch = rawName.trim().toLowerCase();
      if (normalizedMatch === candidate) {
        return canonical;
      }
      if (availableColumns.some((column) => column.trim().toLowerCase() === normalizedMatch)) {
        return canonical;
      }
      return match;
    });
    const canonicalTableToken = availableColumns.some(
      (column) => column.toLowerCase() === normalizedTableRef
    );
    if (canonicalTableToken) {
      rewritten = rewritten.replace(new RegExp(`\\b${tableName}\\b`, "gi"), tableName);
    }
  }
  return rewritten;
}
async function getCachedSchemaSnapshot(deps, cacheKey, sqlQuery, abortSignal) {
  const cached = deps.schemaCacheByTableKey.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < deps.SCHEMA_CACHE_TTL_MS) {
    return {
      rows: cached.schema.map((col, idx) => ({
        table_schema: cacheKey.split(".").slice(0, -1).join(".") || "dbo",
        table_name: cacheKey.split(".").pop() || "",
        ordinal_position: String(idx + 1),
        column_name: col.name,
        data_type: col.dataType,
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        datetime_precision: null,
        is_nullable: col.isNullable ? 1 : 0,
        is_identity: col.isIdentity ? 1 : 0
      }))
    };
  }
  const rows = await deps.executeMetadataSql(sqlQuery, abortSignal);
  const schemaColumns = rows.map((row) => {
    const colName = row["column_name"];
    const dataType = row["data_type"];
    const maxLen = row["character_maximum_length"];
    const isNullable = row["is_nullable"];
    const isIdentity = row["is_identity"];
    return {
      name: typeof colName === "string" ? colName : String(colName || ""),
      dataType: typeof dataType === "string" ? dataType : "unknown",
      isNullable: Boolean(isNullable),
      maxLength: typeof maxLen === "number" && maxLen > 0 ? maxLen : null,
      isIdentity: Boolean(isIdentity),
      isPrimaryKey: false,
      hasForeignKey: false,
      sampleValues: []
    };
  });
  deps.schemaCacheByTableKey.set(cacheKey, { schema: schemaColumns, timestamp: Date.now() });
  return { rows };
}
function normalizeTableReference(normalizeTableRefFn, tableRef) {
  return normalizeTableRefFn(tableRef).replace(/\[|\]|`|"/g, "").replace(/\s+/g, "");
}
function resolveColumnNameAlias(columnName, availableColumns) {
  const normalizedTarget = columnName.trim().toLowerCase();
  const normalizedAvailable = availableColumns.map((entry) => entry.trim().toLowerCase());
  if (normalizedAvailable.includes(normalizedTarget)) {
    return availableColumns[normalizedAvailable.indexOf(normalizedTarget)];
  }
  const aliasMap = {
    name: "Title",
    title: "Title",
    date: "DocDate",
    docdate: "DocDate",
    doc_date: "DocDate",
    documentdate: "DocDate",
    document_date: "DocDate"
  };
  const alias = aliasMap[normalizedTarget];
  if (alias && normalizedAvailable.includes(alias.toLowerCase())) {
    return alias;
  }
  const fuzzy = availableColumns.find((entry) => entry.trim().toLowerCase() === normalizedTarget);
  if (fuzzy) {
    return fuzzy;
  }
  return columnName;
}
const MAX_TOOL_CALL_ROUNDS = 4;
const MAX_TOOL_CALLS_PER_ROUND = 7;
const MAX_TOTAL_TOOL_CALLS = 14;
const MAX_SCHEMA_ROWS = 240;
const MAX_TABLE_LIST_ROWS = 500;
const MAX_TOOL_PAYLOAD_CHARS = 9e4;
const MAX_TOOL_VALUE_CHARS = 500;
class AgentOrchestrator {
  sqlParser = new nodeSqlParser.Parser();
  geminiClient;
  getSettings;
  executeReadOnlySql;
  executeMetadataSql;
  auditLog;
  telemetry;
  mobileBridge;
  activeExecutions = /* @__PURE__ */ new Map();
  conversationMemoryById = /* @__PURE__ */ new Map();
  schemaCacheByTableKey = /* @__PURE__ */ new Map();
  schemaTableListCache = /* @__PURE__ */ new Map();
  SCHEMA_CACHE_TTL_MS = 9e5;
  get salesGrowthDeps() {
    return {
      findActiveSchemaCatalog: (settings) => this.findActiveSchemaCatalog(settings),
      resolvePreferredMapping: (catalog, conceptKey, prompt) => this.resolvePreferredMapping(catalog, conceptKey, prompt),
      normalizeTableRef: (tableRef) => this.normalizeTableRef(tableRef),
      quoteSqlTableRef: (ref) => this.quoteSqlTableRef(ref),
      executeReadOnlySql: (query, signal) => this.executeReadOnlySql(query, signal),
      toSafeNumber: (value) => this.toSafeNumber(value),
      rememberToolTrace: (memory, trace) => this.rememberToolTrace(memory, trace),
      throwIfRequestCanceled: (signal) => this.throwIfRequestCanceled(signal),
      safeAuditWrite: (entry) => this.safeAuditWrite(entry),
      compactText: (value, maxLength) => this.compactText(value, maxLength)
    };
  }
  constructor(deps) {
    this.geminiClient = deps.geminiClient;
    this.getSettings = deps.getSettings;
    this.executeReadOnlySql = deps.executeReadOnlySql;
    this.executeMetadataSql = deps.executeMetadataSql;
    this.auditLog = deps.auditLog;
    this.telemetry = deps.telemetry;
    this.mobileBridge = deps.mobileBridge;
  }
  async sendMessage(payload, onProgress) {
    const mode = this.getSettings().financialEngineMode ?? "legacy";
    void this.safeAuditWrite({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      requestId: payload.requestId,
      conversationId: payload.conversationId,
      stage: "engine-mode",
      prompt: `FINANCIAL_ENGINE_MODE=${mode}`
    });
    return sendMessage(this.sendMessageDeps, payload, onProgress);
  }
  get sendMessageDeps() {
    return {
      activeExecutions: this.activeExecutions,
      getOrCreateConversationMemory: (conversationId) => this.getOrCreateConversationMemory(conversationId),
      createConversationMemorySnapshot: (memory) => this.createConversationMemorySnapshot(memory),
      pruneConversationMemory: () => this.pruneConversationMemory(),
      isLikelyRefinementPrompt: (previousMemory, prompt) => this.isLikelyRefinementPrompt(previousMemory, prompt),
      safeAuditWrite: (entry) => this.safeAuditWrite(entry),
      emitProgress: (onProgress, event) => this.emitProgress(onProgress, event),
      throwIfRequestCanceled: (signal) => this.throwIfRequestCanceled(signal),
      getSettings: () => this.getSettings(),
      refreshConversationMemory: (memory, settings, history, prompt) => this.refreshConversationMemory(memory, settings, history, prompt),
      buildRuntimeSystemPrompt: (settings, prompt, conversationMemory, previousMemorySnapshot) => this.buildRuntimeSystemPrompt(settings, prompt, conversationMemory, previousMemorySnapshot),
      compactHistory: (history, memory) => this.compactHistory(history, memory),
      detectDeterministicFinancialIntent: (prompt) => this.detectDeterministicFinancialIntent(prompt),
      buildClarificationResponseIfNeeded: (settings, prompt, conversationMemory) => this.buildClarificationResponseIfNeeded(settings, prompt, conversationMemory),
      tryResolveDeterministicFinancialTool: (deterministicIntent, settings, conversationMemory, signal, onProgress, prompt) => this.tryResolveDeterministicFinancialTool(
        deterministicIntent,
        settings,
        conversationMemory,
        signal,
        onProgress,
        prompt
      ),
      finalizeFinancialResponse: (prompt, rawText, conversationMemory, totalToolCallCount, successfulDataFetchCount, routeMode, executionTrace, recoveryContext, requestId) => this.finalizeFinancialResponse(
        prompt,
        rawText,
        conversationMemory,
        totalToolCallCount,
        successfulDataFetchCount,
        routeMode,
        executionTrace,
        recoveryContext,
        requestId
      ),
      composeDeterministicFinancialToolMarkdown: (deterministicIntent, result) => this.composeDeterministicFinancialToolMarkdown(deterministicIntent, result),
      updateConversationMemoryFromAssistant: (memory, finalText) => this.updateConversationMemoryFromAssistant(memory, finalText),
      buildDeterministicIntentClarificationResponse: (intentId) => this.buildDeterministicIntentClarificationResponse(intentId),
      tryResolveFiscalYearFallback: (deterministicIntent, settings, conversationMemory, signal, onProgress) => this.tryResolveFiscalYearFallback(
        deterministicIntent,
        settings,
        conversationMemory,
        signal,
        onProgress
      ),
      composeFiscalYearDeterministicMarkdown: (deterministicIntent, result) => this.composeFiscalYearDeterministicMarkdown(deterministicIntent, result),
      isSalesGrowthPercentPrompt: (prompt) => this.isSalesGrowthPercentPrompt(prompt),
      tryResolveSalesGrowthPercentFallback: (prompt, conversationMemory, signal) => this.tryResolveSalesGrowthPercentFallback(prompt, conversationMemory, signal),
      composeSalesGrowthFallbackMarkdown: (result) => this.composeSalesGrowthFallbackMarkdown(result),
      callGeminiWithProviderRetry: (payload, savedConfig, abortSignal, onProgress) => this.callGeminiWithProviderRetry(payload, savedConfig, abortSignal, onProgress),
      toErrorInfo: (error) => this.toErrorInfo(error),
      shouldReturnDegradedFallback: (error) => this.shouldReturnDegradedFallback(error),
      emitGuardrailTelemetry: (kind, requestId, conversationId, details) => this.emitGuardrailTelemetry(kind, requestId, conversationId, details),
      emitGuardrailCounterTelemetry: (kind, requestId, conversationId, count) => this.emitGuardrailCounterTelemetry(kind, requestId, conversationId, count),
      buildRuntimeFailureFallbackAnswer: (prompt, detail, toolCallsUsed, successfulDataFetches, kind) => this.buildRuntimeFailureFallbackAnswer(
        prompt,
        detail,
        toolCallsUsed,
        successfulDataFetches,
        kind
      ),
      extractToolCallsFromResponse: (response) => this.extractToolCallsFromResponse(response),
      requiresStrictFinancialDataFetch: (prompt, narrative) => this.requiresStrictFinancialDataFetch(prompt, narrative),
      isComparativeMultiPeriodPrompt: (prompt) => this.isComparativeMultiPeriodPrompt(prompt),
      buildRecoveryHint: (failureKind, lastErrorCode, lastErrorMessage, evidence, context, prompt) => this.buildRecoveryHint(
        failureKind,
        lastErrorCode,
        lastErrorMessage,
        evidence,
        context,
        prompt
      ),
      executeFinancialToolCalls: (params) => this.executeFinancialToolCalls(params),
      buildExhaustionFallbackAnswer: (prompt, history, toolCallsUsed, successfulDataFetches) => this.buildExhaustionFallbackAnswer(prompt, history, toolCallsUsed, successfulDataFetches),
      resolveCancellationError: (error, signal) => this.resolveCancellationError(error, signal),
      telemetryCapture: this.telemetry?.capture.bind(this.telemetry)
    };
  }
  cancelMessage(requestId, reason) {
    const trimmedRequestId = requestId.trim();
    const execution = this.activeExecutions.get(trimmedRequestId);
    if (!execution) {
      return false;
    }
    if (!execution.abortController.signal.aborted) {
      execution.abortController.abort(reason?.trim() || "Request canceled by user.");
    }
    return true;
  }
  async executeFinancialToolCalls(params) {
    return executeFinancialToolCalls(this.toolExecutionDeps, params);
  }
  rowsContainNonNullValue(rows) {
    return rowsContainNonNullValue(rows);
  }
  emitProgress(onProgress, event) {
    if (onProgress) {
      onProgress(event);
    }
    if (this.mobileBridge) {
      this.mobileBridge.broadcast({
        type: "agent:progress",
        payload: event
      });
    }
  }
  async safeAuditWrite(entry) {
    try {
      await this.auditLog.write(entry);
      this.telemetry?.capture({
        event: "agent.orchestrator.audit",
        category: "agent.orchestrator",
        level: "info",
        process: "main",
        message: entry.stage,
        details: {
          requestId: entry.requestId,
          conversationId: entry.conversationId,
          stage: entry.stage,
          round: entry.round,
          recoveryAttempts: entry.recoveryAttempts,
          failureKind: entry.failureKind,
          errorCode: entry.errorCode,
          errorCategory: entry.errorCategory
        },
        requestId: entry.requestId,
        conversationId: entry.conversationId
      });
    } catch (error) {
      console.warn("[AgentOrchestrator] Failed to write audit log:", error);
    }
  }
  toErrorInfo(error) {
    if (error instanceof SqlPolicyViolationError) {
      return {
        message: error.message,
        code: error.code,
        category: error.category
      };
    }
    if (error instanceof Error) {
      const errorWithMetadata = error;
      return {
        message: error.message,
        code: typeof errorWithMetadata.code === "string" ? errorWithMetadata.code : void 0,
        category: typeof errorWithMetadata.category === "string" ? errorWithMetadata.category : void 0
      };
    }
    return {
      message: String(error)
    };
  }
  createAgentPolicyError(code, message) {
    const error = new Error(message);
    error.code = code;
    error.category = "orchestration-policy";
    return error;
  }
  throwIfRequestCanceled(signal) {
    throwIfRequestCanceled(signal);
  }
  resolveCancellationError(error, signal) {
    return resolveCancellationError(error, signal);
  }
  isCancellationLikeError(error) {
    return isCancellationLikeError(error);
  }
  getOrCreateConversationMemory(conversationId) {
    return getOrCreateConversationMemory(this.conversationMemoryById, conversationId);
  }
  createConversationMemorySnapshot(memory) {
    return createConversationMemorySnapshot(memory);
  }
  pruneConversationMemory() {
    pruneConversationMemory(this.conversationMemoryById);
  }
  get conversationMemoryDeps() {
    return {
      compactText: (value, maxLength) => this.compactText(value, maxLength)
    };
  }
  get responseContractDeps() {
    return {
      normalizePersianDigits: (value) => this.normalizePersianDigits(value),
      ensureFinancialResponseTemplate: (rawText, memory, count) => this.ensureFinancialResponseTemplate(rawText, memory, count),
      enforcePromptIntentAlignment: (prompt, text) => this.enforcePromptIntentAlignment(prompt, text),
      validateIntentTableMatch: (intentId, evidence) => this.validateIntentTableMatch(intentId, evidence),
      emitEvidenceContractTelemetry: (requestId, conversationId, failureText, attempts) => this.emitEvidenceContractTelemetry(requestId, conversationId, failureText, attempts),
      appearsToContainFinancialClaim: (text) => this.appearsToContainFinancialClaim(text),
      parseFinancialTemplateSections: (text) => this.parseFinancialTemplateSections(text),
      hasRequiredFinancialResponseSections: (sections) => this.hasRequiredFinancialResponseSections(sections),
      hasStructuredEvidence: (evidence) => this.hasStructuredEvidence(evidence),
      requiresStrictFinancialDataFetch: (prompt, narrative) => this.requiresStrictFinancialDataFetch(prompt, narrative),
      requiresStrictQuantitativeDataFetch: (prompt) => this.requiresStrictQuantitativeDataFetch(prompt),
      hasQuantitativeResultSignal: (narrative) => this.hasQuantitativeResultSignal(narrative),
      appearsToBeNoDataResult: (narrative) => this.appearsToBeNoDataResult(narrative),
      extractNumericClaims: (narrative) => this.extractNumericClaims(narrative),
      containsUnsupportedNumericClaim: (narrative, evidence, sections) => this.containsUnsupportedNumericClaim(narrative, evidence, sections),
      containsFinancialMarkedNumericClaim: (narrative) => this.containsFinancialMarkedNumericClaim(narrative),
      traceSupportsNumericClaim: (trace) => this.traceSupportsNumericClaim(trace)
    };
  }
  get sqlExecutionDeps() {
    return {
      normalizePersianDigits: (value) => this.normalizePersianDigits(value),
      findActiveSchemaCatalog: (settings) => this.findActiveSchemaCatalog(settings),
      normalizeTableRef: (tableRef) => this.normalizeTableRef(tableRef),
      createAgentPolicyError: (code, message) => this.createAgentPolicyError(code, message),
      collectRuntimeScopeColumnCandidates: (catalog) => this.collectRuntimeScopeColumnCandidates(catalog),
      sqlParser: this.sqlParser,
      schemaContextConceptOrder: SCHEMA_CONTEXT_CONCEPT_ORDER
    };
  }
  get promptBuilderDeps() {
    return {
      compactText: (value, maxLength) => this.compactText(value, maxLength),
      pushConversationMemoryNote: (memory, note) => this.pushConversationMemoryNote(memory, note),
      findActiveSchemaCatalog: (settings) => this.findActiveSchemaCatalog(settings),
      detectPromptConcepts: (prompt) => this.detectPromptConcepts(prompt),
      resolvePreferredMapping: (catalog, conceptKey, prompt) => this.resolvePreferredMapping(catalog, conceptKey, prompt),
      inferDateHintForTable: (catalog, tableRef) => this.inferDateHintForTable(catalog, tableRef),
      extractConversationFacts: (text) => this.extractConversationFacts(text),
      buildSchemaCatalogContext: (settings) => this.buildSchemaCatalogContext(settings),
      schemaContextConceptLabels: SCHEMA_CONTEXT_CONCEPT_LABELS
    };
  }
  get clarificationDeps() {
    return {
      createConversationMemorySnapshot: (memory) => this.createConversationMemorySnapshot(memory),
      detectPromptConcepts: (prompt) => this.detectPromptConcepts(prompt),
      findActiveSchemaCatalog: (settings) => this.findActiveSchemaCatalog(settings),
      detectDeterministicFinancialIntent: (prompt) => this.detectDeterministicFinancialIntent(prompt),
      resolvePreferredMapping: (catalog, conceptKey, prompt) => this.resolvePreferredMapping(catalog, conceptKey, prompt),
      extractConversationFacts: (text) => this.extractConversationFacts(text),
      normalizePersianDigits: (value) => this.normalizePersianDigits(value),
      schemaContextConceptLabels: SCHEMA_CONTEXT_CONCEPT_LABELS
    };
  }
  get schemaCatalogDeps() {
    return {
      normalizePersianDigits: (value) => this.normalizePersianDigits(value),
      compactText: (value, maxLength) => this.compactText(value, maxLength)
    };
  }
  get fiscalYearFallbackDeps() {
    return {
      findActiveSchemaCatalog: (settings) => this.findActiveSchemaCatalog(settings),
      collectRuntimeScopeColumnCandidates: (catalog) => this.collectRuntimeScopeColumnCandidates(catalog),
      executeMetadataSql: (sql, signal) => this.executeMetadataSql(sql, signal),
      executeReadOnlySql: (sql, signal) => this.executeReadOnlySql(sql, signal),
      throwIfRequestCanceled: (signal) => this.throwIfRequestCanceled(signal),
      parseSqlTableReference: (rawRef) => this.parseSqlTableReference(rawRef),
      quoteSqlIdentifier: (value) => this.quoteSqlIdentifier(value),
      toFiniteInteger: (value) => this.toFiniteInteger(value),
      toOptionalFiniteInteger: (value) => this.toOptionalFiniteInteger(value),
      rememberToolTrace: (memory, trace) => this.rememberToolTrace(memory, trace),
      emitProgress: (progressCallback, event) => this.emitProgress(progressCallback, event)
    };
  }
  get evidenceValidationDeps() {
    return {
      normalizePersianDigits: (value) => this.normalizePersianDigits(value),
      compactText: (value, maxLength) => this.compactText(value, maxLength),
      detectDeterministicFinancialIntent: (prompt) => this.detectDeterministicFinancialIntent(prompt)
    };
  }
  get telemetryDeps() {
    return {
      capture: this.telemetry?.capture.bind(this.telemetry)
    };
  }
  get toolExecutionDeps() {
    return {
      throwIfRequestCanceled: (signal) => this.throwIfRequestCanceled(signal),
      buildPendingToolStatusText: (toolName, args) => this.buildPendingToolStatusText(toolName, args),
      emitProgress: (onProgress, event) => this.emitProgress(onProgress, event),
      safeAuditWrite: (entry) => this.safeAuditWrite(entry),
      buildCatalogScanQuery: (tablePattern, limit) => this.buildCatalogScanQuery(tablePattern, limit),
      executeMetadataSql: (query, signal) => this.executeMetadataSql(query, signal),
      rememberToolTrace: (memory, trace) => this.rememberToolTrace(memory, trace),
      limitRowsForModel: (rows) => this.limitRowsForModel(rows),
      createToolResponseMessage: (toolCall, data) => this.createToolResponseMessage(toolCall, data),
      buildListDatabaseTablesQuery: (tablePattern) => this.buildListDatabaseTablesQuery(tablePattern),
      fetchTableListCached: (tablePattern, sqlQuery, abortSignal) => this.fetchTableListCached(tablePattern, sqlQuery, abortSignal),
      compactText: (value, maxLength) => this.compactText(value, maxLength),
      emitGuardrailTelemetry: (kind, requestId, conversationId, details) => this.emitGuardrailTelemetry(kind, requestId, conversationId, details),
      emitGuardrailCounterTelemetry: (kind, requestId, conversationId, count) => this.emitGuardrailCounterTelemetry(kind, requestId, conversationId, count),
      createAgentPolicyError: (code, message) => this.createAgentPolicyError(code, message),
      prevalidateFinancialQuery: (sqlQuery, settings) => this.prevalidateFinancialQuery(sqlQuery, settings),
      ensureFinancialQueryAllowed: (sqlQuery, settings, conversationMemory) => this.ensureFinancialQueryAllowed(sqlQuery, settings, conversationMemory),
      executeReadOnlySql: (query, signal) => this.executeReadOnlySql(query, signal),
      rowsContainNonNullValue: (rows) => this.rowsContainNonNullValue(rows),
      redactSensitiveIdentifiers: (rows) => this.redactSensitiveIdentifiers(rows),
      createEvidencePreview: (sqlQuery, rows, rowCount, truncated) => this.createEvidencePreview(sqlQuery, rows, rowCount, truncated),
      buildDatabaseSchemaQuery: (tableName, schemaName) => this.buildDatabaseSchemaQuery(tableName, schemaName),
      getCachedSchemaSnapshot: (cacheKey, sqlQuery, abortSignal) => this.getCachedSchemaSnapshot(cacheKey, sqlQuery, abortSignal),
      isCancellationLikeError: (error) => this.isCancellationLikeError(error),
      resolveCancellationError: (error, signal) => this.resolveCancellationError(error, signal),
      toErrorInfo: (error) => this.toErrorInfo(error),
      schemaCacheByTableKey: this.schemaCacheByTableKey,
      SCHEMA_CACHE_TTL_MS: this.SCHEMA_CACHE_TTL_MS
    };
  }
  refreshConversationMemory(memory, settings, history, prompt) {
    memory.touchedAt = Date.now();
    const activeCatalog = this.findActiveSchemaCatalog(settings);
    if (activeCatalog) {
      for (const conceptKey of SCHEMA_CONTEXT_CONCEPT_ORDER) {
        const selectedMapping = activeCatalog.selectedMappings[conceptKey]?.trim() ?? "";
        if (selectedMapping) {
          memory.facts.confirmedMappings[conceptKey] = selectedMapping;
        }
      }
    }
    const textSources = [
      ...history.filter((message) => message.role === "user").map((message) => message.content),
      prompt
    ];
    for (const sourceText of textSources) {
      const extractedFacts = this.extractConversationFacts(sourceText);
      memory.facts.companyNames = this.mergeScopeValues(
        memory.facts.companyNames,
        extractedFacts.companyNames
      );
      memory.facts.fiscalYears = this.mergeScopeValues(
        memory.facts.fiscalYears,
        extractedFacts.fiscalYears
      );
      memory.facts.branchNames = this.mergeScopeValues(
        memory.facts.branchNames,
        extractedFacts.branchNames
      );
      if (extractedFacts.dateRange) {
        memory.facts.dateRange = extractedFacts.dateRange;
      }
    }
    memory.lastUserPrompt = this.compactText(prompt, 240);
    this.pushConversationMemoryNote(memory, `Latest user intent: ${this.compactText(prompt, 220)}`);
  }
  extractConversationFacts(text) {
    return extractConversationFacts(text);
  }
  mergeScopeValues(currentValues, incomingValues) {
    return mergeScopeValues(currentValues, incomingValues);
  }
  normalizePersianDigits(value) {
    return normalizePersianDigits(value);
  }
  updateConversationMemoryFromAssistant(memory, finalText) {
    updateConversationMemoryFromAssistant(this.conversationMemoryDeps, memory, finalText);
  }
  rememberToolTrace(memory, trace) {
    rememberToolTrace(this.conversationMemoryDeps, memory, trace);
  }
  pushConversationMemoryNote(memory, note) {
    pushConversationMemoryNote(memory, note);
  }
  createToolResponseMessage(toolCall, payload) {
    return {
      role: "tool",
      name: toolCall.function.name,
      toolCallId: toolCall.id,
      content: JSON.stringify(payload)
    };
  }
  extractToolCallsFromResponse(response) {
    if (Array.isArray(response.toolCalls) && response.toolCalls.length > 0) {
      return response.toolCalls;
    }
    const raw = response.raw;
    const rawToolCalls = raw.choices?.[0]?.message?.tool_calls;
    if (!Array.isArray(rawToolCalls)) {
      return [];
    }
    return rawToolCalls.filter(
      (toolCall) => {
        return Boolean(toolCall?.id && toolCall.function?.name);
      }
    ).map((toolCall) => ({
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments ?? "{}"
      }
    }));
  }
  compactHistory(history, memory) {
    return compactHistory(this.promptBuilderDeps, history, memory);
  }
  buildRuntimeSystemPrompt(settings, prompt, conversationMemory, previousMemorySnapshot) {
    return buildRuntimeSystemPrompt(
      this.promptBuilderDeps,
      settings,
      prompt,
      conversationMemory,
      previousMemorySnapshot
    );
  }
  isLikelyRefinementPrompt(previousMemory, prompt) {
    return isLikelyRefinementPrompt(previousMemory, prompt);
  }
  buildDeterministicIntentClarificationResponse(intentId) {
    return buildDeterministicIntentClarificationResponse(intentId);
  }
  buildClarificationResponseIfNeeded(settings, prompt, conversationMemory) {
    return buildClarificationResponseIfNeeded(
      this.clarificationDeps,
      settings,
      prompt,
      conversationMemory
    );
  }
  resolvePreferredMapping(activeCatalog, conceptKey, prompt) {
    return resolvePreferredMapping(this.schemaCatalogDeps, activeCatalog, conceptKey, prompt);
  }
  detectPromptConcepts(prompt) {
    return detectPromptConcepts(prompt);
  }
  inferDateHintForTable(activeCatalog, tableRef) {
    return inferDateHintForTable(activeCatalog, tableRef);
  }
  normalizeTableRef(tableRef) {
    return normalizeTableRef(tableRef);
  }
  get schemaCacheDeps() {
    return {
      schemaTableListCache: this.schemaTableListCache,
      schemaCacheByTableKey: this.schemaCacheByTableKey,
      SCHEMA_CACHE_TTL_MS: this.SCHEMA_CACHE_TTL_MS,
      executeMetadataSql: (query, signal) => this.executeMetadataSql(query, signal),
      findActiveSchemaCatalog: (settings) => this.findActiveSchemaCatalog(settings),
      normalizeTableRef: (tableRef) => this.normalizeTableRef(tableRef)
    };
  }
  async fetchTableListCached(tablePattern, sqlQuery, abortSignal) {
    return fetchTableListCached(this.schemaCacheDeps, tablePattern, sqlQuery, abortSignal);
  }
  prevalidateFinancialQuery(sqlQuery, settings) {
    return prevalidateFinancialQuery(this.schemaCacheDeps, sqlQuery, settings);
  }
  async getCachedSchemaSnapshot(cacheKey, sqlQuery, abortSignal) {
    return getCachedSchemaSnapshot(this.schemaCacheDeps, cacheKey, sqlQuery, abortSignal);
  }
  normalizeTableReference(tableRef) {
    return normalizeTableReference(this.normalizeTableRef.bind(this), tableRef);
  }
  resolveColumnNameAlias(columnName, availableColumns) {
    return resolveColumnNameAlias(columnName, availableColumns);
  }
  getLoopBudgetSummary() {
    return {
      maxRounds: MAX_TOOL_CALL_ROUNDS,
      maxCallsPerRound: MAX_TOOL_CALLS_PER_ROUND,
      maxTotalCalls: MAX_TOTAL_TOOL_CALLS
    };
  }
  get geminiRetryDeps() {
    return {
      geminiClient: this.geminiClient,
      emitProgress: (onProgress, event) => this.emitProgress(onProgress, event),
      toErrorInfo: (error) => this.toErrorInfo(error),
      compactText: (value, maxLength) => this.compactText(value, maxLength)
    };
  }
  buildExhaustionFallbackAnswer(prompt, history, toolCallsUsed, successfulDataFetches) {
    return buildExhaustionFallbackAnswer(
      this.geminiRetryDeps,
      prompt,
      history,
      toolCallsUsed,
      successfulDataFetches
    );
  }
  async callGeminiWithProviderRetry(payload, savedConfig, abortSignal, onProgress) {
    return callGeminiWithProviderRetry(
      this.geminiRetryDeps,
      payload,
      savedConfig,
      abortSignal,
      onProgress
    );
  }
  shouldReturnDegradedFallback(error) {
    return shouldReturnDegradedFallback(this.geminiRetryDeps, error);
  }
  buildRuntimeFailureFallbackAnswer(prompt, detail, toolCallsUsed, successfulDataFetches, kind = "provider") {
    return buildRuntimeFailureFallbackAnswer(
      this.geminiRetryDeps,
      prompt,
      detail,
      toolCallsUsed,
      successfulDataFetches,
      kind
    );
  }
  validateIntentTableMatch(intentId, evidence) {
    return validateIntentTableMatch(intentId, evidence);
  }
  buildRecoveryHint(failureKind, lastErrorCode, lastErrorMessage, evidence = [], context, prompt) {
    return buildRecoveryHint(
      failureKind,
      lastErrorCode,
      lastErrorMessage,
      evidence,
      context,
      prompt
    );
  }
  collectRuntimeScopeColumnCandidates(activeCatalog) {
    return collectRuntimeScopeColumnCandidates(this.schemaCatalogDeps, activeCatalog);
  }
  buildSchemaCatalogContext(settings) {
    return buildSchemaCatalogContext(this.schemaCatalogDeps, settings);
  }
  findActiveSchemaCatalog(settings) {
    return findActiveSchemaCatalog(settings);
  }
  compactText(value, maxLength) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength - 1)}…`;
  }
  detectDeterministicFinancialIntent(prompt) {
    const matchedIntent = detectFinancialIntent(prompt);
    if (!matchedIntent) {
      return null;
    }
    const definition = listFinancialIntentDefinitions().find(
      (entry) => entry.id === matchedIntent.intentId
    );
    if (definition?.responseMode === "deterministic") {
      return matchedIntent.intentId;
    }
    return null;
  }
  /**
   * H3: detect a multi-period comparative financial intent — e.g.
   * "فروش 1403 در مقابل 1402" or "مقایسه خرید سال X و Y" — even when no percent
   * is requested. The orchestrator must run at least one `fetch_financial_data`
   * per period; exiting with fewer than 2 successful fetches is a NO_FETCH-grade
   * defect for such prompts.
   */
  isComparativeMultiPeriodPrompt(prompt) {
    return isComparativeMultiPeriodPrompt(prompt);
  }
  isSalesGrowthPercentPrompt(prompt) {
    return isSalesGrowthPercentPrompt(prompt);
  }
  async tryResolveSalesGrowthPercentFallback(prompt, conversationMemory, signal) {
    return tryResolveSalesGrowthPercentFallback(
      this.salesGrowthDeps,
      prompt,
      this.getSettings(),
      conversationMemory,
      signal
    );
  }
  composeSalesGrowthFallbackMarkdown(result) {
    return composeSalesGrowthFallbackMarkdown(this.salesGrowthDeps, result);
  }
  async tryResolveFiscalYearFallback(deterministicIntent, settings, conversationMemory, signal, onProgress) {
    return tryResolveFiscalYearFallback(
      this.fiscalYearFallbackDeps,
      deterministicIntent,
      settings,
      conversationMemory,
      signal,
      onProgress
    );
  }
  tryResolveDeterministicFinancialTool(deterministicIntent, settings, conversationMemory, signal, onProgress, prompt) {
    return resolveDeterministicFinancialTool(
      {
        findActiveSchemaCatalog: (catalogSettings) => this.findActiveSchemaCatalog(catalogSettings),
        resolvePreferredMapping: (catalog, conceptKey, mappingPrompt) => this.resolvePreferredMapping(catalog, conceptKey, mappingPrompt),
        parseSqlTableReference: (rawRef) => this.parseSqlTableReference(rawRef),
        executeReadOnlySql: (sqlQuery, sqlSignal) => this.executeReadOnlySql(sqlQuery, sqlSignal),
        quoteSqlIdentifier: (value) => this.quoteSqlIdentifier(value),
        quoteSqlTableRef: (ref) => this.quoteSqlTableRef(ref),
        toOptionalFiniteInteger: (value) => this.toOptionalFiniteInteger(value),
        rememberToolTrace: (memory, trace) => this.rememberToolTrace(memory, trace),
        emitProgress: (progressCallback, event) => this.emitProgress(progressCallback, event),
        safeAuditWrite: (entry) => this.safeAuditWrite(entry)
      },
      deterministicIntent,
      settings,
      conversationMemory,
      signal,
      onProgress,
      prompt
    );
  }
  composeDeterministicFinancialToolMarkdown(deterministicIntent, result) {
    return composeDeterministicFinancialToolMarkdown(deterministicIntent, result);
  }
  composeFiscalYearDeterministicMarkdown(deterministicIntent, result) {
    return composeFiscalYearDeterministicMarkdown(deterministicIntent, result);
  }
  buildActionProposal(prompt, subject, priorityCount) {
    const normalizedPrompt = this.compactText(prompt.replace(/\s+/g, " ").trim(), 220);
    const safePriorityCount = Math.max(1, Math.trunc(priorityCount || 1));
    return [
      "### Summary",
      `پیشنهاد اقدام برای ${subject}: ${normalizedPrompt}`,
      "",
      "### Findings",
      "- این خروجی فقط یک پیشنهاد مدیریتی و قابل بازبینی است و هیچ تغییر داده‌ای اجرا نمی‌کند.",
      `- برای تصمیم‌گیری، ${safePriorityCount} اولویت اصلی با مقایسه‌ی شواهد، ریسک و scope بررسی می‌شود.`,
      "- این پیشنهاد صرفاً برای سناریوهای کم‌ریسک و قابل audit طراحی شده است؛ اقدام واقعی فقط پس از تایید انسانی مجاز است.",
      "",
      "### Evidence",
      "- پیشنهاد بر پایه متن سوال و شواهد مالی موجود در مسیر read-only ساخته می‌شود.",
      "- هر اقدام بعدی باید با تایید انسانی، dry-run و audit کامل همراه باشد.",
      "- بررسی/چک‌لیست تایید انسانی: scope، ریسک، اثر روی داده، خروجی قابل بازبینی و امکان rollback/compensating action.",
      "",
      "### Assumptions",
      "- فرض می‌شود داده‌ها از مسیر قابل اتکا و بدون write operation استخراج شده‌اند.",
      "- اگر سناریو ریسک‌پذیر باشد، پیشنهاد باید به حالت تعلیق و بازبینی انسانی برگردد.",
      "",
      "### Actions",
      `1. مقایسه‌ی نتایج فعلی با baseline و سناریوهای کم‌ریسک.
2. اولویت‌بندی ${safePriorityCount} مورد کلیدی برای تایید مدیر.
3. اجرای dry-run و ثبت audit قبل از هر اقدام بعدی.
4. بررسی/چک‌لیست تایید انسانی قبل از هر اقدام واقعی.
5. آماده‌سازی rollback/compensating action و ثبت گزارش before/after برای هر مورد پیشنهادی.`
    ].join("\n");
  }
  finalizeFinancialResponse(prompt, rawText, conversationMemory, totalToolCallCount, successfulDataFetchCount, routeMode = "model-assisted", executionTrace, recoveryContext, requestId) {
    return finalizeFinancialResponse(
      this.responseContractDeps,
      prompt,
      rawText,
      conversationMemory,
      totalToolCallCount,
      successfulDataFetchCount,
      routeMode,
      executionTrace,
      recoveryContext,
      requestId
    );
  }
  enforceEvidenceFirstContract(prompt, finalText, totalToolCallCount, successfulDataFetchCount, executionTrace, recoveryContext, requestId, conversationId) {
    return enforceEvidenceFirstContract(
      this.responseContractDeps,
      prompt,
      finalText,
      totalToolCallCount,
      successfulDataFetchCount,
      executionTrace,
      recoveryContext,
      requestId,
      conversationId
    );
  }
  requiresStrictFinancialDataFetch(prompt, narrative) {
    return requiresStrictFinancialDataFetch(this.evidenceValidationDeps, prompt, narrative);
  }
  requiresStrictQuantitativeDataFetch(prompt) {
    return requiresStrictQuantitativeDataFetch(this.evidenceValidationDeps, prompt);
  }
  hasQuantitativeResultSignal(text) {
    return hasQuantitativeResultSignal(this.evidenceValidationDeps, text);
  }
  appearsToBeNoDataResult(text) {
    return appearsToBeNoDataResult(this.evidenceValidationDeps, text);
  }
  appearsToContainFinancialClaim(text) {
    return appearsToContainFinancialClaim(text);
  }
  hasRequiredFinancialResponseSections(sections) {
    return hasRequiredFinancialResponseSections(sections);
  }
  hasStructuredEvidence(evidenceSection) {
    return hasStructuredEvidence(this.evidenceValidationDeps, evidenceSection);
  }
  containsUnsupportedNumericClaim(narrative, evidence, sections) {
    return containsUnsupportedNumericClaim(
      this.evidenceValidationDeps,
      narrative,
      evidence,
      sections
    );
  }
  /**
   * H1: detect whether the narrative contains a *financial* numeric claim —
   * a number paired with a currency marker (تومان/ریال/$/IRR), a percent sign,
   * or a financial keyword (مبلغ/موجودی/مانده/جمع/...). Bare scope numbers like
   * fiscal years (e.g. "FiscalYearRef = 1403") must not count, so an honest
   * VALID_EMPTY response that merely echoes the queried scope is not rejected.
   */
  containsFinancialMarkedNumericClaim(narrative) {
    return containsFinancialMarkedNumericClaim(this.evidenceValidationDeps, narrative);
  }
  extractNumericClaims(text) {
    return extractNumericClaims(this.evidenceValidationDeps, text);
  }
  traceSupportsNumericClaim(trace) {
    return traceSupportsNumericClaim(trace);
  }
  emitEvidenceContractTelemetry(requestId, conversationId, finalText, recoveryAttempts) {
    emitEvidenceContractTelemetry(
      this.telemetryDeps,
      requestId,
      conversationId,
      finalText,
      recoveryAttempts
    );
  }
  emitGuardrailTelemetry(kind, requestId, conversationId, details) {
    emitGuardrailTelemetry(this.telemetryDeps, kind, requestId, conversationId, details);
  }
  emitGuardrailCounterTelemetry(kind, requestId, conversationId, count) {
    emitGuardrailCounterTelemetry(this.telemetryDeps, kind, requestId, conversationId, count);
  }
  enforcePromptIntentAlignment(prompt, finalText) {
    return enforcePromptIntentAlignment(this.evidenceValidationDeps, prompt, finalText);
  }
  quoteSqlIdentifier(value) {
    return quoteSqlIdentifier(value);
  }
  quoteSqlTableRef(ref) {
    return quoteSqlTableRef(ref);
  }
  toFiniteInteger(value) {
    return toFiniteInteger(value);
  }
  toSafeNumber(value) {
    return toSafeNumber(value);
  }
  toOptionalFiniteInteger(value) {
    return toOptionalFiniteInteger(value);
  }
  ensureFinancialResponseTemplate(rawText, conversationMemory, totalToolCallCount) {
    return ensureFinancialResponseTemplate(
      this.evidenceValidationDeps,
      rawText,
      conversationMemory,
      totalToolCallCount
    );
  }
  parseFinancialTemplateSections(text) {
    return parseFinancialTemplateSections(text);
  }
  createEvidencePreview(sqlQuery, rows, rowCount, truncated) {
    return createEvidencePreview(
      { compactText: (value, maxLength) => this.compactText(value, maxLength) },
      sqlQuery,
      rows,
      rowCount,
      truncated
    );
  }
  buildPendingToolStatusText(toolName, args) {
    return buildPendingToolStatusText(toolName, args);
  }
  ensureFinancialQueryAllowed(sqlQuery, settings, conversationMemory) {
    ensureFinancialQueryAllowed(this.sqlExecutionDeps, sqlQuery, settings, conversationMemory);
  }
  parseSqlTableReference(rawRef) {
    return parseSqlTableReference(rawRef);
  }
  limitRowsForModel(rows) {
    return limitRowsForModel(rows, MAX_TOOL_PAYLOAD_CHARS, MAX_TOOL_VALUE_CHARS);
  }
  redactSensitiveIdentifiers(rows) {
    return redactSensitiveIdentifiers(rows);
  }
  buildCatalogScanQuery(tablePattern, limit) {
    return buildCatalogScanQuery(tablePattern, limit);
  }
  buildListDatabaseTablesQuery(tablePattern) {
    return buildListDatabaseTablesQuery(tablePattern, MAX_TABLE_LIST_ROWS);
  }
  buildDatabaseSchemaQuery(tableName, schemaName) {
    return buildDatabaseSchemaQueryWrapper(tableName, schemaName, MAX_SCHEMA_ROWS);
  }
}
const STOP_TIMEOUT_MS$1 = 1500;
function resolveUtf8Prompt(payload) {
  const base64 = payload.promptBase64?.trim();
  if (base64) {
    try {
      const decoded = Buffer.from(base64, "base64").toString("utf8").trim();
      if (decoded) {
        return decoded;
      }
    } catch {
    }
  }
  return payload.prompt?.trim() ?? "";
}
class AgentDebugServer {
  server = null;
  async start(options) {
    await this.stop();
    this.server = node_http.createServer(async (req, res) => {
      try {
        if (!this.authorize(req, options.token)) {
          this.json(res, 401, { error: "unauthorized" });
          return;
        }
        if (req.method === "GET" && req.url === "/health") {
          this.json(res, 200, { ok: true });
          return;
        }
        if (req.method === "POST" && req.url === "/ask") {
          const payload = await this.readJsonBody(req);
          const prompt = resolveUtf8Prompt(payload);
          if (!prompt) {
            this.json(res, 400, { error: "prompt is required" });
            return;
          }
          const requestId = payload.requestId?.trim() || `ssh-${Date.now()}`;
          const conversationId = payload.conversationId?.trim() || "ssh-debug";
          const mode = payload.mode === "dry-run" ? "dry-run" : "manual";
          const progress = [];
          const result = await options.sendMessage(
            {
              requestId,
              conversationId,
              prompt,
              mode,
              history: []
            },
            (event) => {
              progress.push(event);
            }
          );
          this.json(res, 200, {
            ok: true,
            requestId,
            conversationId,
            result,
            progress
          });
          return;
        }
        this.json(res, 404, { error: "not-found" });
      } catch (error) {
        this.json(res, 500, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    await new Promise((resolve, reject) => {
      const onListening = () => {
        cleanup();
        resolve();
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        this.server?.off("listening", onListening);
        this.server?.off("error", onError);
      };
      this.server?.on("listening", onListening);
      this.server?.on("error", onError);
      this.server?.listen(options.port, options.host);
    });
  }
  async stop() {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };
      server.close(() => done());
      setTimeout(done, STOP_TIMEOUT_MS$1);
    });
  }
  authorize(req, token) {
    const provided = req.headers["x-debug-token"];
    return typeof provided === "string" && provided.trim() === token;
  }
  async readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) {
      return {};
    }
    return JSON.parse(raw);
  }
  json(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body)
    });
    res.end(body);
  }
}
class AuditLogService {
  filePath;
  constructor(filePath) {
    this.filePath = filePath ?? node_path.join(electron.app.getPath("userData"), "logs", "agent-audit.log");
  }
  async write(entry) {
    const redactedEntry = {
      ...entry,
      prompt: this.redactSensitiveText(entry.prompt),
      sqlQuery: this.redactSensitiveText(entry.sqlQuery),
      error: this.redactSensitiveText(entry.error)
    };
    await promises.mkdir(node_path.dirname(this.filePath), { recursive: true });
    await promises.appendFile(this.filePath, `${JSON.stringify(redactedEntry)}
`, "utf8");
  }
  async query(request) {
    const safeLimit = Math.min(Math.max(Math.trunc(request?.limit ?? 120), 1), 500);
    const requestIdFilter = request?.requestId?.trim() || null;
    const conversationFilter = request?.conversationId?.trim() || null;
    const stageFilter = request?.stage && request.stage !== "all" ? request.stage : null;
    const fromTime = this.parseTimestampOrNull(request?.fromTimestamp);
    const toTime = this.parseTimestampOrNull(request?.toTimestamp);
    let content = "";
    try {
      content = await promises.readFile(this.filePath, "utf8");
    } catch {
      return {
        entries: [],
        total: 0
      };
    }
    const parsedEntries = [];
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      try {
        const entry = JSON.parse(line);
        if (!entry.timestamp || !entry.requestId || !entry.stage) {
          continue;
        }
        if (requestIdFilter && entry.requestId !== requestIdFilter) {
          continue;
        }
        if (conversationFilter && entry.conversationId !== conversationFilter) {
          continue;
        }
        if (stageFilter && entry.stage !== stageFilter) {
          continue;
        }
        const entryTime = this.parseTimestampOrNull(entry.timestamp);
        if (fromTime !== null && (entryTime === null || entryTime < fromTime)) {
          continue;
        }
        if (toTime !== null && (entryTime === null || entryTime > toTime)) {
          continue;
        }
        const redactedPrompt = this.redactSensitiveText(entry.prompt);
        const redactedSql = this.redactSensitiveText(entry.sqlQuery);
        parsedEntries.push({
          timestamp: entry.timestamp,
          requestId: entry.requestId,
          conversationId: entry.conversationId,
          stage: entry.stage,
          toolName: entry.toolName,
          rowCount: entry.rowCount,
          round: entry.round,
          durationMs: entry.durationMs,
          errorCode: entry.errorCode,
          errorCategory: entry.errorCategory,
          promptPreview: this.compactText(redactedPrompt, 180),
          sqlQueryPreview: this.compactText(redactedSql, 220)
        });
      } catch {
        continue;
      }
    }
    parsedEntries.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    return {
      entries: parsedEntries.slice(0, safeLimit),
      total: parsedEntries.length
    };
  }
  parseTimestampOrNull(value) {
    if (!value || !value.trim()) {
      return null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  redactSensitiveText(value) {
    if (!value) {
      return value;
    }
    const patterns = [
      { regex: /\b\d{10}\b/g, label: "NATIONAL_CODE" },
      { regex: /\b09\d{9}\b/g, label: "PHONE" },
      { regex: /\b\d{16}\b/g, label: "ACCOUNT_NUMBER" },
      { regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g, label: "IBAN" }
    ];
    let redacted = value;
    for (const { regex, label } of patterns) {
      redacted = redacted.replace(regex, () => `[REDACTED:${label}]`);
    }
    return redacted;
  }
  compactText(value, maxLength) {
    if (!value) {
      return void 0;
    }
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return void 0;
    }
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength - 1)}…`;
  }
}
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_OPENAI_BASE_URL = "https://api.avalai.ir/v1";
const RESILIENCE_CONNECT_TIMEOUT_MS = 45e3;
const RESILIENCE_TIME_TO_FIRST_TOKEN_MS = 15e3;
const RESILIENCE_INTER_CHUNK_STALL_MS = 15e3;
const RESILIENCE_OVERALL_DEADLINE_MS = 9e4;
const RESILIENCE_RETRY_ATTEMPTS = 2;
const RESILIENCE_RETRY_BASE_DELAY_MS = 500;
const RESILIENCE_RETRY_MAX_DELAY_MS = 12e3;
const RESILIENCE_RETRY_JITTER_RATIO = 0.35;
const RESILIENCE_FAILURE_THRESHOLD = 3;
const RESILIENCE_OPEN_COOLDOWN_MS = 6e4;
const RESILIENCE_MAX_RATE_LIMIT_COOLDOWN_MS = 6e4;
class CircuitBreaker {
  constructor(failureThreshold, openCooldownMs) {
    this.failureThreshold = failureThreshold;
    this.openCooldownMs = openCooldownMs;
  }
  failureThreshold;
  openCooldownMs;
  state = "CLOSED";
  failureCount = 0;
  openedAt = 0;
  probeInFlight = false;
  snapshot() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      msUntilHalfOpen: this.state === "OPEN" ? Math.max(0, this.openedAt + this.openCooldownMs - Date.now()) : 0
    };
  }
  beforeRequest() {
    if (this.state === "OPEN") {
      if (Date.now() - this.openedAt >= this.openCooldownMs) {
        this.state = "HALF_OPEN";
        this.probeInFlight = true;
        return { allowed: true };
      }
      return { allowed: false, reason: "provider-circuit-open" };
    }
    if (this.state === "HALF_OPEN") {
      if (!this.probeInFlight) {
        this.probeInFlight = true;
        return { allowed: true };
      }
      return { allowed: false, reason: "provider-circuit-open" };
    }
    return { allowed: true };
  }
  recordSuccess() {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.probeInFlight = false;
  }
  recordFailure() {
    if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.openedAt = Date.now();
      this.probeInFlight = false;
      this.failureCount = this.failureThreshold;
      return;
    }
    this.failureCount += 1;
    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = Date.now();
      this.probeInFlight = false;
    }
  }
}
class GeminiHttpError extends Error {
  statusCode;
  retryAfterMs;
  constructor(message, statusCode, retryAfterMs) {
    super(message);
    this.name = "GeminiHttpError";
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}
class GeminiClient {
  retryAttempts;
  retryBaseDelayMs;
  retryMaxDelayMs;
  retryJitterRatio;
  connectTimeoutMs;
  timeToFirstTokenMs;
  interChunkStallMs;
  overallDeadlineMs;
  circuitBreaker;
  rateLimitCooldownUntil = 0;
  consecutiveRateLimitFailures = 0;
  constructor(options) {
    this.retryAttempts = Math.max(0, options?.retryAttempts ?? RESILIENCE_RETRY_ATTEMPTS);
    this.retryBaseDelayMs = Math.max(0, options?.retryBaseDelayMs ?? RESILIENCE_RETRY_BASE_DELAY_MS);
    this.retryMaxDelayMs = Math.max(this.retryBaseDelayMs, options?.retryMaxDelayMs ?? RESILIENCE_RETRY_MAX_DELAY_MS);
    this.retryJitterRatio = Math.max(0, options?.retryJitterRatio ?? RESILIENCE_RETRY_JITTER_RATIO);
    this.connectTimeoutMs = Math.max(100, options?.connectTimeoutMs ?? RESILIENCE_CONNECT_TIMEOUT_MS);
    this.timeToFirstTokenMs = Math.max(100, options?.timeToFirstTokenMs ?? RESILIENCE_TIME_TO_FIRST_TOKEN_MS);
    this.interChunkStallMs = Math.max(100, options?.interChunkStallMs ?? RESILIENCE_INTER_CHUNK_STALL_MS);
    this.overallDeadlineMs = Math.max(this.connectTimeoutMs, options?.overallDeadlineMs ?? RESILIENCE_OVERALL_DEADLINE_MS);
    this.circuitBreaker = new CircuitBreaker(options?.failureThreshold ?? RESILIENCE_FAILURE_THRESHOLD, options?.openCooldownMs ?? RESILIENCE_OPEN_COOLDOWN_MS);
  }
  async chat(payload, savedConfig, streamOptions) {
    try {
      const config = this.normalizeConfig(savedConfig, payload.config);
      if (!config.apiKey || config.apiKey.startsWith("accassist:enc:v1:")) {
        throw new Error("کلید API هوش مصنوعی تنظیم نشده یا قابل خواندن نیست. لطفاً در تب تنظیمات کلید را دوباره وارد و ذخیره کنید.");
      }
      if (payload.messages.length === 0) {
        throw new Error("پیامی برای ارسال به هوش مصنوعی وجود ندارد.");
      }
      return await this.chatOpenAi(payload, config, streamOptions);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.startsWith("خطای ارتباط با هوش مصنوعی")) {
          throw error;
        }
        if (error.message.includes("Gemini API request")) {
          throw new Error(`خطای ارتباط با هوش مصنوعی: ${this.translateAiError(error.message)}`);
        }
        throw error;
      }
      throw error;
    }
  }
  getCircuitBreakerSnapshot() {
    return this.circuitBreaker.snapshot();
  }
  async chatOpenAi(payload, config, streamOptions) {
    if (streamOptions?.onTextChunk) {
      return this.withRetry(
        () => this.chatOpenAiStream(payload, config, streamOptions),
        "stream"
      );
    }
    const url = this.buildOpenAiUrl(config.baseUrl);
    this.assertCircuitClosed();
    const raw = await this.withRetry(
      () => this.requestJson(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`
          },
          body: JSON.stringify({
            model: config.model || DEFAULT_MODEL,
            messages: this.toOpenAiMessages(payload.messages),
            temperature: payload.temperature ?? 0.2,
            max_tokens: payload.maxOutputTokens,
            tools: payload.tools && payload.tools.length > 0 ? payload.tools : void 0,
            tool_choice: payload.tools && payload.tools.length > 0 ? "auto" : void 0,
            stream: false
          })
        },
        this.connectTimeoutMs,
        streamOptions?.signal
      ),
      "request"
    );
    const text = this.extractOpenAiText(raw);
    const toolCalls = this.extractOpenAiToolCalls(raw);
    return { text, raw, toolCalls };
  }
  async chatOpenAiStream(payload, config, streamOptions) {
    const onTextChunk = streamOptions.onTextChunk;
    if (!onTextChunk) {
      throw new Error("OpenAI stream mode requires onTextChunk callback.");
    }
    const url = this.buildOpenAiUrl(config.baseUrl);
    this.assertCircuitClosed();
    const abortRuntime = this.createAbortRuntimeContext(this.connectTimeoutMs, this.overallDeadlineMs, streamOptions.signal);
    try {
      const response = await this.withRetry(
        () => fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`
          },
          body: JSON.stringify({
            model: config.model || DEFAULT_MODEL,
            messages: this.toOpenAiMessages(payload.messages),
            temperature: payload.temperature ?? 0.2,
            max_tokens: payload.maxOutputTokens,
            tools: payload.tools && payload.tools.length > 0 ? payload.tools : void 0,
            tool_choice: payload.tools && payload.tools.length > 0 ? "auto" : void 0,
            stream: true
          }),
          signal: abortRuntime.signal
        }),
        "stream"
      );
      if (!response.ok) {
        const text = await response.text();
        const normalized = this.normalizeUpstreamError(response.status, response.headers, text);
        const retryAfterMs = this.parseRetryAfterMs(response.headers.get("retry-after"));
        throw new GeminiHttpError(
          `Gemini API request failed (${response.status}${normalized.requestId ? `, requestId=${normalized.requestId}` : ""}): ${normalized.message}`,
          response.status,
          retryAfterMs
        );
      }
      if (!response.body) {
        throw new Error("Gemini API streaming response has no body.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: false });
      abortRuntime.onResponseHeaders();
      const rawChunks = [];
      const textChunks = [];
      const toolCallsByIndex = /* @__PURE__ */ new Map();
      let buffer = "";
      let streamDone = false;
      while (!streamDone) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        const chunkText = this.normalizeStreamText(decoder.decode(value, { stream: true }));
        if (chunkText) {
          abortRuntime.markChunkReceived();
        }
        buffer += chunkText;
        let delimiterIndex = buffer.indexOf("\n\n");
        while (delimiterIndex !== -1) {
          const eventBlock = buffer.slice(0, delimiterIndex);
          buffer = buffer.slice(delimiterIndex + 2);
          const dataPayload = this.extractSseDataPayload(eventBlock);
          if (dataPayload) {
            const shouldContinue = this.consumeOpenAiStreamPayload(
              dataPayload,
              rawChunks,
              textChunks,
              toolCallsByIndex,
              onTextChunk
            );
            if (!shouldContinue) {
              streamDone = true;
              break;
            }
          }
          delimiterIndex = buffer.indexOf("\n\n");
        }
      }
      buffer += this.normalizeStreamText(decoder.decode());
      const trailingPayload = this.extractSseDataPayload(buffer.trim());
      if (trailingPayload) {
        this.consumeOpenAiStreamPayload(
          trailingPayload,
          rawChunks,
          textChunks,
          toolCallsByIndex,
          onTextChunk
        );
      }
      const combinedText = textChunks.join("");
      const normalizedText = combinedText.trim();
      const toolCalls = this.buildOpenAiStreamToolCalls(toolCallsByIndex);
      return {
        text: normalizedText,
        raw: {
          stream: true,
          chunks: rawChunks,
          choices: [
            {
              message: {
                content: combinedText,
                tool_calls: toolCalls?.map((toolCall) => ({
                  id: toolCall.id,
                  type: toolCall.type,
                  function: {
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments
                  }
                }))
              }
            }
          ]
        },
        toolCalls
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (abortRuntime.didExternalAbort()) {
          throw new Error("درخواست هوش مصنوعی توسط کاربر لغو شد.");
        }
        throw new Error(`زمان انتظار برای هوش مصنوعی به پایان رسید (${this.overallDeadlineMs} میلی‌ثانیه). وضعیت شبکه یا فیلترشکن خود را بررسی کنید.`);
      }
      if (error instanceof Error) {
        const persianError = this.translateAiError(error.message);
        throw new Error(`خطای ارتباط با هوش مصنوعی: ${persianError}`);
      }
      throw error;
    } finally {
      abortRuntime.dispose();
    }
  }
  translateAiError(message) {
    const lower = message.toLowerCase();
    if (lower.includes("401") || lower.includes("unauthorized")) {
      return "کلید API معتبر نیست.";
    }
    if (lower.includes("429") || lower.includes("too many requests")) {
      return "تعداد درخواست‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید.";
    }
    if (lower.includes("404") || lower.includes("not found")) {
      return "سرویس هوش مصنوعی یا مدل انتخاب شده پیدا نشد.";
    }
    if (lower.includes("500") || lower.includes("internal server error")) {
      return "خطای سرور سرویس‌دهنده هوش مصنوعی.";
    }
    if (lower.includes("503") || lower.includes("service unavailable")) {
      return "سرویس هوش مصنوعی موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.";
    }
    if (lower.includes("econnrefused") || lower.includes("enotfound")) {
      return "خطای دسترسی به شبکه. لطفاً اتصال اینترنت یا آدرس Base URL را بررسی کنید.";
    }
    return message;
  }
  async withRetry(operation, operationKind) {
    let lastError;
    let lastDecision = null;
    await this.waitForRateLimitCooldown();
    for (let attempt = 0; attempt <= this.retryAttempts; attempt += 1) {
      try {
        const result = await operation();
        this.circuitBreaker.recordSuccess();
        this.consecutiveRateLimitFailures = 0;
        return result;
      } catch (error) {
        lastError = error;
        lastDecision = this.classifyRetryDecision(error);
        if (this.shouldRecordCircuitFailure(error)) {
          this.circuitBreaker.recordFailure();
        }
        if (lastDecision === "CIRCUIT_OPEN" || lastDecision === "USER_ABORT" || lastDecision === "TERMINAL_CLIENT" || lastDecision === "TERMINAL_UPSTREAM") {
          break;
        }
        if (attempt >= this.retryAttempts) {
          break;
        }
        const retryDelayMs = this.computeRetryDelayMs(error, attempt);
        await this.sleep(retryDelayMs);
      }
    }
    if (this.isRateLimitedError(lastError)) {
      this.consecutiveRateLimitFailures += 1;
      if (this.consecutiveRateLimitFailures >= 2) {
        const cooldownMs = Math.min(
          RESILIENCE_MAX_RATE_LIMIT_COOLDOWN_MS,
          Math.max(this.computeRetryDelayMs(lastError, this.retryAttempts), this.retryBaseDelayMs * 4)
        );
        this.rateLimitCooldownUntil = Date.now() + cooldownMs;
      }
    }
    if (lastError instanceof Error) {
      throw new Error(this.decorateRetryFailureMessage(lastError.message, operationKind, lastDecision ?? void 0));
    }
    throw lastError;
  }
  classifyRetryDecision(error) {
    if (error instanceof GeminiHttpError && typeof error.statusCode === "number") {
      if (error.statusCode === 429) return "RETRYABLE_TRANSIENT";
      if (error.statusCode >= 400 && error.statusCode < 500) return "TERMINAL_CLIENT";
      if (error.statusCode >= 500 && error.statusCode < 600) return "TERMINAL_UPSTREAM";
    }
    if (!(error instanceof Error)) {
      return "TERMINAL_CLIENT";
    }
    const lower = error.message.toLowerCase();
    if (lower.includes("provider-circuit-open") || lower.includes("circuit open")) {
      return "CIRCUIT_OPEN";
    }
    if (lower.includes("cancel") || lower.includes("user abort")) {
      return "USER_ABORT";
    }
    if (lower.includes("429") || lower.includes("too many requests") || lower.includes("rate limit")) {
      return "RETRYABLE_TRANSIENT";
    }
    if (lower.includes("econnreset") || lower.includes("etimedout") || lower.includes("timeout") || lower.includes("network") || lower.includes("fetch failed") || lower.includes("ehostunreach") || lower.includes("econnrefused")) {
      return "RETRYABLE_TRANSIENT";
    }
    if (lower.includes("500") || lower.includes("502") || lower.includes("503") || lower.includes("504")) {
      return "TERMINAL_UPSTREAM";
    }
    return "TERMINAL_CLIENT";
  }
  shouldRecordCircuitFailure(error) {
    if (error instanceof GeminiHttpError && typeof error.statusCode === "number") {
      if (error.statusCode === 429) {
        return false;
      }
      return error.statusCode >= 500;
    }
    if (!(error instanceof Error)) return false;
    const lower = error.message.toLowerCase();
    return lower.includes("502") || lower.includes("503") || lower.includes("504") || lower.includes("econnreset") || lower.includes("ehostunreach") || lower.includes("fetch failed") || lower.includes("timeout") || lower.includes("ttft") || lower.includes("stall") || lower.includes("deadline");
  }
  computeRetryDelayMs(error, attempt) {
    if (error instanceof GeminiHttpError && typeof error.retryAfterMs === "number" && error.retryAfterMs > 0) {
      return Math.min(this.retryMaxDelayMs, error.retryAfterMs);
    }
    const base = this.retryBaseDelayMs * Math.pow(2, attempt);
    const jitterFactor = 1 + (Math.random() * 2 - 1) * this.retryJitterRatio;
    return Math.min(this.retryMaxDelayMs, Math.max(0, Math.floor(base * jitterFactor)));
  }
  isRateLimitedError(error) {
    if (error instanceof GeminiHttpError && error.statusCode === 429) {
      return true;
    }
    if (!(error instanceof Error)) {
      return false;
    }
    const lower = error.message.toLowerCase();
    return lower.includes("(429") || lower.includes("too many requests") || lower.includes("rate limit");
  }
  async waitForRateLimitCooldown() {
    const cooldownRemainingMs = this.rateLimitCooldownUntil - Date.now();
    if (cooldownRemainingMs > 0) {
      await this.sleep(cooldownRemainingMs);
    }
  }
  decorateRetryFailureMessage(message, operationKind, failureClass) {
    const suffix = this.retryAttempts > 0 ? ` پس از ${this.retryAttempts + 1} تلاش ناموفق` : "";
    const classSuffix = failureClass ? ` [${failureClass}]` : "";
    if (operationKind === "stream") {
      return `خطای ارتباط با هوش مصنوعی (stream): ${message}${classSuffix}${suffix}`;
    }
    return `خطای ارتباط با هوش مصنوعی: ${message}${classSuffix}${suffix}`;
  }
  async sleep(ms) {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
  normalizeStreamText(text) {
    return text.replace(/\uFEFF/g, "").replace(/\r\n/g, "\n").replace(/\u0000/g, "").replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
  }
  extractOpenAiText(raw) {
    const typed = raw;
    const content = typed.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return content.trim();
    }
    if (Array.isArray(content)) {
      return content.map((part) => typeof part.text === "string" ? part.text : "").join("\n").trim();
    }
    return "";
  }
  extractOpenAiToolCalls(raw) {
    const typed = raw;
    const toolCalls = typed.choices?.[0]?.message?.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return void 0;
    }
    const normalized = [];
    for (const toolCall of toolCalls) {
      if (!toolCall?.id || !toolCall.function?.name) {
        continue;
      }
      normalized.push({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments ?? "{}"
        }
      });
    }
    return normalized.length > 0 ? normalized : void 0;
  }
  extractSseDataPayload(eventBlock) {
    if (!eventBlock) {
      return null;
    }
    const dataLines = [];
    for (const rawLine of eventBlock.split(/\r?\n/)) {
      if (!rawLine.startsWith("data:")) {
        continue;
      }
      dataLines.push(rawLine.slice(5).trimStart());
    }
    if (dataLines.length === 0) {
      return null;
    }
    return dataLines.join("\n");
  }
  consumeOpenAiStreamPayload(dataPayload, rawChunks, textChunks, toolCallsByIndex, onTextChunk) {
    if (!dataPayload || dataPayload === "[DONE]") {
      return dataPayload !== "[DONE]";
    }
    const parsedChunk = this.tryJsonParse(dataPayload);
    rawChunks.push(parsedChunk);
    const typedChunk = parsedChunk;
    const delta = typedChunk.choices?.[0]?.delta;
    if (!delta) {
      return true;
    }
    const chunkText = this.extractOpenAiStreamTextDelta(delta.content);
    if (chunkText) {
      textChunks.push(chunkText);
      onTextChunk(chunkText);
    }
    if (delta.tool_calls) {
      this.mergeOpenAiStreamToolCalls(delta.tool_calls, toolCallsByIndex);
    }
    return true;
  }
  extractOpenAiStreamTextDelta(content) {
    if (typeof content === "string") {
      return content;
    }
    if (!Array.isArray(content)) {
      return "";
    }
    return content.map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (!part || typeof part !== "object") {
        return "";
      }
      const typedPart = part;
      return typeof typedPart.text === "string" ? typedPart.text : "";
    }).join("");
  }
  mergeOpenAiStreamToolCalls(streamToolCalls, toolCallsByIndex) {
    if (!Array.isArray(streamToolCalls)) {
      return;
    }
    for (const part of streamToolCalls) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const typedPart = part;
      const index = typeof typedPart.index === "number" && Number.isInteger(typedPart.index) ? typedPart.index : 0;
      const existing = toolCallsByIndex.get(index) ?? {
        id: `tool_call_${index + 1}`,
        type: "function",
        function: {
          name: "",
          arguments: ""
        }
      };
      if (typeof typedPart.id === "string" && typedPart.id.trim()) {
        existing.id = typedPart.id;
      }
      const functionPart = typedPart.function;
      if (functionPart && typeof functionPart === "object") {
        if (typeof functionPart.name === "string" && functionPart.name.trim()) {
          const nextName = functionPart.name.trim();
          if (!existing.function.name || nextName.length >= existing.function.name.length) {
            existing.function.name = nextName;
          }
        }
        if (typeof functionPart.arguments === "string" && functionPart.arguments.length > 0) {
          existing.function.arguments += functionPart.arguments;
        }
      }
      toolCallsByIndex.set(index, existing);
    }
  }
  buildOpenAiStreamToolCalls(toolCallsByIndex) {
    if (toolCallsByIndex.size === 0) {
      return void 0;
    }
    const normalizedToolCalls = [...toolCallsByIndex.entries()].sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex).map(([index, toolCall]) => {
      const toolName = toolCall.function.name.trim();
      if (!toolName) {
        return null;
      }
      const toolArguments = toolCall.function.arguments.trim() || "{}";
      return {
        id: toolCall.id || `tool_call_${index + 1}`,
        type: "function",
        function: {
          name: toolName,
          arguments: toolArguments
        }
      };
    }).filter((toolCall) => Boolean(toolCall));
    return normalizedToolCalls.length > 0 ? normalizedToolCalls : void 0;
  }
  toOpenAiMessages(messages) {
    return messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
          name: message.name
        };
      }
      if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: message.content,
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments
            }
          }))
        };
      }
      return {
        role: message.role,
        content: message.content,
        name: message.name
      };
    });
  }
  normalizeConfig(saved, patch) {
    const merged = {
      ...saved,
      ...patch
    };
    const baseUrlCandidate = merged.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL;
    const isGoogleDomain = /googleapis\.com/i.test(baseUrlCandidate);
    const normalizedBaseUrl = isGoogleDomain ? DEFAULT_OPENAI_BASE_URL : baseUrlCandidate;
    return {
      ...merged,
      mode: "openai",
      apiKey: merged.apiKey.trim(),
      model: merged.model?.trim() || DEFAULT_MODEL,
      baseUrl: normalizedBaseUrl
    };
  }
  assertCircuitClosed() {
    const gate = this.circuitBreaker.beforeRequest();
    if (!gate.allowed) {
      throw new Error("سرویس هوش مصنوعی موقتاً در دسترس نیست؛ چند لحظه دیگر تلاش کنید.");
    }
  }
  normalizeUpstreamError(status, headers, rawBody) {
    const requestId = headers.get("x-request-id") || headers.get("request-id") || void 0;
    const contentType = headers.get("content-type") || void 0;
    const trimmed = rawBody.trim();
    try {
      if (contentType?.includes("application/json") || (trimmed.startsWith("{") || trimmed.startsWith("["))) {
        const parsed = this.tryJsonParse(rawBody);
        if (parsed && typeof parsed === "object") {
          const data = parsed;
          const extracted = typeof data.error?.message === "string" ? data.error.message : typeof data.message === "string" ? data.message : typeof data.detail === "string" ? data.detail : "";
          if (extracted) {
            return { message: extracted.slice(0, 200), requestId, contentType };
          }
        }
      }
      if (trimmed.startsWith("<") || contentType?.includes("text/html")) {
        return { message: `upstream-html-error status=${status}${requestId ? ` requestId=${requestId}` : ""}`, requestId, contentType };
      }
      const fallback = this.sanitizeErrorText(rawBody);
      return { message: fallback || `upstream-error status=${status}`, requestId, contentType };
    } catch {
      return { message: `upstream-error status=${status}${requestId ? ` requestId=${requestId}` : ""}`, requestId, contentType };
    }
  }
  sanitizeErrorText(text) {
    return text.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  }
  async requestJson(url, init, timeoutMs, externalSignal) {
    const abortRuntime = this.createAbortRuntimeContext(timeoutMs, this.overallDeadlineMs, externalSignal);
    try {
      const response = await fetch(url, {
        ...init,
        signal: abortRuntime.signal
      });
      const text = await response.text();
      const payload = this.tryJsonParse(text);
      if (!response.ok) {
        const normalized = this.normalizeUpstreamError(response.status, response.headers, text);
        const retryAfterMs = this.parseRetryAfterMs(response.headers.get("retry-after"));
        throw new GeminiHttpError(
          `Gemini API request failed (${response.status}${normalized.requestId ? `, requestId=${normalized.requestId}` : ""}): ${normalized.message}`,
          response.status,
          retryAfterMs
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (abortRuntime.didExternalAbort()) {
          throw new Error("Gemini API request canceled by user.");
        }
        throw new Error(`Gemini API request timeout after ${timeoutMs}ms`);
      }
      if (error instanceof Error) {
        throw new Error(`Gemini API proxy error: ${error.message}`);
      }
      throw error;
    } finally {
      abortRuntime.dispose();
    }
  }
  createAbortRuntimeContext(connectTimeoutMs, overallDeadlineMs, externalSignal) {
    const controller = new AbortController();
    let didExternalAbort = false;
    let connectTimer;
    let ttftTimer;
    let interChunkTimer;
    let firstChunkSeen = false;
    const abortWithReason = (reason) => {
      controller.abort(reason);
    };
    const onExternalAbort = () => {
      didExternalAbort = true;
      abortWithReason("user-abort");
    };
    if (externalSignal) {
      if (externalSignal.aborted) {
        onExternalAbort();
      } else {
        externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }
    connectTimer = setTimeout(() => abortWithReason("connect-timeout"), connectTimeoutMs);
    const overallTimer = setTimeout(() => abortWithReason("deadline-timeout"), overallDeadlineMs);
    return {
      signal: controller.signal,
      didExternalAbort: () => didExternalAbort,
      onResponseHeaders: () => {
        if (ttftTimer) return;
        ttftTimer = setTimeout(() => abortWithReason("ttft-timeout"), this.timeToFirstTokenMs);
      },
      markChunkReceived: () => {
        if (!firstChunkSeen) {
          firstChunkSeen = true;
          if (ttftTimer) {
            clearTimeout(ttftTimer);
            ttftTimer = void 0;
          }
        }
        if (interChunkTimer) {
          clearTimeout(interChunkTimer);
        }
        interChunkTimer = setTimeout(() => abortWithReason("stall-timeout"), this.interChunkStallMs);
      },
      dispose: () => {
        if (connectTimer) clearTimeout(connectTimer);
        if (ttftTimer) clearTimeout(ttftTimer);
        if (interChunkTimer) clearTimeout(interChunkTimer);
        clearTimeout(overallTimer);
        if (externalSignal) {
          externalSignal.removeEventListener("abort", onExternalAbort);
        }
      }
    };
  }
  tryJsonParse(text) {
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  buildOpenAiUrl(baseUrl) {
    const normalized = baseUrl.replace(/\/+$/, "");
    if (normalized.endsWith("/chat/completions")) {
      return normalized;
    }
    return `${normalized}/chat/completions`;
  }
  parseRetryAfterMs(headerValue) {
    if (!headerValue) {
      return void 0;
    }
    const trimmed = headerValue.trim();
    if (!trimmed) {
      return void 0;
    }
    const seconds = Number.parseInt(trimmed, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1e3;
    }
    const retryAt = Date.parse(trimmed);
    if (Number.isNaN(retryAt)) {
      return void 0;
    }
    return Math.max(0, retryAt - Date.now());
  }
}
const SHUTDOWN_CODE = 1001;
const SHUTDOWN_REASON = "Bridge server shutting down";
const STOP_TIMEOUT_MS = 1500;
const AUTH_TIMEOUT_MS = 3e4;
class MobileBridgeServer {
  server = null;
  clients = /* @__PURE__ */ new Map();
  handlers = /* @__PURE__ */ new Map();
  pairingCode = null;
  status = {
    running: false,
    host: "127.0.0.1",
    port: 3310,
    url: "ws://127.0.0.1:3310",
    clientCount: 0
  };
  getStatus() {
    this.status.clientCount = this.clients.size;
    return this.status;
  }
  registerHandler(messageType, handler) {
    this.handlers.set(messageType, handler);
  }
  removeHandler(messageType) {
    this.handlers.delete(messageType);
  }
  async start(config) {
    if (!config.enabled) {
      await this.stop();
      this.status = {
        running: false,
        host: config.host,
        port: config.port,
        url: `ws://${config.host}:${config.port}`,
        clientCount: 0
      };
      return this.status;
    }
    if (this.server && this.status.host === config.host && this.status.port === config.port) {
      return this.getStatus();
    }
    await this.stop();
    this.pairingCode = Math.floor(1e5 + Math.random() * 9e5).toString();
    console.log(`[MobileBridgeServer] Pairing Code: ${this.pairingCode}`);
    const server = new ws.WebSocketServer({
      host: config.host,
      port: config.port,
      clientTracking: false
    });
    this.server = server;
    server.on("connection", (socket) => {
      const clientId = node_crypto.randomUUID();
      const authTimer = setTimeout(() => {
        if (this.clients.has(clientId) && !this.clients.get(clientId)?.authenticated) {
          console.log(`[MobileBridgeServer] Client ${clientId} failed to authenticate in time. Closing.`);
          socket.close(4001, "Authentication Timeout");
          this.clients.delete(clientId);
        }
      }, AUTH_TIMEOUT_MS);
      this.clients.set(clientId, {
        socket,
        authenticated: false,
        authTimer
      });
      socket.send(
        JSON.stringify({
          type: "bridge:hello",
          clientId,
          message: "اتصال برقرار شد. لطفاً کد تایید را وارد کنید."
        })
      );
      socket.on("message", (message) => {
        void this.handleClientMessage(clientId, socket, message);
      });
      socket.on("close", () => {
        const client = this.clients.get(clientId);
        if (client) clearTimeout(client.authTimer);
        this.clients.delete(clientId);
      });
      socket.on("error", (error) => {
        console.warn(`[MobileBridgeServer] Client ${clientId} error:`, error);
        const client = this.clients.get(clientId);
        if (client) clearTimeout(client.authTimer);
        this.clients.delete(clientId);
      });
    });
    server.on("error", (error) => {
      console.error("[MobileBridgeServer] Server error:", error);
    });
    await this.waitForListening(server);
    this.status = {
      running: true,
      host: config.host,
      port: config.port,
      url: `ws://${config.host}:${config.port}`,
      clientCount: this.clients.size
    };
    return this.status;
  }
  getPairingCode() {
    return this.pairingCode;
  }
  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.authenticated && client.socket.readyState === ws.WebSocket.OPEN) {
        client.socket.send(payload);
      }
    }
  }
  async handleClientMessage(clientId, socket, raw) {
    try {
      const message = this.parseMessage(raw);
      const client = this.clients.get(clientId);
      if (!client || !message) return;
      if (!client.authenticated) {
        if (message.type === "auth:pair") {
          const code = message.payload?.code;
          if (code === this.pairingCode) {
            client.authenticated = true;
            clearTimeout(client.authTimer);
            socket.send(JSON.stringify({ type: "auth:success", message: "احراز هویت با موفقیت انجام شد." }));
            console.log(`[MobileBridgeServer] Client ${clientId} authenticated via pairing code.`);
          } else {
            socket.send(JSON.stringify({ type: "auth:fail", message: "کد تایید اشتباه است." }));
          }
          return;
        }
        socket.send(JSON.stringify({ type: "auth:error", message: "لطفاً ابتدا احراز هویت کنید." }));
        return;
      }
      const handler = this.handlers.get(message.type);
      if (handler) {
        await handler(clientId, socket, message);
      } else {
        socket.send(JSON.stringify({ type: "bridge:error", message: `هندلری برای ${message.type} وجود ندارد.` }));
      }
    } catch (error) {
      console.error("[MobileBridgeServer] Message handling error:", error);
    }
  }
  async stop() {
    const server = this.server;
    this.server = null;
    for (const client of this.clients.values()) {
      clearTimeout(client.authTimer);
      try {
        client.socket.close(SHUTDOWN_CODE, SHUTDOWN_REASON);
      } catch {
        client.socket.terminate();
      }
    }
    this.clients.clear();
    if (server) {
      await this.closeServer(server);
    }
    this.status = {
      ...this.status,
      running: false,
      clientCount: 0
    };
  }
  waitForListening(server) {
    return new Promise((resolve, reject) => {
      const onListening = () => {
        cleanup();
        resolve();
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        server.off("listening", onListening);
        server.off("error", onError);
      };
      server.on("listening", onListening);
      server.on("error", onError);
    });
  }
  async closeServer(server) {
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };
      server.close(() => done());
      setTimeout(done, STOP_TIMEOUT_MS);
    });
  }
  parseMessage(rawMessage) {
    try {
      const text = Buffer.isBuffer(rawMessage) ? rawMessage.toString("utf8") : rawMessage.toString();
      const parsed = JSON.parse(text);
      if (!parsed.type || typeof parsed.type !== "string") {
        return null;
      }
      return {
        type: parsed.type,
        payload: parsed.payload,
        requestId: typeof parsed.requestId === "string" ? parsed.requestId : void 0
      };
    } catch {
      return null;
    }
  }
}
const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MULTISPACE_PATTERN = /\s+/g;
const MAX_FILE_NAME_BASE_LENGTH = 80;
const MAX_PDF_EVIDENCE_ROWS = 120;
const MAX_PDF_COLUMNS = 12;
class ReportExportService {
  showSaveDialogInvoker;
  fileWriter;
  pdfBufferBuilder;
  constructor(deps = {}) {
    this.showSaveDialogInvoker = deps.showSaveDialog ?? (async (ownerWindow, options) => {
      return this.showSaveDialog(ownerWindow, options);
    });
    this.fileWriter = deps.writeFile ?? (async (filePath, outputBuffer) => {
      await promises.writeFile(filePath, outputBuffer);
    });
    this.pdfBufferBuilder = deps.createPdfBuffer ?? (async (payload) => {
      return this.buildPdfBuffer(payload);
    });
  }
  async exportReport(ownerWindow, payload) {
    const format = this.normalizeFormat(payload.format);
    const saveDialogOptions = {
      title: format === "pdf" ? "Export Financial Report (PDF)" : "Export Financial Report (Excel)",
      defaultPath: this.buildDefaultFileName(payload.defaultFileName, format),
      filters: format === "pdf" ? [{ name: "PDF file", extensions: ["pdf"] }] : [{ name: "Excel Workbook", extensions: ["xlsx"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"]
    };
    const saveTarget = await this.showSaveDialogInvoker(ownerWindow, saveDialogOptions);
    if (saveTarget.canceled || !saveTarget.filePath) {
      throw new Error("Report export canceled by user.");
    }
    const targetFilePath = this.ensureFileExtension(saveTarget.filePath, format);
    const outputBuffer = format === "pdf" ? await this.pdfBufferBuilder(payload) : this.buildExcelBuffer(payload);
    await this.fileWriter(targetFilePath, outputBuffer);
    return {
      filePath: targetFilePath,
      format,
      bytesWritten: outputBuffer.byteLength
    };
  }
  normalizeFormat(format) {
    if (format === "pdf" || format === "excel") {
      return format;
    }
    throw new Error(`Unsupported report export format: ${String(format)}`);
  }
  buildDefaultFileName(defaultFileName, format) {
    const base = this.sanitizeFileNameBase(defaultFileName || "acc-assist-financial-report");
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const extension = format === "pdf" ? "pdf" : "xlsx";
    return `${base}-${timestamp}.${extension}`;
  }
  sanitizeFileNameBase(value) {
    const normalized = value.replace(INVALID_FILE_NAME_CHARS, " ").replace(MULTISPACE_PATTERN, " ").trim();
    if (!normalized) {
      return "acc-assist-financial-report";
    }
    const withoutExtension = normalized.replace(/\.(pdf|xlsx)$/i, "").trim();
    const clipped = withoutExtension.slice(0, MAX_FILE_NAME_BASE_LENGTH).trim();
    return clipped || "acc-assist-financial-report";
  }
  ensureFileExtension(filePath, format) {
    const extension = format === "pdf" ? ".pdf" : ".xlsx";
    if (filePath.toLowerCase().endsWith(extension)) {
      return filePath;
    }
    return `${filePath}${extension}`;
  }
  async showSaveDialog(ownerWindow, options) {
    if (ownerWindow) {
      return electron.dialog.showSaveDialog(ownerWindow, options);
    }
    return electron.dialog.showSaveDialog(options);
  }
  async buildPdfBuffer(payload) {
    const reportHtml = this.buildReportHtml(payload);
    const printWindow = new electron.BrowserWindow({
      show: false,
      width: 1240,
      height: 1754,
      webPreferences: {
        sandbox: true,
        javascript: false,
        contextIsolation: true
      }
    });
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(reportHtml)}`);
      const pdfData = await printWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
        margins: {
          top: 0.5,
          bottom: 0.5,
          left: 0.5,
          right: 0.5
        }
      });
      return Buffer.from(pdfData);
    } finally {
      if (!printWindow.isDestroyed()) {
        printWindow.destroy();
      }
    }
  }
  buildReportHtml(payload) {
    const stats = this.calculateEvidenceStats(payload.evidence);
    const escapedTitle = this.escapeHtml(payload.title || "Financial Report");
    const escapedPrompt = this.escapeHtml(payload.prompt || "-");
    const escapedGeneratedAt = this.escapeHtml(this.formatGeneratedAt(payload.generatedAt));
    const responseHtml = this.markdownToPdfHtml(payload.responseMarkdown || "-");
    const escapedStatsRows = this.escapeHtml(this.formatInteger(stats.totalRows));
    const evidenceBlocks = payload.evidence.map((item, index) => this.buildEvidenceHtmlBlock(item, index + 1)).join("");
    const evidenceContent = evidenceBlocks || '<p class="muted">No evidence rows were available for this report.</p>';
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapedTitle}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #1f2937;
        font-family: "Segoe UI", Tahoma, sans-serif;
        font-size: 12px;
        line-height: 1.55;
        background: #eef3f8;
      }
      .page {
        padding: 24px;
      }
      .card {
        background: #ffffff;
        border: 1px solid #d7e1ec;
        border-radius: 12px;
        box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
        padding: 14px 16px;
        margin-bottom: 14px;
      }
      .header {
        display: grid;
        gap: 8px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 9px;
        border-radius: 999px;
        border: 1px solid #c5d4e4;
        background: #edf5fc;
        color: #35506a;
        font-size: 11px;
        font-weight: 700;
        width: fit-content;
      }
      h1 {
        margin: 0;
        font-size: 21px;
        letter-spacing: 0.01em;
      }
      h2 {
        margin: 0 0 8px;
        font-size: 14px;
        color: #14344f;
      }
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .kpi {
        border: 1px solid #d4e0ec;
        border-radius: 10px;
        padding: 8px;
        background: #f8fbff;
      }
      .kpi-label {
        font-size: 11px;
        color: #51657a;
      }
      .kpi-value {
        font-size: 17px;
        font-weight: 700;
        color: #18344a;
      }
      .prompt {
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
      }
      .markdown-body p {
        margin: 0 0 8px;
      }
      .markdown-body p:last-child {
        margin-bottom: 0;
      }
      .markdown-body h1,
      .markdown-body h2,
      .markdown-body h3 {
        margin: 9px 0 7px;
        line-height: 1.3;
      }
      .markdown-body ul,
      .markdown-body ol {
        margin: 5px 0 8px 18px;
      }
      .markdown-body code {
        background: rgba(55, 85, 115, 0.13);
        border-radius: 4px;
        padding: 1px 4px;
        font-family: "Cascadia Mono", Consolas, monospace;
        font-size: 11px;
      }
      .markdown-body pre {
        margin: 8px 0;
        white-space: pre-wrap;
        word-break: break-word;
        border: 1px solid #d6e0e8;
        border-radius: 8px;
        padding: 10px;
        background: #f6f9fc;
      }
      .markdown-body pre code {
        background: transparent;
        padding: 0;
      }
      .markdown-body blockquote {
        margin: 8px 0;
        padding: 3px 0 3px 10px;
        border-left: 3px solid #9eb5ca;
        color: #3f5368;
      }
      .markdown-body a {
        color: #0d4f7f;
        text-decoration: underline;
      }
      .meta {
        display: grid;
        gap: 6px;
      }
      .meta div {
        border: 1px solid #d9e4ef;
        border-radius: 8px;
        padding: 8px;
        background: #f9fcff;
      }
      .label {
        font-weight: 700;
        color: #345064;
      }
      .evidence-block {
        border: 1px solid #d5e0ec;
        border-radius: 10px;
        margin-bottom: 14px;
        overflow: hidden;
        background: #ffffff;
      }
      .evidence-head {
        padding: 8px 10px;
        background: #edf4fb;
        border-bottom: 1px solid #d3deea;
      }
      table {
        border-collapse: collapse;
        width: 100%;
        table-layout: fixed;
      }
      th, td {
        border: 1px solid #d9e2ea;
        padding: 6px;
        text-align: left;
        vertical-align: top;
        word-break: break-word;
      }
      th {
        background: #eff5fb;
        color: #2d4a60;
      }
      tbody tr:nth-child(even) td {
        background: #fbfdff;
      }
      .small {
        font-size: 11px;
        color: #45627a;
      }
      .muted {
        color: #5f7384;
      }
      .footer {
        text-align: right;
        margin-top: 10px;
        color: #647487;
        font-size: 10px;
      }
    </style>
  </head>
  <body>
    <div class="page">
      <section class="card header">
        <span class="badge">ACC Assist Report Export</span>
        <h1>${escapedTitle}</h1>
        <div class="meta">
          <div><span class="label">Generated At:</span> ${escapedGeneratedAt}</div>
        </div>
      </section>

      <section class="card">
        <div class="kpi-grid">
          <div class="kpi">
            <div class="kpi-label">Evidence Blocks</div>
            <div class="kpi-value">${stats.blocks}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Evidence Rows</div>
            <div class="kpi-value">${escapedStatsRows}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">Truncated Blocks</div>
            <div class="kpi-value">${stats.truncatedBlocks}</div>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Prompt</h2>
        <p class="prompt">${escapedPrompt}</p>
      </section>

      <section class="card">
        <h2>Assistant Response</h2>
        <div class="markdown-body">${responseHtml}</div>
      </section>

      <section class="card">
        <h2>Evidence</h2>
        ${evidenceContent}
      </section>

      <div class="footer">Generated by ACC Assist</div>
    </div>
  </body>
</html>`;
  }
  buildEvidenceHtmlBlock(item, index) {
    const boundedColumns = item.columns.slice(0, MAX_PDF_COLUMNS);
    const boundedRows = item.rows.slice(0, MAX_PDF_EVIDENCE_ROWS);
    const wasTrimmedInPdf = item.columns.length > boundedColumns.length || item.rows.length > boundedRows.length;
    const head = `<div class="evidence-head"><strong>Evidence ${index}:</strong> ${this.escapeHtml(item.toolName)} <span class="small">(rows=${item.rowCount}, truncated=${item.truncated ? "yes" : "no"})</span></div>`;
    const queryHtml = item.queryPreview ? `<div class="small" style="padding:8px 10px; border-bottom:1px solid #d6e0e8;"><span class="label">Query:</span> ${this.escapeHtml(item.queryPreview)}</div>` : "";
    const trimHtml = wasTrimmedInPdf ? `<div class="small" style="padding:6px 10px; border-bottom:1px solid #d6e0e8;">PDF preview trimmed to ${boundedRows.length} rows and ${boundedColumns.length} columns.</div>` : "";
    if (boundedColumns.length === 0 || boundedRows.length === 0) {
      return `<section class="evidence-block">${head}${queryHtml}${trimHtml}<div style="padding:10px;" class="muted">No evidence rows available.</div></section>`;
    }
    const headerCells = ["<th>#</th>", ...boundedColumns.map((column) => `<th>${this.escapeHtml(column)}</th>`)].join("");
    const bodyRows = boundedRows.map((row, rowIndex) => {
      const cells = [
        `<td>${rowIndex + 1}</td>`,
        ...boundedColumns.map((column) => `<td>${this.escapeHtml(this.toPdfCellText(row[column]))}</td>`)
      ].join("");
      return `<tr>${cells}</tr>`;
    }).join("");
    return `<section class="evidence-block">${head}${queryHtml}${trimHtml}<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></section>`;
  }
  buildExcelBuffer(payload) {
    const workbook = XLSX__namespace.utils.book_new();
    const stats = this.calculateEvidenceStats(payload.evidence);
    const safeGeneratedAt = this.toSafeDate(payload.generatedAt);
    workbook.Props = {
      Title: payload.title || "ACC Assist Financial Report",
      Subject: "Financial report export",
      Author: "ACC Assist",
      CreatedDate: safeGeneratedAt
    };
    const summaryRows = [
      ["ACC Assist Financial Report", ""],
      [],
      ["Title", payload.title || "-"],
      ["Generated At", this.formatGeneratedAt(payload.generatedAt)],
      ["Prompt", payload.prompt || "-"],
      ["Evidence Blocks", stats.blocks],
      ["Evidence Rows", stats.totalRows],
      ["Truncated Evidence Blocks", stats.truncatedBlocks],
      [],
      ["Assistant Response", payload.responseMarkdown || "-"]
    ];
    const summarySheet = XLSX__namespace.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 26 }, { wch: 120 }];
    summarySheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    XLSX__namespace.utils.book_append_sheet(workbook, summarySheet, "Summary");
    const evidenceIndexRows = [["#", "Tool", "Rows", "Truncated", "Columns", "Query Preview"]];
    payload.evidence.forEach((item, index) => {
      evidenceIndexRows.push([
        index + 1,
        item.toolName,
        item.rowCount,
        item.truncated ? "yes" : "no",
        item.columns.join(", "),
        item.queryPreview || "-"
      ]);
    });
    if (payload.evidence.length === 0) {
      evidenceIndexRows.push(["-", "No evidence blocks were exported.", 0, "no", "-", "-"]);
    }
    const evidenceIndexSheet = XLSX__namespace.utils.aoa_to_sheet(evidenceIndexRows);
    evidenceIndexSheet["!cols"] = [
      { wch: 6 },
      { wch: 28 },
      { wch: 10 },
      { wch: 14 },
      { wch: 50 },
      { wch: 92 }
    ];
    evidenceIndexSheet["!autofilter"] = {
      ref: `A1:${XLSX__namespace.utils.encode_cell({ r: evidenceIndexRows.length - 1, c: evidenceIndexRows[0].length - 1 })}`
    };
    XLSX__namespace.utils.book_append_sheet(workbook, evidenceIndexSheet, "EvidenceIndex");
    if (payload.evidence.length === 0) {
      const noEvidenceSheet = XLSX__namespace.utils.aoa_to_sheet([["No evidence rows were available for this report."]]);
      noEvidenceSheet["!cols"] = [{ wch: 60 }];
      XLSX__namespace.utils.book_append_sheet(workbook, noEvidenceSheet, "Evidence");
    } else {
      payload.evidence.forEach((item, index) => {
        const sheetName = this.toExcelSheetName(`Evidence_${index + 1}`);
        const sheetRows = [
          ["Tool", item.toolName],
          ["Query", item.queryPreview || "-"],
          ["Generated At", this.formatGeneratedAt(payload.generatedAt)],
          ["Row Count", item.rowCount],
          ["Truncated", item.truncated ? "yes" : "no"],
          []
        ];
        let tableHeaderRowIndex = null;
        let tableColumnCount = 0;
        if (item.columns.length === 0 || item.rows.length === 0) {
          sheetRows.push(["No evidence rows available."]);
        } else {
          const tableHeader = ["#", ...item.columns];
          const tableRows = item.rows.map((row, rowIndex) => {
            return [
              rowIndex + 1,
              ...item.columns.map((column) => this.toExcelCellValue(row[column]))
            ];
          });
          tableHeaderRowIndex = sheetRows.length;
          tableColumnCount = tableHeader.length;
          sheetRows.push(tableHeader);
          sheetRows.push(...tableRows);
        }
        const evidenceSheet = XLSX__namespace.utils.aoa_to_sheet(sheetRows);
        if (tableHeaderRowIndex !== null && tableColumnCount > 0) {
          const tableHeader = sheetRows[tableHeaderRowIndex]?.map((value) => String(value ?? "")) ?? [];
          const tableRows = sheetRows.slice(tableHeaderRowIndex + 1);
          evidenceSheet["!cols"] = this.computeExcelTableColumnWidths(tableHeader, tableRows);
          evidenceSheet["!autofilter"] = {
            ref: `${XLSX__namespace.utils.encode_cell({ r: tableHeaderRowIndex, c: 0 })}:${XLSX__namespace.utils.encode_cell({ r: sheetRows.length - 1, c: tableColumnCount - 1 })}`
          };
        } else {
          evidenceSheet["!cols"] = [{ wch: 24 }, { wch: 96 }];
        }
        XLSX__namespace.utils.book_append_sheet(workbook, evidenceSheet, sheetName);
      });
    }
    const rawOutput = XLSX__namespace.write(workbook, { type: "buffer", bookType: "xlsx" });
    return Buffer.isBuffer(rawOutput) ? rawOutput : Buffer.from(rawOutput);
  }
  calculateEvidenceStats(evidence) {
    return {
      blocks: evidence.length,
      totalRows: evidence.reduce((sum, item) => sum + item.rowCount, 0),
      truncatedBlocks: evidence.filter((item) => item.truncated).length
    };
  }
  markdownToPdfHtml(markdown) {
    const normalized = markdown.replace(/\r\n?/g, "\n").trim();
    if (!normalized) {
      return "<p>(No content)</p>";
    }
    const codeBlocks = [];
    let source = this.escapeHtml(normalized);
    source = source.replace(/```([\s\S]*?)```/g, (_full, code) => {
      const index = codeBlocks.length;
      const cleaned = code.replace(/^\n+|\n+$/g, "");
      codeBlocks.push(`<pre><code>${cleaned}</code></pre>`);
      return `@@PDF_CODE_BLOCK_${index}@@`;
    });
    const lines = source.split("\n");
    const htmlParts = [];
    let inUnorderedList = false;
    let inOrderedList = false;
    const closeLists = () => {
      if (inUnorderedList) {
        htmlParts.push("</ul>");
        inUnorderedList = false;
      }
      if (inOrderedList) {
        htmlParts.push("</ol>");
        inOrderedList = false;
      }
    };
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        closeLists();
        continue;
      }
      const codeToken = line.match(/^@@PDF_CODE_BLOCK_(\d+)@@$/);
      if (codeToken) {
        closeLists();
        htmlParts.push(codeBlocks[Number(codeToken[1])] ?? "");
        continue;
      }
      const unorderedMatch = line.match(/^[-*]\s+(.+)/);
      if (unorderedMatch) {
        if (inOrderedList) {
          htmlParts.push("</ol>");
          inOrderedList = false;
        }
        if (!inUnorderedList) {
          htmlParts.push("<ul>");
          inUnorderedList = true;
        }
        htmlParts.push(`<li>${this.formatInlineMarkdownForPdf(unorderedMatch[1])}</li>`);
        continue;
      }
      const orderedMatch = line.match(/^\d+\.\s+(.+)/);
      if (orderedMatch) {
        if (inUnorderedList) {
          htmlParts.push("</ul>");
          inUnorderedList = false;
        }
        if (!inOrderedList) {
          htmlParts.push("<ol>");
          inOrderedList = true;
        }
        htmlParts.push(`<li>${this.formatInlineMarkdownForPdf(orderedMatch[1])}</li>`);
        continue;
      }
      closeLists();
      if (line.startsWith("### ")) {
        htmlParts.push(`<h3>${this.formatInlineMarkdownForPdf(line.slice(4))}</h3>`);
        continue;
      }
      if (line.startsWith("## ")) {
        htmlParts.push(`<h2>${this.formatInlineMarkdownForPdf(line.slice(3))}</h2>`);
        continue;
      }
      if (line.startsWith("# ")) {
        htmlParts.push(`<h1>${this.formatInlineMarkdownForPdf(line.slice(2))}</h1>`);
        continue;
      }
      if (line.startsWith("> ")) {
        htmlParts.push(`<blockquote>${this.formatInlineMarkdownForPdf(line.slice(2))}</blockquote>`);
        continue;
      }
      htmlParts.push(`<p>${this.formatInlineMarkdownForPdf(line)}</p>`);
    }
    closeLists();
    return htmlParts.join("\n") || "<p>(No content)</p>";
  }
  formatInlineMarkdownForPdf(text) {
    let formatted = text;
    formatted = formatted.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
    );
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    formatted = formatted.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    formatted = formatted.replace(/`([^`]+)`/g, "<code>$1</code>");
    return formatted;
  }
  computeExcelTableColumnWidths(header, tableRows) {
    const maxColumnLength = header.map((name) => Math.max(10, name.length + 2));
    for (const row of tableRows) {
      row.forEach((value, index) => {
        const asText = this.toExcelPreviewText(value);
        const boundedLength = Math.min(58, asText.length + 2);
        maxColumnLength[index] = Math.max(maxColumnLength[index] ?? 10, boundedLength);
      });
    }
    return maxColumnLength.map((width) => ({ wch: width }));
  }
  toExcelPreviewText(value) {
    if (value === null || value === void 0) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  toSafeDate(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return /* @__PURE__ */ new Date();
    }
    return parsed;
  }
  formatGeneratedAt(value) {
    const date = this.toSafeDate(value);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }
  formatInteger(value) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  }
  toExcelSheetName(value) {
    const cleaned = value.replace(/[\\/?*\[\]:]/g, "_").trim() || "Sheet";
    return cleaned.slice(0, 31);
  }
  toExcelCellValue(value) {
    if (value === null || value === void 0) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "bigint") {
      const asNumber = Number(value);
      return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  toPdfCellText(value) {
    if (value === null || value === void 0) {
      return "";
    }
    if (typeof value === "number") {
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  escapeHtml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
}
const ALL_ACCOUNTING_CONCEPTS = [
  "accounts",
  "documents",
  "documentLines",
  "counterparties",
  "cashTransactions",
  "costCenters",
  "projects",
  "banks",
  "pettyCash"
];
function normalizeTableRefs(tableRefs) {
  return tableRefs.map((tableRef) => tableRef.trim().toLowerCase()).filter(Boolean);
}
function buildConnectorSchemaFingerprint(tableRefs) {
  const normalizedRefs = normalizeTableRefs(tableRefs);
  const sortedUniqueRefs = [...new Set(normalizedRefs)].sort((left, right) => left.localeCompare(right));
  const tokenSet = /* @__PURE__ */ new Set();
  for (const tableRef of sortedUniqueRefs) {
    const tokens = tableRef.split(/[^a-z0-9\u0600-\u06ff]+/iu).filter(Boolean);
    for (const token of tokens) {
      tokenSet.add(token);
    }
  }
  const signatureSource = `${sortedUniqueRefs.join("|")}::${[...tokenSet].sort((a, b) => a.localeCompare(b)).join("|")}`;
  const signature = node_crypto.createHash("sha256").update(signatureSource).digest("hex").slice(0, 24);
  return {
    tableRefCount: sortedUniqueRefs.length,
    normalizedTokenCount: tokenSet.size,
    signature
  };
}
function buildConnectorReadinessSummary(params) {
  const suggestedMappings = params.suggestedMappings ?? {};
  const selectedMappings = params.selectedMappings ?? {};
  const coverage = params.detectedSoftware?.coverage ?? buildMappingCoverageSummary("Connector", suggestedMappings, selectedMappings);
  const suggestedCount = Object.values(suggestedMappings).reduce((sum, values) => sum + values.filter(Boolean).length, 0);
  const selectedCount = Object.values(selectedMappings).filter((value) => typeof value === "string" && value.trim()).length;
  const confidence = params.detectedSoftware?.confidence ?? 0;
  let status = "unknown";
  if (coverage.coverageScore >= 80 && confidence >= 0.8) {
    status = "ready";
  } else if (coverage.coverageScore > 0 || selectedCount > 0 || suggestedCount > 0) {
    status = "needs-review";
  }
  const summaryText = `پوشش نگاشت: ${coverage.coverageScore}% | پیشنهادها: ${suggestedCount} | انتخاب‌ها: ${selectedCount} | وضعیت: ${status === "ready" ? "آماده" : status === "needs-review" ? "نیاز به بازبینی" : "ناشناخته"}`;
  return {
    coverageScore: coverage.coverageScore,
    suggestedCount,
    selectedCount,
    status,
    summaryText
  };
}
function buildMappingCoverageSummary(presetName, suggestedMappings, selectedMappings) {
  const coveredConcepts = ALL_ACCOUNTING_CONCEPTS.filter((conceptKey) => {
    const suggestion = suggestedMappings[conceptKey]?.find((value) => value.trim().length > 0);
    const selection = selectedMappings[conceptKey]?.trim();
    return Boolean(selection || suggestion);
  });
  const missingConcepts = ALL_ACCOUNTING_CONCEPTS.filter((conceptKey) => !coveredConcepts.includes(conceptKey));
  const coverageScore = Math.round(coveredConcepts.length / ALL_ACCOUNTING_CONCEPTS.length * 100);
  const validationHints = [
    `پوشش نگاشت برای ${presetName}: ${coveredConcepts.length}/${ALL_ACCOUNTING_CONCEPTS.length} مفهوم شناسایی شد.`,
    "برای هر مفهوم بدون نگاشت، پیشنهاد یا انتخاب دستی را بررسی کنید."
  ];
  if (missingConcepts.length > 0) {
    validationHints.push(`کمبودهای پیشنهادی: ${missingConcepts.join(", ")}.`);
  }
  return {
    coveredConcepts,
    missingConcepts,
    coverageScore,
    validationHints
  };
}
function detectConnectorByPresets(params) {
  const minScore = params.minScore;
  const normalizedTableRefs = normalizeTableRefs(params.tableRefs);
  const fingerprint = buildConnectorSchemaFingerprint(normalizedTableRefs);
  if (normalizedTableRefs.length === 0) {
    return {
      primary: null,
      candidates: [],
      fingerprint
    };
  }
  const scoredCandidates = params.presets.map((preset) => scorePreset(preset, normalizedTableRefs)).filter((candidate) => candidate.score >= minScore).sort((left, right) => right.score - left.score);
  if (scoredCandidates.length === 0) {
    return {
      primary: null,
      candidates: [],
      fingerprint
    };
  }
  const topScore = scoredCandidates[0].score;
  const candidates = scoredCandidates.map((candidate) => ({
    ...candidate,
    confidence: Number((candidate.score / topScore).toFixed(2))
  }));
  return {
    primary: candidates[0],
    candidates,
    fingerprint
  };
}
function scoreTableForPresetConcept(preset, conceptKey, tableRef) {
  if (!preset) {
    return 0;
  }
  const conceptPatterns = preset.conceptPatterns[conceptKey] ?? [];
  const normalizedTableRef = tableRef.trim().toLowerCase();
  if (!normalizedTableRef) {
    return 0;
  }
  return conceptPatterns.some((pattern) => pattern.test(normalizedTableRef)) ? 6 : 0;
}
function scorePreset(preset, tableRefs) {
  let score = 0;
  let matchedDetectionPatterns = 0;
  const matchedConcepts = [];
  for (const pattern of preset.detectionPatterns) {
    if (tableRefs.some((tableRef) => pattern.test(tableRef))) {
      score += 5;
      matchedDetectionPatterns += 1;
    }
  }
  for (const conceptKey of Object.keys(preset.conceptPatterns)) {
    const conceptPatterns = preset.conceptPatterns[conceptKey] ?? [];
    if (conceptPatterns.some((pattern) => tableRefs.some((tableRef) => pattern.test(tableRef)))) {
      score += 2;
      matchedConcepts.push(conceptKey);
    }
  }
  const uniqueMatchedConcepts = [...new Set(matchedConcepts)];
  const missingConcepts = ALL_ACCOUNTING_CONCEPTS.filter((conceptKey) => !uniqueMatchedConcepts.includes(conceptKey));
  const coverageScore = Math.round(uniqueMatchedConcepts.length / ALL_ACCOUNTING_CONCEPTS.length * 100);
  const coverage = buildMappingCoverageSummary(
    preset.name,
    Object.fromEntries(uniqueMatchedConcepts.map((conceptKey) => [conceptKey, [conceptKey]])),
    {}
  );
  const validationHints = [
    `Detected ${uniqueMatchedConcepts.length}/${ALL_ACCOUNTING_CONCEPTS.length} core accounting concepts for ${preset.name}.`
  ];
  if (missingConcepts.length > 0) {
    validationHints.push(`Manual mapping is recommended for: ${missingConcepts.join(", ")}.`);
  }
  if (uniqueMatchedConcepts.length === 0) {
    validationHints.push("No concept mapping evidence matched the current schema fingerprint.");
  }
  return {
    id: preset.id,
    name: preset.name,
    score,
    confidence: 0,
    matchedDetectionPatterns,
    matchedConcepts: uniqueMatchedConcepts,
    coverage: {
      coveredConcepts: coverage.coveredConcepts,
      missingConcepts: coverage.missingConcepts,
      coverageScore,
      validationHints: [...validationHints, ...coverage.validationHints]
    }
  };
}
const CONNECTOR_PROFILES = [
  {
    id: "sepidar",
    name: "Sepidar",
    detectionPatterns: [
      /\bacc_(documents?|documentitems?|accounts?|vouchers?)\b/i,
      /\bbas_(persons?|customers?|parties?)\b/i,
      /\btre_(cash|bank|payments?|receipts?)\b/i
    ],
    conceptPatterns: {
      accounts: [/\bacc_accounts?\b/i, /\bacc_chartofaccounts\b/i, /\bacc_ledger\b/i],
      documents: [/\bacc_documents?\b/i, /\bacc_vouchers?\b/i],
      documentLines: [/\bacc_documentitems?\b/i, /\bacc_documentlines?\b/i],
      counterparties: [/\bbas_persons?\b/i, /\bbas_customers?\b/i],
      cashTransactions: [/\btre_(cash|payments?|receipts?)\b/i, /\bcash_transactions?\b/i],
      costCenters: [/\bacc_costcenters?\b/i, /\bcost_centers?\b/i],
      projects: [/\bprj_projects?\b/i, /\bacc_projects?\b/i],
      banks: [/\btre_bank(accounts?|transactions?)\b/i, /\bbank_accounts?\b/i],
      pettyCash: [/\btre_pettycash\b/i, /\bpetty_cash\b/i, /\btan(kh|x)ah\b/i]
    }
  },
  {
    id: "mahak",
    name: "Mahak",
    detectionPatterns: [
      /\bsanad\b/i,
      /\bhesab(kol|moin|tafzil(i|y)|tafzili)?\b/i,
      /\b(ashkhas|daryaft|pardakht|markazhazine)\b/i
    ],
    conceptPatterns: {
      accounts: [/\bhesab(kol|moin|tafzil(i|y)|tafzili)\b/i, /\bchart_accounts?\b/i],
      documents: [/\bsanad(head|headers?)?\b/i, /\bvouchers?\b/i],
      documentLines: [/\bsanad(items?|lines?)\b/i, /\barticles?\b/i],
      counterparties: [/\bashkhas\b/i, /\btaraf(hesab)?\b/i, /\bcustomers?\b/i],
      cashTransactions: [/\b(daryaft|pardakht)\b/i, /\bcash(transactions?)?\b/i],
      costCenters: [/\bmarkazhazine\b/i, /\bcost_centers?\b/i],
      projects: [/\bproject(s)?\b/i, /\bproje(h)?\b/i],
      banks: [/\bbank(accounts?|transactions?)?\b/i, /\bcheques?\b/i],
      pettyCash: [/\bsandogh\b/i, /\bpetty_cash\b/i, /\btan(kh|x)ah\b/i]
    }
  }
];
const MIN_DETECTION_SCORE = 6;
function getAccountingConnectorProfile(id) {
  return CONNECTOR_PROFILES.find((profile) => profile.id === id);
}
function detectAccountingSoftware(tableRefs) {
  const detection = detectConnectorByPresets({
    presets: CONNECTOR_PROFILES,
    tableRefs,
    minScore: MIN_DETECTION_SCORE
  });
  return {
    primary: detection.primary,
    candidates: detection.candidates
  };
}
function scoreTableForSoftwareConcept(softwareId, conceptKey, tableRef) {
  if (!softwareId) {
    return 0;
  }
  const profile = getAccountingConnectorProfile(softwareId);
  if (!profile) {
    return 0;
  }
  return scoreTableForPresetConcept(profile, conceptKey, tableRef);
}
function toSampleValue(value) {
  if (value === null || value === void 0) {
    return null;
  }
  let text;
  if (typeof value === "string") {
    text = value.trim();
  } else if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    text = String(value);
  } else if (value instanceof Date) {
    text = value.toISOString();
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (!text) {
    return null;
  }
  if (text.length > 90) {
    return `${text.slice(0, 87)}...`;
  }
  return text;
}
function buildCatalogCacheKey(profileId, databaseName, softwareOverrideId) {
  return `${profileId.trim().toLowerCase()}::${databaseName.trim().toLowerCase()}::${softwareOverrideId ?? "auto"}`;
}
const MAX_TABLES = 220;
const MAX_COLUMNS_PER_TABLE = 120;
const MAX_SAMPLE_TABLES = 12;
const MAX_SAMPLE_VALUES_PER_COLUMN = 4;
const SAMPLE_ROW_LIMIT = 3;
const MAX_SUGGESTION_COUNT_PER_CONCEPT = 5;
const MAX_DATE_EVIDENCE_ITEMS = 6;
const MAX_DISCOVERY_SCHEMA_ROWS = MAX_TABLES * MAX_COLUMNS_PER_TABLE;
const SCHEMA_DISCOVERY_CACHE_TTL_MS = 15 * 60 * 1e3;
const CONCEPT_PATTERNS = {
  accounts: [/\baccount\b/i, /\baccounts\b/i, /\bledger\b/i, /\bchart\b/i, /\bcoa\b/i],
  documents: [/\bdocument\b/i, /\bdocuments\b/i, /\bvoucher\b/i, /\bjournal\b/i, /\bentry\b/i],
  documentLines: [/\bline\b/i, /\blines\b/i, /\bdetail\b/i, /\bdetails\b/i, /\barticle\b/i, /\bitem\b/i],
  counterparties: [/\bparty\b/i, /\bcustomer\b/i, /\bvendor\b/i, /\bperson\b/i, /\bclient\b/i],
  cashTransactions: [/\btransaction\b/i, /\breceipt\b/i, /\bpayment\b/i, /\bcash\b/i, /\bcashflow\b/i],
  costCenters: [/\bcost\s*center\b/i, /\bcost_center\b/i, /\bcostcenter\b/i],
  projects: [/\bproject\b/i, /\bprojects\b/i],
  banks: [/\bbank\b/i, /\bbanks\b/i],
  pettyCash: [/\bpetty\b/i, /\bimprest\b/i, /\bcashbox\b/i, /\bfund\b/i]
};
const SERVER_INFO_QUERY = `
SELECT TOP (1)
  CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS server_version,
  DB_NAME() AS database_name`;
const TABLES_QUERY = `
SELECT
  s.name AS schema_name,
  t.name AS table_name,
  CAST(COALESCE(SUM(p.rows), 0) AS bigint) AS estimated_row_count
FROM sys.tables t
INNER JOIN sys.schemas s
  ON s.schema_id = t.schema_id
LEFT JOIN sys.partitions p
  ON p.object_id = t.object_id
  AND p.index_id IN (0, 1)
WHERE t.is_ms_shipped = 0
GROUP BY s.name, t.name
ORDER BY s.name, t.name`;
const COLUMNS_QUERY = `
SELECT TOP (${MAX_DISCOVERY_SCHEMA_ROWS})
  s.name AS schema_name,
  t.name AS table_name,
  c.name AS column_name,
  ty.name AS data_type,
  CAST(c.max_length AS int) AS max_length,
  CAST(c.is_nullable AS int) AS is_nullable,
  CAST(c.is_identity AS int) AS is_identity
FROM sys.tables t
INNER JOIN sys.schemas s
  ON s.schema_id = t.schema_id
INNER JOIN sys.columns c
  ON c.object_id = t.object_id
INNER JOIN sys.types ty
  ON ty.user_type_id = c.user_type_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name, c.column_id`;
const PRIMARY_KEYS_QUERY = `
SELECT TOP (${MAX_DISCOVERY_SCHEMA_ROWS})
  s.name AS schema_name,
  t.name AS table_name,
  c.name AS column_name
FROM sys.key_constraints kc
INNER JOIN sys.tables t
  ON t.object_id = kc.parent_object_id
INNER JOIN sys.schemas s
  ON s.schema_id = t.schema_id
INNER JOIN sys.index_columns ic
  ON ic.object_id = kc.parent_object_id
  AND ic.index_id = kc.unique_index_id
INNER JOIN sys.columns c
  ON c.object_id = ic.object_id
  AND c.column_id = ic.column_id
WHERE kc.type = 'PK'
ORDER BY s.name, t.name, ic.key_ordinal`;
const FOREIGN_KEYS_QUERY = `
SELECT TOP (${MAX_DISCOVERY_SCHEMA_ROWS})
  ps.name AS schema_name,
  pt.name AS table_name,
  pc.name AS column_name,
  rs.name AS referenced_schema,
  rt.name AS referenced_table,
  rc.name AS referenced_column
FROM sys.foreign_key_columns fkc
INNER JOIN sys.tables pt
  ON pt.object_id = fkc.parent_object_id
INNER JOIN sys.schemas ps
  ON ps.schema_id = pt.schema_id
INNER JOIN sys.columns pc
  ON pc.object_id = fkc.parent_object_id
  AND pc.column_id = fkc.parent_column_id
INNER JOIN sys.tables rt
  ON rt.object_id = fkc.referenced_object_id
INNER JOIN sys.schemas rs
  ON rs.schema_id = rt.schema_id
INNER JOIN sys.columns rc
  ON rc.object_id = fkc.referenced_object_id
  AND rc.column_id = fkc.referenced_column_id
ORDER BY ps.name, pt.name, fkc.constraint_column_id`;
class SchemaDiscoveryService {
  catalogCache = /* @__PURE__ */ new Map();
  inFlightCatalogRequests = /* @__PURE__ */ new Map();
  async discoverCatalog(params) {
    const profileId = params.profileId.trim();
    const softwareOverrideId = this.normalizeSoftwareId(params.softwareOverrideId);
    const executeSql = params.executeSql;
    if (!profileId) {
      throw new Error("شناسه پروفایل (Profile ID) برای کشف ساختار الزامی است.");
    }
    const cacheKey = buildCatalogCacheKey(profileId, params.databaseName, softwareOverrideId);
    const cached = this.catalogCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < SCHEMA_DISCOVERY_CACHE_TTL_MS) {
      return cached.catalog;
    }
    const inflight = this.inFlightCatalogRequests.get(cacheKey);
    if (inflight) {
      return inflight;
    }
    const request = this.discoverCatalogInternal({
      profileId,
      databaseName: params.databaseName,
      softwareOverrideId,
      previousSelectedMappings: params.previousSelectedMappings,
      executeSql
    }).finally(() => {
      this.inFlightCatalogRequests.delete(cacheKey);
    });
    this.inFlightCatalogRequests.set(cacheKey, request);
    const catalog = await request;
    this.catalogCache.set(cacheKey, { catalog, fetchedAt: Date.now() });
    return catalog;
  }
  async discoverCatalogInternal(params) {
    const profileId = params.profileId.trim();
    const softwareOverrideId = this.normalizeSoftwareId(params.softwareOverrideId);
    const executeSql = params.executeSql;
    const serverInfoRows = await executeSql(SERVER_INFO_QUERY);
    const serverInfo = serverInfoRows[0] ?? {};
    const serverVersion = this.toStringValue(serverInfo["server_version"], "Unknown");
    const detectedDatabaseName = this.toStringValue(serverInfo["database_name"], "");
    const rawTableRows = await executeSql(TABLES_QUERY);
    const totalTables = rawTableRows.length;
    const includedTableRows = rawTableRows.slice(0, MAX_TABLES);
    const tableMap = /* @__PURE__ */ new Map();
    for (const row of includedTableRows) {
      const schemaName = this.toStringValue(row["schema_name"], "");
      const tableName = this.toStringValue(row["table_name"], "");
      if (!schemaName || !tableName) {
        continue;
      }
      const key = this.toTableKey(schemaName, tableName);
      tableMap.set(key, {
        schemaName,
        tableName,
        estimatedRowCount: this.toNullableNumber(row["estimated_row_count"]),
        tags: [],
        columns: [],
        foreignKeys: []
      });
    }
    const columnRows = await executeSql(COLUMNS_QUERY);
    for (const row of columnRows) {
      const schemaName = this.toStringValue(row["schema_name"], "");
      const tableName = this.toStringValue(row["table_name"], "");
      const key = this.toTableKey(schemaName, tableName);
      const table = tableMap.get(key);
      if (!table || table.columns.length >= MAX_COLUMNS_PER_TABLE) {
        continue;
      }
      const columnName = this.toStringValue(row["column_name"], "");
      if (!columnName) {
        continue;
      }
      table.columns.push({
        name: columnName,
        dataType: this.toStringValue(row["data_type"], "unknown"),
        isNullable: this.toBooleanFlag(row["is_nullable"]),
        maxLength: this.toNullableNumber(row["max_length"]),
        isIdentity: this.toBooleanFlag(row["is_identity"]),
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: []
      });
    }
    const primaryKeyRows = await executeSql(PRIMARY_KEYS_QUERY);
    for (const row of primaryKeyRows) {
      const schemaName = this.toStringValue(row["schema_name"], "");
      const tableName = this.toStringValue(row["table_name"], "");
      const columnName = this.toStringValue(row["column_name"], "");
      const key = this.toTableKey(schemaName, tableName);
      const table = tableMap.get(key);
      if (!table || !columnName) {
        continue;
      }
      const column = table.columns.find((item) => item.name.toLowerCase() === columnName.toLowerCase());
      if (column) {
        column.isPrimaryKey = true;
      }
    }
    const foreignKeyRows = await executeSql(FOREIGN_KEYS_QUERY);
    for (const row of foreignKeyRows) {
      const schemaName = this.toStringValue(row["schema_name"], "");
      const tableName = this.toStringValue(row["table_name"], "");
      const columnName = this.toStringValue(row["column_name"], "");
      const key = this.toTableKey(schemaName, tableName);
      const table = tableMap.get(key);
      if (!table || !columnName) {
        continue;
      }
      table.foreignKeys.push({
        columnName,
        referencedSchema: this.toStringValue(row["referenced_schema"], ""),
        referencedTable: this.toStringValue(row["referenced_table"], ""),
        referencedColumn: this.toStringValue(row["referenced_column"], "")
      });
      const column = table.columns.find((item) => item.name.toLowerCase() === columnName.toLowerCase());
      if (column) {
        column.hasForeignKey = true;
      }
    }
    const tables = Array.from(tableMap.values());
    for (const table of tables) {
      table.tags = this.detectTableTags(table);
    }
    const tableRefs = tables.map((table) => `${table.schemaName}.${table.tableName}`);
    const softwareDetection = detectAccountingSoftware(tableRefs);
    const connectorFingerprint = buildConnectorSchemaFingerprint(tableRefs);
    const effectiveSoftwareId = softwareOverrideId ?? softwareDetection.primary?.id ?? null;
    const sampleTargets = this.pickSampleTables(tables);
    for (const table of sampleTargets) {
      await this.fillSampleValues(table, executeSql);
    }
    const suggestedMappings = this.buildSuggestedMappings(tables, effectiveSoftwareId);
    const selectedMappings = params.previousSelectedMappings ?? {};
    const coverageSummary = buildMappingCoverageSummary(
      softwareDetection.primary?.name ?? "Connector",
      suggestedMappings,
      selectedMappings
    );
    const detectedSoftware = softwareDetection.primary ? {
      ...softwareDetection.primary,
      coverage: {
        ...softwareDetection.primary.coverage ?? {},
        ...coverageSummary,
        validationHints: [
          ...softwareDetection.primary.coverage?.validationHints ?? [],
          ...coverageSummary.validationHints
        ]
      }
    } : null;
    const connectorReadiness = buildConnectorReadinessSummary({
      suggestedMappings,
      selectedMappings,
      detectedSoftware: detectedSoftware ? {
        coverage: detectedSoftware.coverage,
        confidence: detectedSoftware.confidence
      } : null
    });
    const softwareCandidates = softwareDetection.candidates.map((candidate) => ({
      ...candidate,
      coverage: {
        ...candidate.coverage ?? {},
        ...buildMappingCoverageSummary(candidate.name, suggestedMappings, {}),
        validationHints: [
          ...candidate.coverage?.validationHints ?? [],
          ...buildMappingCoverageSummary(candidate.name, suggestedMappings, {}).validationHints
        ]
      }
    }));
    const catalogTables = tables.sort((a, b) => this.toTableKey(a.schemaName, a.tableName).localeCompare(this.toTableKey(b.schemaName, b.tableName))).map((table) => this.toCatalogTable(table));
    const dateDetection = this.detectCatalogDateMode(catalogTables);
    return {
      profileId,
      databaseName: detectedDatabaseName || params.databaseName,
      discoveredAt: (/* @__PURE__ */ new Date()).toISOString(),
      serverVersion,
      totalTables,
      includedTables: catalogTables.length,
      sampledTables: sampleTargets.length,
      tables: catalogTables,
      suggestedMappings,
      selectedMappings,
      connectorReadiness,
      detectedSoftware,
      softwareCandidates,
      selectedSoftwareId: softwareOverrideId,
      detectedDateMode: dateDetection.mode,
      selectedDateMode: null,
      dateEvidence: dateDetection.evidence,
      connectorFingerprint
    };
  }
  detectCatalogDateMode(tables) {
    const shamsiTextPattern = /^(13|14)\d{2}[\/-](0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])$/;
    const shamsiNumericPattern = /^(13|14)\d{6}$/;
    const gregorianTextPattern = /^(19|20)\d{2}[\/-](0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])/i;
    const fiscalPeriodPattern = /^\d{4}(0[1-9]|1[0-2])$/;
    const scores = {
      unknown: 0,
      gregorian: 0,
      shamsiText: 0,
      shamsiNumeric: 0,
      fiscalPeriod: 0,
      mixed: 0
    };
    const evidenceByMode = {
      unknown: [],
      gregorian: [],
      shamsiText: [],
      shamsiNumeric: [],
      fiscalPeriod: [],
      mixed: []
    };
    for (const table of tables) {
      const tableRef = `${table.schemaName}.${table.tableName}`;
      for (const column of table.columns) {
        const dataType = column.dataType.toLowerCase();
        const columnName = column.name.toLowerCase();
        const columnRef = `${tableRef}.${column.name}`;
        const sampleValues = column.sampleValues.map((value) => value.trim()).filter(Boolean);
        if (dataType.includes("date") || dataType.includes("time")) {
          scores.gregorian += 2;
          this.addDateEvidence(evidenceByMode, "gregorian", `${columnRef} [${column.dataType}]`);
        }
        if (columnName.includes("fiscal") || columnName.includes("period") || columnName.includes("سال") || columnName.includes("دوره")) {
          scores.fiscalPeriod += 1;
          this.addDateEvidence(evidenceByMode, "fiscalPeriod", `${columnRef} [name]`);
        }
        for (const sampleValue of sampleValues) {
          if (shamsiTextPattern.test(sampleValue)) {
            scores.shamsiText += 3;
            this.addDateEvidence(evidenceByMode, "shamsiText", `${columnRef}=${sampleValue}`);
            continue;
          }
          if (shamsiNumericPattern.test(sampleValue)) {
            scores.shamsiNumeric += 3;
            this.addDateEvidence(evidenceByMode, "shamsiNumeric", `${columnRef}=${sampleValue}`);
            continue;
          }
          if (gregorianTextPattern.test(sampleValue)) {
            scores.gregorian += 2;
            this.addDateEvidence(evidenceByMode, "gregorian", `${columnRef}=${sampleValue}`);
            continue;
          }
          if (fiscalPeriodPattern.test(sampleValue) && (columnName.includes("period") || columnName.includes("fiscal"))) {
            scores.fiscalPeriod += 2;
            this.addDateEvidence(evidenceByMode, "fiscalPeriod", `${columnRef}=${sampleValue}`);
          }
        }
      }
    }
    const rankedModes = ["gregorian", "shamsiText", "shamsiNumeric", "fiscalPeriod"].map((mode) => ({
      mode,
      score: scores[mode]
    })).filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score);
    if (rankedModes.length === 0) {
      return {
        mode: "unknown",
        evidence: []
      };
    }
    if (rankedModes.length > 1 && rankedModes[0].score === rankedModes[1].score) {
      const mixedEvidence = [
        ...evidenceByMode[rankedModes[0].mode],
        ...evidenceByMode[rankedModes[1].mode]
      ].slice(0, MAX_DATE_EVIDENCE_ITEMS);
      return {
        mode: "mixed",
        evidence: mixedEvidence
      };
    }
    const topMode = rankedModes[0].mode;
    return {
      mode: topMode,
      evidence: evidenceByMode[topMode].slice(0, MAX_DATE_EVIDENCE_ITEMS)
    };
  }
  addDateEvidence(evidenceByMode, mode, evidence) {
    const bucket = evidenceByMode[mode];
    if (bucket.includes(evidence)) {
      return;
    }
    if (bucket.length >= MAX_DATE_EVIDENCE_ITEMS * 2) {
      return;
    }
    bucket.push(evidence);
  }
  toCatalogTable(table) {
    return {
      schemaName: table.schemaName,
      tableName: table.tableName,
      estimatedRowCount: table.estimatedRowCount,
      tags: [...table.tags],
      columns: table.columns.map((column) => ({ ...column })),
      foreignKeys: table.foreignKeys.map((foreignKey) => ({ ...foreignKey }))
    };
  }
  detectTableTags(table) {
    const searchSource = [
      table.schemaName,
      table.tableName,
      ...table.columns.map((column) => column.name)
    ].join(" ").toLowerCase();
    const tags = [];
    for (const conceptKey of Object.keys(CONCEPT_PATTERNS)) {
      const patterns = CONCEPT_PATTERNS[conceptKey];
      if (patterns.some((pattern) => pattern.test(searchSource))) {
        tags.push(conceptKey);
      }
    }
    return tags;
  }
  pickSampleTables(tables) {
    const ranked = [...tables].map((table) => {
      const rowBonus = table.estimatedRowCount ? Math.min(8, Math.log10(table.estimatedRowCount + 1)) : 0;
      return {
        table,
        score: table.tags.length * 10 + rowBonus
      };
    }).sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const bRows = b.table.estimatedRowCount ?? -1;
      const aRows = a.table.estimatedRowCount ?? -1;
      if (bRows !== aRows) {
        return bRows - aRows;
      }
      return this.toTableKey(a.table.schemaName, a.table.tableName).localeCompare(
        this.toTableKey(b.table.schemaName, b.table.tableName)
      );
    });
    return ranked.slice(0, MAX_SAMPLE_TABLES).map((entry) => entry.table);
  }
  async fillSampleValues(table, executeSql) {
    const query = `SELECT TOP (${SAMPLE_ROW_LIMIT}) * FROM ${this.quoteSqlIdentifier(table.schemaName)}.${this.quoteSqlIdentifier(table.tableName)}`;
    const rows = await executeSql(query);
    if (rows.length === 0) {
      return;
    }
    const sampleMap = /* @__PURE__ */ new Map();
    for (const column of table.columns) {
      sampleMap.set(column.name.toLowerCase(), /* @__PURE__ */ new Set());
    }
    for (const row of rows) {
      for (const [columnName, rawValue] of Object.entries(row)) {
        const entry = sampleMap.get(columnName.toLowerCase());
        if (!entry || entry.size >= MAX_SAMPLE_VALUES_PER_COLUMN) {
          continue;
        }
        const sampleValue = toSampleValue(rawValue);
        if (!sampleValue) {
          continue;
        }
        entry.add(sampleValue);
      }
    }
    for (const column of table.columns) {
      const entry = sampleMap.get(column.name.toLowerCase());
      column.sampleValues = entry ? Array.from(entry) : [];
    }
  }
  buildSuggestedMappings(tables, detectedSoftwareId) {
    const suggestions = {};
    for (const conceptKey of Object.keys(CONCEPT_PATTERNS)) {
      const ranked = tables.map((table) => {
        const tableRef = `${table.schemaName}.${table.tableName}`;
        const searchSource = [
          table.schemaName,
          table.tableName,
          ...table.columns.map((column) => column.name)
        ].join(" ");
        const patternHits = CONCEPT_PATTERNS[conceptKey].filter((pattern) => pattern.test(searchSource)).length;
        const tagBonus = table.tags.includes(conceptKey) ? 2 : 0;
        const softwareBoost = scoreTableForSoftwareConcept(detectedSoftwareId, conceptKey, tableRef);
        const score = patternHits * 4 + tagBonus + softwareBoost;
        return {
          tableRef,
          score,
          rowCount: table.estimatedRowCount ?? -1
        };
      }).filter((entry) => entry.score > 0).sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if (b.rowCount !== a.rowCount) {
          return b.rowCount - a.rowCount;
        }
        return a.tableRef.localeCompare(b.tableRef);
      });
      if (ranked.length > 0) {
        suggestions[conceptKey] = ranked.slice(0, MAX_SUGGESTION_COUNT_PER_CONCEPT).map((entry) => entry.tableRef);
      }
    }
    return suggestions;
  }
  quoteSqlIdentifier(value) {
    return `[${value.replace(/]/g, "]]")}]`;
  }
  toTableKey(schemaName, tableName) {
    return `${schemaName.toLowerCase()}.${tableName.toLowerCase()}`;
  }
  toStringValue(value, fallback) {
    if (typeof value === "string") {
      return value.trim();
    }
    if (typeof value === "number" || typeof value === "bigint") {
      return String(value);
    }
    return fallback;
  }
  toNullableNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "bigint") {
      return Number(value);
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  toBooleanFlag(value) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value === 1;
    }
    if (typeof value === "bigint") {
      return value === 1n;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return normalized === "1" || normalized === "true";
    }
    return false;
  }
  normalizeSoftwareId(value) {
    if (value === "sepidar" || value === "mahak") {
      return value;
    }
    return null;
  }
}
const DEFAULT_PROFILE_ID = "default-profile";
const DEFAULT_SETTINGS = {
  gemini: {
    apiKey: "aa-aDiE3jyTPH5opHafdpUc5d4c2mJU2NS96YisP3FXlcs46ANI",
    baseUrl: "https://api.avalai.ir/v1",
    mode: "openai",
    model: "gemini-2.5-flash"
  },
  sql: {
    server: "127.0.0.1",
    database: "Sepidar01",
    user: "damavand",
    password: "damavand",
    port: 58033,
    encrypt: false,
    trustServerCertificate: true,
    connectionTimeoutMs: 15e3,
    requestTimeoutMs: 45e3
  },
  sqlSecurity: {
    enforceReadOnlyLogin: false,
    forbidWildcardSelect: true,
    requireOrderByWhenLimited: true,
    blockQueryHints: true
  },
  ssh: {
    enabled: false,
    host: "",
    port: 22,
    username: "",
    password: "",
    privateKey: "",
    passphrase: "",
    dstHost: "127.0.0.1",
    dstPort: 1433,
    localPort: null,
    readyTimeoutMs: 15e3,
    keepaliveIntervalMs: 1e4
  },
  mobileBridge: {
    enabled: true,
    host: "127.0.0.1",
    port: 3310,
    allowedOrigin: "xapi.test"
  },
  telemetry: {
    enabled: true,
    ingestUrl: "",
    bearerToken: "",
    logLevel: "debug",
    flushIntervalMs: 5e3,
    requestTimeoutMs: 8e3,
    maxBatchSize: 25,
    maxQueueSize: 5e3,
    includeRendererErrors: true,
    retentionDays: 30
  },
  connectionProfile: {
    name: "پروفایل پیش فرض",
    description: "پروفایل اصلی اتصال SQL و SSH",
    type: "direct",
    lastTestStatus: "never",
    lastTestMessage: "هنوز تستی اجرا نشده است.",
    lastTestAt: null
  },
  connectionProfiles: [
    {
      id: DEFAULT_PROFILE_ID,
      metadata: {
        name: "پروفایل پیش فرض",
        description: "پروفایل اصلی اتصال SQL و SSH",
        type: "direct",
        lastTestStatus: "never",
        lastTestMessage: "هنوز تستی اجرا نشده است.",
        lastTestAt: null
      },
      sql: {
        server: "127.0.0.1",
        database: "Sepidar01",
        user: "damavand",
        password: "damavand",
        port: 58033,
        encrypt: false,
        trustServerCertificate: true,
        connectionTimeoutMs: 15e3,
        requestTimeoutMs: 45e3
      },
      ssh: {
        enabled: false,
        host: "",
        port: 22,
        username: "",
        password: "",
        privateKey: "",
        passphrase: "",
        dstHost: "127.0.0.1",
        dstPort: 1433,
        localPort: null,
        readyTimeoutMs: 15e3,
        keepaliveIntervalMs: 1e4
      }
    }
  ],
  activeConnectionProfileId: DEFAULT_PROFILE_ID,
  schemaCatalogs: [],
  promptTemplates: [],
  financialEngineMode: "legacy"
};
function mergeSettings(current, patch) {
  return {
    ...current,
    ...patch,
    gemini: {
      ...current.gemini,
      ...patch.gemini
    },
    sql: {
      ...current.sql,
      ...patch.sql
    },
    sqlSecurity: {
      ...current.sqlSecurity,
      ...patch.sqlSecurity
    },
    ssh: {
      ...current.ssh,
      ...patch.ssh
    },
    mobileBridge: {
      ...current.mobileBridge,
      ...patch.mobileBridge
    },
    telemetry: {
      ...current.telemetry,
      ...patch.telemetry
    },
    connectionProfile: {
      ...current.connectionProfile,
      ...patch.connectionProfile
    },
    connectionProfiles: patch.connectionProfiles ? [...patch.connectionProfiles] : [...current.connectionProfiles],
    activeConnectionProfileId: patch.activeConnectionProfileId ?? current.activeConnectionProfileId,
    schemaCatalogs: patch.schemaCatalogs ? [...patch.schemaCatalogs] : [...current.schemaCatalogs],
    promptTemplates: patch.promptTemplates ? [...patch.promptTemplates] : [...current.promptTemplates]
  };
}
function isTruthyEnvValue(value) {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
function shouldStartAgentDebugServer(params) {
  const env = params.env ?? process.env;
  return params.isAgentDebugServerOnly || isTruthyEnvValue(env["ACC_ENABLE_AGENT_DEBUG_SERVER"]);
}
function resolveAgentDebugToken(env = process.env) {
  const token = env["ACC_AGENT_DEBUG_TOKEN"]?.trim();
  return token ? token : null;
}
const ENCRYPTED_PREFIX = "accassist:enc:v1:";
function isDemoProfileEnabled(env = process.env) {
  return isTruthyEnvValue(env.ACC_ENABLE_DEMO_PROFILE);
}
function resolveForcedSqlOverride(env = process.env) {
  const override = {};
  if (isDemoProfileEnabled(env)) {
    const demoPort = Number.parseInt(env.ACC_DEMO_SQL_PORT ?? "58033", 10);
    override.server = env.ACC_DEMO_SQL_SERVER ?? "127.0.0.1";
    override.port = Number.isFinite(demoPort) ? demoPort : 58033;
    override.database = env.ACC_DEMO_SQL_DATABASE ?? "Sepidar01";
    override.user = env.ACC_DEMO_SQL_USER ?? "damavand";
    override.password = env.ACC_DEMO_SQL_PASSWORD ?? "damavand";
    override.encrypt = isTruthyEnvValue(env.ACC_DEMO_SQL_ENCRYPT);
    override.trustServerCertificate = isTruthyEnvValue(env.ACC_DEMO_SQL_TRUST_SERVER_CERTIFICATE);
  }
  if (env.ACC_SQL_SERVER !== void 0) {
    override.server = env.ACC_SQL_SERVER;
  }
  if (env.ACC_SQL_PORT !== void 0) {
    const explicitPort = Number.parseInt(env.ACC_SQL_PORT, 10);
    if (Number.isFinite(explicitPort)) {
      override.port = explicitPort;
    }
  }
  if (env.ACC_SQL_DATABASE !== void 0) {
    override.database = env.ACC_SQL_DATABASE;
  }
  if (env.ACC_SQL_USER !== void 0) {
    override.user = env.ACC_SQL_USER;
  }
  if (env.ACC_SQL_PASSWORD !== void 0) {
    override.password = env.ACC_SQL_PASSWORD;
  }
  if (env.ACC_SQL_ENCRYPT !== void 0) {
    override.encrypt = isTruthyEnvValue(env.ACC_SQL_ENCRYPT);
  }
  if (env.ACC_SQL_TRUST_SERVER_CERTIFICATE !== void 0) {
    override.trustServerCertificate = isTruthyEnvValue(env.ACC_SQL_TRUST_SERVER_CERTIFICATE);
  }
  return Object.keys(override).length > 0 ? override : null;
}
function resolveForcedGeminiOverride(env = process.env) {
  if (!isDemoProfileEnabled(env)) {
    return null;
  }
  const mode = env.ACC_DEMO_GEMINI_MODE === "google" ? "google" : "openai";
  return {
    apiKey: env.ACC_DEMO_GEMINI_API_KEY ?? "aa-aDiE3jyTPH5opHafdpUc5d4c2mJU2NS96YisP3FXlcs46ANI",
    baseUrl: env.ACC_DEMO_GEMINI_BASE_URL ?? "https://api.avalai.ir/v1",
    mode,
    model: env.ACC_DEMO_GEMINI_MODEL ?? "gemini-2.5-flash"
  };
}
class SettingsStore {
  filePath;
  cache = mergeSettings(DEFAULT_SETTINGS, {});
  warnedEncryptionUnavailable = false;
  constructor(filePath) {
    this.filePath = filePath ?? node_path.join(electron.app.getPath("userData"), "acc-assist.settings.json");
  }
  async load() {
    try {
      const raw = await promises.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const merged = mergeSettings(DEFAULT_SETTINGS, parsed);
      const normalized = this.normalizeConnectionProfiles(this.decryptSensitiveFields(merged));
      this.cache = this.applyForcedTestSqlProfile(normalized);
      await this.persist();
    } catch (error) {
      const fileError = error;
      if (fileError.code !== "ENOENT") {
        console.warn("[SettingsStore] Failed to read settings file. Recreating defaults.", error);
      }
      this.cache = this.applyForcedTestSqlProfile(this.normalizeConnectionProfiles(mergeSettings(DEFAULT_SETTINGS, {})));
      await this.persist();
    }
    return this.cache;
  }
  get() {
    return this.cache;
  }
  async save(patch) {
    const merged = mergeSettings(this.cache, patch);
    const normalized = this.normalizeConnectionProfiles(merged, patch);
    this.cache = this.applyForcedTestSqlProfile(normalized);
    await this.persist();
    return this.cache;
  }
  applyForcedTestSqlProfile(settings) {
    const sqlOverride = resolveForcedSqlOverride();
    const geminiOverride = resolveForcedGeminiOverride();
    const demoEnabled = isDemoProfileEnabled();
    if (!sqlOverride && !geminiOverride) {
      return settings;
    }
    return {
      ...settings,
      gemini: geminiOverride ? {
        ...settings.gemini,
        ...geminiOverride
      } : settings.gemini,
      sql: sqlOverride ? {
        ...settings.sql,
        ...sqlOverride
      } : settings.sql,
      sqlSecurity: demoEnabled ? {
        ...settings.sqlSecurity,
        enforceReadOnlyLogin: false
      } : settings.sqlSecurity,
      connectionProfiles: sqlOverride ? settings.connectionProfiles.map((profile) => ({
        ...profile,
        sql: {
          ...profile.sql,
          ...sqlOverride
        }
      })) : settings.connectionProfiles
    };
  }
  async persist() {
    await promises.mkdir(node_path.dirname(this.filePath), { recursive: true });
    const encrypted = this.encryptSensitiveFields(this.cache);
    await promises.writeFile(this.filePath, JSON.stringify(encrypted, null, 2), "utf8");
  }
  encryptSensitiveFields(settings) {
    const snapshot = mergeSettings(DEFAULT_SETTINGS, settings);
    snapshot.gemini.apiKey = this.encryptIfPossible(snapshot.gemini.apiKey);
    snapshot.sql.password = this.encryptIfPossible(snapshot.sql.password);
    snapshot.ssh.password = this.encryptIfPossible(snapshot.ssh.password);
    snapshot.ssh.privateKey = this.encryptIfPossible(snapshot.ssh.privateKey);
    snapshot.ssh.passphrase = this.encryptIfPossible(snapshot.ssh.passphrase);
    snapshot.telemetry.bearerToken = this.encryptIfPossible(snapshot.telemetry.bearerToken);
    snapshot.connectionProfiles = snapshot.connectionProfiles.map((profile) => ({
      ...profile,
      sql: {
        ...profile.sql,
        password: this.encryptIfPossible(profile.sql.password)
      },
      ssh: {
        ...profile.ssh,
        password: this.encryptIfPossible(profile.ssh.password),
        privateKey: this.encryptIfPossible(profile.ssh.privateKey),
        passphrase: this.encryptIfPossible(profile.ssh.passphrase)
      }
    }));
    return snapshot;
  }
  decryptSensitiveFields(settings) {
    return {
      ...settings,
      gemini: {
        ...settings.gemini,
        apiKey: this.decryptIfNeeded(settings.gemini.apiKey)
      },
      sql: {
        ...settings.sql,
        password: this.decryptIfNeeded(settings.sql.password)
      },
      ssh: {
        ...settings.ssh,
        password: this.decryptIfNeeded(settings.ssh.password),
        privateKey: this.decryptIfNeeded(settings.ssh.privateKey),
        passphrase: this.decryptIfNeeded(settings.ssh.passphrase)
      },
      telemetry: {
        ...settings.telemetry,
        bearerToken: this.decryptIfNeeded(settings.telemetry.bearerToken)
      },
      connectionProfiles: settings.connectionProfiles.map((profile) => ({
        ...profile,
        sql: {
          ...profile.sql,
          password: this.decryptIfNeeded(profile.sql.password)
        },
        ssh: {
          ...profile.ssh,
          password: this.decryptIfNeeded(profile.ssh.password),
          privateKey: this.decryptIfNeeded(profile.ssh.privateKey),
          passphrase: this.decryptIfNeeded(profile.ssh.passphrase)
        }
      }))
    };
  }
  normalizeConnectionProfiles(settings, patch) {
    const base = mergeSettings(DEFAULT_SETTINGS, settings);
    const normalizedPromptTemplates = this.normalizePromptTemplates(base.promptTemplates);
    const incomingProfiles = Array.isArray(base.connectionProfiles) ? base.connectionProfiles : [];
    const profiles = [];
    const profileIds = /* @__PURE__ */ new Set();
    for (let index = 0; index < incomingProfiles.length; index += 1) {
      const currentProfile = incomingProfiles[index];
      if (!currentProfile || typeof currentProfile !== "object") {
        continue;
      }
      const normalizedProfile = this.normalizeSingleProfile(currentProfile, index);
      let uniqueId = normalizedProfile.id;
      while (profileIds.has(uniqueId)) {
        uniqueId = `${normalizedProfile.id}-${index + 1}`;
      }
      profileIds.add(uniqueId);
      profiles.push({
        ...normalizedProfile,
        id: uniqueId
      });
    }
    if (profiles.length === 0) {
      const fallbackProfile = this.createProfileFromSnapshot(base, "default-profile");
      profiles.push(fallbackProfile);
      profileIds.add(fallbackProfile.id);
    }
    let activeConnectionProfileId = base.activeConnectionProfileId?.trim() || profiles[0].id;
    if (!profiles.some((profile) => profile.id === activeConnectionProfileId)) {
      activeConnectionProfileId = profiles[0].id;
    }
    if (patch?.activeConnectionProfileId?.trim()) {
      const patchedId = patch.activeConnectionProfileId.trim();
      if (profiles.some((profile) => profile.id === patchedId)) {
        activeConnectionProfileId = patchedId;
      }
    }
    let activeIndex = profiles.findIndex((profile) => profile.id === activeConnectionProfileId);
    if (activeIndex < 0) {
      activeIndex = 0;
      activeConnectionProfileId = profiles[0].id;
    }
    let activeProfile = profiles[activeIndex];
    if (patch?.connectionProfile) {
      activeProfile = {
        ...activeProfile,
        metadata: {
          ...activeProfile.metadata,
          ...base.connectionProfile
        }
      };
    }
    if (patch?.sql) {
      activeProfile = {
        ...activeProfile,
        sql: {
          ...base.sql
        }
      };
    }
    if (patch?.ssh) {
      activeProfile = {
        ...activeProfile,
        ssh: {
          ...base.ssh
        }
      };
    }
    profiles[activeIndex] = activeProfile;
    return {
      ...base,
      sql: {
        ...activeProfile.sql
      },
      sqlSecurity: {
        ...DEFAULT_SETTINGS.sqlSecurity,
        ...base.sqlSecurity
      },
      ssh: {
        ...activeProfile.ssh
      },
      connectionProfile: {
        ...activeProfile.metadata
      },
      connectionProfiles: profiles,
      activeConnectionProfileId,
      promptTemplates: normalizedPromptTemplates
    };
  }
  normalizeSingleProfile(profile, index) {
    const fallbackProfile = this.createProfileFromSnapshot(DEFAULT_SETTINGS, `profile-${index + 1}`);
    const normalizedId = profile.id?.trim() || fallbackProfile.id;
    const normalizedSql = {
      ...DEFAULT_SETTINGS.sql,
      ...profile.sql
    };
    const normalizedSsh = {
      ...DEFAULT_SETTINGS.ssh,
      ...profile.ssh
    };
    const normalizedType = profile.metadata?.type === "ssh" ? "ssh" : "direct";
    const normalizedMetadata = {
      ...DEFAULT_SETTINGS.connectionProfile,
      ...profile.metadata,
      type: normalizedType
    };
    return {
      id: normalizedId,
      metadata: normalizedMetadata,
      sql: normalizedSql,
      ssh: normalizedSsh
    };
  }
  createProfileFromSnapshot(settings, id) {
    return {
      id,
      metadata: {
        ...settings.connectionProfile
      },
      sql: {
        ...settings.sql
      },
      ssh: {
        ...settings.ssh
      }
    };
  }
  normalizePromptTemplates(templates) {
    if (!Array.isArray(templates)) {
      return [];
    }
    const normalized = [];
    const ids = /* @__PURE__ */ new Set();
    for (const template of templates) {
      if (!template || typeof template !== "object") {
        continue;
      }
      const typedTemplate = template;
      const id = typeof typedTemplate.id === "string" ? typedTemplate.id.trim() : "";
      const label = typeof typedTemplate.label === "string" ? typedTemplate.label.trim() : "";
      const prompt = typeof typedTemplate.prompt === "string" ? typedTemplate.prompt.trim() : "";
      if (!id || !label || !prompt || ids.has(id)) {
        continue;
      }
      const createdAt = typeof typedTemplate.createdAt === "string" && typedTemplate.createdAt.trim() ? typedTemplate.createdAt.trim() : void 0;
      const updatedAt = typeof typedTemplate.updatedAt === "string" && typedTemplate.updatedAt.trim() ? typedTemplate.updatedAt.trim() : void 0;
      const isSystem = Boolean(typedTemplate.isSystem);
      ids.add(id);
      normalized.push({
        id,
        label,
        prompt,
        createdAt,
        updatedAt,
        isSystem
      });
      if (normalized.length >= 30) {
        break;
      }
    }
    return normalized;
  }
  encryptIfPossible(value) {
    if (!value) {
      return "";
    }
    if (value.startsWith(ENCRYPTED_PREFIX)) {
      return value;
    }
    if (!this.isSafeStorageEncryptionAvailable()) {
      this.warnEncryptionUnavailable();
      return value;
    }
    try {
      const encryptedBuffer = electron.safeStorage.encryptString(value);
      return `${ENCRYPTED_PREFIX}${encryptedBuffer.toString("base64")}`;
    } catch (error) {
      console.warn("[SettingsStore] Unable to encrypt value with safeStorage. Falling back to plain text.", error);
      return value;
    }
  }
  decryptIfNeeded(value) {
    if (!value) {
      return "";
    }
    if (!value.startsWith(ENCRYPTED_PREFIX)) {
      return value;
    }
    if (!this.isSafeStorageEncryptionAvailable()) {
      this.warnEncryptionUnavailable();
      return value;
    }
    try {
      const cipherText = value.slice(ENCRYPTED_PREFIX.length);
      const encryptedBuffer = Buffer.from(cipherText, "base64");
      return electron.safeStorage.decryptString(encryptedBuffer);
    } catch (error) {
      console.warn("[SettingsStore] Unable to decrypt value with safeStorage. Returning empty string.", error);
      return "";
    }
  }
  warnEncryptionUnavailable() {
    if (this.warnedEncryptionUnavailable) {
      return;
    }
    this.warnedEncryptionUnavailable = true;
    console.warn(
      "[SettingsStore] safeStorage encryption is unavailable on this system. Sensitive values will be stored as plain text."
    );
  }
  isSafeStorageEncryptionAvailable() {
    if (!electron.safeStorage || typeof electron.safeStorage.isEncryptionAvailable !== "function") {
      return false;
    }
    try {
      return electron.safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }
}
const LOCAL_HOST = "127.0.0.1";
const SHUTDOWN_TIMEOUT_MS = 1500;
class SshTunnelService {
  client = null;
  server = null;
  activeSockets = /* @__PURE__ */ new Set();
  stopPromise = null;
  status = {
    active: false,
    localHost: LOCAL_HOST,
    localPort: null,
    message: "Tunnel is not started"
  };
  getStatus() {
    return this.status;
  }
  async start(config) {
    if (!config.enabled) {
      await this.stop("SSH tunnel is disabled by settings");
      return this.status;
    }
    this.validateConfig(config);
    await this.stop("Restarting tunnel with new configuration");
    const client = new ssh2.Client();
    let server = null;
    try {
      await this.connectClient(client, config);
      server = this.createForwardServer(client, config);
      const localPort = await this.listenServer(server, config.localPort ?? 0);
      this.attachRuntimeListeners(client, server);
      this.client = client;
      this.server = server;
      this.status = {
        active: true,
        localHost: LOCAL_HOST,
        localPort,
        message: `تونل فعال شد: ${LOCAL_HOST}:${localPort} -> ${config.dstHost}:${config.dstPort}`
      };
      return this.status;
    } catch (error) {
      await this.disposeTransientResources(server, client);
      const message = error instanceof Error ? error.message : String(error);
      const persianMessage = this.translateSshError(message);
      this.status = {
        active: false,
        localHost: LOCAL_HOST,
        localPort: null,
        message: `خطا در برقراری تونل SSH: ${persianMessage}`
      };
      throw new Error(`امکان برقراری تونل SSH وجود ندارد: ${persianMessage}`);
    }
  }
  translateSshError(message) {
    const lower = message.toLowerCase();
    if (lower.includes("all configured authentication methods failed")) {
      return "احراز هویت ناموفق بود. نام کاربری، رمز عبور یا کلید خصوصی را بررسی کنید.";
    }
    if (lower.includes("timed out while waiting for handshake")) {
      return "زمان انتظار برای دست‌تکانی (Handshake) به پایان رسید. وضعیت شبکه یا پورت را بررسی کنید.";
    }
    if (lower.includes("econnrefused")) {
      return "اتصال توسط سرور مقصد رد شد. پورت SSH یا فایروال سرور را بررسی کنید.";
    }
    if (lower.includes("enotfound") || lower.includes("getaddrinfo")) {
      return "آدرس سرور SSH پیدا نشد. لطفاً Hostname را بررسی کنید.";
    }
    if (lower.includes("unsupported key type")) {
      return "قالب کلید خصوصی (Private Key) پشتیبانی نمی‌شود.";
    }
    if (lower.includes("encrypted private key")) {
      return "کلید خصوصی رمزگذاری شده است. لطفاً Passphrase را وارد کنید.";
    }
    return message;
  }
  async stop(message = "Tunnel stopped") {
    if (this.stopPromise) {
      await this.stopPromise;
      this.status = {
        active: false,
        localHost: LOCAL_HOST,
        localPort: null,
        message
      };
      return this.status;
    }
    this.stopPromise = this.stopInternal(message);
    try {
      return await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }
  async stopInternal(message) {
    const server = this.server;
    const client = this.client;
    this.server = null;
    this.client = null;
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();
    if (server) {
      await this.closeServer(server);
    }
    if (client) {
      await this.closeClient(client);
    }
    this.status = {
      active: false,
      localHost: LOCAL_HOST,
      localPort: null,
      message
    };
    return this.status;
  }
  validateConfig(config) {
    if (!config.host.trim()) {
      throw new Error("آدرس سرور SSH وارد نشده است.");
    }
    if (!config.username.trim()) {
      throw new Error("نام کاربری SSH وارد نشده است.");
    }
    if (!config.dstHost.trim()) {
      throw new Error("آدرس مقصد نهایی (Database Host) وارد نشده است.");
    }
    if (config.dstPort <= 0) {
      throw new Error("پورت مقصد نهایی باید عددی بزرگتر از صفر باشد.");
    }
    const hasPrivateKey = config.privateKey.trim().length > 0;
    const hasPassword = config.password.trim().length > 0;
    if (!hasPrivateKey && !hasPassword) {
      throw new Error("رمز عبور یا کلید خصوصی (Private Key) برای اتصال SSH الزامی است.");
    }
  }
  createForwardServer(client, config) {
    return net.createServer((socket) => {
      this.activeSockets.add(socket);
      socket.setNoDelay(true);
      socket.once("close", () => {
        this.activeSockets.delete(socket);
      });
      socket.on("error", () => {
        socket.destroy();
      });
      client.forwardOut(
        socket.remoteAddress ?? LOCAL_HOST,
        socket.remotePort ?? 0,
        config.dstHost,
        config.dstPort,
        (error, stream) => {
          if (error) {
            socket.destroy(new Error(`SSH forwardOut failed: ${error.message}`));
            return;
          }
          stream.setNoDelay(true);
          stream.on("error", () => socket.destroy());
          stream.on("close", () => socket.end());
          socket.pipe(stream).pipe(socket);
        }
      );
    });
  }
  listenServer(server, port) {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        resolve(address?.port ?? port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, LOCAL_HOST);
    });
  }
  attachRuntimeListeners(client, server) {
    client.on("error", (error) => {
      if (this.client !== client) {
        return;
      }
      void this.stop(`SSH client error: ${error.message}`);
    });
    client.on("close", () => {
      if (this.client !== client) {
        return;
      }
      void this.stop("SSH client closed");
    });
    server.on("error", (error) => {
      if (this.server !== server) {
        return;
      }
      void this.stop(`SSH local forward server error: ${error.message}`);
    });
  }
  async closeServer(server) {
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };
      server.close(() => done());
      setTimeout(done, SHUTDOWN_TIMEOUT_MS);
    });
  }
  async closeClient(client) {
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };
      client.once("close", done);
      client.once("end", done);
      try {
        client.end();
      } catch {
        done();
      }
      setTimeout(() => {
        try {
          client.destroy();
        } catch {
        }
        done();
      }, SHUTDOWN_TIMEOUT_MS);
    });
  }
  async disposeTransientResources(server, client) {
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();
    if (server) {
      await this.closeServer(server);
    }
    await this.closeClient(client);
  }
  connectClient(client, config) {
    const connectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: config.readyTimeoutMs,
      keepaliveInterval: config.keepaliveIntervalMs
    };
    if (config.privateKey.trim().length > 0) {
      connectConfig.privateKey = this.normalizePrivateKey(config.privateKey);
      if (config.passphrase.trim().length > 0) {
        connectConfig.passphrase = config.passphrase;
      }
    } else {
      connectConfig.password = config.password;
    }
    return new Promise((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("SSH connection closed before becoming ready"));
      };
      const cleanup = () => {
        client.off("ready", onReady);
        client.off("error", onError);
        client.off("close", onClose);
      };
      client.on("ready", onReady);
      client.on("error", onError);
      client.on("close", onClose);
      client.connect(connectConfig);
    });
  }
  normalizePrivateKey(privateKey) {
    return privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey;
  }
}
let electronApp;
try {
  const electron2 = require("electron");
  electronApp = electron2.app;
} catch {
  electronApp = void 0;
}
const LEVEL_WEIGHT = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50
};
const DEFAULT_TELEMETRY_CONFIG = {
  enabled: false,
  ingestUrl: "",
  bearerToken: "",
  logLevel: "debug",
  flushIntervalMs: 5e3,
  requestTimeoutMs: 8e3,
  maxBatchSize: 25,
  maxQueueSize: 5e3,
  includeRendererErrors: true,
  retentionDays: 30
};
const MAX_TEXT_LENGTH = 8e3;
function redactSensitiveText(value) {
  const patterns = [
    { regex: /\b\d{10}\b/g, label: "REDACTED:NATIONAL_CODE" },
    { regex: /\b09\d{9}\b/g, label: "REDACTED:PHONE" },
    { regex: /\b\d{16}\b/g, label: "REDACTED:ACCOUNT_NUMBER" },
    { regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g, label: "REDACTED:IBAN" },
    { regex: /\bBearer\s+[A-Za-z0-9._-]+/gi, label: "REDACTED:BEARER_TOKEN" },
    { regex: /\bsecret-token\b/gi, label: "REDACTED:SECRET" },
    { regex: /\b(api[_-]?key|token|password)\s*[:=]\s*['"][^'"]+['"]/gi, label: "REDACTED:SECRET" },
    { regex: /\b(Authorization)\s*[:=]\s*['"][^'"]+['"]/gi, label: "REDACTED:AUTH_HEADER" }
  ];
  let redacted = value;
  for (const { regex, label } of patterns) {
    redacted = redacted.replace(regex, label);
  }
  return redacted;
}
function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSensitiveText(error.message),
      stack: redactSensitiveText(error.stack ?? ""),
      cause: error.cause
    };
  }
  return {
    message: typeof error === "string" ? redactSensitiveText(error) : redactSensitiveText(String(error))
  };
}
function normalizeText(value) {
  if (value == null) {
    return "";
  }
  const text = redactSensitiveText(String(value));
  if (text.length <= MAX_TEXT_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_TEXT_LENGTH)}...`;
}
function sanitizeDetails(value) {
  if (value == null) {
    return {};
  }
  const seen = /* @__PURE__ */ new WeakSet();
  const replacer = (_key, currentValue) => {
    if (typeof currentValue === "bigint") {
      return currentValue.toString();
    }
    if (typeof currentValue === "function") {
      return `[function ${currentValue.name || "anonymous"}]`;
    }
    if (currentValue instanceof Error) {
      return serializeError(currentValue);
    }
    if (typeof currentValue === "string") {
      return normalizeText(currentValue);
    }
    if (currentValue && typeof currentValue === "object") {
      const objectValue = currentValue;
      if (seen.has(objectValue)) {
        return "[circular]";
      }
      seen.add(objectValue);
    }
    return currentValue;
  };
  try {
    const serialized = JSON.stringify(value, replacer);
    if (!serialized) {
      return {};
    }
    const parsed = JSON.parse(serialized);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {
      value: parsed
    };
  } catch {
    return {
      value: normalizeText(value)
    };
  }
}
function normalizeLogLevel(level) {
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }
  return "debug";
}
class TelemetryIngestService {
  queueFilePath;
  eventLogFilePath;
  config = { ...DEFAULT_TELEMETRY_CONFIG };
  queue = [];
  loaded = false;
  flushing = false;
  flushTimer = null;
  constructor(queueFilePath, eventLogFilePath) {
    const userDataDir = electronApp?.getPath?.("userData") ?? process.env.APPDATA ?? os.tmpdir();
    const logsDir = node_path.join(userDataDir, "logs");
    this.queueFilePath = queueFilePath ?? node_path.join(logsDir, "telemetry-queue.ndjson");
    this.eventLogFilePath = eventLogFilePath ?? node_path.join(logsDir, "telemetry-events.ndjson");
  }
  configure(configPatch) {
    const merged = {
      ...this.config,
      ...configPatch,
      logLevel: normalizeLogLevel(configPatch?.logLevel ?? this.config.logLevel)
    };
    this.config = {
      enabled: Boolean(merged.enabled),
      ingestUrl: normalizeText(merged.ingestUrl).trim(),
      bearerToken: normalizeText(merged.bearerToken).trim(),
      logLevel: merged.logLevel,
      flushIntervalMs: Math.min(Math.max(Number(merged.flushIntervalMs) || 5e3, 1e3), 6e4),
      requestTimeoutMs: Math.min(Math.max(Number(merged.requestTimeoutMs) || 8e3, 1e3), 6e4),
      maxBatchSize: Math.min(Math.max(Number(merged.maxBatchSize) || 25, 1), 200),
      maxQueueSize: Math.min(Math.max(Number(merged.maxQueueSize) || 5e3, 100), 5e4),
      includeRendererErrors: Boolean(merged.includeRendererErrors),
      retentionDays: Math.max(1, Math.trunc(Number(merged.retentionDays) || DEFAULT_TELEMETRY_CONFIG.retentionDays))
    };
    this.ensureLoaded();
    this.pruneExpiredEvents();
    this.scheduleFlushTimer();
    if (this.queue.length > 0) {
      void this.flushNow("config-updated");
    }
  }
  capture(input) {
    this.ensureLoaded();
    const level = input.level ?? "info";
    if (!this.shouldCaptureLevel(level)) {
      return;
    }
    if ((input.process ?? "main") === "renderer" && !this.config.includeRendererErrors) {
      return;
    }
    const event = this.buildEvent(input);
    this.appendToEventLog(event);
    this.queue.push(event);
    this.pruneExpiredEvents();
    if (this.queue.length > this.config.maxQueueSize) {
      const dropped = this.queue.length - this.config.maxQueueSize;
      this.queue = this.queue.slice(-this.config.maxQueueSize);
      this.appendInternalEvent("warn", "telemetry.queue", "queue-trimmed", {
        dropped,
        maxQueueSize: this.config.maxQueueSize
      });
    }
    this.persistQueue();
    if (level === "error" || level === "fatal") {
      void this.flushNow("high-severity-event");
    }
  }
  captureError(category, event, error, processType = "main", details) {
    const errorDetails = serializeError(error);
    this.capture({
      level: "error",
      category,
      event,
      process: processType,
      message: normalizeText(errorDetails.message),
      details: {
        ...details,
        error: errorDetails
      }
    });
  }
  async flushNow(reason = "manual") {
    this.ensureLoaded();
    if (this.flushing || this.queue.length === 0) {
      return;
    }
    if (!this.canSend()) {
      return;
    }
    this.flushing = true;
    try {
      const batch = this.queue.slice(0, this.config.maxBatchSize);
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, this.config.requestTimeoutMs);
      let responseOk = false;
      let responseStatus = 0;
      let responseText = "";
      try {
        const response = await fetch(this.config.ingestUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.bearerToken}`,
            "Content-Type": "application/json; charset=utf-8"
          },
          body: JSON.stringify(batch),
          signal: controller.signal
        });
        responseOk = response.ok;
        responseStatus = response.status;
        if (!response.ok) {
          responseText = normalizeText(await response.text());
        }
      } finally {
        clearTimeout(timeout);
      }
      if (!responseOk) {
        this.appendInternalEvent("warn", "telemetry.ingest", "remote-send-failed", {
          reason,
          status: responseStatus,
          responseText,
          queueSize: this.queue.length,
          attemptedBatchSize: batch.length
        });
        return;
      }
      this.queue = this.queue.slice(batch.length);
      this.persistQueue();
      this.appendInternalEvent("debug", "telemetry.ingest", "remote-send-success", {
        reason,
        sent: batch.length,
        remaining: this.queue.length
      });
    } catch (error) {
      this.appendInternalEvent("warn", "telemetry.ingest", "remote-send-error", {
        reason,
        queueSize: this.queue.length,
        error: serializeError(error)
      });
    } finally {
      this.flushing = false;
    }
  }
  async queryEvents(request) {
    this.ensureLoaded();
    this.pruneExpiredEvents();
    const fromTime = request?.from ? new Date(request.from).getTime() : null;
    const toTime = request?.to ? new Date(request.to).getTime() : null;
    const requestedLimit = Math.min(Math.max(Number(request?.limit) || 100, 1), 500);
    const cursor = request?.cursor ? String(request.cursor).trim() : null;
    const filtered = this.eventLogEntries().filter((entry) => {
      if (fromTime !== null && new Date(entry.timestamp).getTime() < fromTime) {
        return false;
      }
      if (toTime !== null && new Date(entry.timestamp).getTime() > toTime) {
        return false;
      }
      if (request?.requestId && entry.requestId !== request.requestId) {
        return false;
      }
      if (request?.conversationId && entry.conversationId !== request.conversationId) {
        return false;
      }
      if (request?.category && entry.category !== request.category) {
        return false;
      }
      if (cursor) {
        const [cursorTimestamp, cursorId] = cursor.split("|");
        const entryTime = new Date(entry.timestamp).getTime();
        const cursorTime = Number(cursorTimestamp) || 0;
        if (entryTime < cursorTime || entryTime === cursorTime && entry.id <= cursorId) {
          return false;
        }
      }
      return true;
    });
    filtered.sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id));
    const total = filtered.length;
    const page = filtered.slice(0, requestedLimit);
    const next = page.length > 0 && page.length < total ? `${new Date(page[page.length - 1]?.timestamp ?? 0).getTime()}|${page[page.length - 1]?.id ?? ""}` : null;
    return {
      entries: page.map((entry) => ({
        id: entry.id,
        timestamp: entry.timestamp,
        level: entry.level,
        category: entry.category,
        event: entry.event,
        process: entry.process,
        message: entry.message,
        requestId: entry.requestId,
        conversationId: entry.conversationId,
        correlationId: entry.correlationId
      })),
      total,
      nextCursor: next
    };
  }
  async shutdown(reason = "shutdown") {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushNow(reason);
  }
  buildEvent(input) {
    const level = input.level ?? "info";
    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      category: normalizeText(input.category || "general").slice(0, 120),
      event: normalizeText(input.event || "event").slice(0, 120),
      process: input.process ?? "main",
      appVersion: electronApp?.getVersion?.() ?? "0.0.0",
      platform: process.platform,
      arch: process.arch,
      message: input.message ? normalizeText(input.message) : void 0,
      details: input.details ? sanitizeDetails(input.details) : void 0,
      requestId: input.requestId ? normalizeText(input.requestId).trim() || void 0 : void 0,
      conversationId: input.conversationId ? normalizeText(input.conversationId).trim() || void 0 : void 0,
      correlationId: input.correlationId ? normalizeText(input.correlationId).trim() || void 0 : void 0
    };
  }
  shouldCaptureLevel(level) {
    const threshold = LEVEL_WEIGHT[this.config.logLevel];
    return LEVEL_WEIGHT[level] >= threshold;
  }
  canSend() {
    return Boolean(this.config.enabled && this.config.ingestUrl && this.config.bearerToken);
  }
  eventLogEntries() {
    try {
      const raw = node_fs.readFileSync(this.eventLogFilePath, "utf8");
      return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((item) => Boolean(item.id && item.timestamp));
    } catch {
      return [];
    }
  }
  pruneExpiredEvents() {
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1e3;
    const pruneList = (items) => items.filter((item) => new Date(item.timestamp).getTime() >= cutoff);
    const eventEntries = pruneList(this.eventLogEntries());
    if (eventEntries.length !== this.eventLogEntries().length) {
      node_fs.writeFileSync(this.eventLogFilePath, eventEntries.map((item) => JSON.stringify(item)).join("\n") + (eventEntries.length ? "\n" : ""), "utf8");
    }
    const queueEntries = pruneList(this.queue);
    if (queueEntries.length !== this.queue.length) {
      this.queue = queueEntries;
      this.persistQueue();
    }
  }
  ensureLoaded() {
    if (this.loaded) {
      return;
    }
    node_fs.mkdirSync(node_path.dirname(this.queueFilePath), { recursive: true });
    try {
      const raw = node_fs.readFileSync(this.queueFilePath, "utf8");
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const parsed = [];
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (!event.id || !event.event || !event.category) {
            continue;
          }
          parsed.push({
            id: String(event.id),
            timestamp: String(event.timestamp || (/* @__PURE__ */ new Date()).toISOString()),
            level: event.level || "info",
            category: String(event.category),
            event: String(event.event),
            process: event.process === "renderer" ? "renderer" : "main",
            appVersion: String(event.appVersion || electronApp?.getVersion?.() || "0.0.0"),
            platform: event.platform || process.platform,
            arch: String(event.arch || process.arch),
            message: event.message ? String(event.message) : void 0,
            details: event.details ? sanitizeDetails(event.details) : void 0,
            requestId: event.requestId ? String(event.requestId) : void 0,
            conversationId: event.conversationId ? String(event.conversationId) : void 0,
            correlationId: event.correlationId ? String(event.correlationId) : void 0
          });
        } catch {
          continue;
        }
      }
      this.queue = parsed;
    } catch {
      this.queue = [];
      this.persistQueue();
    }
    this.loaded = true;
  }
  scheduleFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.canSend()) {
      return;
    }
    this.flushTimer = setInterval(() => {
      void this.flushNow("periodic");
    }, this.config.flushIntervalMs);
    this.flushTimer.unref();
  }
  appendToEventLog(event) {
    node_fs.mkdirSync(node_path.dirname(this.eventLogFilePath), { recursive: true });
    node_fs.appendFileSync(this.eventLogFilePath, `${JSON.stringify(event)}
`, "utf8");
  }
  appendInternalEvent(level, category, event, details) {
    if (!this.shouldCaptureLevel(level)) {
      return;
    }
    const payload = this.buildEvent({
      level,
      category,
      event,
      process: "main",
      details
    });
    this.appendToEventLog(payload);
  }
  persistQueue() {
    const serialized = this.queue.map((item) => JSON.stringify(item)).join("\n");
    const withTrailingNewline = serialized ? `${serialized}
` : "";
    node_fs.writeFileSync(this.queueFilePath, withTrailingNewline, "utf8");
  }
}
class UpdateManager {
  telemetry;
  updater = null;
  status;
  constructor(telemetry, currentVersion = electron.app.getVersion()) {
    this.telemetry = telemetry;
    this.status = {
      enabled: false,
      currentVersion,
      channel: "latest",
      autoDownload: false,
      state: "disabled",
      latestVersion: null,
      downloadedVersion: null,
      lastCheckedAt: null,
      lastError: null
    };
  }
  async start(options) {
    this.status = {
      ...this.status,
      enabled: options.enabled,
      channel: options.channel,
      autoDownload: options.autoDownload,
      state: options.enabled ? "idle" : "disabled"
    };
    if (!options.enabled) {
      this.telemetry.capture({
        process: "main",
        level: "info",
        category: "release.update",
        event: "disabled",
        details: {
          reason: "opt-in-disabled"
        }
      });
      return;
    }
    try {
      const updaterModule = await import("electron-updater");
      const autoUpdater = updaterModule.autoUpdater;
      autoUpdater.autoDownload = options.autoDownload;
      autoUpdater.allowDowngrade = true;
      autoUpdater.channel = options.channel;
      this.attachEventHandlers(autoUpdater);
      this.updater = autoUpdater;
      this.telemetry.capture({
        process: "main",
        level: "info",
        category: "release.update",
        event: "initialized",
        details: {
          channel: options.channel,
          autoDownload: options.autoDownload
        }
      });
    } catch (error) {
      this.status = {
        ...this.status,
        state: "error",
        lastError: error instanceof Error ? error.message : String(error)
      };
      this.telemetry.captureError("release.update", "initialize-failed", error, "main", {
        channel: options.channel
      });
    }
  }
  getStatus() {
    return { ...this.status };
  }
  async checkForUpdates() {
    if (!this.status.enabled || !this.updater) {
      return this.getStatus();
    }
    this.status = {
      ...this.status,
      state: "checking",
      lastError: null,
      lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.status = {
        ...this.status,
        state: "error",
        lastError: error instanceof Error ? error.message : String(error)
      };
      this.telemetry.captureError("release.update", "check-failed", error, "main", {
        channel: this.status.channel
      });
    }
    return this.getStatus();
  }
  installDownloadedUpdate() {
    if (!this.status.enabled || !this.updater || this.status.state !== "downloaded") {
      return false;
    }
    this.telemetry.capture({
      process: "main",
      level: "info",
      category: "release.update",
      event: "install-requested",
      details: {
        downloadedVersion: this.status.downloadedVersion,
        channel: this.status.channel
      }
    });
    this.updater.quitAndInstall();
    return true;
  }
  attachEventHandlers(updater) {
    updater.on("checking-for-update", () => {
      this.status = {
        ...this.status,
        state: "checking",
        lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString(),
        lastError: null
      };
    });
    updater.on("update-available", (...args) => {
      const info = args[0];
      this.status = {
        ...this.status,
        state: "update-available",
        latestVersion: info?.version ?? null,
        lastError: null
      };
      this.telemetry.capture({
        process: "main",
        level: "info",
        category: "release.update",
        event: "update-available",
        details: {
          latestVersion: info?.version ?? null,
          channel: this.status.channel
        }
      });
    });
    updater.on("update-not-available", (...args) => {
      const info = args[0];
      this.status = {
        ...this.status,
        state: "update-not-available",
        latestVersion: info?.version ?? this.status.currentVersion,
        downloadedVersion: null,
        lastError: null
      };
    });
    updater.on("update-downloaded", (...args) => {
      const info = args[0];
      this.status = {
        ...this.status,
        state: "downloaded",
        latestVersion: info?.version ?? this.status.latestVersion,
        downloadedVersion: info?.version ?? this.status.downloadedVersion,
        lastError: null
      };
      this.telemetry.capture({
        process: "main",
        level: "info",
        category: "release.update",
        event: "update-downloaded",
        details: {
          downloadedVersion: info?.version ?? null,
          channel: this.status.channel
        }
      });
    });
    updater.on("error", (error) => {
      this.status = {
        ...this.status,
        state: "error",
        lastError: error instanceof Error ? error.message : String(error)
      };
      this.telemetry.captureError("release.update", "runtime-error", error, "main", {
        channel: this.status.channel
      });
    });
  }
}
const icon = path.join(__dirname, "../../resources/icon.png");
const settingsStore = new SettingsStore();
const sqlConnectionManager = new SqlConnectionManager();
const sshTunnelService = new SshTunnelService();
const geminiClient = new GeminiClient();
const mobileBridgeServer = new MobileBridgeServer();
const schemaDiscoveryService = new SchemaDiscoveryService();
const auditLogService = new AuditLogService();
const reportExportService = new ReportExportService();
const telemetryIngestService = new TelemetryIngestService();
const agentDebugServer = new AgentDebugServer();
const updateManager = new UpdateManager(telemetryIngestService);
const agentOrchestrator = new AgentOrchestrator({
  geminiClient,
  getSettings: () => settingsStore.get(),
  executeReadOnlySql: async (query, signal) => {
    const saved = settingsStore.get();
    const runtimeConnection = await resolveRuntimeSqlConnection(saved.sql, saved.ssh);
    return sqlConnectionManager.executeReadOnlyQuery(runtimeConnection, query, "agent-data", signal, {
      enforceReadOnlyLogin: saved.sqlSecurity.enforceReadOnlyLogin,
      forbidWildcardSelect: saved.sqlSecurity.forbidWildcardSelect,
      requireOrderByWhenLimited: saved.sqlSecurity.requireOrderByWhenLimited,
      blockQueryHints: saved.sqlSecurity.blockQueryHints
    });
  },
  executeMetadataSql: async (query, signal) => {
    const saved = settingsStore.get();
    const runtimeConnection = await resolveRuntimeSqlConnection(saved.sql, saved.ssh);
    return sqlConnectionManager.executeReadOnlyQuery(runtimeConnection, query, "metadata", signal);
  },
  auditLog: auditLogService,
  mobileBridge: mobileBridgeServer
});
let mainWindow = null;
const AGENT_DEBUG_HOST = "127.0.0.1";
const AGENT_DEBUG_PORT = 3322;
const isAgentDebugServerOnly = process.argv.includes("--agent-debug-server-only");
const isAgentDebugServerEnabled = shouldStartAgentDebugServer({
  isAgentDebugServerOnly
});
let cleanupPromise = null;
let cleanupCompleted = false;
let quittingAfterCleanup = false;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    ...process.platform === "linux" ? { icon } : {},
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("unresponsive", () => {
    telemetryIngestService.capture({
      process: "main",
      level: "error",
      category: "renderer.health",
      event: "window-unresponsive"
    });
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    telemetryIngestService.capture({
      process: "main",
      level: isMainFrame ? "error" : "warn",
      category: "renderer.health",
      event: "did-fail-load",
      message: errorDescription,
      details: {
        errorCode,
        validatedURL,
        isMainFrame
      }
    });
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    telemetryIngestService.captureError("renderer.health", "preload-error", error, "main", {
      preloadPath
    });
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(node_path.join(__dirname, "../renderer/index.html"));
  }
}
function ok(data) {
  return {
    ok: true,
    data
  };
}
function failWithContext(error, channel) {
  telemetryIngestService.captureError("ipc.handler", channel, error, "main");
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  };
}
function registerCrashObservers() {
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    telemetryIngestService.captureError("process.crash", "uncaught-exception", error, "main", {
      origin
    });
    void telemetryIngestService.flushNow("uncaught-exception");
  });
  process.on("unhandledRejection", (reason) => {
    telemetryIngestService.captureError("process.crash", "unhandled-rejection", reason, "main");
    void telemetryIngestService.flushNow("unhandled-rejection");
  });
  process.on("warning", (warning) => {
    telemetryIngestService.capture({
      process: "main",
      level: "warn",
      category: "process.warning",
      event: warning.name || "warning",
      message: warning.message,
      details: {
        stack: warning.stack
      }
    });
  });
  electron.app.on("render-process-gone", (_event, webContents, details) => {
    telemetryIngestService.capture({
      process: "main",
      level: details.reason === "clean-exit" ? "warn" : "fatal",
      category: "process.crash",
      event: "render-process-gone",
      message: details.reason,
      details: {
        exitCode: details.exitCode,
        url: webContents.getURL(),
        webContentsId: webContents.id
      }
    });
  });
  electron.app.on("child-process-gone", (_event, details) => {
    telemetryIngestService.capture({
      process: "main",
      level: details.reason === "clean-exit" ? "warn" : "error",
      category: "process.crash",
      event: "child-process-gone",
      message: details.reason,
      details: {
        exitCode: details.exitCode,
        name: details.name,
        serviceName: details.serviceName,
        type: details.type
      }
    });
  });
}
function isSameSchemaCatalog(entry, profileId, databaseName) {
  return entry.profileId === profileId && entry.databaseName.trim().toLowerCase() === databaseName.trim().toLowerCase();
}
const SUPPORTED_SCHEMA_DATE_MODES = [
  "unknown",
  "gregorian",
  "shamsiText",
  "shamsiNumeric",
  "fiscalPeriod",
  "mixed"
];
function normalizeSchemaDateMode(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (SUPPORTED_SCHEMA_DATE_MODES.includes(trimmed)) {
    return trimmed;
  }
  return null;
}
function normalizeAccountingSoftwareId(value) {
  if (value === "sepidar" || value === "mahak") {
    return value;
  }
  return null;
}
function resolveReleaseUpdateChannel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "alpha" || normalized === "beta" || normalized === "rc" || normalized === "latest") {
    return normalized;
  }
  return "latest";
}
async function resolveRuntimeSqlConnection(connection, sshConfig) {
  if (!sshConfig?.enabled) {
    return connection;
  }
  const tunnelStatus = await sshTunnelService.start(sshConfig);
  if (!tunnelStatus.active || !tunnelStatus.localPort) {
    throw new Error(tunnelStatus.message);
  }
  return {
    ...connection,
    server: tunnelStatus.localHost,
    port: tunnelStatus.localPort
  };
}
function registerIpcHandlers() {
  electron.ipcMain.handle("settings:get", async () => {
    return ok(settingsStore.get());
  });
  electron.ipcMain.handle(
    "settings:save",
    async (_, patch) => {
      try {
        const updated = await settingsStore.save(patch);
        const shouldResetSqlRuntime = Boolean(patch.sql) || Boolean(patch.ssh) || Boolean(patch.activeConnectionProfileId) || Boolean(patch.connectionProfiles);
        if (shouldResetSqlRuntime) {
          await sqlConnectionManager.close();
        }
        if (patch.ssh) {
          await sshTunnelService.stop("SSH tunnel reconfigured from settings");
        }
        telemetryIngestService.configure(updated.telemetry);
        if (!updated.mobileBridge.enabled) {
          await mobileBridgeServer.stop();
        } else {
          await mobileBridgeServer.start(updated.mobileBridge);
        }
        if (!updated.ssh.enabled) {
          await sshTunnelService.stop("SSH tunnel disabled from settings");
        }
        return ok(updated);
      } catch (error) {
        return failWithContext(error, "settings:save");
      }
    }
  );
  electron.ipcMain.handle(
    "sql:list-databases",
    async (_, payload) => {
      try {
        const saved = settingsStore.get();
        const connection = payload?.connection ?? saved.sql;
        const ssh = payload?.ssh ?? saved.ssh;
        const runtimeConnection = await resolveRuntimeSqlConnection(connection, ssh);
        const databases = await sqlConnectionManager.listDatabases(runtimeConnection);
        return ok(databases);
      } catch (error) {
        return failWithContext(error, "sql:list-databases");
      }
    }
  );
  electron.ipcMain.handle(
    "sql:health-check",
    async (_, payload) => {
      try {
        const saved = settingsStore.get();
        const connection = payload?.connection ?? saved.sql;
        const ssh = payload?.ssh ?? saved.ssh;
        const runtimeConnection = await resolveRuntimeSqlConnection(connection, ssh);
        const healthCheck = await sqlConnectionManager.getHealthCheck(runtimeConnection);
        return ok(healthCheck);
      } catch (error) {
        return failWithContext(error, "sql:health-check");
      }
    }
  );
  electron.ipcMain.handle(
    "schema:discover",
    async (_, payload) => {
      try {
        const saved = settingsStore.get();
        const connection = payload?.connection ?? saved.sql;
        const ssh = payload?.ssh ?? saved.ssh;
        const runtimeConnection = await resolveRuntimeSqlConnection(connection, ssh);
        const profileId = payload?.profileId?.trim() || saved.activeConnectionProfileId;
        const requestedDatabase = payload?.databaseName?.trim() || connection.database.trim();
        const previousCatalog = saved.schemaCatalogs.find(
          (entry) => isSameSchemaCatalog(entry, profileId, requestedDatabase)
        );
        const preservedSelectedSoftwareId = normalizeAccountingSoftwareId(previousCatalog?.selectedSoftwareId);
        const hasSelectedSoftwareId = payload ? Object.prototype.hasOwnProperty.call(payload, "selectedSoftwareId") : false;
        const selectedSoftwareId = hasSelectedSoftwareId ? normalizeAccountingSoftwareId(payload?.selectedSoftwareId) : preservedSelectedSoftwareId;
        const discoveredCatalog = await schemaDiscoveryService.discoverCatalog({
          profileId,
          databaseName: requestedDatabase,
          softwareOverrideId: selectedSoftwareId,
          previousSelectedMappings: previousCatalog?.selectedMappings ?? {},
          executeSql: async (query) => {
            return sqlConnectionManager.executeReadOnlyQuery(runtimeConnection, query, "discovery");
          }
        });
        const resolvedPreviousCatalog = previousCatalog ?? saved.schemaCatalogs.find(
          (entry) => isSameSchemaCatalog(entry, discoveredCatalog.profileId, discoveredCatalog.databaseName)
        );
        const preservedSelectedDateMode = normalizeSchemaDateMode(resolvedPreviousCatalog?.selectedDateMode);
        const fallbackSelectedSoftwareId = normalizeAccountingSoftwareId(resolvedPreviousCatalog?.selectedSoftwareId);
        const effectiveSelectedSoftwareId = hasSelectedSoftwareId ? selectedSoftwareId : fallbackSelectedSoftwareId;
        const catalogToSave = {
          ...discoveredCatalog,
          selectedMappings: resolvedPreviousCatalog?.selectedMappings ?? {},
          selectedSoftwareId: effectiveSelectedSoftwareId,
          selectedDateMode: preservedSelectedDateMode
        };
        const mergedCatalogs = [
          catalogToSave,
          ...saved.schemaCatalogs.filter(
            (entry) => !isSameSchemaCatalog(entry, catalogToSave.profileId, catalogToSave.databaseName)
          )
        ].slice(0, 30);
        const updated = await settingsStore.save({
          schemaCatalogs: mergedCatalogs
        });
        return ok({
          catalog: catalogToSave,
          schemaCatalogs: updated.schemaCatalogs
        });
      } catch (error) {
        return failWithContext(error, "schema:discover");
      }
    }
  );
  electron.ipcMain.handle(
    "schema:get-catalog",
    async (_, payload) => {
      try {
        const saved = settingsStore.get();
        const profileId = payload?.profileId?.trim() || saved.activeConnectionProfileId;
        const databaseName = payload?.databaseName?.trim() || saved.sql.database.trim();
        const catalog = saved.schemaCatalogs.find((entry) => isSameSchemaCatalog(entry, profileId, databaseName)) ?? null;
        return ok(catalog);
      } catch (error) {
        return failWithContext(error, "schema:get-catalog");
      }
    }
  );
  electron.ipcMain.handle(
    "schema:update-mappings",
    async (_, payload) => {
      try {
        const saved = settingsStore.get();
        const profileId = payload?.profileId?.trim() || saved.activeConnectionProfileId;
        const databaseName = payload?.databaseName?.trim() || saved.sql.database.trim();
        if (!profileId || !databaseName) {
          throw new Error("Profile and database are required to update schema mappings.");
        }
        const existingCatalog = saved.schemaCatalogs.find(
          (entry) => isSameSchemaCatalog(entry, profileId, databaseName)
        );
        if (!existingCatalog) {
          throw new Error("No schema catalog found for the selected profile and database.");
        }
        const normalizedMappings = Object.entries(payload?.selectedMappings ?? {}).reduce((acc, [conceptKey, tableRef]) => {
          if (typeof tableRef !== "string") {
            return acc;
          }
          const trimmed = tableRef.trim();
          if (!trimmed) {
            return acc;
          }
          acc[conceptKey] = trimmed;
          return acc;
        }, {});
        const hasSelectedDateMode = payload ? Object.prototype.hasOwnProperty.call(payload, "selectedDateMode") : false;
        const selectedDateMode = hasSelectedDateMode ? normalizeSchemaDateMode(payload?.selectedDateMode) : normalizeSchemaDateMode(existingCatalog.selectedDateMode);
        const hasSelectedSoftwareId = payload ? Object.prototype.hasOwnProperty.call(payload, "selectedSoftwareId") : false;
        const selectedSoftwareId = hasSelectedSoftwareId ? normalizeAccountingSoftwareId(payload?.selectedSoftwareId) : normalizeAccountingSoftwareId(existingCatalog.selectedSoftwareId);
        const updatedCatalog = {
          ...existingCatalog,
          selectedMappings: normalizedMappings,
          selectedSoftwareId,
          selectedDateMode
        };
        const mergedCatalogs = [
          updatedCatalog,
          ...saved.schemaCatalogs.filter((entry) => !isSameSchemaCatalog(entry, profileId, databaseName))
        ].slice(0, 30);
        const updatedSettings = await settingsStore.save({
          schemaCatalogs: mergedCatalogs
        });
        return ok({
          catalog: updatedCatalog,
          schemaCatalogs: updatedSettings.schemaCatalogs
        });
      } catch (error) {
        return failWithContext(error, "schema:update-mappings");
      }
    }
  );
  electron.ipcMain.handle("ssh:start", async (_, config) => {
    try {
      const tunnelStatus = await sshTunnelService.start(config ?? settingsStore.get().ssh);
      return ok(tunnelStatus);
    } catch (error) {
      return failWithContext(error, "ssh:start");
    }
  });
  electron.ipcMain.handle("ssh:stop", async () => {
    try {
      const tunnelStatus = await sshTunnelService.stop("SSH tunnel stopped by user");
      return ok(tunnelStatus);
    } catch (error) {
      return failWithContext(error, "ssh:stop");
    }
  });
  electron.ipcMain.handle("ssh:status", async () => {
    return ok(sshTunnelService.getStatus());
  });
  electron.ipcMain.handle(
    "sql:test-connection",
    async (_, payload) => {
      try {
        const saved = settingsStore.get();
        const connection = payload?.connection ?? saved.sql;
        const ssh = payload?.ssh ?? saved.ssh;
        const runtimeConnection = await resolveRuntimeSqlConnection(connection, ssh);
        const message = await sqlConnectionManager.testConnection(runtimeConnection);
        return ok(message);
      } catch (error) {
        return failWithContext(error, "sql:test-connection");
      }
    }
  );
  electron.ipcMain.handle("sql:execute-query", async (_, query) => {
    try {
      const saved = settingsStore.get();
      const runtimeConnection = await resolveRuntimeSqlConnection(saved.sql, saved.ssh);
      const rows = await sqlConnectionManager.executeReadOnlyQuery(runtimeConnection, query, "generic", void 0, {
        enforceReadOnlyLogin: saved.sqlSecurity.enforceReadOnlyLogin,
        forbidWildcardSelect: saved.sqlSecurity.forbidWildcardSelect,
        requireOrderByWhenLimited: saved.sqlSecurity.requireOrderByWhenLimited,
        blockQueryHints: saved.sqlSecurity.blockQueryHints
      });
      return ok(rows);
    } catch (error) {
      return failWithContext(error, "sql:execute-query");
    }
  });
  electron.ipcMain.handle("sql:disconnect", async () => {
    try {
      await sqlConnectionManager.close();
      return ok(true);
    } catch (error) {
      return failWithContext(error, "sql:disconnect");
    }
  });
  electron.ipcMain.handle("gemini:chat", async (_, payload) => {
    try {
      const response = await geminiClient.chat(payload, settingsStore.get().gemini);
      return ok(response);
    } catch (error) {
      return failWithContext(error, "gemini:chat");
    }
  });
  electron.ipcMain.handle(
    "agent:send-message",
    async (event, payload) => {
      try {
        const requestId = payload.requestId?.trim() || `req-${Date.now()}`;
        const conversationId = payload.conversationId?.trim() || `conv-${Date.now()}`;
        const result = await agentOrchestrator.sendMessage(
          {
            ...payload,
            requestId,
            conversationId
          },
          (progressEvent) => {
            const envelope = {
              requestId,
              event: progressEvent
            };
            event.sender.send("agent:event", envelope);
          }
        );
        return ok(result);
      } catch (error) {
        return failWithContext(error, "agent:send-message");
      }
    }
  );
  electron.ipcMain.handle(
    "agent:cancel-message",
    async (_, payload) => {
      try {
        const requestId = payload.requestId?.trim() || "";
        if (!requestId) {
          throw new Error("requestId is required to cancel an agent request.");
        }
        const cancelled = agentOrchestrator.cancelMessage(requestId, payload.reason);
        return ok({ cancelled });
      } catch (error) {
        return failWithContext(error, "agent:cancel-message");
      }
    }
  );
  electron.ipcMain.handle(
    "audit:list",
    async (_, payload) => {
      try {
        const result = await auditLogService.query(payload);
        return ok(result);
      } catch (error) {
        return failWithContext(error, "audit:list");
      }
    }
  );
  electron.ipcMain.handle(
    "report:export",
    async (_, payload) => {
      try {
        const result = await reportExportService.exportReport(mainWindow, payload);
        return ok(result);
      } catch (error) {
        return failWithContext(error, "report:export");
      }
    }
  );
  electron.ipcMain.handle(
    "telemetry:capture-renderer-event",
    async (_, payload) => {
      try {
        telemetryIngestService.capture({
          process: "renderer",
          level: payload.level ?? "error",
          category: payload.category?.trim() || "renderer.runtime",
          event: payload.event?.trim() || "renderer-event",
          message: payload.message,
          details: {
            stack: payload.stack,
            ...payload.details ?? {}
          }
        });
        return ok(true);
      } catch (error) {
        return failWithContext(error, "telemetry:capture-renderer-event");
      }
    }
  );
  electron.ipcMain.handle("mobile-bridge:status", async () => {
    return ok(mobileBridgeServer.getStatus());
  });
  electron.ipcMain.handle("release:get-update-status", async () => {
    return ok(updateManager.getStatus());
  });
  electron.ipcMain.handle("release:check-updates", async () => {
    try {
      const status = await updateManager.checkForUpdates();
      return ok(status);
    } catch (error) {
      return failWithContext(error, "release:check-updates");
    }
  });
  electron.ipcMain.handle("release:install-downloaded-update", async () => {
    try {
      return ok(updateManager.installDownloadedUpdate());
    } catch (error) {
      return failWithContext(error, "release:install-downloaded-update");
    }
  });
}
async function cleanupServices() {
  if (cleanupCompleted) {
    return;
  }
  if (cleanupPromise) {
    return cleanupPromise;
  }
  cleanupPromise = (async () => {
    telemetryIngestService.capture({
      process: "main",
      level: "info",
      category: "app.lifecycle",
      event: "cleanup-services"
    });
    await Promise.allSettled([
      sqlConnectionManager.close(),
      sshTunnelService.stop("Application is closing"),
      agentDebugServer.stop(),
      mobileBridgeServer.stop(),
      telemetryIngestService.shutdown("application-closing")
    ]);
    cleanupCompleted = true;
  })();
  return cleanupPromise;
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId("com.acc-assist.desktop");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  void (async () => {
    await settingsStore.load();
    telemetryIngestService.configure(settingsStore.get().telemetry);
    await updateManager.start({
      enabled: process.env.ACC_ENABLE_AUTO_UPDATE === "1",
      channel: resolveReleaseUpdateChannel(process.env.ACC_AUTO_UPDATE_CHANNEL),
      autoDownload: process.env.ACC_AUTO_UPDATE_AUTO_DOWNLOAD === "1"
    });
    telemetryIngestService.capture({
      process: "main",
      level: "info",
      category: "app.lifecycle",
      event: "app-ready"
    });
    registerIpcHandlers();
    const mobileBridgeConfig = settingsStore.get().mobileBridge;
    if (mobileBridgeConfig.enabled) {
      try {
        await mobileBridgeServer.start(mobileBridgeConfig);
      } catch (error) {
        console.error("Unable to start mobile bridge server:", error);
        telemetryIngestService.captureError("mobile-bridge", "start-failed", error, "main");
      }
    }
    const agentDebugToken = resolveAgentDebugToken();
    if (isAgentDebugServerEnabled && agentDebugToken) {
      try {
        await agentDebugServer.start({
          host: AGENT_DEBUG_HOST,
          port: AGENT_DEBUG_PORT,
          token: agentDebugToken,
          sendMessage: async (payload, onProgress) => {
            return agentOrchestrator.sendMessage(payload, onProgress);
          }
        });
        telemetryIngestService.capture({
          process: "main",
          level: "info",
          category: "agent.debug-server",
          event: "started",
          details: {
            host: AGENT_DEBUG_HOST,
            port: AGENT_DEBUG_PORT,
            enabled: true
          }
        });
      } catch (error) {
        telemetryIngestService.captureError("agent.debug-server", "start-failed", error, "main", {
          host: AGENT_DEBUG_HOST,
          port: AGENT_DEBUG_PORT
        });
      }
    } else {
      telemetryIngestService.capture({
        process: "main",
        level: "info",
        category: "agent.debug-server",
        event: "disabled",
        details: {
          reason: isAgentDebugServerEnabled ? "missing-token" : "opt-in-disabled"
        }
      });
    }
    if (!isAgentDebugServerOnly) {
      createWindow();
    }
  })();
  electron.app.on("activate", function() {
    if (isAgentDebugServerOnly) {
      return;
    }
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !isAgentDebugServerOnly) {
    electron.app.quit();
  }
});
electron.app.on("before-quit", (event) => {
  if (cleanupCompleted || quittingAfterCleanup) {
    return;
  }
  event.preventDefault();
  void cleanupServices().finally(() => {
    quittingAfterCleanup = true;
    electron.app.quit();
  });
});
registerCrashObservers();
