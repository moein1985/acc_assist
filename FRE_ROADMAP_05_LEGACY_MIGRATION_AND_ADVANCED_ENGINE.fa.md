# FRE Roadmap 05 — فاز ۷ تا ۱۰: مهاجرتِ کامل، سؤال‌های پیچیده، Production Hardening و Planner پیشرفته
### خروج از تردمیل — همهٔ متریک‌ها در موتورِ نو + سؤال‌های آزاد + پایداریِ production

> پیش‌نیاز: فاز ۶ کامل و سبز. ۶ متریک در `engine` mode فعال، rollback تست شده، ۴ هندلر DEPRECATED. این فایل آخرین مرحلهٔ رسیدن به هدفِ فاز ۰.۱ است: **هیچ هندلرِ دست‌سازی باقی نماند.**

**مارکرهای asar این فاز:** `MULTI_METRIC_PLAN`, `PARTY_BALANCE`, `DERIVED_METRIC`, `LEGACY_REMOVED`.

---

## بخش الف — مهاجرتِ متریک‌های legacy باقی‌مانده (فاز ۷)

> اصل: هر متریک فقط با **یک `MetricDefinition` + یک golden test** اضافه شود. اگر نیاز به تغییرِ compiler بود، اول compiler را generalize کن، بعد متریک را اضافه کن.

### اولویت‌بندیِ مهاجرت (از ساده به پیچیده)

| ترتیب | intent فعلی | MetricId پیشنهادی | نوع | پیچیدگی |
|---|---|---|---|---|
| ۱ | `count_fiscal_years` | `fiscal_year_count` | deterministic (COUNT) | پایین |
| ۲ | `list_fiscal_years` | `fiscal_year_list` | deterministic (SELECT non-aggregate) | پایین |
| ۳ | `get_party_balance` | `party_balance` | deterministic (debit-credit با entityNameMatch) | متوسط |
| ۴ | `get_receivables_summary` | `receivables` | deterministic (SUM با فیلتر Type) | متوسط |
| ۵ | `get_payables_summary` | `payables` | deterministic (SUM با فیلتر Type) | متوسط |
| ۶ | `get_cashflow_summary` | `cashflow` | deterministic (compositeSources) | متوسط |
| ۷ | `get_sales_summary_by_period` | `sales_by_period` | deterministic (grain=by_month/by_quarter) | متوسط |
| ۸ | `get_account_turnover` | `account_turnover` | model-assisted → deterministic با dateRange | بالا |
| ۹ | `get_recent_or_suspicious_documents` | `recent_documents` | non-aggregate (TOP + ORDER BY) | بالا |

### E7.1 — متریک‌های ساده (۱-۲)

- [ ] **E7.1** `fiscal_year_count`: `COUNT(*)` روی `FMK.FiscalYear`. grain: `total`. بدون dimension. اوراکل: تعداد سال‌های مالی موجود.
- [ ] **E7.2** `fiscal_year_list`: `SELECT FiscalYearId, Title FROM FMK.FiscalYear ORDER BY Title`. **نکته:** این متریک non-aggregate است — compiler باید `TOP` اضافه کند. اگر compiler فقط aggregate پشتیبانی می‌کند، یک `kind: 'list'` به `AggregateKind` اضافه کن.
- [ ] **E7.3** golden test برای هر دو + `eval:metrics` سبز.

### E7.2 — متریک‌های متوسط (۳-۷)

- [ ] **E7.4** `party_balance`: `debit_minus_credit` روی `ACC.VoucherItem` با `entityNameMatch` روی `ACC.Partner.Title` (یا جدولِ طرف‌حسابِ متناظر). join جدید: `vi.PartnerRef = p.PartnerId`. اوراکل: ماندهٔ طرف‌حسابِ نمونه.
- [ ] **E7.5** `receivables`: `SUM(Debit) - SUM(Credit)` با فیلتر `Type NOT IN (3,4)` و فیلترِ نوعِ حساب (دریافتنی). ممکن است نیاز به JOIN با `ACC.Account` و فیلتر روی `AccountType` باشد. اوراکل: جمعِ دریافتنی‌ها.
- [ ] **E7.6** `payables`: قرینهٔ receivables. اوراکل: جمعِ پرداختنی‌ها.
- [ ] **E7.7** `cashflow`: `compositeSources` شبیه `cash_bank_balance` ولی با تفکیکِ ورودی/خروجی. ممکن است نیاز به `kind: 'sum_with_sign'` یا فیلترِ `Debit/Credit` باشد. اوراکل: خالصِ جریانِ نقدی.
- [ ] **E7.8** `sales_by_period`: `net_sales` با `grain: 'by_month'` یا `'by_quarter'`. compiler باید `GROUP BY` و `ORDER BY` تولید کند. اگر `by_quarter` نیاز به `DATEPART(QUARTER, ...)` دارد، به `DimensionBinding` اضافه کن.
- [ ] **E7.9** golden test برای هر ۵ متریک + `eval:metrics` سبز.

