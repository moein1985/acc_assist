# FRE Roadmap 07 — فاز ۹: Production Hardening، Shadow Run و حذفِ Legacy
### پایداریِ طولانی‌مدت + حذفِ کدِ مرده + monitoring

> پیش‌نیاز: فاز ۸ کامل و سبز. ۱۵ متریک + MultiMetric + متریک‌های مشتق در engine mode. این فاز سه کار می‌کند: (الف) shadow run طولانی‌مدت در production، (ب) حذفِ فیزیکیِ کد legacy، (ج) monitoring و بهینه‌سازی.

**مارکرهای asar این فاز:** `LEGACY_REMOVED`, `SHADOW_CLEAN_2W`, `ENGINE_MONITOR`.

---

## ۰ — نقشهٔ فاز

| بخش | موضوع | مدت |
|---|---|---|
| الف | Shadow run طولانی‌مدت (۲ هفته) | ۲ هفته |
| ب | حذفِ فیزیکیِ کد legacy | کوچک |
| ج | Monitoring و بهینه‌سازی | متوسط |

---

## بخش الف — Shadow Run طولانی‌مدت

> هدف: اطمینان از اینکه engine و legacy در ۲ هفتهِ production واقعی، **۰ mismatch** دارند. این معیارِ پذیرشِ شمارهٔ ۵ فاز ۰.۹ است.

### S9.1 — اسکریپتِ mismatch report

- [x] **S9.1** در `scripts/ops/shadow-mismatch-report.ts` اسکریپتی بساز که `agent-audit.log` را parse کند:
  - خطوطِ `engine-shadow-compare` را استخراج کن.
  - گروه‌بندی بر اساسِ `metricId` و تاریخ.
  - خروجی: جدولِ `metricId | date | legacyValue | engineValue | match`.
  - در انتها: `total mismatches: N`.
  - **معیارِ پذیرش:** اسکریپت اجرا می‌شود و خروجیِ جدولی می‌دهد. `npm run shadow:report` در `package.json` اضافه شود.

### S9.2 — فعال‌سازی shadow در production

- [ ] **S9.2** روی remote (192.168.85.56) `ACC_FINANCIAL_ENGINE_MODE` را به `shadow` تغییر بده:
  - در `settings.json` کاربر + متغیرِ محیطی.
  - سرویس را restart کن.
  - **معیارِ پذیرش:** audit log خطوطِ `engine-shadow-compare` نشان می‌دهد. `requestId` و timestamp ثبت شود.

### S9.3 — نظارتِ روزانه (روز ۱ تا ۷)

- [ ] **S9.3** هر روز `npm run shadow:report` را اجرا کن و تعدادِ mismatch را ثبت کن:
  - روز ۱: mismatches = ?
  - روز ۲: mismatches = ?
  - ...
  - روز ۷: mismatches = ?
  - اگر mismatch پیدا شد: ریشه‌یابی کن، اصلاح کن، shadow را از نو شروع کن.
  - **معیارِ پذیرش:** گزارشِ روزانه در «شاهد S9» ثبت شود. تعدادِ mismatch در روز ۷ باید ۰ باشد.

### S9.4 — نظارتِ روزانه (روز ۸ تا ۱۴)

- [ ] **S9.4** ادامهٔ نظارت:
  - روز ۸ تا ۱۴: mismatches = ?
  - **معیارِ پذیرش:** در روز ۱۴، تعدادِ mismatch در کلِ ۲ هفته = ۰ (یا تمامِ mismatchها ریشه‌یابی و اصلاح شده‌اند).

### S9.5 — سوییچ به engine پس از shadow تمیز

- [ ] **S9.5** پس از ۲ هفته shadow تمیز (۰ mismatch):
  - `ACC_FINANCIAL_ENGINE_MODE` را به `engine` تغییر بده.
  - سرویس را restart کن.
  - field test: ۳ متریک را در engine mode تست کن و اعداد را با oracle تطبیق بده.
  - **معیارِ پذیرش:** engine mode فعال. field test با verdict=ok. `requestId` ثبت شود.

---

## بخش ب — حذفِ فیزیکیِ کد Legacy

> هدف: حذفِ همهٔ کدِ DEPRECATED از `src/`. کد در git history باقی می‌ماند.

### S9.6 — فهرستِ کاملِ فایل‌های受到影响

