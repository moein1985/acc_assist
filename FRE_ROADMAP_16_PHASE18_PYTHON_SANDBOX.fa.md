# FRE Roadmap 16 — فاز ۱۸: محیط اجرای پایتون (Python Sandbox)
### از خروجی متنی به هر خروجی که کاربر بخواهد — نمودار، اکسل، PDF

> پیش‌نیاز: فاز ۱۷ کامل. باگ‌های معماری برطرف شده. ۲۱۱ golden case سبز.

**مارکرهای asar:** `PYTHON_SANDBOX`, `EMBEDDED_PYTHON`, `CODE_EXECUTION`, `CHART_OUTPUT`.

---

## ۰ — نقشهٔ فاز

| بخش | موضوع | اندازه |
|---|---|---|
| الف | Embedded Python + pip + repo fallback | متوسط |
| ب | Sandbox امن (AST validation، timeout، memory) | متوسط–بزرگ |
| ج | ادغام با Planner (PythonOutputPlan) | متوسط |
| د | رندر خروجی در UI (PNG، XLSX، PDF) | متوسط |
| هـ | تست و اعتبارسنجی | متوسط |

---

## ۱ — انگیزه و دامنه

### وضعیت پس از فاز ۱۷
- ۵۸ متریک، ۲۱۱ golden case، ۳۶۱ unit test ✅
- خروجی فعلی فقط متن + جدول در چت ✅
- PDF/Excel در فاز ۱۳ محدود و static ✅
- کاربر نمی‌تواند نمودار سفارشی درخواست کند ❌

### هدف
- Python 3.12 embedded در برنامه bundle شود — کاربر نیازی به نصب ندارد
- مدل کد Python بنویسد که داده‌های SQL را بگیرد و نمودار/اکسل/PDF تولید کند
- sandbox امن: no network، timeout ۳۰s، AST validation، whitelist کتابخانه‌ها
- pip با repo بین‌المللی + fallback به repo ایرانی (`pypi.ir`)

### معماری
```
کاربر → Planner (MetricPlan + PythonOutputPlan)
     → SQL Executor → rows (JSON)
     → Python Sandbox (subprocess) → output file (PNG/XLSX/PDF)
     → Renderer (نمایش در چت + دکمه دانلود)
```

---

## بخش الف — Embedded Python

### S18.1 — دانلود و bundle کردن Python 3.12 embedded

- [ ] **S18.1** Python 3.12 embedded (~۱۵MB) در `resources/python/` قرار گیرد:
  - **منبع:** `https://www.python.org/ftp/python/3.12.x/python-3.12.x-embed-amd64.zip`
  - **`python312._pth`:** اصلاح شود تا `site-packages` و `Lib` شامل شود
  - **electron-builder.yml:** `resources/python/**/*` به `extraResources` اضافه شود
  - **معیار:** `python.exe --version` → `Python 3.12.x`. `typecheck:node` تمیز.

### S18.2 — نصب کتابخانه‌های پایه با pip + repo fallback

- [ ] **S18.2** کتابخانه‌ها در زمان build نصب شوند:
  - **کتابخانه‌ها:** `pandas`، `matplotlib`، `openpyxl`، `reportlab`، `numpy`
  - **repo پیش‌فرض:** `https://pypi.org/simple`
  - **repo fallback:** `https://pypi.ir/simple --trusted-host pypi.ir`
  - **اسکریپت:** `scripts/ops/install-python-deps.ps1`
  - **matplotlib backend:** `Agg` در `matplotlibrc` (non-interactive)
  - **معیار:** `python.exe -c "import pandas, matplotlib, openpyxl, reportlab, numpy"` → `OK`.

### S18.3 — PythonRunnerService

- [ ] **S18.3** سرویس `PythonRunnerService` در `src/main/services/pythonRunnerService.ts`:
  - **منطق:** resolve مسیر `python.exe` (dev vs production)، `isAvailable()`، `getVersion()`
  - **معیار:** `isAvailable()` در dev و production درست کار کند. `typecheck:node` تمیز.

---

## بخش ب — Sandbox امن

### S18.4 — AST Validation و whitelist

- [ ] **S18.4** static analysis قبل از اجرای کد Python:
  - **محل:** `src/main/services/pythonSandbox.ts`
  - **whitelist:** `pandas`، `matplotlib`، `numpy`، `openpyxl`، `reportlab`، `json`، `datetime`، `math`، `io`، `csv`، `base64`، `re`، `statistics`
  - **blacklist:** `os`، `subprocess`، `socket`، `http`، `urllib`، `ctypes`، `threading`، `pickle`، `shutil`، `__import__`، `eval`، `exec`، `compile`
  - **validator:** `resources/python/validate_code.py` — کد را parse کند و `OK` یا `REJECTED: <reason>` برگرداند
  - **معیار:** `import os` رد شود. `import pandas` قبول شود. `eval(...)` رد شود. `typecheck:node` تمیز.

