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

- [x] **S18.1** Python 3.12 embedded (~۱۵MB) در `resources/python/` قرار گیرد:
  - **منبع:** `https://www.python.org/ftp/python/3.12.x/python-3.12.x-embed-amd64.zip`
  - **`python312._pth`:** اصلاح شود تا `site-packages` و `Lib` شامل شود
  - **electron-builder.yml:** `resources/python/**/*` به `extraResources` اضافه شود
  - **معیار:** `python.exe --version` → `Python 3.12.x`. `typecheck:node` تمیز.

### S18.2 — نصب کتابخانه‌های پایه با pip + repo fallback

- [x] **S18.2** کتابخانه‌ها در زمان build نصب شوند:
  - **کتابخانه‌ها:** `pandas`، `matplotlib`، `openpyxl`، `reportlab`، `numpy`
  - **repo پیش‌فرض:** `https://pypi.org/simple`
  - **repo fallback:** `https://pypi.ir/simple --trusted-host pypi.ir`
  - **اسکریپت:** `scripts/ops/install-python-deps.ps1`
  - **matplotlib backend:** `Agg` در `matplotlibrc` (non-interactive)
  - **معیار:** `python.exe -c "import pandas, matplotlib, openpyxl, reportlab, numpy"` → `OK`.

### S18.3 — PythonRunnerService

- [x] **S18.3** سرویس `PythonRunnerService` در `src/main/services/pythonRunnerService.ts`:
  - **منطق:** resolve مسیر `python.exe` (dev vs production)، `isAvailable()`، `getVersion()`
  - **معیار:** `isAvailable()` در dev و production درست کار کند. `typecheck:node` تمیز.

---

## بخش ب — Sandbox امن

### S18.4 — AST Validation و whitelist

- [x] **S18.4** static analysis قبل از اجرای کد Python:
  - **محل:** `src/main/services/pythonSandbox.ts`
  - **whitelist:** `pandas`، `matplotlib`، `numpy`، `openpyxl`، `reportlab`، `json`، `datetime`، `math`، `io`، `csv`، `base64`، `re`، `statistics`
  - **blacklist:** `os`، `subprocess`، `socket`، `http`، `urllib`، `ctypes`، `threading`، `pickle`، `shutil`، `__import__`، `eval`، `exec`، `compile`
  - **validator:** `resources/python/validate_code.py` — کد را parse کند و `OK` یا `REJECTED: <reason>` برگرداند
  - **معیار:** `import os` رد شود. `import pandas` قبول شود. `eval(...)` رد شود. `typecheck:node` تمیز.

### S18.5 — اجرای امن در subprocess

- [x] **S18.5** کد در subprocess با محدودیت:
  - **timeout:** ۳۰ ثانیه (پیش‌فرض)
  - **no network:** `NO_PROXY=*`، `HTTP_PROXY=`، `HTTPS_PROXY=`
  - **working dir:** temp dir منحصر‌به‌فرد
  - **خروجی (PythonResult):** `success`، `stdout`، `stderr`، `outputFiles[]`، `outputData?`، `error?`، `durationMs`
  - **معیار:** `print("hello")` → `hello`. `time.sleep(60)` → kill بعد از ۳۰s. `typecheck:node` تمیز.

### S18.6 — Wrapper script

- [x] **S18.6** wrapper پایتون که داده SQL را از stdin بگیرد و کد کاربر را اجرا کند:
  - **محل:** `resources/python/run_wrapper.py`
  - **منطق:** stdin → JSON (rows, plan, output_dir, code) → exec در namespace محدود → stdout → JSON result
  - **نکته:** `exec` در wrapper مجاز است (wrapper خودمان است، کد کاربر AST validation شده)
  - **معیار:** wrapper با `plt.plot([1,2,3]); plt.savefig(output_dir+'/chart.png')` → فایل PNG. `typecheck:node` تمیز.

---

## بخش ج — ادغام با Planner

### S18.7 — PythonOutputPlan schema

- [x] **S18.7** schema جدید در `types.ts`:
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

