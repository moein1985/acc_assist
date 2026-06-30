# FRE Roadmap 15 — فاز ۱۷: اصلاحات معماری (Architecture Fixes)
### پایداری، پختگی تولید، و رفع باگ‌های ساختاری پس از فاز ۱۶

> پیش‌نیاز: فاز ۱۶ کامل. SSH tunnel کار می‌کند. ۱۲/۱۲ field test PASS. باگ‌های معماری شناسایی شده‌اند.

**مارکرهای asar این فاز:** `ARCH_FIXES_PHASE17`.

---

## ۰ — نقشهٔ فاز

| بخش | موضوع | اندازه |
|---|---|---|
| الف | پایداری تونل و اتصال (backpressure، pool cleanup) | متوسط |
| ب | پختگی تولید (لاگ‌های DIAG، cache، notification) | کوچک–متوسط |
| ج | پاکسازی کد (redundant calls، double reads) | کوچک |
| د | تست و اعتبارسنجی | کوچک |

---

## ۱ — انگیزه و دامنه

### وضعیت پس از فاز ۱۶
- تونل SSH با `ssh2` کار می‌کند — ۱۲/۱۲ field test PASS ✅
- `setNoDelay` bug fix اعمال شده ✅
- Manual data forwarding بین socket و stream پیاده‌سازی شده ✅
- Auto-connect، auto-reconnect، host key verification، credential encryption فعال ✅

### مشکلات فعلی
- **عدم مدیریت Backpressure** — `stream.write()` و `socket.write()` خروجی بررسی نمی‌شود؛ در بار بالا می‌تواند باعث OOM شود
- **عدم بسته شدن SQL Pool هنگام قطع تونل** — وقتی تونل قطع و reconnect می‌شود، pool قدیمی hang می‌ماند
- **لاگ‌های DIAG در کد تولید** — ۳۰+ `console.error` با پیشوند `[DIAG]` در کد تولید باقی مانده‌اند
- **`resolveRuntimeSqlConnection` در هر کوئری** — overhead اضافی در هر کوئری
- **`setNoDelay` دو بار صدا زده می‌شود** — redundant
- **`pruneExpiredEvents` فایل را دو بار می‌خواند** — overhead دیسک
- **`autoDiscoverSchema` fire-and-forget** — شکست به کاربر اطلاع داده نمی‌شود

### هدف
- پایداری تونل در بار بالا و شرایط شبکه ناپایدار
- پختگی تولید: لاگ‌های کنترل‌شده، cache، notification کاربر
- کد تمیز و بدون redundant calls

---

## بخش الف — پایداری تونل و اتصال

### S17.1 — مدیریت Backpressure در ارسال دستی دیتا

- [x] **S17.1** وقتی `stream.write(data)` مقدار `false` برمی‌گرداند، `socket.pause()` صدا زده شود و پس از رویداد `drain` روی `stream`، `socket.resume()` شود. همین منطق برای `socket.write(data)` و `stream.pause()/resume()`:
  - **محل:** `src/main/services/sshTunnelService.ts` — `createForwardServer` callback
  - **منطق:**
    ```typescript
    socket.on('data', (data: Buffer) => {
      const ok = stream.write(data)
      if (!ok) {
        socket.pause()
        stream.once('drain', () => socket.resume())
      }
    })
    stream.on('data', (data: Buffer) => {
      const ok = socket.write(data)
      if (!ok) {
        stream.pause()
        socket.once('drain', () => stream.resume())
      }
    })
    ```
  - **نکته:** لاگ‌های DIAG باید در این مرحله حذف یا به debug flag منتقل شوند (S17.3)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test با mock stream که `write` مقدار `false` برمی‌گرداند و بررسی می‌کند که `socket.pause()` صدا زده شده.

### S17.2 — بسته شدن SQL Pool هنگام قطع تونل SSH