### S18.5 — اجرای امن در subprocess

- [ ] **S18.5** کد در subprocess با محدودیت:
  - **timeout:** ۳۰ ثانیه (پیش‌فرض)
  - **no network:** `NO_PROXY=*`، `HTTP_PROXY=`، `HTTPS_PROXY=`
  - **working dir:** temp dir منحصر‌به‌فرد
  - **خروجی (PythonResult):** `success`، `stdout`، `stderr`، `outputFiles[]`، `outputData?`، `error?`، `durationMs`
  - **معیار:** `print("hello")` → `hello`. `time.sleep(60)` → kill بعد از ۳۰s. `typecheck:node` تمیز.

### S18.6 — Wrapper script

- [ ] **S18.6** wrapper پایتون که داده SQL را از stdin بگیرد و کد کاربر را اجرا کند:
  - **محل:** `resources/python/run_wrapper.py`
  - **منطق:** stdin → JSON (rows, plan, output_dir, code) → exec در namespace محدود → stdout → JSON result
  - **نکته:** `exec` در wrapper مجاز است (wrapper خودمان است، کد کاربر AST validation شده)
  - **معیار:** wrapper با `plt.plot([1,2,3]); plt.savefig(output_dir+'/chart.png')` → فایل PNG. `typecheck:node` تمیز.

---

## بخش ج — ادغام با Planner

### S18.7 — PythonOutputPlan schema

- [ ] **S18.7** schema جدید در `types.ts`:
  ```typescript
  interface PythonOutputPlan {
    enabled: boolean
    outputType: 'chart' | 'excel' | 'pdf' | 'csv' | 'html' | 'table'
    chartType?: 'line' | 'bar' | 'pie' | 'scatter' | 'area' | 'heatmap'
    title?: string
    xAxis?: string
    yAxis?: string
    code?: string  // optional — اگر مدل ننوشت، template تولید می‌کند
  }
  ```
  - **معیار:** Zod schema تعریف شود. `typecheck:node` تمیز.

### S18.8 — Planner few-shot examples

- [ ] **S18.8** ۵ نمونه جدید در `planner.ts`:
  1. «نمودار روند فروش ۵ سال» → `chart, line`
  2. «گزارش اکسل فروش ۱۴۰۲» → `excel`
  3. «نمودار میله‌ای مقایسه خرید و فروش» → `chart, bar`
  4. «گزارش PDF ترازنامه» → `pdf`
  5. «نمودار دایره‌ای ترکیب هزینه‌ها» → `chart, pie`
  - **معیار:** Planner برای «نمودار روند فروش» `PythonOutputPlan(chart)` تولید کند. `typecheck:node` تمیز.

### S18.9 — Template engine برای کد پیش‌فرض

- [ ] **S18.9** `src/main/services/financialEngine/pythonTemplates.ts`:
  - اگر `plan.code` موجود → استفاده از آن
  - اگر نه → template بر اساس `outputType` و `chartType`
  - **template خطی:** `df = pd.DataFrame(rows); plt.plot(df[x], df[y]); plt.savefig(...)`
  - **template اکسل:** `df.to_excel(output_dir+'/report.xlsx')`
  - **template PDF:** `SimpleDocTemplate + Table`
  - **معیار:** برای `chart, line` کد معتبر Python تولید شود. `typecheck:node` تمیز.

### S18.10 — ادغام با runPlan

- [ ] **S18.10** در `index.ts` `runPlan`، بعد از اجرای SQL:
  - اگر `plan.pythonOutput?.enabled`: تولید کد → AST validation → اجرای sandbox → دریافت outputFiles
  - اگر Python شکست خورد → fallback به نمایش متنی + لاگ خطا
  - **معیار:** کوئری `total_revenue by_year` + `PythonOutputPlan(chart)` → فایل PNG. شکست Python → fallback متن. `typecheck:node` تمیز.

---

## بخش د — رندر خروجی در UI

### S18.11 — IPC handlers

- [ ] **S18.11** IPC events در `src/main/index.ts`:
  - `python:output-file` — ارسال مسیر فایل به renderer
  - `python:save-file` — `dialog.showSaveDialog` → ذخیره فایل
  - **معیار:** فایل PNG در چت نمایش داده شود. دکمه «دانلود» فایل را ذخیره کند. `typecheck:node` تمیز.

### S18.12 — کامپوننت خروجی در renderer