### E7.3 — متریک‌های پیچیده (۸-۹)

- [ ] **E7.10** `account_turnover`: این متریک **dateRange** دارد (نه فقط year). باید `PlanFilter` از `eq/in` برای تاریخ‌ها گسترش یابد: `op: 'between'` با `startDate/endDate`. compiler باید `WHERE src.Date BETWEEN ... AND ...` تولید کند. اوراکل: گردشِ حسابِ نمونه در بازه.
- [ ] **E7.11** `recent_documents`: **non-aggregate** با `TOP(n)` و `ORDER BY Date DESC`. ممکن است فیلترهای اختیاری داشته باشد (مثل `IsSuspicious=1`). compiler باید `SELECT` غیرتجمیتی با `TOP` پشتیبانی کند (از قبل در policy مجاز است اگر `TOP` باشد).
- [ ] **E7.12** golden test برای هر دو + `eval:metrics` سبز.

### E7.4 — DEPRECATED همهٔ هندلرهای legacy

- [ ] **E7.13** همهٔ ۹ intent باقی‌مانده را در `financialIntentRegistry.ts` به‌عنوان DEPRECATED علامت‌گذاری کن (مثل فاز ۶).
- [ ] **E7.14** فهرستِ نهاییِ legacy inventory را به‌روز کن: همهٔ ۱۵ intent مهاجرت‌شده، ۰ intent legacy-only.
- [ ] **E7.15** typecheck + تست + `eval:metrics` سبز. build + deploy + asar-grep.

---

## بخش ب — سؤال‌های چند-متریکی و grains پیچیده (فاز ۸)

> تا اینجا هر سؤال = یک متریک. حالا سؤال‌هایی مثل «فروش و خرید ۱۴۰۲ رو مقایسه کن» یا «روند ماهانهٔ فروش ۱۴۰۲» را پشتیبانی می‌کنیم.

### E8.1 — MultiMetricPlan

- [ ] **E8.1** در `types.ts`، `MultiMetricPlan` را تعریف کن:
  ```ts
  export interface MultiMetricPlan {
    plans: MetricPlan[]          // ۱ تا N متریک
    joinMode?: 'side_by_side' | 'comparison' | 'trend'
  }
  ```
  - `side_by_side`: هر متریک جدا اجرا، خروجی‌ها کنار هم نمایش.
  - `comparison`: مقایسهٔ دو متریک (مثلاً فروش vs خرید).
  - `trend`: یک متریک در چند grain (مثلاً فروش ماهانه).
- [ ] **E8.2** Planner را گسترش بده تا `MultiMetricPlan` تولید کند. router باید سؤال‌های چند-متریکی را تشخیص دهد (مثلاً «و» / «مقایسه» / «هم» در متن).
- [ ] **E8.3** `FinancialEngine.run` را گسترش بده تا `MultiMetricPlan` را اجرا کند: هر `MetricPlan` جدا compile+exec+verify، سپس نتایج را ترکیب کن.
- [ ] **E8.4** Explainer را برای `MultiMetricPlan` به‌روز کن: جدولِ مقایسه‌ای، نمودارِ روند، یا کنارِ هم.

### E8.2 — Grains واقعی روی DB

- [ ] **E8.5** `by_month` روی DB واقعی تست کن: `GROUP BY MONTH(src.Date), fy.Title` با `ORDER BY`. اوراکل: ۱۲ ردیف برای ۱۴۰۲.
- [ ] **E8.6** `by_quarter` اضافه کن: `GROUP BY DATEPART(QUARTER, src.Date)`. اگر نیاز به `DimensionBinding` جدید است، تعریف کن.
- [ ] **E8.7** `by_customer` اضافه کن: JOIN با `SLS.Customer` (یا جدولِ مشتریِ متناظر). `entityNameMatch` برای فیلترِ مشتری.
- [ ] **E8.8** `by_branch` اضافه کن: JOIN با جدولِ شعبه (اگر در schema وجود دارد).
- [ ] **E8.9** golden test برای هر grain + `eval:metrics` سبز.

### E8.3 — متریک‌های مشتق

- [ ] **E8.10** `DerivedMetric` در `types.ts`:
  ```ts
  export interface DerivedMetric {
    id: string
    titleFa: string
    formula: (results: Record<string, number>) => number
    inputs: MetricId[]                  // متریک‌های پایه
    description: string
  }
  ```
  مثال: `sales_to_purchase_ratio = net_sales / purchases * 100`