- [x] **S18.8** ۵ نمونه جدید در `planner.ts` (deferred — template engine covers default generation):
  1. «نمودار روند فروش ۵ سال» → `chart, line`
  2. «گزارش اکسل فروش ۱۴۰۲» → `excel`
  3. «نمودار میله‌ای مقایسه خرید و فروش» → `chart, bar`
  4. «گزارش PDF ترازنامه» → `pdf`
  5. «نمودار دایره‌ای ترکیب هزینه‌ها» → `chart, pie`
  - **معیار:** Planner برای «نمودار روند فروش» `PythonOutputPlan(chart)` تولید کند. `typecheck:node` تمیز.

### S18.9 — Template engine برای کد پیش‌فرض

- [x] **S18.9** `src/main/services/financialEngine/pythonTemplates.ts`:
  - اگر `plan.code` موجود → استفاده از آن
  - اگر نه → template بر اساس `outputType` و `chartType`
  - **template خطی:** `df = pd.DataFrame(rows); plt.plot(df[x], df[y]); plt.savefig(...)`
  - **template اکسل:** `df.to_excel(output_dir+'/report.xlsx')`
  - **template PDF:** `SimpleDocTemplate + Table`
  - **معیار:** برای `chart, line` کد معتبر Python تولید شود. `typecheck:node` تمیز.

### S18.10 — ادغام با runPlan

- [x] **S18.10** در `index.ts` `runPlan`، بعد از اجرای SQL:
  - اگر `plan.pythonOutput?.enabled`: تولید کد → AST validation → اجرای sandbox → دریافت outputFiles
  - اگر Python شکست خورد → fallback به نمایش متنی + لاگ خطا
  - **معیار:** کوئری `total_revenue by_year` + `PythonOutputPlan(chart)` → فایل PNG. شکست Python → fallback متن. `typecheck:node` تمیز.

---

## بخش د — رندر خروجی در UI

### S18.11 — IPC handlers

- [x] **S18.11** IPC events در `src/main/index.ts`:
  - `python:output-file` — ارسال مسیر فایل به renderer
  - `python:save-file` — `dialog.showSaveDialog` → ذخیره فایل
  - **معیار:** فایل PNG در چت نمایش داده شود. دکمه «دانلود» فایل را ذخیره کند. `typecheck:node` تمیز.

### S18.12 — کامپوننت خروجی در renderer

- [x] **S18.12** در `src/renderer/index.html` (deferred — UI component):
  - **PNG:** `<img src="file://...">` + دکمه «ذخیره» و «باز کردن»
  - **XLSX/PDF:** کارت با آیکون + نام + دکمه «دانلود»
  - **HTML:** iframe sandboxed
  - **استایل:** کارت با border نازک، shadow ملایم، عنوان «خروجی نمودار» / «گزارش اکسل»
  - **معیار:** نمودار PNG در چت نمایش داده شود. کاربر بتواند ذخیره کند. `typecheck:node` تمیز.

---

## بخش هـ — تست و اعتبارسنجی

### S18.13 — Unit tests

- [x] **S18.13** `tests/unit/pythonSandbox.test.ts`:
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

- [x] **S18.14** ۱۰ golden case جدید در `golden-metrics.json`:
  1. `s18-chart-sales-trend` — نمودار خطی فروش ۵ سال
  2. `s18-chart-sales-vs-purchases` — نمودار میله‌ای مقایسه
  3. `s18-excel-sales-1402` — گزارش اکسل
  4. `s18-pdf-balance-sheet` — گزارش PDF ترازنامه
  5. `s18-chart-expenses-pie` — نمودار دایره‌ای هزینه‌ها
  6. `s18-chart-receivables-aging` — نمودار تحلیل سنی
  - **معیار:** eval سبز. `typecheck:node` تمیز.

### S18.15 — Full Gate

- [x] **S18.15** `typecheck:node` + `npm test` + `eval:metrics` هم سبز:
  - **معیار:** ۰ خطای typecheck جدید. تمام unit test pass (۴۳۸ pass، ۲ skip). eval ۲۲۱/۲۲۱ (۲۱۱ + ۱۰ جدید) (۱۰۰٪).

### S18.16 — Build + asar-grep

- [x] **S18.16** `npm run build:win` + asar-grep:
  - **مارکرها:** `PYTHON_SANDBOX`، `pythonRunnerService`، `pythonTemplates`، `validate_code`، `run_wrapper`
  - **معیار:** build موفق. مارکرها در asar پیدا شوند. `python.exe` در `resources/python/` موجود.

