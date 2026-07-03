# FRE Roadmap 28 — سری تأیید و پوشش: نمای کلی و معیارهای سخت‌گیرانه
### Verification & Coverage Series (فازهای ۲۹ تا ۳۲) — «از ۶ عددِ تأییدشده به کلِ کاتالوگِ اثبات‌شده»

> این سند ریشهٔ «سری تأیید» است. پیش از اجرای هر فازِ ۲۹–۳۲ باید کامل خوانده شود.
> مخاطبِ پیاده‌ساز: مدلِ heavy-lifting (GLM 5.2). تمرکزِ این سری **فقط سپیدار** است. این سری هیچ ویژگیِ نمایشیِ جدید اضافه نمی‌کند؛ کارش **اثباتِ درستیِ عددیِ آنچه هست** و **رشدِ داده‌محورِ پوشش** است.

---

## ۲۸.۰ — چرا این سری (وضعیتِ سنجیده)

پس از تأییدِ مستقلِ فازهای ۲۳–۲۸ (مهاجرت به engine-only، ضدِّ توهم)، یک ممیزیِ زندهٔ مستقل روی `Sepidar01` انجام شد:

- **۶ متریکِ هسته با sqlcmdِ مستقل تأیید شدند** (engine == DB، دقیق):
  | متریک | عددِ تأییدشدهٔ ۱۴۰۲ | روش |
  |---|---|---|
  | net_sales | 64,252,437,897 | SUM(NetPriceInBaseCurrency) SLS.Invoice |
  | trial_balance | 566,396,483,280 | SUM(Debit)=SUM(Credit) با Type NOT IN(3,4) — متوازن |
  | cash_bank_balance | 9,521,507,066 | RPA.CashBalance + RPA.BankAccountBalance |
  | receivables | 14,392,491,310 | Debit−Credit، سرفصلِ ۱۲/۱۳ زیرِ ۱۱ |
  | payables | −26,058,866,504 | Debit−Credit، سرفصلِ ۱۰/۱۲ زیرِ ۲۱ |

- **ولی کاتالوگ ۶۸ متریکِ پایه دارد** → یعنی درستیِ عددیِ ~۶۲ متریکِ دیگر **هنوز مستقل تأیید نشده**. تست‌ها با mock سبزند و بنچ‌مارکِ golden فقط planning را می‌سنجد. **این تنها ریسکِ جدیِ «آمادگیِ تولید روی سپیدار» است.**

## ۲۸.۱ — ریسکِ ویژهٔ متریک‌های حسابداری
متریک‌های حسابداری (aging، تطبیق، مالیات، چک، استهلاک، صورت‌های مالی) هم **پرکاربردترین** و هم **پیچیده‌ترین** و هم **پرخطاترین** برای منطق‌اند — و حسابدار به عددِ غلط صفر تحمل دارد (مسئولیتِ حرفه‌ای). پس این‌ها بالاترین اولویتِ تأییدند.

---

## ۲۸.۲ — نقشهٔ فازها

| فاز | فایل | هدف |
|---|---|---|
| ۲۹ | `FRE_ROADMAP_29_PHASE29_GROUNDTRUTH_SWEEP.fa.md` | سوییپِ ground-truthِ همهٔ متریک‌های اسکالر + رجیستریِ تأیید + رفعِ probe |
| ۳۰ | `FRE_ROADMAP_30_PHASE30_ACCOUNTANT_DEEP_VERIFICATION.fa.md` | تأییدِ عمیقِ متریک‌های پیچیدهٔ حسابدار (تطبیق/aging/مالیات/چک/استهلاک) + پذیرشِ حسابدار |
| ۳۱ | `FRE_ROADMAP_31_PHASE31_REFUSAL_ANALYTICS_COVERAGE.fa.md` | حلقهٔ تحلیلِ ردها و رشدِ داده‌محورِ پوشش |
| ۳۲ | `FRE_ROADMAP_32_PHASE32_PER_DEPLOYMENT_CALIBRATION.fa.md` | کالیبراسیونِ ground-truth به‌ازای هر مشتری (سرفصلِ سفارشی) |
| ۳۳ | `FRE_ROADMAP_33_PHASE33_VERIFICATION_INTEGRITY.fa.md` | بازدرجه‌بندیِ سخت‌گیرانهٔ رجیستری + رفعِ نقص‌های اثبات‌شده (purchases/tax/لیستی) + پاسِ دومنبعیِ زنده |
| ۳۴ | `FRE_ROADMAP_34_PHASE34_CALIBRATION_RUNTIME_WIRING.fa.md` | بستنِ شکافِ wiring (نگاشتِ کشف‌شده واقعاً اعمال شود) + رجیستریِ per-deployment (S32.8) |
| ۳۵ | `FRE_ROADMAP_35_PHASE35_CALIBRATION_UI.fa.md` | UIِ کالیبراسیون: مرور/تأیید/اصلاحِ نگاشت توسطِ کاربر و حسابدار (S32.5) |

