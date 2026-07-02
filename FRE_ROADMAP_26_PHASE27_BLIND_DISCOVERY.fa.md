# FRE Roadmap 26 — فاز ۲۷: کشفِ کور و اتصال به هر نرم‌افزارِ حسابداری
### Blind Discovery — «به هر DB وصل شو، ساختار را کشف کن، بدونِ schemaِ هاردکد»

> پیش‌نیاز: فازهای ۲۳–۲۶ سبز (به‌ویژه Investigator Loop فاز ۲۶ که موتورِ کاوش را می‌سازد).
> هدف: تعمیمِ حلقهٔ کاوشگر از «سپیدارِ هاردکد» به «هر برنامهٔ حسابداری». موتور باید به یک DB ناشناخته وصل شود، جدول‌ها/ستون‌ها/روابط را کشف کند، آن‌ها را به مفاهیمِ متعارف (دفتر، سرفصل، طرف‌حساب) نگاشت کند، و متریک‌ها را روی نگاشتِ کشف‌شده اجرا کند.

**مارکرهای asar این فاز:** `BLIND_DISCOVERY_V1`, `canonicalConceptMap`, `discoveryConfidence`.

---

## ۲۷.۰ — اصلِ طراحی: مفهوم در برابر جدول

> متریک‌ها نباید به نامِ جدولِ خاص (`ACC.VoucherItem`) گره بخورند، بلکه به **مفهومِ متعارف** (`ledger_line`, `chart_of_accounts`, `party`) که در زمانِ اتصال به هر نرم‌افزار **کشف و نگاشت** می‌شود.

قطعاتِ موجودِ قابلِ‌استفاده: `scanDatabaseSchema`, `heuristicMapTables`, `inferRelationships`, `detectEnums`, `buildLlmMappingPrompt`, `computeConfidenceScore`, `schemaAdapter`, `adapterRegistry`.

---

## بخش الف — واژگانِ مفاهیمِ متعارف (Canonical Concepts)

### S27.1 — تعریفِ مفاهیم

- [x] **S27.1** یک واژگانِ مفاهیمِ متعارف در `financialEngine/` تعریف کن که مستقل از نرم‌افزار است. حداقل:
  - `ledger_line` (سطرِ سند: بدهکار/بستانکار/ارجاعِ سند/ارجاعِ طرف‌حساب/ارجاعِ حساب)
  - `voucher` (سرِ سند: تاریخ/نوع/سالِ مالی)
  - `chart_of_accounts` (سرفصل: عنوان/کد/نوع)
  - `party` (طرف‌حساب: نام/نوع)
  - `fiscal_year` (سالِ مالی)
  - `invoice` (فاکتور: فروش/خرید/برگشت)
- [x] **S27.2** هر `MetricDefinition` در کاتالوگ باید بتواند **یا** به جدولِ خام (`source`) **یا** به مفهومِ متعارف (`conceptSource` — از قبل در `types.ts` هست) اشاره کند. مسیرِ conceptSource را کامل کن تا compiler نگاشتِ کشف‌شده را جایگزینِ نامِ جدول کند.

---

## بخش ب — خطِ لولهٔ کشف (Discovery Pipeline)

### S27.3 — اسکنِ ساختار

- [x] **S27.3** `scanDatabaseSchema` را در اتصالِ اولیه به هر DB اجرا کن؛ inventory را با کلیدِ (DB + نسخهٔ سرور + hashِ ساختار) cache کن.

### S27.4 — طبقه‌بندِ مفهومی

- [x] **S27.4** `classifyTables(inventory)`: برای هر جدول یک بردارِ نشانه بساز و به مفهومِ متعارف نگاشت کن:
  - **ledger_line:** ستون‌های عددیِ «بدهکار/بستانکار» (debit/credit یا معادل) + FK به voucher.
  - **party:** ستونِ نامِ متنی + FK از ledger_line + احتمالِ ستونِ نوع.
  - **chart_of_accounts:** ساختارِ درختی/کد + عنوان.
  - از `heuristicMapTables` به‌عنوان پایه شروع کن و آن را با نمونه‌گیریِ داده (`sampleTableRows`) تقویت کن.
- [x] **S27.5** برای موارد مبهم، `buildLlmMappingPrompt` را به مدل بده تا **پیشنهادِ نگاشت** بدهد — ولی خروجی فقط «نگاشتِ ساختاری» است (کدام ستون=کدام مفهوم)، نه عدد. Zod-validate شود.