- [x] **S17.2** وقتی تونل SSH قطع می‌شود (در `handleTunnelError`)، `SqlConnectionManager` باید pool را ببندد:
  - **محل:** `src/main/services/sshTunnelService.ts` — `handleTunnelError` + `src/main/services/sqlConnectionManager.ts`
  - **منطق:**
    1. `SshTunnelService` یک event به نام `tunnel-closed` emit کند
    2. در `index.ts`، listener روی `tunnel-closed`، `sqlConnectionManager.close()` را صدا بزند
    3. این تضمین می‌کند که pool قدیمی با پورت محلی قدیمی بسته شود و کوئری‌های بعدی pool جدید با پورت جدید بسازند
  - **نکته:** `close()` از قبل در `SqlConnectionManager` وجود دارد و pool را async می‌بندد
  - **معیارِ پذیرش:** تونل قطع شود → pool بسته شود → reconnect تونل → کوئری بعدی pool جدید بسازد → کوئری موفق. `typecheck:node` تمیز.

---

## بخش ب — پختگی تولید

### S17.3 — محدود کردن لاگ‌های DIAG به debug flag

- [x] **S17.3** تمام `console.error` با پیشوند `[DIAG` فقط وقتی `process.env.ACC_DEBUG_SSH === '1'` (یا `ACC_DEBUG_SQL === '1'` یا `ACC_DEBUG_MAIN === '1'`) چاپ شوند:
  - **محل:** `src/main/services/sshTunnelService.ts` (حدود ۱۵ لاگ) + `src/main/services/sqlConnectionManager.ts` (حدود ۱۵ لاگ)
  - **منطق:**
    ```typescript
    const DEBUG_SSH = process.env.ACC_DEBUG_SSH === '1'
    // جایگزینی:
    if (DEBUG_SSH) console.error(`[DIAG ...] ...`)
    ```
  - **نکته:** لاگ‌های غیر-DIAG (مثل خطاهای واقعی یا `addLog`) باید باقی بمانند
  - **معیارِ پذیرش:** بدون `ACC_DEBUG_SSH=1` هیچ لاگ DIAG چاپ نشود. با flag لاگ‌ها چاپ شوند. `typecheck:node` تمیز.

### S17.4 — Cache نتیجه `resolveRuntimeSqlConnection`

- [x] **S17.4** نتیجه `resolveRuntimeSqlConnection` کش شود تا در هر کوئری `sshTunnelService.start()` صدا زده نشود:
  - **محل:** `src/main/index.ts` — `resolveRuntimeSqlConnection`
  - **منطق:**
    1. یک متغیر `cachedRuntimeConnection: SqlConnectionConfig | null` نگه‌داری شود
    2. اگر tunnel status فعال است و config تغییر نکرده، از cache استفاده شود
    3. وقتی تونل قطع یا reconnect می‌شود (پورت تغییر می‌کند)، cache invalidate شود
  - **نکته:** `sshTunnelService.start()` از قبل چک می‌کند که تونل فعال است، ولی این cache آن بررسی را هم حذف می‌کند
  - **معیارِ پذیرش:** در ۲ کوئری متوالی، `sshTunnelService.start()` فقط یک بار صدا زده شود. `typecheck:node` تمیز.

### S17.5 — Surface کردن شکست `autoDiscoverSchema` به UI

- [x] **S17.5** اگر `autoDiscoverSchema` شکست بخورد، یک notification به renderer ارسال شود:
  - **محل:** `src/main/index.ts` — `autoDiscoverSchema` + renderer IPC
  - **منطق:**
    1. در catch blockِ `autoDiscoverSchema`، یک IPC event به renderer بفرست: `mainWindow.webContents.send('schema:discovery-failed', { profileId, database, error })`
    2. در renderer، یک toast/notification نمایش بده
  - **معیارِ پذیرش:** schema discovery شکست بخورد → toast در UI نمایش داده شود. `typecheck:node` تمیز.

---

## بخش ج — پاکسازی کد

### S17.6 — حذف `setNoDelay` مضاعف

- [x] **S17.6** `socket.setNoDelay(true)` در `forwardOut` callback (خط ۳۲۹) حذف شود چون قبلاً در `createServer` callback (خط ۲۹۵) صدا زده شده:
  - **محل:** `src/main/services/sshTunnelService.ts:329`
  - **معیارِ پذیرش:** `typecheck:node` تمیز. تونل همچنان کار کند.

