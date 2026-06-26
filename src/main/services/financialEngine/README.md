# Financial Reasoning Engine (FRE)

> **هستهٔ قطعی، پوستهٔ احتمالی** (deterministic core, probabilistic shell)

این پکیج اسکلتِ موتورِ معناییِ نو است که در فازهای ۲ تا ۳ پر می‌شود.

## معماری

```
Router → Planner (مدل) → Semantic Layer → Compiler → Executor → Verifier → Explainer (مدل)
```

| فایل | نقش | فاز پیاده‌سازی |
|---|---|---|
| `types.ts` | تعریف انواع `MetricId`, `Grain`, `MetricDefinition`, `MetricPlan`, `CompiledQuery`, `EngineResult`, `EngineVerdict` | فاز ۲ |
| `router.ts` | `FinancialEngineRouter`: first-pass متریک‌یابی | فاز ۲ |
| `metricCatalog.ts` | رجیستری `MetricDefinition[]` | فاز ۲ |
| `compiler.ts` | `compileMetricPlan(...)`: تبدیل `MetricPlan` به SQL امن | فاز ۲ |
| `verifier.ts` | `verifyResult(...)`: تأیید آشتی، intent-alignment، evidence | فاز ۳ |
| `index.ts` | `FinancialEngine` class: orchestration کلی | فاز ۲+ |

## وضعیت فعلی (فاز ۱)

همه توابع no-op هستند و `{ status: 'not-implemented' }` یا `null` برمی‌گردانند.
هیچ‌کدام فراخوانی نمی‌شوند.

## نقشه راه

- فاز ۱: اسکلت no-op (این فاز)
- فاز ۲: Semantic Layer + Compiler + مهاجرت ۵ متریک
- فاز ۳: Planner + Verifier
- فاز ۴: Eval + Deploy + Cutover

@see `FRE_ROADMAP_00_OVERVIEW.fa.md`
