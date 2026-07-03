# Refusal Analysis — Iterative Cycle Checklist

> این چک‌لیست برای تکرارِ دوره‌ایِ فاز ۳۱ است. هر دوره را کپی کن و پر کن.

## دورهٔ N — تاریخ: YYYY-MM-DD

### ۱. جمع‌آوریِ لاگ
- [ ] اپ با `ACC_ENABLE_AGENT_DEBUG_SERVER=1` و `ACC_FINANCIAL_ENGINE_MODE=engine` روی سرور اجرا شود
- [ ] پرسش‌های تست (حداقل ۲۰: مالی + رد + خارج از پوشش) از طریق debug endpoint پرسیده شود
- [ ] audit log از سرور دانلود شود: `pscp ... agent-audit.log ops/agent-audit-<date>.log`
- [ ] ورودی‌های دوره استخراج شود: `Select-String "<date-pattern>"`

### ۲. تحلیل
- [ ] `npx tsx scripts/ops/analyzeRefusals.ts --audit-log ops/<file> --output ops/refusal-report-<date>.md` اجرا شود
- [ ] خوشه‌های `no_metric` بررسی شوند:
  - آیا متریکِ موجود است ولی planner پیدا نکرده؟ → بهبودِ anchor
  - آیا خطای گذرا (API/SQL) است؟ → ثبتِ باگ، نه متریکِ جدید
  - آیا واقعاً داده در DB هست ولی متریک نیست؟ → تعریفِ MetricDefinition + تأییدِ فاز ۲۹
- [ ] خوشه‌های `ambiguous` بررسی شوند: بهبودِ clarify یا anchor
- [ ] خوشه‌های `out_of_scope` تأیید شوند: ردِ سالم = مرزِ سالمِ محصول

### ۳. اقدام
- [ ] اگر متریکِ جدید: طبقِ فاز ۲۹ با اوراکل تأیید شود → `verified` در رجیستری
- [ ] اگر بهبودِ anchor: `metricCatalog.ts` به‌روزرسانی + typecheck + test
- [ ] اگر باگِ SQL: fix + test + golden eval
- [ ] build + استقرار روی سرور

### ۴. سنجه
- [ ] نرخِ ردِ کلی: (تعدادِ رد / تعدادِ کل) × ۱۰۰
- [ ] تفکیک: `no_metric` ٪ vs `out_of_scope` ٪ vs `ambiguous` ٪
- [ ] روند: مقایسه با دورهٔ قبلی — `no_metric` رو به کاهش؟ `out_of_scope` پایدار؟
- [ ] تعدادِ متریکِ verified: N

### ۵. مستندسازی
- [ ] گزارش در `ops/refusal-report-<date>.md` ذخیره شود
- [ ] roadmap با شواهدِ این دوره به‌روزرسانی شود
- [ ] یادداشتِ دوره در این فایل اضافه شود

---

## تاریخچهٔ دوره‌ها

### دورهٔ ۱ — ۱۴۰۴/۰۴/۱۳ (۲۰۲۶-۰۷-۰۳)
- ۲۰ پرسش، ۵ رد (۲۵٪)
- `no_metric`: ۳ (خطای گذرا + باگ SQL + مبهمی — نه شکافِ پوشش)
- `out_of_scope`: ۲ (مرزِ سالم تأیید شد)
- `ambiguous`: ۰ (۲ مورد در engine-mode ولی categorizeRefusalReason درست out_of_scope داد)
- متریکِ جدید: هیچ
- نتیجه: سلامتِ پوشش تأیید شد. باگِ `party_turnover` SQL برای دورهٔ بعد ثبت شد.