### S17.7 — اصلاح `pruneExpiredEvents` با double read

- [x] **S17.7** در `telemetryIngestService.ts`، `this.eventLogEntries()` در `pruneExpiredEvents` دو بار صدا زده می‌شود — باید در یک متغیر ذخیره شود:
  - **محل:** `src/main/services/telemetryIngestService.ts` — `pruneExpiredEvents`
  - **منطق:**
    ```typescript
    const entries = this.eventLogEntries()
    const eventEntries = pruneList(entries)
    if (eventEntries.length !== entries.length) { ... }
    ```
  - **معیارِ پذیرش:** `typecheck:node` تمیز. `npm test` سبز.

---

## بخش د — تست و اعتبارسنجی

### S17.8 — typecheck + unit test سبز

- [x] **S17.8** `typecheck:node` بدون خطای جدید + `npm test` تمام test‌های قبلی سبز:
  - **معیارِ پذیرش:** ۰ خطای typecheck جدید. تمام unit test‌های موجود pass شوند.

### S17.9 — ثبتِ شواهد در «شاهد S17»

- [x] **S17.9** پر شدن بخش شاهد با جزئیات هر step:
  - **معیارِ پذیرش:** شاهد پر شده با فایل‌های تغییر یافته، خطوط، و نتیجه تست.

### S17.10 — به‌روزرسانی OVERVIEW

- [x] **S17.10** فایل `FRE_ROADMAP_00_OVERVIEW.fa.md` با فاز ۱۷ به‌روز شود:
  - **معیارِ پذیرش:** فاز ۱۷ در جدول فازها و جدول وضعیت اضافه شده.

---

## شاهد S17
```
فاز ۱۷ — تمام مراحل پیاده‌سازی شد

تاریخ: ۲۰۲۶-۰۶-۲۹

S17.1 — Backpressure handling در sshTunnelService.ts:
  - stream.on('data') و socket.on('data') با بررسی write() return value
  - pause/resume + drain event برای جلوگیری از OOM
  - فایل: src/main/services/sshTunnelService.ts

S17.2 — Close SQL pool هنگام قطع تونل:
  - در index.ts، listener روی sshTunnelService 'status-changed' وقتی !status.active:
    cachedRuntimeConnection = null + sqlConnectionManager.close()
  - فایل: src/main/index.ts

S17.3 — Gate DIAG logs:
  - sshTunnelService.ts: ACC_DEBUG_SSH=1 (۱۵+ لاگ)
  - sqlConnectionManager.ts: ACC_DEBUG_SQL=1 (۱۵+ لاگ)
  - index.ts: ACC_DEBUG_MAIN=1 (۵+ لاگ)
  - فایل‌ها: sshTunnelService.ts, sqlConnectionManager.ts, index.ts

S17.4 — Cache resolveRuntimeSqlConnection:
  - cachedRuntimeConnection با signature-based invalidation
  - Invalidated در settings:save و tunnel status-changed
  - فایل: src/main/index.ts

S17.5 — Surface autoDiscoverSchema failures:
  - IPC event 'schema:discovery-failed' به renderer در catch block
  - فایل: src/main/index.ts

S17.6 — Remove duplicate setNoDelay:
  - حذف socket.setNoDelay(true) از forwardOut callback
  - فایل: src/main/services/sshTunnelService.ts

S17.7 — Fix double eventLogEntries():
  - ذخیره در currentEntries متغیر قبل از pruneList
  - فایل: src/main/services/telemetryIngestService.ts

S17.8 — Full Gate:
  - typecheck:node: 0 errors ✅
  - unit tests: 361 pass, 0 fail, 1 skip ✅
  - integration tests: 55 pass, 0 fail, 1 skip ✅

S17.10 — OVERVIEW به‌روز شد:
  - فاز ۱۷ به جدول فازها اضافه شد
  - ترتیب اجرا به‌روز شد
```
