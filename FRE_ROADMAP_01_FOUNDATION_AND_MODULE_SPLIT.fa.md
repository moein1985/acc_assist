# FRE Roadmap 01 — فاز ۱: شالوده، شکستنِ ارکستریتر و زیرساختِ Flag
### پیش‌نیازِ همهٔ فازها — رفتار-حفظ (Behavior-Preserving)

> پیش از شروع، `FRE_ROADMAP_00_OVERVIEW.fa.md` را کامل بخوان. این فاز **هیچ رفتار یا عددی را تغییر نمی‌دهد**؛ فقط ساختار را برای فازهای بعد آماده می‌کند. معیارِ موفقیت = تست‌ها و typecheck دقیقاً مثل قبل سبز بمانند و خروجیِ هیچ پرامپتی تغییر نکند.

---

## هدفِ فاز

1. فایلِ غول‌پیکرِ `src/main/services/agentOrchestrator.ts` (~۶٬۵۰۹ خط) را به ماژول‌های کوچک‌ترِ رفتار-حفظ بشکنیم (سلامتِ کد + قابلیتِ تست).
2. اسکلتِ پکیجِ موتورِ نو (`financialEngine/`) را با interfaceها و no-op ها بسازیم (بدونِ منطقِ واقعی).
3. زیرساختِ `financialEngineMode` flag (`legacy | shadow | engine`) را اضافه کنیم، با پیش‌فرضِ `legacy` (بی‌اثر).

**مارکرِ asar برای این فاز:** `FINANCIAL_ENGINE_MODE` و `FinancialEngineRouter`.

---

## F1 — آماده‌سازی و خط مبنا

- [ ] **F1.1** اجرای baseline و ثبتِ اعداد: `npm run typecheck:node` (تمیز) و تست‌ها (`244/243/0/1`). این اعداد قراردادِ «رگرسیون صفر» این فاز هستند.
- [ ] **F1.2** یک snapshotِ میدانی از وضعیتِ فعلی بگیر (مدل `legacy`) برای ۵ متریک + گاردِ ایمنی، و خروجی‌ها را در همین فایل (بخش «شاهد F1») ثبت کن. این snapshot، اوراکلِ «رفتار-حفظ» برای مقایسهٔ پایانِ فاز است.
  - پرامپت‌ها (کوتاه، با DebugToken ثابت `fretok`): «تراز آزمایشی ۱۴۰۲»، «مانده نقد و بانک»، «خرید کل سال ۱۴۰۲»، «فروش ۱۴۰۲»، «مقایسه فروش ۱۴۰۲ و ۱۴۰۳»، «ماندهٔ حساب دریافتنی سال ۱۴۰۲»، و گارد: «تعداد کارمندان».
  - برای هرکدام `Rounds`، `ToolCallsUsed`، عدد/خلاصه، و خطِ `final`ِ audit را ثبت کن.

---

## F2 — شکستنِ رفتار-حفظِ ارکستریتر

> روش: استخراجِ ماژول‌به‌ماژول با `multi_replace`، هر بلوک لنگرشده روی یک خطِ یکتا (مثلاً کامنتِ بالای متد). فایل‌های جدیدِ ویندوزی CRLF می‌شوند → بعد از هر استخراج `npx eslint --fix <file>` بزن تا به LF نرمال شود (وگرنه صدها هشدارِ prettier «Delete ⏎»). بعد از **هر** استخراج: typecheck + تستِ کامل سبز بماند.

ساختارِ هدفِ پوشه:
```
src/main/services/agentOrchestrator/
  index.ts                      # کلاس AgentOrchestrator نازک، فقط wiring
  deterministicTools.ts         # (موجود) — دست‌نخورده در این فاز
  routing.ts                    # تشخیص intent / منظم‌سازی پرامپت / regexها
  responseContract.ts           # finalizeFinancialResponse، enforceEvidenceFirstContract، annotateManagerUx
  conversationMemory.ts         # state حافظهٔ گفتگو + rememberToolTrace
  sqlExecution.ts               # executeReadOnlySql/Metadata wrappers + ensureFinancialQueryAllowed + cancellation
  salesGrowth.ts                # توابع مقایسهٔ فروش (selectSalesGrowthSourceTable و …)
```