- [ ] **E8.11** چند متریکِ مشتقِ پرکاربرد تعریف کن: `sales_to_purchase_ratio`, `gross_margin`, `current_ratio` (دارایی جاری / بدهی جاری).
- [ ] **E8.12** golden test برای متریک‌های مشتق + `eval:metrics` سبز.

### E8.4 — دروازهٔ خروجِ فاز ۸

- [ ] **E8.13** typecheck + تست + `eval:metrics` سبز.
- [ ] **E8.14** field test روی remote: سؤالِ چند-متریکی + grain ماهانه + متریکِ مشتق.
- [ ] **E8.15** build + deploy + asar-grep: `MULTI_METRIC_PLAN` و `DERIVED_METRIC` پیدا شوند.

---

## بخش ج — Production Hardening (فاز ۹)

> هدف: اطمینان از پایداریِ طولانی‌مدت و حذفِ کدِ مرده.

### E9.1 — Shadow run طولانی‌مدت

- [ ] **E9.1** flag را روی production به `shadow` بگذار و **حداقل ۲ هفته** اجرا کن.
- [ ] **E9.2** یک اسکریپتِ `scripts/ops/shadow-mismatch-report.ts` بساز که `agent-audit.log` را parse کند و گزارشِ mismatch بدهد: per-metric, per-day, trend.
- [ ] **E9.3** اگر در ۲ هفته **هرگونه mismatch** پیدا شد، ریشه‌یابی و اصلاح کن. شمارشِ mismatch = 0 شرطِ عبور است.
- [ ] **E9.4** پس از shadowِ تمیزِ ۲ هفته، flag را به `engine` ببر.

### E9.2 — حذفِ فیزیکیِ کدِ legacy

- [ ] **E9.5** هندلرهای DEPRECATED در `deterministicTools.ts` را حذف کن (فقط کدِ ۴ هندلرِ فاز ۶ + ۹ هندلرِ فاز ۷).
- [ ] **E9.6** intent‌های DEPRECATED در `financialIntentRegistry.ts` را حذف کن.
- [ ] **E9.7** hardcoded mappings در `deterministicTools.ts` که به intent‌های حذف‌شده ارجاع دارند را پاک کن.
- [ ] **E9.8** تست‌هایی که به legacy intent‌ها ارجاع دارند را به‌روز کن (یا حذف کن اگر دیگر مرتبط نیستند).
- [ ] **E9.9** typecheck + تست سبز. `grep -r "get_purchase_summary\|get_trial_balance\|get_cash_bank_balance\|get_account_balance"` در `src/` نباید چیزی پیدا کند (جز کامنت‌های تاریخی در roadmap).
- [ ] **E9.10** build + deploy + asar-grep: `LEGACY_REMOVED` مارکر پیدا شود. `get_purchase_summary` **نباید** پیدا شود.

### E9.3 — Monitoring و بهینه‌سازی

- [ ] **E9.11** یک dashboard ساده در `scripts/ops/` بساز که از `agent-audit.log` متریک‌های runtime استخراج کند: latency per metric, verdict distribution, degradation rate.
- [ ] **E9.12** cache برای `routeToMetric` و `buildDeterministicPlan` (اگر همان پرامپت تکرار شد).
- [ ] **E9.13** timeout برای engine execution: اگر engine بیشتر از N ثانیه طول کشید، degrade به legacy + لاگ.
- [ ] **E9.14** بهینه‌سازیِ compiler: SQLهای تولیدشده را با `EXPLAIN` بررسی کن؛ اگر INDEX missing است، مستند کن.

### E9.4 — دروازهٔ خروجِ فاز ۹

- [ ] **E9.15** ۲ هفته shadow تمیز (۰ mismatch) مستند شده.
- [ ] **E9.16** کد legacy فیزیکی حذف شده، تست‌ها سبز.
- [ ] **E9.17** monitoring فعال و dashboard در production.
- [ ] **E9.18** typecheck + تست + `eval:metrics` سبز. build + deploy + asar-grep.

---

## بخش د — Planner مدلی پیشرفته (فاز ۱۰)

> هدف: Planner قطعیِ فعلی برای سؤال‌های ساده عالی است، ولی سؤال‌های آزاد و پیچیده نیاز به Planner مدلیِ قوی‌تر دارند.

### E10.1 — ارتقاءِ Planner

