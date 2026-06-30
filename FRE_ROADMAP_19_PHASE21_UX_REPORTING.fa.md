# FRE Roadmap 19 — فاز ۲۱: تجربه کاربری و گزارش‌گیری (UX & Reporting)
### شفافیت SQL، اعتماد-score، گزارش‌های زمان‌بندی‌شده، نمودار تعاملی، چندزبانه

> پیش‌نیاز: فاز ۲۰ کامل. Planner هوشمند فعال. ۲۵۳ golden case سبز.

**مارکرهای asar:** `SQL_TRANSPARENCY`, `CONFIDENCE_SCORE`, `SCHEDULED_REPORTS`, `INTERACTIVE_CHARTS`, `MULTI_LANGUAGE`.

---

## ۰ — نقشهٔ فاز

| بخش | موضوع | اندازه |
|---|---|---|
| الف | شفافیت SQL و اعتماد-score | کوچک–متوسط |
| ب | نمودار تعاملی در renderer | متوسط |
| ج | گزارش‌های زمان‌بندی‌شده | متوسط |
| د | پشتیبانی چندزبانه (فارسی + انگلیسی) | متوسط |
| هـ | بهبودهای UX چت | کوچک |
| و | تست و اعتبارسنجی | متوسط |

---

## ۱ — انگیزه و دامنه

### وضعیت پس از فاز ۲۰
- Planner چندمرحله‌ای، smart suggestions، anomaly detection ✅
- Python Sandbox برای نمودار/اکسل/PDF ✅
- کاربر نمی‌تواند SQL اجراشده را ببیند ❌
- نمودارها static (PNG) هستند، تعاملی نیستند ❌
- گزارش‌های خودکار زمان‌بندی‌شده وجود ندارد ❌
- فقط فارسی پشتیبانی می‌شود ❌

### هدف
- شفافیت کامل: کاربر بتواند SQL و evidence هر پاسخ را ببیند (در حالت debug)
- نمودار تعاملی: zoom، tooltip، toggle series
- گزارش‌های زمان‌بندی‌شده: اجرای خودکار + ذخیره/ارسال
- پشتیبانی سؤال انگلیسی در کنار فارسی

---

## بخش الف — شفافیت SQL و اعتماد-score

### S21.1 — SQL transparency panel

- [ ] **S21.1** نمایش SQL اجراشده در یک panel قابل باز/بسته:
  - **محل:** `src/renderer/index.html`
  - **منطق:**
    1. هر پاسخ شامل `sql` و `evidence` در metadata باشد
    2. در UI، زیر هر پاسخ یک دکمه «نمایش SQL» باشد
    3. کلیک → panel با syntax highlighting (SQL)
    4. دکمه «کپی SQL» برای کاربر
  - **نکته:** قابل فعال/غیرفعال از تنظیمات (پیش‌فرض: غیرفعال برای کاربر غیرفنی)
  - **معیار:** دکمه «نمایش SQL» → SQL با syntax highlighting. `typecheck:node` تمیز.

### S21.2 — Confidence Score

- [ ] **S21.2** نمایش اعتماد-score برای هر پاسخ:
  - **محل:** `src/main/services/financialEngine/confidenceScore.ts`
  - **منطق:**
    ```typescript
    interface ConfidenceScore {
      score: number  // 0-100
      factors: {
        sqlRowsReturned: boolean   // > 0 rows
        evidenceMatch: boolean     // اعداد با SQL همخوانی دارند
        anomalyDetected: boolean   // anomaly وجود دارد (کاهش اعتماد)
        planConfidence: 'high' | 'medium' | 'low'  // از planner
        fallbackUsed: boolean      // fallback به متن (کاهش اعتماد)
      }
    }
    ```
  - **UI:** badge رنگی: سبز (۸۰+)، زرد (۵۰-۸۰)، قرمز (<۵۰)
  - **معیار:** پاسخ با ۰ row → score پایین. پاسخ با evidence match → score بالا. `typecheck:node` تمیز.

### S21.3 — Evidence panel

- [ ] **S21.3** نمایش evidence (اعداد تأییدشده) در یک panel:
  - **منطق:** جدول با ستون‌های: metric, value, sql_column, row_count
  - **نکته:** قابل toggle، پیش‌فرض فعال
  - **معیار:** evidence جدول نمایش داده شود. `typecheck:node` تمیز.

---

## بخش ب — نمودار تعاملی

### S21.4 — Chart.js integration در renderer

