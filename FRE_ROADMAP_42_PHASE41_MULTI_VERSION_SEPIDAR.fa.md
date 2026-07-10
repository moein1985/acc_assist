# FRE Roadmap 42 — فاز ۴۱: اثباتِ چند‌نسخه‌ایِ سپیدار
### Multi-Version Sepidar Robustness — «کشف کن، فرض نکن» روی چند نسخهٔ واقعی

> پیش‌نیاز: فاز ۳۹ (سماجت/کشف) + فاز ۴۰ (روتینگِ مقاوم + کورپوس).
> بینش: ایمنیِ چند‌نسخه‌ای عمدتاً **ثمرهٔ سماجت/کشف** (فاز ۳۹) است. این فاز آن را روی **نسخه‌های واقعیِ سپیدار** اثبات و شکاف‌های باقی‌مانده را می‌بندد. تا امروز همه‌چیز فقط روی یک نسخه (`Sepidar01`) اثبات شده — یک ریسکِ واقعی.

**مارکرهای asar این فاز:** `SEPIDAR_VERSION_DETECT`, `SCHEMA_ADAPTIVE_METRICS`, `MULTI_VERSION_PROVEN`.

---

## بخش صفر — تأییدِ دسترسی (گیتِ بحرانیِ اجراپذیری)

> **بازخوردِ GLM (بحرانی):** این فاز به نسخهٔ دومِ واقعیِ سپیدار با **دادهٔ واقعی** وابسته است. بدونِ آن، اثباتِ واقعیِ چند‌نسخه‌ای ممکن نیست و schemaِ خالی برای تستِ اوراکل کافی نیست.

### S41.0 — تأییدِ دسترسی، وگرنه تعویقِ صادقانه
- [x] **S41.0** دسترسی به **۲ دیتابیسِ واقعیِ سپیدار** تأیید شد: `Sepidar01` و `Sepidar03` روی همان سرور (192.168.85.56:58033). هر دو ۴۰۷ جدول، ۱۶ schema. تفاوتِ schema: `Sepidar03` ۵ ستونِ `CostCenterRef` اضافی در `AST` (Assets) دارد. دادهٔ واقعی: Sepidar01 (۱۱ سالِ مالی ۱۳۹۴-۱۴۰۴)، Sepidar03 (۴ سالِ مالی ۱۴۰۲-۱۴۰۵، ۵۹ فاکتور، فروش≈۸۵ میلیارد). **ادامهٔ فاز.**

---

## بخش الف — تشخیصِ نسخه/واریانتِ schema

### S41.1 — شناساییِ نسخه
- [x] **S41.1** `detectSepidarVersion(executeSql)` ساخته شد در `src/main/services/financialEngine/versionDetect.ts`. ۱۲ پروبِ schema fingerprint (CostCenterRef در AST، OrderRef/AgreementRef در SLS.Invoice، وجودِ جدول‌های کلیدی). خروجی: `{ versionId, versionLabel, schemaFingerprint, confidence, features }`. ۹ unit test سبز.
- [x] **S41.2** `agentOrchestrator.ts` نسخه را هنگامِ اتصال تشخیص می‌دهد، در audit log ثبت می‌کند (stage: `calibration-mapping`)، و `versionId` به `getDeploymentId()` پاس می‌شود. `chartOfAccountsMapping.ts` پارامترِ `versionId` را می‌پذیرد و در hashِ deployment ID می‌آورد.

---

## بخش ب — متریکِ schema-adaptive (کشف‌محور، نه فرض‌محور)

> این هستهٔ ایمنیِ چند‌نسخه‌ای است: متریک‌ها نباید نام‌های ثابتِ `Sepidar01` را فرض کنند.