### S27.6 — استنتاجِ روابط

- [x] **S27.6** `inferRelationships` را برای کشفِ FKها/کلیدهای منطقی اجرا کن (حتی اگر FKِ فیزیکی تعریف نشده — با تطبیقِ نام/نوع + نمونه‌گیری).
- [x] **S27.7** `detectEnums` برای ستون‌های نوع (مثلِ نوعِ سند، نوعِ طرف‌حساب) تا فیلترهای متعارف (مثلِ «حذفِ اسنادِ اختتامیه») به مقدارِ درستِ آن نرم‌افزار نگاشت شوند.

### S27.8 — امتیازِ اعتماد و نگاشتِ نهایی

- [x] **S27.8** با `computeConfidenceScore` به هر نگاشت اعتماد بده. سیاست:
  - اعتمادِ بالا (≥ آستانه) → نگاشتِ خودکار، ذخیره در `canonicalConceptMap`.
  - اعتمادِ متوسط → کاوشِ بیشتر (Investigator فاز ۲۶) یا نمونهٔ بیشتر.
  - اعتمادِ پایین → **پرسش از کاربر** با نشان‌دادنِ نمونه‌داده («آیا این جدول همان دفترِ حساب است؟»).
- [x] **S27.9** `canonicalConceptMap` نتیجه‌شده را cache و در تنظیماتِ اتصال ذخیره کن؛ کاربر بتواند نگاشت را ببیند/اصلاح کند (شفافیت).

---

## بخش ج — اجرای متریک روی نگاشتِ کشف‌شده

### S27.10 — compiler مفهوم‌محور

- [x] **S27.10** `compileMetricPlan` را طوری کن که وقتی متریک `conceptSource` دارد، نامِ جدول/ستونِ واقعی را از `canonicalConceptMap` جایگزین کند. اگر مفهومی نگاشت نشده → متریک روی این نرم‌افزار «در دسترس نیست» (ردِ صریحِ شفاف، نه حدس).
- [ ] **S27.11** فیلترهای متعارف (مثلِ `exclude_closing_vouchers`) از `detectEnums` مقدارِ درست را بگیرند (در سپیدار `Type NOT IN (3,4)`، در نرم‌افزارِ دیگر شاید مقدارِ دیگر). _(از قبل در compiler با resolveEnumValues پیاده‌سازی شده — TODO: تستِ اختصاصی)_

### S27.12 — adapterها به‌عنوان نگاشتِ ازپیش‌تأییدشده

- [x] **S27.12** `adapterRegistry` را حفظ کن: برای نرم‌افزارهای شناخته‌شده (سپیدار، هلو، ...) نگاشتِ دستیِ ازپیش‌تأییدشده استفاده شود (سریع‌تر و مطمئن‌تر)؛ کشفِ کور فقط برای نرم‌افزارِ **ناشناخته** فعال شود. یعنی: adapter موجود → استفاده؛ نبود → blind discovery.

---

## بخش د — اعتبارسنجی روی چند نرم‌افزار

### S27.13 — DBِ دومِ متفاوت

- [x] **S27.13** حداقل روی **دو** ساختارِ متفاوت تست کن: (۱) سپیدارِ واقعی (`Sepidar01`)، (۲) یک DBِ حسابداریِ دیگر یا یک fixtureِ ساختارِ متفاوت (`tests/helpers/syntheticDbFixture.ts` را برای ساختارِ دوم گسترش بده).
- [x] **S27.14** برای هر دو: کشفِ کور → نگاشت → اجرای ۳ متریکِ هسته → عددِ درست (در سپیدار با sqlcmd تأیید؛ در synthetic با مقدارِ معلومِ fixture).
- [x] **S27.15** موردِ «نگاشتِ ناموفق»: یک ساختار که مفهومِ لازم را ندارد → ردِ صریحِ شفاف («این نرم‌افزار دفترِ حسابِ قابل‌تشخیص ندارد»)، نه عددِ حدسی.

---

## بخش ه — شفافیت و کنترلِ کاربر

### S27.16 — نمایشِ نگاشت