- [ ] **S21.4** جایگزینی PNG static با نمودار تعاملی Chart.js:
  - **محل:** `src/renderer/index.html` + `src/renderer/charts.ts`
  - **منطق:**
    1. Python Sandbox داده‌های JSON (نه PNG) تولید کند برای نمودار
    2. Renderer با Chart.js نمودار تعاملی رسم کند
    3. اگر کاربر PNG خواست (برای ذخیره/چاپ)، دکمه «تصویر» → canvas.toDataURL
  - **ویژگی‌ها:** tooltip، zoom، toggle series، legend clickable
  - **نکته:** Python Sandbox همچنان برای اکسل/PDF استفاده شود
  - **معیار:** نمودار با tooltip تعاملی. دکمه «ذخیره تصویر» PNG تولید کند. `typecheck:node` تمیز.

### S21.5 — Chart type auto-selection

- [ ] **S21.5** انتخاب خودکار نوع نمودار بر اساس داده:
  - **منطق:**
    - ۱ سری زمانی → line chart
    - مقایسه ۲+ دسته → bar chart
    - ترکیب درصد → pie/doughnut
    - توزیع → scatter/histogram
  - **نکته:** کاربر می‌تواند نوع نمودار را تغییر دهد (dropdown)
  - **معیار:** داده زمانی → line. داده مقایسه‌ای → bar. `typecheck:node` تمیز.

---

## بخش ج — گزارش‌های زمان‌بندی‌شده

### S21.6 — Scheduled Reports schema

- [ ] **S21.6** تعریف scheduled reports در settings:
  ```typescript
  interface ScheduledReport {
    id: string
    name: string
    metricPlan: MetricPlan | MultiStepPlan
    schedule: {
      frequency: 'daily' | 'weekly' | 'monthly'
      dayOfWeek?: number  // 0-6 (weekly)
      dayOfMonth?: number // 1-31 (monthly)
      time: string        // "09:00"
    }
    outputFormat: 'text' | 'chart' | 'excel' | 'pdf'
    delivery: 'save' | 'open' | 'notify'
    enabled: boolean
  }
  ```
  - **معیار:** `typecheck:node` تمیز. Zod schema.

### S21.7 — Scheduler service

- [ ] **S21.7** سرویس `ReportScheduler` در `src/main/services/reportScheduler.ts`:
  - **منطق:**
    1. در startup، scheduled reports از settings خوانده شود
    2. با `setInterval` یا `node-cron`، در زمان مقرر اجرا شود
    3. اجرای MetricPlan → تولید خروجی → ذخیره در `reports/` یا notification
  - **نکته:** برنامه باید در حالت اجرا باشد (Electron app) تا scheduler فعال باشد
  - **معیار:** report با frequency=daily در زمان مقرر اجرا شود. `typecheck:node` تمیز.

### S21.8 — UI برای مدیریت scheduled reports

- [ ] **S21.8** در renderer، صفحه مدیریت گزارش‌های زمان‌بندی‌شده:
  - **ویژگی‌ها:**
    - لیست گزارش‌های موجود (نام، frequency، آخرین اجرا)
    - دکمه «گزارش جدید» → فرم (metric، schedule، output)
    - دکمه «اجرای اکنون» → تست دستی
    - دکمه «فعال/غیرفعال»
  - **معیار:** گزارش جدید ایجاد و اجرا شود. `typecheck:node` تمیز.

---

## بخش د — پشتیبانی چندزبانه

### S21.9 — English query support

- [ ] **S21.9** Planner بتواند سؤال انگلیسی هم بفهمد:
  - **منطق:**
    1. در planner prompt، نمونه‌های انگلیسی اضافه شود
    2. Router anchors انگلیسی اضافه شود (مثلاً: "sales", "revenue", "balance sheet")
    3. پاسخ نهایی به زبان سؤال باشد (فارسی → فارسی، انگلیسی → انگلیسی)
  - **نمونه‌های few-shot:**
    1. "What were total sales in 1402?" → total_revenue, by_year, 1402
    2. "Show me the balance sheet" → balance_sheet
    3. "Compare expenses 1402 vs 1403" → total_expenses, comparison
  - **نکته:** metric anchors هم فارسی هم انگلیسی شوند
  - **معیار:** سؤال انگلیسی → MetricPlan درست + پاسخ انگلیسی. `typecheck:node` تمیز.

### S21.10 — Mixed language support

- [ ] **S21.10** پشتیبانی سؤال ترکیبی فارسی-انگلیسی:
  - **نمونه:** «فروش 1402 رو با 1403 compare کن»
  - **منطق:** normalize متن قبل از planner (حفظ کلمات فارسی و انگلیسی)
  - **معیار:** سؤال ترکیبی → MetricPlan درست. `typecheck:node` تمیز.

---

## بخش هـ — بهبودهای UX چت

### S21.11 — Chat history persistence

- [ ] **S21.11** ذخیره تاریخچه چت در disk و بازیابی در startup:
  - **محل:** `src/main/services/chatHistory.ts`
  - **منطق:**
    1. هر مکالمه در `userData/chat-history/` با timestamp ذخیره شود
    2. در startup، آخرین مکالمه بارگذاری شود
    3. دکمه «مکالمه جدید» → پاک‌سازی history
    4. لیست مکالمات قبلی در sidebar
  - **معیار:** مکالمه بعد از restart برنامه حفظ شود. `typecheck:node` تمیز.