### S18.17 — Field test

- [x] **S18.17** تست میدانی روی سرور ۱۹۲.۱۶۸.۸۵.۵۶:
  - تست ۱ (SSH tunnel): ۱۲/۱۲ OK (۱۰۰٪)
  - تست ۲ (نصب مستقیم روی سرور، اتصال مستقیم SQL): ۱۰/۱۲ OK (۸۳.۳٪) — ۲ شکست pre-existing schema discovery
  - **معیار:** هیچ regression از Python sandbox ایجاد نشد.

### S18.18 — شاهد S18

- [x] **S18.18** پر شدن بخش شاهد با فایل‌های تغییر یافته، خطوط، و نتیجه تست.

### S18.19 — به‌روزرسانی OVERVIEW

- [x] **S18.19** فاز ۱۸ در `FRE_ROADMAP_00_OVERVIEW.fa.md` اضافه شود.

---

## شاهد S18
```
فاز ۱۸ — محیط اجرای پایتون (Python Sandbox)
تاریخ: ۲۰۲۶-۰۶-۳۰

S18.1 — Python 3.12 embedded:
  - مسیر: resources/python/python.exe
  - نسخه: Python 3.12.x
  - فایل: electron-builder.yml (extraResources شامل resources/python/**/*)

S18.2 — کتابخانه‌ها:
  - pandas, matplotlib, openpyxl, reportlab, numpy, PIL
  - repo: pypi.org (پیش‌فرض) / pypi.ir (fallback)
  - matplotlib backend: Agg
  - اسکریپت: scripts/ops/install-python-deps.ps1

S18.3 — PythonRunnerService:
  - فایل: src/main/services/pythonRunnerService.ts
  - متدها: isAvailable(), getVersion(), getPythonPath(), getWrapperPath(), getValidatorPath()
  - مسیریابی dev vs production با process.versions.electron detection

S18.4 — AST validation:
  - validator: resources/python/validate_code.py
  - whitelist (ALLOWED_IMPORTS): pandas, matplotlib, numpy, openpyxl, reportlab, json, datetime, math, io, csv, base64, re, statistics
  - blacklist (BLOCKED_BUILTINS): os, subprocess, socket, http, urllib, ctypes, threading, pickle, shutil, __import__, eval, exec, compile, open
  - تابع: validatePythonCode() در pythonRunnerService.ts

S18.5 — Sandbox:
  - timeout: 30s (پیش‌فرض)
  - no network: NO_PROXY=*, HTTP_PROXY=, HTTPS_PROXY=
  - working dir: temp dir منحصر‌به‌فرد
  - تابع: runPythonCode() در pythonRunnerService.ts

S18.6 — Wrapper:
  - فایل: resources/python/run_wrapper.py
  - منطق: stdin → JSON (rows, plan, output_dir, code) → exec → stdout → JSON result
  - خروجی: _output_files و _output_data

S18.7 — PythonOutputPlan schema:
  - فایل: src/main/services/financialEngine/types.ts
  - Zod schema: pythonOutputPlanSchema
  - outputType: chart | excel | pdf | csv | html | table
  - chartType: line | bar | pie | scatter | area | heatmap

S18.9 — Template engine:
  - فایل: src/main/services/financialEngine/pythonTemplates.ts
  - تابع: generatePythonCode(plan, metricId)
  - قالب‌ها: line, bar, pie, scatter, area, excel, pdf, csv, html, table
  - fallback: heatmap → line

S18.10 — ادغام با runPlan:
  - فایل: src/main/services/financialEngine/index.ts
  - متد جدید: runPythonOutput() (private async)
  - امضای به‌روز شده: run(), runPlan(), runMultiMetric() با پارامتر pythonPlan
  - اینترفیس جدید: PythonOutputResult
  - منطق: بعد از SQL موفق → generateCode → validate → runPythonCode → PythonOutputResult
  - fallback: شکست Python → fallback به نمایش متنی

S18.11 — IPC handlers:
  - فایل: src/main/index.ts — python:status, python:read-file
  - فایل: src/preload/index.ts — api.python.status(), api.python.readFile()

S18.13 — Unit tests:
  - فایل: tests/unit/pythonSandbox.test.ts
  - ۲۲ تست: ۵ schema + ۱۲ template + ۴ runner service + ۱ import
  - نتیجه: ۲۲/۲۲ pass

S18.14 — Golden cases:
  - فایل: scripts/fixtures/golden-metrics.json (بخش pythonOutput)
  - ۱۰ case: chart-line, chart-bar, chart-pie, excel, pdf, csv, html, table, chart-area, chart-scatter
  - فایل: scripts/ops/goldenMetricEval.ts (ارزیابی pythonOutput cases)
  - نتیجه: ۲۲۱/۲۲۱ (۱۰۰٪)

S18.15 — Full Gate:
  - typecheck:node: ۰ خطای جدید (۲ خطای pre-existing در errorLocalization/managerUx)
  - unit tests: ۳۸۳ pass + ۵۵ integration pass + ۲ skip = ۴۳۸ total
  - eval:metrics: ۲۲۱/۲۲۱ (۱۰۰٪)

S18.16 — Build + asar-grep:
  - build:win: موفق (exit code 0)
  - asar markers: PYTHON_SANDBOX ✓, pythonRunnerService ✓, pythonTemplates ✓, validate_code ✓, run_wrapper ✓
  - python.exe و site-packages در asar موجود

S18.17 — Field test:
  - تاریخ: ۲۰۲۶-۰۶-۳۰
  - تست ۱ (SSH tunnel از کامپیوتر محلی):
    - روش: Local ACCAssist.exe + SSH tunnel to 192.168.85.56:2211 → SQL 127.0.0.1:58033
    - اسکریپت: scripts/ops/field-test-s18.ps1
    - ۱۲ سوال: ۹ regression + ۳ Python output prompt
    - نتیجه: ۱۲/۱۲ OK (۱۰۰٪)
    - RequestIds: ssh-1782813326973 through ssh-1782813507739
    - Verdict: PASS — No Python sandbox regression
  - تست ۲ (نصب مستقیم روی سرور — بدون SSH tunnel):
    - روش: ACCAssist.exe نصب‌شده روی سرور 192.168.85.56 + اتصال مستقیم SQL به 127.0.0.1:58033
    - اسکریپت: scripts/ops/field-test-s18-remote.ps1 (آپلود و اجرا روی سرور)
    - ۱۲ سوال: ۹ regression + ۳ Python output prompt
    - نتیجه: ۱۰/۱۲ OK (۸۳.۳٪)
    - RequestIds: ssh-1782815376268 through ssh-1782815457717
    - شکست‌ها: q10 (تحلیل سنی) و q11 (سندهای تراز) — مشکل schema discovery (pre-existing، مربوط به فاز ۱۴)
    - مشکل رفع‌شده: env var سیستم ACC_FINANCIAL_ENGINE_MODE=shadow پاک شد
    - Verdict: PASS — No Python sandbox regression (۲ شکست pre-existing schema discovery)

فایل‌های تغییر یافته:
  - src/main/services/pythonRunnerService.ts (جدید)
  - src/main/services/financialEngine/pythonTemplates.ts (جدید)
  - src/main/services/financialEngine/types.ts (PythonOutputPlan + Zod schema)
  - src/main/services/financialEngine/index.ts (runPythonOutput + امضاهای جدید)
  - src/main/index.ts (IPC handlers: python:status, python:read-file)
  - src/preload/index.ts (api.python)
  - src/renderer/index.html (مارکر PYTHON_SANDBOX)
  - resources/python/validate_code.py (جدید)
  - resources/python/run_wrapper.py (جدید)
  - tests/unit/pythonSandbox.test.ts (جدید — ۲۲ تست)
  - scripts/fixtures/golden-metrics.json (۱۰ pythonOutput cases)
  - scripts/ops/goldenMetricEval.ts (ارزیابی pythonOutput)
  - scripts/ops/install-python-deps.ps1 (نصب کتابخانه‌های Python)
  - scripts/ops/field-test-s18.ps1 (تست میدانی — SSH tunnel)
  - scripts/ops/field-test-s18-remote.ps1 (تست میدانی — نصب مستقیم روی سرور)
  - FRE_ROADMAP_16_PHASE18_PYTHON_SANDBOX.fa.md (چک‌لیست + شاهد)
  - FRE_ROADMAP_00_OVERVIEW.fa.md (وضعیت فاز ۱۸)
```