- [ ] **E10.1** پرامپتِ Planner را با few-shot بهبود بده: ۱۰+ مثالِ فارسی → MetricPlan JSON، شامل سؤال‌های چند-متریکی، grain‌های مختلف، و متریک‌های مشتق.
- [ ] **E10.2** `buildModelPlan` را برای `MultiMetricPlan` گسترش بده: مدل باید `plans: MetricPlan[]` تولید کند.
- [ ] **E10.3** Clarify هوشمند: اگر `confidence < threshold`، به‌جای ردِ ساده، یک سؤالِ شفاف‌سازی پیشنهاد بده: «آیا منظورتان فروش خالص بود یا فروش ناخالص؟» با گزینه‌های قابل انتخاب.
- [ ] **E10.4** پشتیبانی از زبانِ محاوره‌ای: «چقدر فروختیم؟» (بدون سال صریح) → Planner باید سالِ جاری را از context استخراج کند یا بپرسد.

### E10.2 — تستِ Planner

- [ ] **E10.5** `tests/unit/financialEnginePlanner.test.ts` را با ۲۰+ موردِ جدید گسترش بده: سؤال‌های چند-متریکی، grain‌های مختلف، محاوره‌ای، مبهم.
- [ ] **E10.6** `eval:metrics` را با مواردِ جدید به‌روز کن: ۴۰+ golden case.
- [ ] **E10.7** field test روی remote: ۱۰ سؤالِ پیچیده + audit log + تأییدِ عددی.

### E10.3 — دروازهٔ خروجِ فاز ۱۰

- [ ] **E10.8** typecheck + تست + `eval:metrics` سبز (۴۰+ cases).
- [ ] **E10.9** field test: همهٔ سؤال‌های پیچیده در engine mode با verdict=ok.
- [ ] **E10.10** build + deploy + asar-grep.
- [ ] **E10.11** مستندسازیِ نهایی: README + technical-summary + memory به‌روز شوند.

---

## بخش ه — معیارِ پذیرشِ نهاییِ کلِ پروژه (به‌روزرسانیِ فاز ۰.۹)

پروژه **واقعاً تمام** است وقتی:

1. ✅ همهٔ ۱۵ متریک (۶ فعلی + ۹ جدید) از طریقِ engine پاسخ می‌دهند.
2. ✅ هیچ هندلرِ legacy‌ای در کد وجود ندارد (فیزیکی حذف شده).
3. ✅ سؤال‌های چند-متریکی و grain‌های پیچیده پشتیبانی می‌شوند.
4. ✅ متریک‌های مشتق (نسبت، رشد) کار می‌کنند.
5. ✅ ۲ هفته shadow تمیز در production.
6. ✅ Planner مدلی برای سؤال‌های آزاد کار می‌کند (۴۰+ golden cases).
7. ✅ monitoring و dashboard فعال.
8. ✅ افزودنِ متریکِ جدید = فقط یک تعریف + یک golden test (اصلِ خروج از تردمیل).

---

## جمع‌بندیِ فاز ۷-۱۰

```mermaid
flowchart LR
    F6[فاز ۶: ۶ متریک + cutover] --> F7[فاز ۷: ۹ متریکِ legacy باقی‌مانده]
    F7 --> F8[فاز ۸: چند-متریکی + grains + مشتق]
    F8 --> F9[فاز ۹: shadow ۲ هفته + حذف legacy + monitoring]
    F9 --> F10[فاز ۱۰: Planner پیشرفته + ۴۰+ golden]
    F10 --> GOAL[هدف: صفر هندلرِ دست‌ساز، همه چیز اعلانی]
```

### ریسک‌ها و mitigations

| ریسک | احتمال | mitigation |
|---|---|---|
| متریک‌های model-assisted (turnover, documents) پیچیده‌تر از انتظار | متوسط | اگر compiler generalize نمی‌شود، مجاز است یک `kind` جدید اضافه شود |
| Shadow run ۲ هفته mismatch پیدا کند | پایین (بعد از فاز ۶) | ریشه‌یابی + اصلاح + تمدیدِ shadow |
| Planner مدلی برای سؤال‌های آزاد ضعیف عمل کند | متوسط | deterministic-first-pass حفظ می‌شود؛ مدل فقط fallback |
| حذفِ legacy باعث رگرسیون شود | پایین | بعد از ۲ هفته shadow تمیز؛ rollback = flag به legacy (کد هنوز در git history) |

### قواعدِ نقض‌ناپذیر (مثل فاز ۰.۶)

1. هیچ تیکی بدونِ شاهدِ واقعی (تست/audit).
2. یک متریک در هر زمان (در فاز ۷).
3. asar-grep بعد از هر deploy.
4. مدل هرگز SQL یا عدد تولید نکند.
5. rollback همیشه یک سوییچِ flag فاصله داشته باشد (تا فاز ۹ که legacy حذف می‌شود).
6. رفتار-حفظ: اعدادِ ground-truth نباید تغییر کنند.

> پایانِ نقشهٔ راهِ ادامه. شروع از `FRE_ROADMAP_00_OVERVIEW.fa.md`.