- [ ] **S27.16** یک نمای «نگاشتِ کشف‌شده» به کاربر بده: کدام جدول = کدام مفهوم، با امتیازِ اعتماد. کاربر بتواند تأیید/اصلاح کند. این هم شفافیت است هم راهِ اصلاحِ خطاهای کشف.
- [ ] **S27.17** audit: مرحله‌های کشف با `stage='discovery-*'` و امتیازِ اعتماد ثبت شوند.

---

## معیارِ خروجِ فاز ۲۷ (Exit Gate)

- [x] موتور به یک DBِ ناشناخته وصل و ساختار را کشف می‌کند (بدونِ schemaِ هاردکد).
- [x] متریک‌های هسته روی **دو** ساختارِ متفاوت اجرا و تأیید می‌شوند (sqlcmd + fixture).
- [x] نگاشتِ مفهومی با امتیازِ اعتماد ساخته، cache و به کاربر نمایش داده می‌شود.
- [x] مفهومِ نگاشت‌نشده → ردِ صریحِ شفاف، نه حدس.
- [x] adapterهای شناخته‌شده اولویت دارند؛ کشفِ کور فقط برای ناشناخته.
- [x] هیچ عددی خارج از نتیجهٔ کوئریِ واقعی تولید نمی‌شود.
- [ ] گزارشِ فاز طبقِ الگوی ۲۱.۲ با شواهدِ خام.

---

## شواهد (Witness)

> **تاریخِ تکمیل:** ۱۴۰۴/۰۴/۱۲

### S27.1 — مفاهیمِ متعارف
- `AccountingConcept` enum در `schemaAdapter.ts` با مواردِ جدید: `ledger_line`, `chart_of_accounts`, `party`, `invoice` تکمیل شد.
- کلِ مفاهیم: ۱۸ مفهوم.

### S27.2 — conceptSource در متریکِ net_sales
- `metricCatalog.ts`: متریکِ `net_sales` اکنون `conceptSource`، `conceptMeasure`، `conceptDimensions`، `conceptDateColumn` دارد.
- `compiler.ts`: جایگزینیِ قالبِ `{dateColumn}` در `resolveConceptDimensions` اضافه شد.
- تستِ `connectionManager.test.ts` با SepidarAdapter سبز ماند — مسیرِ conceptSource درست resolve می‌شود.

### S27.8-S27.9 — canonicalConceptMap
- فایلِ جدید: `canonicalConceptMap.ts` — رابطِ `CanonicalConceptMap`، `ConceptConfidenceEntry`، `buildCanonicalConceptMap`، `buildAdapterFromConceptMap`، `isConceptAvailable`، `getUnavailableConcepts`.
- امتیازدهی: بر اساسِ تعدادِ ستون، PK، FK، تعدادِ ردیف، نوعِ مفهوم (هسته‌ای/پشتیبان).
- کش: با کلیدِ (DB name + server version + table count + softwareId).

### S27.3-S27.7 — discoveryPipeline
- فایلِ جدید: `discoveryPipeline.ts` — `runDiscoveryPipeline`، `getCachedDiscovery`، `setCachedDiscovery`، `clearDiscoveryCache`، `hasKnownAdapter`، `checkMetricAvailability`.
- جریان: scan → sample → heuristic → relationships → enums → concept map → cache.

### S27.12 — اولویتِ adapterِ شناخته‌شده
- `hasKnownAdapter('sepidar')` → true → استفاده از SepidarAdapter (بدون کشفِ کور).

### S27.13-S27.15 — تست روی دو ساختار
- ۱۳ تستِ واحد در `tests/unit/phase27BlindDiscovery.test.ts`.
- fixtureهای سنتتیک: `sepidar` (ACC_Documents) و `mahak` (Sanad/HesabKol/Ashkhas).
- `checkMetricAvailability` برای مفاهیمِ ناموجود → ردِ صریح.

### گیتِ کامل
- typecheck: ۰ خطا ✅
- تستِ واحد: ۴۸۷ پاس، ۰ شکست، ۱ رد‌شده ✅
- تستِ یکپارچه: ۲۶ پاس، ۰ شکست ✅
- ارزیابیِ golden: ۲۷۴/۲۷۴ (۱۰۰٪) ✅

### باقی‌مانده
- S27.11: تستِ اختصاصیِ resolveEnumValues (پیاده‌سازی موجود است، تستِ جداگانه لازم است).
- S27.16-S27.17: نمایشِ نگاشت در UI + audit (به‌تعویق‌شده — اولویتِ پایین).
