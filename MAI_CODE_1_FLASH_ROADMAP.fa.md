# نقشه راه اتمیک ACC Assist برای MAI-Code-1-Flash

آخرین بازبینی: 2026-06-14

هدف این سند: اجرای مرحله ای، قابل تست و کم ریسک برای کاهش باگ و نزدیک شدن به Agent مالی شبیه GitHub Copilot.

این سند برای استفاده مستقیم توسط MAI-Code-1-Flash نوشته شده است.

## دستور اجرای اجباری برای MAI-Code-1-Flash

1. فازها فقط به ترتیب اجرا شوند.
2. در هر مرحله فقط همان فاز پیاده سازی شود.
3. بعد از پایان هر فاز، بخش چک لیست همان فاز باید پر شود.
4. اگر فاز fail شد، فاز بعدی اجرا نشود.
5. در هر فاز، خروجی باید شامل شواهد باشد: فایل های تغییر کرده، نتیجه تست، ریسک باقی مانده.

## فایل مرجع عملیات سرور تلمتری

برای دسترسی، بررسی لاگ و عملیات SSH مربوط به تلمتری باید از این راهنما استفاده شود:

- ops/SSH-TELEMETRY-GUIDE.md

## معیار موفقیت سراسری

- پاسخ های KPI مالی بدون ambiguity برگردند.
- پاسخ عددی بدون evidence وجود نداشته باشد.
- خطاهای SQL مربوط به جدول/ستون نامعتبر در intentهای پشتیبانی شده نزدیک صفر شود.
- برای هر incident، trace کامل از UI تا agent-audit و telemetry قابل بازیابی باشد.

---

## فاز A0 - Baseline و Freeze

هدف: ثبت baseline دقیق قبل از تغییر.

کارهای اتمیک:

1. ثبت 20 سوال واقعی اخیر با outcome فعلی.
2. دسته بندی خطاها به: intent drift، KPI ambiguity، schema mismatch، provider instability.
3. ثبت KPIهای پرتکرار که چند تعریف ممکن دارند.

خروجی اجباری:

- baseline report در یک فایل markdown
- لیست سوالات پرریسک

### چک لیست تکمیل فاز A0 (توسط MAI-Code-1-Flash پر شود)

- [ ] baseline report تولید شد
- [ ] 20 سوال واقعی ثبت شد
- [ ] دسته بندی خطاها تکمیل شد
- [ ] ریسک های اصلی تایید شد
- [ ] این فاز PASS شد

---

## فاز A1 - KPI Contract Lock

هدف: تعریف رسمی KPIها قبل از هر query.

کارهای اتمیک:

1. تعریف KPI dictionary برای فروش سالانه: فروش خالص، فروش ناخالص، فروش دفتری.
2. تعریف KPI dictionary برای درصد رشد فروش: فرمول دقیق، سال مبنا، سال هدف.
3. افزودن قانون اجباری: اگر KPI چندتعبیری بود، پاسخ قطعی ممنوع و سوال شفاف ساز اجباری.

خروجی اجباری:

- سند KPI قراردادها
- قوانین rule-based برای ambiguity

### چک لیست تکمیل فاز A1 (توسط MAI-Code-1-Flash پر شود)

- [ ] KPI dictionary فروش ساخته شد
- [ ] KPI dictionary رشد فروش ساخته شد
- [ ] قانون ambiguity پیاده سازی شد
- [ ] تست واحد برای ambiguity اضافه شد
- [ ] این فاز PASS شد

---

## فاز A2 - Clarification First برای KPI مبهم

هدف: رفتار شبیه Copilot در پرسش منظور دقیق کاربر.

کارهای اتمیک:

1. اگر intent به بیش از یک KPI contract map شد، سیستم باید clarification بپرسد.
2. قالب پرسش clarification استاندارد شود:
- منظور شما از فروش کدام است؟
- 1) فروش ناخالص
- 2) فروش خالص
- 3) فروش ثبت شده در اسناد حسابداری
3. بعد از پاسخ کاربر، intent lock شود و برای همان گفتگو cache گردد.

خروجی اجباری:

- Clarification policy
- تست integration برای flow پرسش-پاسخ clarification

### چک لیست تکمیل فاز A2 (توسط MAI-Code-1-Flash پر شود)

- [ ] سیستم ambiguity را تشخیص می دهد
- [ ] clarification استاندارد نمایش داده می شود
- [ ] intent بعد از انتخاب کاربر lock می شود
- [ ] تست integration پاس شد
- [ ] این فاز PASS شد

---

## فاز A3 - Deterministic Routing برای سوالات فروش

هدف: سوالات اصلی فروش تا حد ممکن از مسیر قطعی بروند.

کارهای اتمیک:

1. برای سوالات فروش سال X، مسیر deterministic اختصاصی فعال شود.
2. برای سوالات رشد X نسبت به Y، مسیر deterministic اختصاصی فعال شود.
3. برای هر مسیر deterministic، evidence SQL و definition used ثبت شود.

خروجی اجباری:

- handler قطعی فروش سالانه
- handler قطعی رشد سالانه

### چک لیست تکمیل فاز A3 (توسط MAI-Code-1-Flash پر شود)

- [ ] routing قطعی فروش سالانه فعال شد
- [ ] routing قطعی رشد فعال شد
- [ ] evidence در پاسخ وجود دارد
- [ ] regression test برای paraphrase پاس شد
- [ ] این فاز PASS شد

---