### S41.3 — ممیزیِ فرض‌های ثابت
- [x] **S41.3** ممیزی کامل در `ops/s41-hardcoded-audit.md`. خلاصه: ۷۳ متریک، فقط `net_sales` دارای `conceptSource` است. ۱۰ متریک HIGH risk (RPA.CashBalance، RPA.BankAccountBalance، INV.vwItemStockSummary، AST.Asset/AssetTransaction — ممکن است در همهٔ نسخه‌ها وجود نداشته باشند). ~۲۵ متریک MEDIUM risk (CNT.Project/CostCenter، ACC.Check، enum values مثل `v.Type NOT IN (3,4)`، نام ستون‌ها). ~۳۵ متریک LOW risk (ACC/SLS/FMK هستهٔ ثابت). اولویتِ مهاجرت: HIGH → MEDIUM → LOW.
### S41.4 — نگاشت از طریقِ concept/adapter
- [x] **S41.4** سه مفهومِ جدید به `AccountingConcept` اضافه شد: `fixed_asset`، `asset_transaction`، `inventory_stock_summary`. نگاشتِ جدول و ستون در `SepidarAdapter` برای این مفاهیم + `check`، `cost_center`، `project` تکمیل شد. `conceptSource` برای `net_sales` از فاز ۲۷ موجود است. برای متریک‌های پرریسک (RPA، INV views، AST) مفاهیم آماده شدند تا در فازهای بعدی `conceptSource` به آن‌ها اضافه شود.
- [x] **S41.5** `compileMetricPlan` در `compiler.ts` حالا `resolveDefinition` را در try-catch می‌پیچد. اگر مفهومی روی یک نسخه نگاشت نشد، `CompiledQuery.refusalReason` با پیامِ «این متریک روی این نسخه از سپیدار در دسترس نیست» برمی‌گردد. `index.ts` این refusal را قبل از اجرای SQL چک می‌کند و verdict با reason برمی‌گردد — نه `execution-error`.

**شاهد:** typecheck 0 new errors | unit 577 pass (8 pre-existing fail) | golden 274/274 (100%)

---

## بخش ج — ماتریسِ تستِ چند‌نسخه‌ای (اثباتِ واقعی)

### S41.6 — جمع‌آوریِ schema از نسخه‌های واقعی
- [x] **S41.6** دو نسخهٔ واقعیِ متفاوتِ سپیدار فراهم شد: `Sepidar01` (۱۱ سال مالی، ۲۰۲ فاکتور، ۲۵۸۷۲ سند، ۹۷۳ طرف حساب) و `Sepidar03` (۴ سال مالی، ۰ فاکتور برای ۱۴۰۲، ۵۳ سند، ۱۵ طرف حساب). هر دو روی سرور 192.168.85.56:58033. تفاوتِ schema: Sepidar03 دارای ۵ ستونِ CostCenterRef اضافی در AST.
### S41.7 — اجرای سوییت روی هر نسخه
- [x] **S41.7** متریک‌های Tier 1 روی هر دو نسخه اجرا شد. نتایج:
  - **Sepidar01** (۸ متریک): ۸ MATCH (net_sales, sales_count, purchases, tax_collected, fiscal_year_count, party_count=973, voucher_count=3115, cashflow=9,521,507,066). تمام رفرول‌ها و mismatch‌ها رفع شد (S41.8).
  - **Sepidar03** (۸ متریک): ۲ MATCH (sales_count=0, fiscal_year_count=4)، ۵ REFUSED (net_sales, purchases, tax_collected, cashflow, party_count, voucher_count — دادهٔ خالی یا planner route نشد)، ۱ N/A.
  - روش: Oracle SQL مستقل با sqlcmd + engine query با remote:ask-ai. Sepidar03 ابتدا با machine-level env var `ACC_SQL_DATABASE=Sepidar03` اجرا شد (workaround برای settings persistence bug — بعداً رفع شد، رکوردِ S41.8/4 را ببینید).
  - گزارشِ CSV: `ops/s41-tier1-comparison.csv`.
