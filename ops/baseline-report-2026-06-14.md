# Baseline Report – ACC Assist

Date: 2026-06-14

## 1. Representative baseline questions

The following 20 representative prompts were used to establish the current baseline for roadmap validation:

1. در دیتابیس چند سال مالی قرار داره؟
2. لیست سال‌های مالی را نمایش بده
3. مانده حساب فروشگاه را بگو
4. مانده طرف حساب فروشگاه را بگو
5. فروش سالانه را برای سال 1403 گزارش کن
6. فروش ناخالص سالانه 1403 را گزارش کن
7. درصد رشد فروش 1403 نسبت به 1402 را بگو
8. خلاصه بدهکاران را بگو
9. خلاصه بستانکاران را بگو
10. جریان نقد ماهانه را خلاصه کن
11. گردش حساب در بازه 1403 تا 1404 را نشان بده
12. جمع بدهکاران و دریافتی‌ها را نشان بده
13. Show total payables and creditors for this month
14. List fiscal years in this database
15. Show the fiscal years available in this database
16. مانده سرفصل فروش را بگو
17. خلاصه جریان وجه نقد را بده
18. فروش سال 1403 نسبت به 1402 چه تغییری داشت؟
19. فروش خالص سالانه 1403 را محاسبه کن
20. فروش دفتری 1403 را گزارش کن

## 2. Error-category baseline

Observed baseline categories from current implementation and tests:

- Intent drift / intent mismatch: guarded in deterministic response alignment tests.
- KPI ambiguity: handled through explicit clarification for ambiguous annual sales prompts.
- Schema mismatch / invalid object or column usage: blocked by preflight validation and negative tests.
- Provider instability / retry resilience: covered by Gemini retry and failure-localization tests.

## 3. Recurring KPI definitions in current baseline

The current codebase already locks the recurring annual sales KPI contracts to these labels:

- فروش ناخالص (gross_sales)
- فروش خالص (net_sales)
- فروش دفتری (booked_sales)

For growth prompts, the current deterministic path relies on a concrete base-year / target-year comparison and evidence-first numeric output.

## 4. Baseline summary

- Ambiguous KPI prompts are now clarified before unsafe execution.
- Deterministic financial routing is active for supported fiscal and summary intents.
- Evidence-first contract enforcement remains active for numeric financial claims.
- The baseline is therefore stable enough to continue with the remaining roadmap validation and UX work.