- [ ] **S9.6** قبل از حذف، فهرستِ کاملی از تمامِ ارجاعاتِ legacy تهیه کن:
  ```bash
  grep -rn "get_purchase_summary\|get_trial_balance\|get_cash_bank_balance\|get_account_balance\|count_fiscal_years\|list_fiscal_years\|get_party_balance\|get_receivables_summary\|get_payables_summary\|get_cashflow_summary\|get_sales_summary_by_period\|get_account_turnover\|get_recent_or_suspicious_documents" src/
  ```
  - خروجی را در یک فایلِ موقت ثبت کن.
  - **معیارِ پذیرش:** فهرست تهیه شد. هر خط را بررسی کن: آیا ارجاعِ فعال است یا کامنت/تست؟

### S9.7 — حذفِ intent definitions از financialIntentRegistry.ts

- [ ] **S9.7** در `financialIntentRegistry.ts`، تمامِ ورودی‌های DEPRECATED را از `FINANCIAL_INTENT_REGISTRY` حذف کن:
  - `get_account_balance`, `get_cash_bank_balance`, `get_trial_balance`, `get_purchase_summary` (فاز ۶)
  - `count_fiscal_years`, `list_fiscal_years`, `get_party_balance`, `get_receivables_summary`, `get_payables_summary`, `get_cashflow_summary`, `get_sales_summary_by_period`, `get_account_turnover`, `get_recent_or_suspicious_documents` (فاز ۷)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. `grep` برای این idها در `financialIntentRegistry.ts` نباید چیزی پیدا کند.

### S9.8 — حذفِ هندلرها از deterministicTools.ts

- [ ] **S9.8** در `deterministicTools.ts` تابعِ `resolveDeterministicFinancialTool`:
  - تمامِ caseهای مربوط به intentهای حذف‌شده را پاک کن.
  - کامنتِ DEPRECATED (خط ۶۴-۷۱) را پاک کن.
  - hardcoded mappings که به intentهای حذف‌شده ارجاع دارند را پاک کن.
  - **معیارِ پذیرش:** `typecheck:node` تمیز.

### S9.9 — به‌روزرسانی تست‌ها

- [ ] **S9.9** تست‌هایی که به legacy intentها ارجاع دارند را به‌روز کن:
  - اگر تستِ یک intentِ حذف‌شده وجود دارد، آن را به تستِ متریکِ متناظرِ FRE تغییر بده.
  - اگر تستِ رگرسیونِ legacy است و دیگر مرتبط نیست، حذفش کن.
  - **معیارِ پذیرش:** `npm test` سبز. تعدادِ تست‌ها نباید به‌طرزِ غیرعادی کاهش یابد (بیشترِ تست‌ها باید به FRE منتقل شده باشند).

### S9.10 — پاکسازیِ ارجاعاتِ باقی‌مانده

- [ ] **S9.10** دوباره grep بزن:
  ```bash
  grep -rn "get_purchase_summary\|get_trial_balance\|get_cash_bank_balance\|get_account_balance\|count_fiscal_years\|list_fiscal_years\|get_party_balance\|get_receivables_summary\|get_payables_summary\|get_cashflow_summary\|get_sales_summary_by_period\|get_account_turnover\|get_recent_or_suspicious_documents" src/
  ```
  - **معیارِ پذیرش:** خروجی خالی (یا فقط کامنت‌های تاریخی در roadmap‌ها که در `src/` نیستند).

### S9.11 — typecheck + تست + eval کامل

- [ ] **S9.11** `npm run typecheck:node` + `npm test` + `npm run eval:metrics` — همه سبز.
  - **شاهد:** خروجی در «شاهد S9».

### S9.12 — build + deploy + asar-grep

- [ ] **S9.12** `npm run build:win` + deploy روی remote + asar-grep:
  - `LEGACY_REMOVED` مارکر پیدا شود (یک کامنت یا const در کد اضافه کن: `// LEGACY_REMOVED`).
  - `get_purchase_summary` **نباید** در `app.asar` پیدا شود.
  - **شاهد:** خروجیِ asar-grep.

---

## بخش ج — Monitoring و بهینه‌سازی

### S9.13 — اسکریپتِ monitoring