- [ ] **S18.12** در `src/renderer/index.html`:
  - **PNG:** `<img src="file://...">` + دکمه «ذخیره» و «باز کردن»
  - **XLSX/PDF:** کارت با آیکون + نام + دکمه «دانلود»
  - **HTML:** iframe sandboxed
  - **استایل:** کارت با border نازک، shadow ملایم، عنوان «خروجی نمودار» / «گزارش اکسل»
  - **معیار:** نمودار PNG در چت نمایش داده شود. کاربر بتواند ذخیره کند. `typecheck:node` تمیز.

---

## بخش هـ — تست و اعتبارسنجی

### S18.13 — Unit tests

- [ ] **S18.13** `tests/unit/pythonSandbox.test.ts`:
  1. `isAvailable()` درست گزارش دهد
  2. `runPythonCode("print('hello')")` → `hello`
  3. `runPythonCode("import os")` → رد شود
  4. `runPythonCode("time.sleep(60)")` → kill بعد از timeout
  5. کد نمودار → فایل PNG
  6. کد اکسل → فایل XLSX
  7. template engine برای chart → کد معتبر
  8. whitelist: `pandas` قبول، `socket` رد
  9. `eval("1+1")` در کد کاربر → رد
  10. شکست Python → fallback متن
  - **معیار:** ۱۰ تست pass. `typecheck:node` تمیز.

### S18.14 — Golden cases

- [ ] **S18.14** ۶ golden case جدید در `golden-metrics.json`:
  1. `s18-chart-sales-trend` — نمودار خطی فروش ۵ سال
  2. `s18-chart-sales-vs-purchases` — نمودار میله‌ای مقایسه
  3. `s18-excel-sales-1402` — گزارش اکسل
  4. `s18-pdf-balance-sheet` — گزارش PDF ترازنامه
  5. `s18-chart-expenses-pie` — نمودار دایره‌ای هزینه‌ها
  6. `s18-chart-receivables-aging` — نمودار تحلیل سنی
  - **معیار:** eval سبز. `typecheck:node` تمیز.

### S18.15 — Full Gate

- [ ] **S18.15** `typecheck:node` + `npm test` + `eval:metrics` هم سبز:
  - **معیار:** ۰ خطای typecheck. تمام unit test pass. eval ۲۱۷/۲۱۷ (۲۱۱ + ۶ جدید).

### S18.16 — Build + asar-grep

- [ ] **S18.16** `npm run build:win` + asar-grep:
  - **مارکرها:** `PYTHON_SANDBOX`، `EMBEDDED_PYTHON`، `CODE_EXECUTION`، `CHART_OUTPUT`
  - **معیار:** build موفق. مارکرها در asar پیدا شوند. `python.exe` در `resources/python/` موجود.

### S18.17 — Field test

- [ ] **S18.17** تست میدانی روی سرور ۱۹۲.۱۶۸.۸۵.۵۶:
  - ۵ پرسش نمودار/اکسل/PDF از طریق `ask-ai`
  - **معیار:** ۵/۵ پاسخ با خروجی فایل موفق.

### S18.18 — شاهد S18

- [ ] **S18.18** پر شدن بخش شاهد با فایل‌های تغییر یافته، خطوط، و نتیجه تست.

### S18.19 — به‌روزرسانی OVERVIEW

- [ ] **S18.19** فاز ۱۸ در `FRE_ROADMAP_00_OVERVIEW.fa.md` اضافه شود.

---

## شاهد S18
```
فاز ۱۸ — محیط اجرای پایتون
تاریخ: [پس از تکمیل پر شود]

S18.1 — Python 3.12 embedded:
  - مسیر: resources/python/python.exe
  - نسخه: 3.12.x
  - فایل: electron-builder.yml

S18.2 — کتابخانه‌ها:
  - pandas, matplotlib, openpyxl, reportlab, numpy
  - repo: pypi.org (پیش‌فرض) / pypi.ir (fallback)
  - matplotlib backend: Agg

S18.4 — AST validation:
  - whitelist: pandas, matplotlib, numpy, openpyxl, reportlab, json, datetime, math, io, csv, base64, re, statistics
  - blacklist: os, subprocess, socket, http, urllib, ctypes, threading, pickle, shutil, __import__, eval, exec, compile

S18.5 — Sandbox:
  - timeout: 30s
  - no network: NO_PROXY=*
  - working dir: temp

S18.15 — Full Gate:
  - typecheck:node: [تعداد] errors
  - unit tests: [تعداد] pass
  - eval:metrics: [تعداد]/[تعداد] (X%)

S18.17 — Field test:
  - [تعداد]/[تعداد] OK
  - RequestIds: [پس از تست پر شود]
```