## فاز A4 - Query Preflight Guard

هدف: جلوگیری از queryهای اشتباه قبل از اجرا.

کارهای اتمیک:

1. preflight schema validation قبل از اجرای query model-generated.
2. اگر object یا column نامعتبر بود، اجرای query متوقف و پیام هدایتگر برگردد.
3. auto-repair فقط در محدوده schema معتبر و با سقف retry محدود.

خروجی اجباری:

- preflight validator عملیاتی
- تست منفی برای object/column نامعتبر

### چک لیست تکمیل فاز A4 (توسط MAI-Code-1-Flash پر شود)

- [ ] validator قبل از اجرا فعال است
- [ ] query نامعتبر block می شود
- [ ] پیام فارسی قابل فهم برگشت داده می شود
- [ ] تست منفی پاس شد
- [ ] این فاز PASS شد

---

## فاز A5 - Conversation Hygiene

هدف: کاهش اثر context قبلی روی سوال جدید.

کارهای اتمیک:

1. تعریف پنجره موثر history برای تصمیم گیری intent.
2. افزودن mode سوال مستقل برای KPIهای اصلی.
3. ثبت دلیل تصمیم context در audit.

خروجی اجباری:

- strategy مشخص برای context isolation
- تست مقایسه ای old conversation vs fresh conversation

### چک لیست تکمیل فاز A5 (توسط MAI-Code-1-Flash پر شود)

- [ ] پنجره history اعمال شد
- [ ] حالت سوال مستقل پیاده سازی شد
- [ ] دلیل انتخاب context در audit ثبت می شود
- [ ] تست مقایسه ای پاس شد
- [ ] این فاز PASS شد

---

## فاز A6 - Telemetry Collector Upgrade

هدف: دسترسی مستقیم و پایدار به لاگ collector برای تحلیل یکپارچه.

کارهای اتمیک روی سرور تلمتری:

1. افزودن endpoint امن برای events با فیلتر زمانی:
- from
- to
- requestId
- conversationId
- category
2. افزودن pagination استاندارد:
- limit
- cursor
3. احراز هویت پایدار service-to-service:
- token rotation policy
- expiry و revoke
4. افزودن correlationId/requestId اجباری به payloadها.
5. افزودن retention و archive policy.

خروجی اجباری:

- API عملیاتی و مستند collector
- اسکریپت عملیاتی خواندن بازه زمانی

نکته اجرایی:

- برای دستورات SSH و دسترسی عملیاتی از ops/SSH-TELEMETRY-GUIDE.md استفاده شود.

### چک لیست تکمیل فاز A6 (توسط MAI-Code-1-Flash پر شود)

- [ ] endpoint فیلتر زمانی اضافه شد
- [ ] pagination اضافه شد
- [ ] auth پایدار پیاده سازی شد
- [ ] correlationId/requestId اجباری شد
- [ ] retention policy اعمال شد
- [ ] راهنمای عملیات به روز شد
- [ ] این فاز PASS شد

---

## فاز A7 - Golden Gate v2

هدف: جلوگیری از بازگشت باگ.

کارهای اتمیک:

1. افزودن 60 پرسش واقعی فارسی با expected intent و expected KPI contract.
2. افزودن سناریوهای paraphrase برای فروش و رشد.
3. افزودن gate CI:
- fail در نبود evidence
- fail در KPI inconsistency
- fail در drift intent

خروجی اجباری:

- golden set نسخه بندی شده
- گزارش score برای هر اجرا

### چک لیست تکمیل فاز A7 (توسط MAI-Code-1-Flash پر شود)

- [ ] golden set کامل شد
- [ ] paraphrase coverage تکمیل شد
- [ ] gate CI فعال شد
- [ ] score baseline ثبت شد
- [ ] این فاز PASS شد

---

## فاز A8 - UX شفاف سازی مدیریتی

هدف: پاسخ قابل فهم برای مدیر مالی.

کارهای اتمیک:

1. نمایش نوع KPI استفاده شده کنار عدد.
2. نمایش deterministic یا model-assisted بودن پاسخ.
3. نمایش پیام شفاف در صورت نیاز به clarification.
4. نمایش علت fail به زبان ساده و اقدام بعدی.

خروجی اجباری:

- UX پاسخ استاندارد مدیریتی

### چک لیست تکمیل فاز A8 (توسط MAI-Code-1-Flash پر شود)

- [ ] KPI type در UI نمایش داده می شود
- [ ] نوع مسیر پاسخ نمایش داده می شود
- [ ] clarification UX واضح است
- [ ] خطاها actionable هستند
- [ ] این فاز PASS شد

---

## قالب گزارش اجباری بعد از هر فاز

پس از پایان هر فاز، MAI-Code-1-Flash باید این قالب را پر کند:

- نام فاز:
- وضعیت: PASS یا FAIL
- فایل های تغییر کرده:
- تست های اجرا شده:
- نتیجه تست ها:
- ریسک باقی مانده:
- تصمیم ادامه: ادامه به فاز بعد یا توقف

---

## شرط توقف اضطراری

در هر فاز اگر هرکدام از موارد زیر رخ دهد، اجرای roadmap متوقف شود:

1. نقض read-only policy
2. افت numeric consistency زیر threshold
3. حذف evidence از پاسخ مالی
4. ناتوانی در trace incident با requestId

این roadmap فقط برای محدوده read-only است و هیچ اقدام write به دیتابیس را مجاز نمی کند.