- [x] **S9.13** در `scripts/ops/engine-monitor.ts` اسکریپتی بساز که از `agent-audit.log` متریک‌های runtime استخراج کند:
  - latency per metric (از `durationMs` در خطِ `final`).
  - verdict distribution (ok vs fail).
  - degradation rate (engine → legacy fallback).
  - خروجی: جدولِ خلاصه + نمودارِ متنیِ ساده.
  - `npm run engine:monitor` در `package.json` اضافه شود.
  - **معیارِ پذیرش:** اسکریپت اجرا می‌شود و خروجیِ جدولی می‌دهد.

### S9.14 — cache برای router/planner

- [x] **S9.14** در `router.ts` و `planner.ts` یک cache ساده اضافه کن:
  - کلید: `normalizePersianText(prompt)`.
  - مقدار: نتیجهٔ `routeMetric` یا `buildDeterministicPlan`.
  - TTL: ۵ دقیقه (یا ۱۰۰ ورودی).
  - **معیارِ پذیرش:** `typecheck:node` تمیز + تست سبز. unit test: همان پرامپت دو بار صدا زده شود، دفعهٔ دوم از cache می‌آید.

### S9.15 — timeout برای engine execution

- [x] **S9.15** در `financialEngine/index.ts` تابعِ `run`، یک timeout اضافه کن:
  - اگر `executeReadOnlySql` بیشتر از ۱۵ ثانیه طول کشید، `null` برگردان (degrade به legacy) + audit log: `{stage:'engine-timeout', metricId, durationMs}`.
  - **معیارِ پذیرش:** `typecheck:node` تمیز + unit test با mock executor که timeout می‌دهد.

### S9.16 — بررسیِ SQL با EXPLAIN

- [ ] **S9.16** برای هر ۱۵ متریک، SQLِ تولیدشده را با `SET SHOWPLAN_TEXT ON` (یا `EXPLAIN`) بررسی کن:
  - آیا INDEX استفاده می‌شود؟
  - آیا Table Scan وجود دارد؟
  - اگر INDEX missing است، یک یادداشت در «شاهد S9» ثبت کن و (اختیاری) INDEX را پیشنهاد بده.
  - **معیارِ پذیرش:** گزارشِ EXPLAIN برای هر متریک در «شاهد S9» (یا یادداشتِ «بدونِ مشکل»).

---

## بخش د — دروازهٔ خروجِ فاز ۹

- [ ] **S9.17** ۲ هفته shadow تمیز (۰ mismatch) مستند شده.
  - **شاهد:** گزارشِ روزانه در «شاهد S9».
- [ ] **S9.18** کد legacy فیزیکی حذف شده، تست‌ها سبز.
  - **شاهد:** `grep` خالی در `src/`.
- [ ] **S9.19** monitoring فعال.
  - **شاهد:** خروجیِ `npm run engine:monitor`.
- [ ] **S9.20** `npm run typecheck:node` + `npm test` + `npm run eval:metrics` سبز.
  - **شاهد:** خروجی در «شاهد S9».
- [ ] **S9.21** `npm run build:win` + deploy + asar-grep.
  - **شاهد:** `LEGACY_REMOVED` پیدا شد، `get_purchase_summary` پیدا نشد.
- [ ] **S9.22** ثبتِ شواهد در «شاهد S9».

---

## شاهد S9
```
<پس از تکمیل، این بخش پر شود>

--- Shadow Run (2 weeks) ---
Start date: <date>
End date: <date>
Mode: shadow on remote 192.168.85.56
Day 1: mismatches = <N>
Day 2: mismatches = <N>
...
Day 14: mismatches = <N>
Total mismatches: <N>
Result: CLEAN / <N mismatches fixed>

--- Legacy Removal ---
Files modified:
  - financialIntentRegistry.ts: <N> intents removed
  - deterministicTools.ts: <N> handlers removed
  - <other files>
grep result: <empty or comments only>

--- Monitoring ---
engine:monitor output:
  Metrics served: <N>
  Avg latency: <ms>
  Verdict ok: <N>%
  Degradation rate: <N>%

--- EXPLAIN ---
net_sales: <index used / table scan>
purchases: <...>
...

eval:metrics: <N>/<N> (100%)
tests: <N> pass, 0 fail
typecheck: node + web clean
build:win: success
asar-grep: LEGACY_REMOVED found, get_purchase_summary NOT found
```

> قدمِ بعدی: `FRE_ROADMAP_08_PHASE10_PLANNER.fa.md`.