- [x] **S41.8** تفاوت‌ها ثبت و ریشه‌یابی شد:
  1. **cashflow mismatch (Sepidar01) — رفع شد**: root cause routing بود نه تعریفِ متریک. متریکِ `cashflow` از قبل `RPA.CashBalance + RPA.BankAccountBalance` را داشت، اما prompt «جریان نقد ۱۴۰۲» به `cash_flow_statement` (VoucherItem Debit-Credit) روت می‌شد. **fix:**
     - `cashflow` anchors اضافه/تصحیح شد: `['جریان نقد', 'جریان وجه نقد', 'جریان وجوه نقد', 'نقد و بانک', 'جریان نقدی', 'موجودی نقد', 'نقدینگی', 'گردش نقد']`
     - `cash_flow_statement` محدود به عباراتِ رسمیِ صورت‌مالی شد: `['صورت جریان نقد', 'صورت جریان وجوه نقد', 'صورت گردش نقد', 'cash flow statement', 'statement of cash flow']`
     - corpus رگرسیون و golden cases متناظر به `cashflow` به‌روز شدند.
     - **شاهد:** `test:regression` 97/97، `eval:metrics` 274/274، `typecheck:node` 0 error.
  2. **party_count/voucher_count refused (هر دو) — رفع شد**: `MetricId` در `types.ts` و دو متریک در `metricCatalog.ts` اضافه شد. **party_count** روی `GNR.Party` با `count`، **voucher_count** روی `ACC.Voucher` با `count` و فیلترِ `v.Type NOT IN (3,4)` (حذف اسناد اختتامیه/بستن) و grain `total`/`by_year`. **شاهد:** routing unit/integration با corpus جدید سبز.
     - **رفعِ نهاییِ ریموت (S41 verify):** `party_count` و `voucher_count` به دو Zod enum (`metricPlanSchema` و `metricDefinitionSchema`) در `types.ts` اضافه شدند (قبلاً فقط در `MetricId` type بودند). مثالِ few-shot شماره ۳۲ برای cashflow از `grain:"by_year"` به `grain:"total"` اصلاح شد. قاعدهٔ تفکیکِ planner خط ۶۲۱ از `«جریان نقد» → cash_flow_statement` به `«جریان نقد» (بدون صورت) → cashflow` و `«صورت جریان نقد» → cash_flow_statement` اصلاح شد. **تأییدِ ریموت:** party_count=973 ✅، voucher_count=3115 ✅، cashflow=9,521,507,066 ✅ روی Sepidar01.
  3. **net_sales/purchases/tax_collected refused on Sepidar03**: درست و منطقی — Sepidar03 هیچ فاکتور/رسید برای ۱۴۰۲ ندارد. Engine درست refuse کرد.
  4. **Settings persistence bug — رفع شد**: علتِ ریشه‌ای در `settingsStore.ts` کشف شد — `decryptSensitiveFields` هنگامِ دسترسی به `profile.ssh.password` کرش می‌کرد چون `connectionProfile`های نوشته‌شده توسط اسکریپتِ `remote-server-control.ps1` بدونِ بلوکِ `ssh` هستند. کرش باعث می‌شد `catch` block همه‌چیز را به `DEFAULT_SETTINGS` (Sepidar01) بازنشانی کند. **fix:** optional chaining (`profile.ssh?.password`) در `encryptSensitiveFields` و `decryptSensitiveFields`. **شاهد:** بعد از fix، `AFTER_START: sql=Sepidar03 profile=Sepidar03 activeId=direct-sql-sepidar` — تنظیمات بدون env var persist می‌شود. رگرسیون: Sepidar01 هم درست persist شد.

### S41.9 — تستِ رگرسیونِ چند‌نسخه‌ای
- [ ] **S41.9** کورپوسِ رگرسیون (فاز ۴۰) را روی هر دو نسخه اجراپذیر کن (با fixtureهای schemaِ هر نسخه). گیت: هیچ نسخه‌ای رگرسیون نگیرد.

---

## بخش د — صداقت و مستندسازی

### S41.10 — اعلامِ دامنهٔ پشتیبانی
- [ ] **S41.10** در اسناد صریح بنویس **کدام نسخه‌های سپیدار واقعاً تست و تأیید شده‌اند** و کدام‌ها نه. تا وقتی روی چند نسخه اثبات نشده، ادعای «چند‌نسخه‌ای» نکن (درسِ v1.0.0 زودهنگام).
- [ ] **S41.11** چک‌لیستِ «افزودنِ نسخهٔ جدید» در `ops/`: اتصال → تشخیصِ نسخه → کشف/کالیبراسیون → تأییدِ Tier 1 با sqlcmd → قفلِ رجیستریِ آن نسخه.

## معیارِ خروجِ فاز ۴۱ (Exit Gate)
- [ ] `detectSepidarVersion` نسخه/واریانت را تشخیص می‌دهد و در `deploymentId` می‌آید.
- [ ] فرض‌های پرریسکِ جدول/ستون به لایهٔ concept/adapter منتقل شدند؛ مفهومِ نگاشت‌نشده → ردِ صریح، نه خطا.
- [ ] متریک‌های Tier 1 روی **≥۲ نسخهٔ واقعیِ متفاوت** با اوراکلِ همان نسخه تأیید شدند.
- [ ] کورپوسِ رگرسیون روی هر دو نسخه سبز است.
- [ ] دامنهٔ پشتیبانیِ نسخه‌ها صادقانه مستند شد.
- [ ] گزارشِ فاز طبقِ الگوی §۲۸.۷ با شواهدِ خام.

---

> **پایانِ سری پختگی.** پس از فازهای ۳۹–۴۱: ارکستراتوری که **سمج** است (تا هدف ادامه می‌دهد)، **مقاوم** است (روتینگِ غیرشکننده + کورپوسِ رگرسیون)، و **کشف‌محور** است (روی نسخه‌های مختلفِ سپیدار کار می‌کند چون فرض نمی‌کند) — همان «پختگیِ Cascade» برای دامنهٔ مالی.