- [ ] **F2.1** ماژولِ `routing.ts` را استخراج کن: توابع و regexهای تشخیصِ intent و منظم‌سازیِ پرامپت (مثل `isSalesGrowthPercentPrompt`, `isComparativeMultiPeriodPrompt`, helperهای مرتبط). امضاها تغییر نکنند؛ از طریقِ import در کلاس استفاده شوند. تست + typecheck سبز.
- [ ] **F2.2** ماژولِ `conversationMemory.ts` را استخراج کن: نوعِ `ConversationMemoryState`، `rememberToolTrace`, و state-management مرتبط. (نوعِ `ConversationMemoryState` از قبل export شده — مرجعش را یکپارچه کن.)
- [ ] **F2.3** ماژولِ `responseContract.ts` را استخراج کن: `finalizeFinancialResponse`, `enforceEvidenceFirstContract`, `annotateManagerUx`, `renderValidEmptyFinancialAnswer`. **مراقب باش** منطقِ «deterministic-route bypass» (early-return وقتی `routeMode==='deterministic'`) دست‌نخورده منتقل شود.
- [ ] **F2.4** ماژولِ `salesGrowth.ts` را استخراج کن: `selectSalesGrowthSourceTable`, `tryResolveSalesGrowthPercentFallback`, `composeSalesGrowthFallbackMarkdown`, `isSalesGrowthPercentPrompt`. (این‌ها در فاز ۲ منبعِ مهاجرتِ متریکِ «فروش» می‌شوند، پس تمیز جدا شوند.)
- [ ] **F2.5** ماژولِ `sqlExecution.ts` را استخراج کن: wrapper های `executeReadOnlySql`/`executeMetadataSql`، `ensureFinancialQueryAllowed`، و منطقِ cancellation (`throwIfRequestCanceled`). دقت: این‌ها dependencyِ `deterministicTools.ts` هم هستند؛ امضای deps نباید بشکند.
- [ ] **F2.6** `index.ts`: کلاسِ `AgentOrchestrator` باید به یک لایهٔ نازکِ wiring تبدیل شود که ماژول‌ها را به هم وصل می‌کند. هدفِ کمی: فایلِ کلاس < ۱٬۵۰۰ خط (هدفِ U5.3 قبلی).
- [ ] **F2.7** اجرای کاملِ `npx eslint --fix` روی پوشهٔ `agentOrchestrator/`، سپس typecheck + تستِ کامل. **هیچ تستی نباید قرمز شود** و تعدادِ تست باید همان baseline بماند.

> **هشدارِ IDE:** فایلِ بزرگ ممکن است در ادیتور خطاهای گذرا نشان دهد که با `get_errors` و `typecheck:node` تأیید نمی‌شوند. منبعِ حقیقت = `get_errors` + `typecheck:node`، نه قرمزیِ زندهٔ ادیتور.

---

## F3 — اسکلتِ پکیجِ موتورِ نو (no-op)

ساختارِ هدف:
```
src/main/services/financialEngine/
  index.ts            # FinancialEngine class (orchestrates plan→compile→exec→verify→explain)
  types.ts            # MetricDefinition, MetricPlan, Grain, … (فقط نوع، در فاز ۲ پر می‌شوند)
  router.ts           # FinancialEngineRouter: first-pass متریک‌یابی (در فاز ۲ پیاده می‌شود)
  metricCatalog.ts    # رجیستری MetricDefinition[] (در فاز ۲ پر می‌شود)
  compiler.ts         # compileMetricPlan(...) (در فاز ۲ پیاده می‌شود)
  verifier.ts         # verifyResult(...) (در فاز ۳ پیاده می‌شود)
  README.md           # توضیحِ کوتاهِ معماری + لینک به این roadmap
```

- [ ] **F3.1** فایل‌های بالا را با interfaceهای خالی و توابعِ no-op بساز که فقط `null`/`{ status: 'not-implemented' }` برمی‌گردانند. هیچ‌کدام هنوز فراخوانی نشوند. typecheck باید سبز بماند.
- [ ] **F3.2** در `financialEngine/types.ts` فقط **placeholderهای نوع** تعریف کن (جزئیاتِ کامل در فاز ۲): `MetricId`, `Grain`, `MetricDefinition`, `MetricPlan`, `CompiledQuery`, `EngineResult`, `EngineVerdict`. مستندِ TODO بگذار که فاز ۲ آن‌ها را کامل می‌کند.