ترتیبِ اجرا اجباری: ۲۹ → ۳۰ → ۳۱ → ۳۲ → ۳۳ → ۳۴ → ۳۵.

> **فازهای ۳۳–۳۵ از ممیزیِ مستقلِ زنده زاده شدند** (نه از رودمپِ اولیه): ممیزی نشان داد رجیستریِ فاز ۲۹ «۴۶ verified» را با معیارِ شل‌شده ثبت کرده (فقط ۵ دومنبعیِ واقعی)، `purchases`/`tax` نقصِ واقعی دارند، و کالیبراسیونِ فاز ۳۲ در زمانِ اجرا اعمال نمی‌شود. این سه فاز آن‌ها را می‌بندند و مواردِ موکول‌شدهٔ S32.5/S32.8 را هم پوشش می‌دهند.

---

## ۲۸.۳ — قراردادِ سخت‌گیرانهٔ «تأییدشده» (هستهٔ این سری)

> بازتعریفِ سخت‌گیرانهٔ قانونِ ۲۱.۲. در این سری، «تأییدشده» یک ادعا نیست؛ یک **وضعیتِ ماشین‌خوان با شاهدِ خام** است.

### تعریفِ «متریکِ تأییدشده» (Definition of Verified)
یک متریک فقط زمانی `verified` می‌شود که **همهٔ** شرایطِ زیر برقرار باشد:
1. **اوراکلِ مستقل:** یک کوئریِ SQLِ **دست‌نوشتهٔ مستقل** (نه تولیدِ موتور، نه کپیِ تعریفِ متریک) نوشته و در رجیستری ثبت شده باشد.
2. **تطبیقِ دومنبعی:** خروجیِ موتور (از audit با `requestId`) با خروجیِ اوراکل یکی باشد (`diff=0`، یا برای درصد/گرد کردن، `tolerance` صریحِ ثبت‌شده).
3. **شاهدِ خام:** خروجیِ خامِ sqlcmd **و** خطِ `final`/`engine-served` موتور با requestId **کپیِ کامل** ضمیمه شده باشد.
4. **تاریخ‌دار و نسخه‌دار:** تاریخِ تأیید + hashِ کامیت ثبت شده باشد.

### ممنوعیت‌های سخت
- **تغییرِ اوراکل برای تطبیق با موتور ممنوع** (قانونِ ۲۱.۲/§۳). اگر نخواندند، اول موتور مشکوک است.
- **`verified` بدونِ شاهدِ خام ممنوع.** عبارتِ «تست شد/درست است» بی‌ارزش است.
- **skip بدونِ دلیلِ مکتوبِ ثبت‌شده ممنوع.**
- **متریکِ لیستی** (خروجیِ چندردیفی مثل `unbalanced_vouchers`) با یک عدد تأیید نمی‌شود؛ نیازمندِ **مرورِ منطق + نمونه‌گیریِ ≥۳ ردیف** با sqlcmdِ مستقل است.

### وضعیت‌های مجاز در رجیستری (نه فقط verified/unverified)
- `verified` — طبق تعریفِ بالا.
- `unverified` — هنوز تأیید نشده.
- `not_applicable` — ماژولِ مربوطه در این نصب استفاده نمی‌شود (مثلاً استهلاک/بودجه) → خروجیِ خالی/صفر **باگ نیست**؛ باید با یک کوئریِ «آیا این ماژول داده دارد؟» اثبات شود.
- `needs_accountant_review` — عدد از DB می‌آید ولی **درستیِ منطقِ حرفه‌ای** (روشِ استهلاک، مرزِ aging، فرمتِ صورتِ مالی) نیازمندِ تأییدِ یک حسابدارِ واقعی است.