### S21.12 — Export conversation

- [ ] **S21.12** خروجی مکالمه به‌صورت PDF یا متن:
  - **منطق:** دکمه «خروجی مکالمه» → انتخاب فرمت (PDF/text) → ذخیره
  - **معیار:** فایل PDF/text تولید شود. `typecheck:node` تمیز.

### S21.13 — Quick action buttons

- [ ] **S21.13** دکمه‌های میانبر در صفحه اصلی:
  - **نمونه‌ها:** «فروش امسال»، «ترازنامه»، «صورت سود و زیان»، «دریافتنی‌ها»
  - **استایل:** کارت‌های بزرگ با آیکون در صفحه خالی (قبل از اولین پیام)
  - **معیار:** کلیک → پیام ارسال شود. `typecheck:node` تمیز.

---

## بخش و — تست و اعتبارسنجی

### S21.14 — Unit tests

- [ ] **S21.14** unit tests جدید:
  1. ConfidenceScore: ۰ row → score پایین
  2. ConfidenceScore: evidence match → score بالا
  3. Chart auto-selection: زمانی → line, مقایسه → bar
  4. ReportScheduler: daily → اجرا در زمان مقرر
  5. English query: "total sales 1402" → MetricPlan درست
  6. Mixed language: «فروش رو compare کن» → MetricPlan درست
  7. ChatHistory: ذخیره و بازیابی
  - **معیار:** ۷ تست pass. `typecheck:node` تمیز.

### S21.15 — Golden cases

- [ ] **S21.15** golden cases جدید:
  1. `s21-english-sales-1402` — "What were total sales in 1402?"
  2. `s21-english-balance-sheet` — "Show me the balance sheet"
  3. `s21-english-compare-expenses` — "Compare expenses 1402 vs 1403"
  4. `s21-mixed-language` — «فروش 1402 رو با 1403 compare کن»
  5. `s21-confidence-score-high` — پاسخ با evidence کامل → score ۸۰+
  6. `s21-confidence-score-low` — پاسخ با ۰ row → score <۵۰
  - **مجموع:** ۶ golden case جدید
  - **معیار:** eval سبز. `typecheck:node` تمیز.

### S21.16 — Full Gate

- [ ] **S21.16** `typecheck:node` + `npm test` + `eval:metrics`:
  - **معیار:** ۰ خطای typecheck. تمام test pass. eval ۲۵۹/۲۵۹ (۲۵۳ + ۶).

### S21.17 — Build + asar-grep

- [ ] **S21.17** build + asar-grep:
  - **مارکرها:** `SQL_TRANSPARENCY`, `CONFIDENCE_SCORE`, `SCHEDULED_REPORTS`, `INTERACTIVE_CHARTS`, `MULTI_LANGUAGE`
  - **معیار:** build موفق. مارکرها در asar.

### S21.18 — Field test

- [ ] **S21.18** تست میدانی:
  - ۸ پرسش (انگلیسی، ترکیبی، نمودار تعاملی، گزارش زمان‌بندی، SQL transparency)
  - **معیار:** ۸/۸ موفق.

### S21.19 — شاهد S21

- [ ] **S21.19** پر شدن بخش شاهد.

### S21.20 — به‌روزرسانی OVERVIEW

- [ ] **S21.20** فاز ۲۱ در OVERVIEW اضافه شود.

---

## شاهد S21
```
فاز ۲۱ — تجربه کاربری و گزارش‌گیری
تاریخ: [پس از تکمیل پر شود]

S21.1-S21.3 — شفافیت:
  - SQL panel با syntax highlighting
  - ConfidenceScore: 0-100 با badge رنگی
  - Evidence panel با جدول
  - فایل: confidenceScore.ts, index.html

S21.4-S21.5 — نمودار تعاملی:
  - Chart.js جایگزین PNG static
  - auto-selection: line/bar/pie/scatter
  - فایل: charts.ts, index.html

S21.6-S21.8 — Scheduled Reports:
  - schema: ScheduledReport با frequency/output/delivery
  - ReportScheduler با node-cron
  - UI: لیست + فرم + اجرای دستی
  - فایل: reportScheduler.ts, index.html

S21.9-S21.10 — Multi-language:
  - English few-shot examples + anchors
  - Mixed language support
  - پاسخ به زبان سؤال

S21.11-S21.13 — UX:
  - Chat history persistence
  - Export conversation (PDF/text)
  - Quick action buttons

S21.16 — Full Gate:
  - typecheck:node: [تعداد] errors
  - unit tests: [تعداد] pass
  - eval:metrics: [تعداد]/[تعداد] (X%)

S21.18 — Field test:
  - [تعداد]/[تعداد] OK
```