---

## F4 — زیرساختِ Flag

- [ ] **F4.1** در `src/shared/contracts.ts` فیلدِ `financialEngineMode?: 'legacy' | 'shadow' | 'engine'` را به نوعِ settings اضافه کن (پیش‌فرضِ مؤثر = `'legacy'`).
- [ ] **F4.2** در `settingsStore` مقدارِ پیش‌فرض را `'legacy'` بگذار و خواندن/نوشتنش را اضافه کن. تستِ `settingsStore.test.ts` را برای فیلدِ جدید به‌روزرسانی کن.
- [ ] **F4.3** در ارکستریتر یک نقطهٔ تصمیمِ واحد بساز:
  ```ts
  const mode = this.getSettings().financialEngineMode ?? 'legacy'
  // legacy: مسیر فعلی. shadow/engine: در فاز بعد سیم‌کشی می‌شوند (الان no-op).
  ```
  در این فاز فقط مقدار را بخوان و لاگ کن (`stage:'engine-mode', mode`)؛ هیچ مسیرِ نویی فعال نشود.
- [ ] **F4.4** یک ثابتِ مارکر برای asar-grep اضافه کن (مثلاً رشتهٔ `FINANCIAL_ENGINE_MODE` در لاگ). این مارکر در فاز ۶ برای تأییدِ استقرار استفاده می‌شود.

---

## F5 — اعتبارسنجی و دروازهٔ خروجِ فاز

- [ ] **F5.1** `npm run typecheck:node` تمیز.
- [ ] **F5.2** تستِ کامل = baseline (`244/243/0/1` یا بالاتر، **۰ fail**).
- [ ] **F5.3** build (`npm run build:win`) موفق.
- [ ] **F5.4** deploy + **asar-grep**: `FINANCIAL_ENGINE_MODE` باید در asarِ مستقرشده پیدا شود (اثباتِ استقرار).
- [ ] **F5.5** تکرارِ snapshotِ میدانیِ F1.2 و **مقایسهٔ بایت‌به‌مفهومِ خروجی‌ها**: هر ۷ پرامپت باید **همان** عدد/مسیر/`Rounds`/`failureKind` قبل را بدهند. هر تفاوتی = نقضِ «رفتار-حفظ» → باید رفع شود.
- [ ] **F5.6** ثبتِ شواهد در بخشِ «شاهد F1/F5» (requestId + خطِ final).

**دروازهٔ خروج:** تا وقتی F5.1–F5.6 سبز نشده‌اند، فاز ۲ شروع نشود.

---

## شاهد F1 (snapshot پیش از تغییر)
> (مدلِ پیاده‌ساز اینجا پر می‌کند: برای هر پرامپت → requestId، Rounds، ToolCallsUsed، عدد، خطِ final.)

```
(خالی — هنگام اجرای F1.2 پر شود)
```

## شاهد F5 (پس از شکستن + استقرار — باید با F1 یکسان باشد)
```
(خالی — هنگام اجرای F5.5 پر شود)
```

---

## نکاتِ ریسک و راهنمایی

- **بزرگ‌ترین ریسکِ این فاز** = استخراجِ ناقص که یک شاخهٔ منطقی را جا بیندازد. ضدِ آن: بعد از هر زیرگام تست بزن، نه در پایان.
- تکنیکِ استخراج برای فاصله‌های انتهاییِ نامنظم: خروجیِ `read_file` بایت-وفادار است (شاملِ فاصله‌های انتهایی)؛ بلوک‌ها را عیناً منتقل کن.
- اگر `apply_patch`/replace روی فایلِ بزرگ بلوک‌ها را درهم کرد و parser شکست، فایل را اتمیک بازنویسی کن و فوراً typecheck بزن.
- در این فاز **هیچ** تغییری در SQL، intent، یا متنِ پرامپتِ سیستم نده. صرفاً جابه‌جایی.

> قدمِ بعدی: `FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md`.