---

## ۲۸.۴ — رجیستریِ تأیید (Verified-Metrics Registry) — خروجیِ مرکزیِ سری

- فایلِ `scripts/fixtures/metric-verification-registry.json` ساخته شود؛ برای **هر ۶۸ متریک** یک رکورد:
  ```json
  {
    "metricId": "receivables",
    "status": "verified",
    "expectedValue": 14392491310,
    "fiscalYear": "1402",
    "oracleSql": "SELECT SUM(vi.Debit-vi.Credit) ...",
    "engineRequestId": "ssh-...",
    "diff": 0,
    "tolerance": 0,
    "verifiedAt": "2026-07-...",
    "commit": "<hash>",
    "notes": "سرفصل 12/13 زیر 11"
  }
  ```
- ۵ متریکِ هسته (بالا) به‌عنوان **بذرِ رجیستری** با وضعیتِ `verified` وارد شوند.
- یک اسکریپتِ `npm run verify:registry` که درصدِ تأیید را گزارش می‌دهد: `verified / total`، تفکیک‌شده بر اساسِ tier و status. **معیارِ کلیدیِ موفقیتِ کلِ سری همین درصد است.**

---

## ۲۸.۵ — لایه‌بندیِ اولویت (Tiers)

| Tier | متریک‌ها | چرا اول |
|---|---|---|
| **T1** (اول) | trial_balance, trial_balance_check, receivables, payables, receivables_aging, payables_aging, net_sales, purchases, net_profit, income_statement, balance_sheet, sales_reconciliation, cash_bank_balance | پرکاربرد + خودتطبیق + حساسیتِ بالا |
| **T2** | cogs, inventory_value, tax_paid/collected, vat_liability, tax_monthly_summary, checks_due/summary/bounced, voucher_detail, account_turnover, party_turnover, cashflow, sales_by_period | کاربردِ روزمرهٔ حسابدار |
| **T3** | depreciation_summary, fixed_assets_register, cost_center_*, project_*, budget_*, inventory_turnover, trend_analysis, bank_reconciliation, cash_flow_statement | تخصصی/ماژول‌محور (ممکن است `not_applicable`) |

---

## ۲۸.۶ — دستورهای مرجع (روش تأییدِ زنده)

اتصال از راهنمای [ops/SSH-TELEMETRY-GUIDE.md](ops/SSH-TELEMETRY-GUIDE.md):
```powershell
# اجرای sqlcmd مستقل روی سرور اصلی (sqlcmd.exe موجود است؛ Invoke-Sqlcmd نیست)
# server 192.168.85.56:2211 → sqlcmd.exe → 127.0.0.1,58033 Sepidar01 (damavand/damavand)
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "<pw>" administrator@192.168.85.56 "<remote-powershell-that-runs-sqlcmd.exe>"

# مسیرِ sqlcmd روی ریموت:
# C:\Program Files\Microsoft SQL Server\100\Tools\Binn\SQLCMD.EXE -S 127.0.0.1,58033 -U damavand -P damavand -d Sepidar01 -i <tmp.sql> -h -1 -W -b

# تأییدِ خروجیِ موتور (نیازمند برنامهٔ در‌حال‌اجرا روی ریموت):
scripts/ops/remote-server-control.ps1 -Action ask-ai -PromptFile <fa.txt> -ConversationId <id> -DebugToken <token>
```
> قواعدِ همیشگی: پرامپت کوتاه؛ بدنهٔ UTF-8؛ پس از deploy حتماً asar-grep؛ بدونِ تأییدِ صریحِ کاربر به origin push نکن.

---

## ۲۸.۷ — الگوی گزارشِ اجباری هر تسک

```
### S29.x — <عنوان>
- وضعیت: DONE
- متریک(ها): <id>
- اوراکلِ sqlcmd: <query>
- خروجیِ خامِ sqlcmd: <کپی>
- خروجیِ موتور: requestId=<...> value=<...>
- diff: 0 (یا tolerance مستند)
- رجیستری: به‌روز شد (status=verified)
```
تسکِ بدونِ این بلوک = انجام‌نشده.
