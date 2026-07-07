# راهنمای اتصال به سرورها (SSH، Plink، Telemetry)

این فایل شامل تمام دستورات و نکات مورد نیاز برای اتصال و مدیریت سرورها است.

---

## 📋 اطلاعات سرورها

| سرور | آدرس | پورت | کاربر | نوع |
|------|------|------|------|-----|
| **اپلیکیشن (Sepidar)** | 192.168.85.56 | 2211 | administrator | Windows Server (SSH) |
| **تست بلایند (Mahak)** | 192.168.85.15 | 2211 | administrator | Windows Server (SSH) |
| **تلمتری** | 192.168.85.84 | 8081 | - | Node.js (HTTP) |
| **Proxmox** | 192.168.85.37 | 22 | root | Linux (SSH) |

---

## 🔐 اطلاعات احراز هویت

```powershell
# سرور اصلی — Sepidar (192.168.85.56)
$ServerHost = "192.168.85.56"
$Port = 2211
$User = "administrator"
$Password = "Hs-co@12321#"
$HostKey = "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ"

# سرور تست بلایند — Mahak (192.168.85.15)
$BlindHost = "192.168.85.15"
$BlindPort = 2211
$BlindUser = "administrator"
$BlindPassword = "Hs-co@12321#"
$BlindHostKey = "ssh-ed25519 255 SHA256:SYxH9M23XV3h6WgGMS++8rw9byMflH5SfHEwE+SIolo"

# سرور تلمتری (192.168.85.84)
$TelemetryHost = "192.168.85.84"
$TelemetryPort = 8081
```

---

## 🚀 اتصال سریع به سرور اصلی

### روش 1: استفاده از دستور npm (سهل‌ترین)

```powershell
# وضعیت سرور
npm run remote:status -- -ServerHost 192.168.85.56 -User administrator -Password 'Hs-co@12321#' -HostKey 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'

# شروع برنامه
npm run remote:start -- -ServerHost 192.168.85.56 -User administrator -Password 'Hs-co@12321#' -HostKey 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'

# متوقف کردن برنامه
npm run remote:stop -- -ServerHost 192.168.85.56 -User administrator -Password 'Hs-co@12321#' -HostKey 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'

# دیدن لاگ‌ها (آخرین 60 خط)
npm run remote:logs -- -ServerHost 192.168.85.56 -User administrator -Password 'Hs-co@12321#' -HostKey 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ' -Tail 60
```

### روش 2: استفاده مستقیم از Plink

```powershell
# دستور کلی plink
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "COMMAND"
```

#### مثال‌های عملی:

```powershell
# دیدن لاگ اجرا
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Get-Content 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log' -Tail 30"

# دیدن تمام فایل‌های لاگ
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Get-ChildItem 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\'"

# وضعیت فرایند
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Get-Process ACCAssist -ErrorAction SilentlyContinue"

# مسیرهای مهم
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Write-Host 'App Path:' 'C:\Users\Administrator\AppData\Local\Programs\acc-assist\ACCAssist.exe'; Write-Host 'Logs Path:' 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\'; Write-Host 'Settings:' 'C:\Users\Administrator\AppData\Roaming\acc-assist\settings.json'"
```

---

## 📊 مشاهده لاگ‌های سرور اصلی

### لاگ Audit (تاریخچه تماس‌ها):

```powershell
# آخرین 30 خط
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Get-Content 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log' -Tail 30"

# فیلتر کردن خطاها
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Select-String 'error' 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log' -CaseSensitive:$false"

# مشاهده یک requestId خاص
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Select-String 'REQUEST_ID_HERE' 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log'"
```

### لاگ Telemetry Events:

```powershell
# آخرین رویدادها
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Get-Content 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\telemetry-events.ndjson' -Tail 20"

# تعداد رویدادها
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "(Get-Content 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\telemetry-events.ndjson' | Measure-Object -Line).Lines"
```

---

## 📡 سرور تلمتری (192.168.85.84:8081)

### بررسی سلامت سرور تلمتری:

```powershell
# از هر کجای شبکه
Invoke-RestMethod -Uri "http://192.168.85.84:8081/health"

# مثال پاسخ v2.0.0:
# {"ok":true,"service":"acc-telemetry-collector","version":"2.0.0","ts":"...","storedEvents":184}
```

### دیدن رویدادهای دریافتی (v2 - فیلتردار):

> نکته: کالکتور از نسخه 2.0.0 از فیلترهای پیشرفته پشتیبانی می‌کند.
> توکن از Proxmox: `plink -P 22 -ssh -batch -pw "PROXMOX_PASS" root@192.168.85.37 "pct exec 205 -- sh -c 'cat /etc/acc-telemetry/token'"`

```powershell
# --- توکن را یکبار بخوانید ---
$token = (plink -P 22 -ssh -batch -pw "Hs-co@12321#" root@192.168.85.37 "pct exec 205 -- sh -c 'cat /etc/acc-telemetry/token'").Trim()
$h = @{ Authorization = "Bearer $token" }

# آخرین 50 رویداد (بدون فیلتر)
Invoke-RestMethod -Uri "http://192.168.85.84:8081/events?limit=50" -Headers $h

# فیلتر بر اساس requestId خاص
Invoke-RestMethod -Uri ("http://192.168.85.84:8081/events?limit=100&requestId=REQ-UUID-HERE") -Headers $h

# فیلتر بر اساس conversationId
Invoke-RestMethod -Uri ("http://192.168.85.84:8081/events?limit=100&conversationId=conv-UUID-HERE") -Headers $h

# فیلتر بر اساس category (مثال: ipc.handler برای خطاها)
Invoke-RestMethod -Uri "http://192.168.85.84:8081/events?limit=50&category=ipc.handler" -Headers $h

# فیلتر بازه زمانی (from/to با ISO 8601)
$from = [System.DateTime]::UtcNow.AddHours(-1).ToString("o")
$to   = [System.DateTime]::UtcNow.ToString("o")
Invoke-RestMethod -Uri ("http://192.168.85.84:8081/events?limit=100&from=" + [Uri]::EscapeDataString($from) + "&to=" + [Uri]::EscapeDataString($to)) -Headers $h

# ترکیب چند فیلتر: category + بازه زمانی
$from = [System.DateTime]::UtcNow.AddHours(-2).ToString("o")
Invoke-RestMethod -Uri ("http://192.168.85.84:8081/events?limit=100&category=ipc.handler&from=" + [Uri]::EscapeDataString($from)) -Headers $h

# Pagination - صفحه بعدی (cursor = nextCursor از پاسخ قبلی)
Invoke-RestMethod -Uri "http://192.168.85.84:8081/events?limit=50&cursor=50" -Headers $h
```

### خواندن رویداد از فایل مستقیم در Proxmox (بدون توکن):

```powershell
# آخرین 50 رویداد از فایل
plink -P 22 -ssh -batch -pw "Hs-co@12321#" root@192.168.85.37 "pct exec 205 -- sh -c 'tail -50 /var/lib/acc-telemetry/events.ndjson'"

# جستجو بر اساس requestId
plink -P 22 -ssh -batch -pw "Hs-co@12321#" root@192.168.85.37 "pct exec 205 -- sh -c 'grep REQ-UUID-HERE /var/lib/acc-telemetry/events.ndjson'"
```

### تشخیص مشکلات تلمتری:

```powershell
# بررسی اتصال از سرور اپلیکیشن
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Test-NetConnection 192.168.85.84 -Port 8081"

# تست ارسال تلمتری
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Invoke-WebRequest -Uri 'http://192.168.85.84:8081/health' -ErrorAction SilentlyContinue"
```

---

## 🔧 دستورات مفید

### ریست کردن صف تلمتری:

```powershell
# پاک کردن فایل صف (Queue)
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Remove-Item 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\telemetry-queue.ndjson' -Force"
```

### نصب مجدد برنامه:

```powershell
cd "c:\Users\Moein\Documents\Codes\ACC Assist"

# حذف نسخه قدیمی
npm run remote:uninstall -- -ServerHost 192.168.85.56 -User administrator -Password 'Hs-co@12321#' -HostKey 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'

# ساخت و نصب نسخه جدید
npm run build:win
npm run remote:install -- -ServerHost 192.168.85.56 -User administrator -Password 'Hs-co@12321#' -HostKey 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'

# شروع برنامه
npm run remote:start -- -ServerHost 192.168.85.56 -User administrator -Password 'Hs-co@12321#' -HostKey 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'
```

---

## 🔗 Debug Endpoint

### اتصال محلی به Debug Endpoint:

```powershell
# ایجاد SSH Tunnel (از ترمینال جدا باز کنید)
ssh -L 3322:127.0.0.1:3322 administrator@192.168.85.56 -p 2211

# سپس در ترمینال دیگر
Invoke-RestMethod -Uri "http://127.0.0.1:3322/ask" -Method Post -ContentType "application/json" -Body @{
    prompt = "یک سوال تست"
} | ConvertTo-Json

# یا برای Health Check
Invoke-WebRequest -Uri "http://127.0.0.1:3322/health"
```

---

## 📝 نکات مهم

### 1. کلید SSH Host Key

اگر خطا گرفتید که "Host key not recognized"، می‌توانید بدون تایید کلید استفاده کنید:

```powershell
# بدون تایید کلید (کمتر امن)
plink -P 2211 -ssh -batch -pw "Hs-co@12321#" administrator@192.168.85.56 "COMMAND"
```

### 2. فشرده‌سازی خروجی

برای دستورات بلند، خروجی را فشرده کنید:

```powershell
$output = plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Get-Content 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log' -Tail 30"
$output | ConvertFrom-Json
```

### 3. خودکار‌سازی با Environment Variables

```powershell
# ذخیره کردن رمز عبور (محتاط باشید!)
$env:ACC_REMOTE_HOST = "192.168.85.56"
$env:ACC_REMOTE_USER = "administrator"
$env:ACC_REMOTE_SSH_PASSWORD = "Hs-co@12321#"
$env:ACC_REMOTE_HOST_KEY = "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ"

# سپس از npm بدون پارامتر استفاده کنید
npm run remote:status
```

### 4. مسیرهای فایل‌ها

| فایل | مسیر |
|-----|------|
| Audit Log | `C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log` |
| Telemetry Events | `C:\Users\Administrator\AppData\Roaming\acc-assist\logs\telemetry-events.ndjson` |
| Telemetry Queue | `C:\Users\Administrator\AppData\Roaming\acc-assist\logs\telemetry-queue.ndjson` |
| Settings | `C:\Users\Administrator\AppData\Roaming\acc-assist\settings.json` |
| Executable | `C:\Users\Administrator\AppData\Local\Programs\acc-assist\ACCAssist.exe` |

---

## 🎯 دستورات مکرر

### چک‌لیست روزانه:

```powershell
# 1. وضعیت برنامه
npm run remote:status -- -ServerHost 192.168.85.56 -User administrator -Password 'Hs-co@12321#' -HostKey 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'

# 2. تعداد لاگ‌ها
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Write-Host 'Audit:' ((Get-Content 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log' | Measure-Object -Line).Lines) 'lines'; Write-Host 'Telemetry:' ((Get-Content 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\telemetry-events.ndjson' | Measure-Object -Line).Lines) 'events'"

# 3. آخرین خطاها
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Select-String 'error' 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log' -CaseSensitive:$false | Select-Object -Last 10"

# 4. سلامت تلمتری
Invoke-WebRequest -Uri "http://192.168.85.84:8081/health" -ErrorAction SilentlyContinue | ConvertTo-Json
```

---

## 🆘 عیب‌یابی

### مشکل: نمی‌تواند به سرور متصل شود

```powershell
# بررسی شبکه
Test-NetConnection 192.168.85.56 -Port 2211

# اگر هنگ کرد، شاید فایروال است
# بررسی OpenSSH Windows
Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH*'
```

### مشکل: خطای احراز هویت

```powershell
# بررسی رمز عبور صحیح است
# اگر رمز عبور دارای نویسه خاص است، آن را escape کنید:
# ' -> ''
# مثال: 'Hs-co@12321#' -> 'Hs-co@12321#'
```

### مشکل: Host Key تغییر یافته

```powershell
# اگر Host Key جدید است، آپدیت کنید:
plink -P 2211 -ssh administrator@192.168.85.56
# (این کلید را ذخیره می‌کند)
```

---

---

## 🧪 سرور تست بلایند — Mahak (192.168.85.15)

این سرور برای تست auto-discovery روی نرم‌افزار حسابداری **مهک (Mahak)** استفاده می‌شود.
نرم‌افزار مهک نصب شده ولی هنوز دیتابیس کاربری ایجاد نشده است.

### اطلاعات سرور:

| مورد | مقدار |
|------|-------|
| **آدرس** | 192.168.85.15 |
| **پورت SSH** | 2211 |
| **کاربر** | administrator |
| **رمز عبور** | Hs-co@12321# |
| **Host Key** | ssh-ed25519 255 SHA256:SYxH9M23XV3h6WgGMS++8rw9byMflH5SfHEwE+SIolo |
| **Hostname** | Mahak |
| **OS** | Windows Server 2022 (Build 20348) |

### اطلاعات SQL Server:

| مورد | مقدار |
|------|-------|
| **نسخه** | SQL Server 2014 (SP2) Enterprise (64-bit) — 12.0.5000.0 |
| **Instance** | MSSQL12.MAHAK (named instance: MAHAK) |
| **پورت** | 50492 (dynamic) |
| **Service Name** | MSSQL$MAHAK |
| **یوزر SQL** | _TODO — بعداً اضافه شود_ |
| **پسورد SQL** | _TODO — بعداً اضافه شود_ |
| **دیتابیس** | _TODO — بعداً اضافه شود_ |

> ⚠️ **توجه:** یوزر و پسورد SQL هنوز در دسترس نیست. بعداً توسط کاربر ارائه خواهد شد.

### نرم‌افزارهای نصب‌شده:

- **مهک (Mahak)** — نرم‌افزار حسابداری (در `C:\Program Files (x86)\Mahak`، فقط Updater نصب است)
- **تامین (Tamin)** — نرم‌افزار قدیمی VB6 (در `C:\Program Files (x86)\Tamin`، دارای DBF/MDB)
- **DorsanDesk** — ابزار Remote Desktop (در `C:\Program Files\DorsanDesk`)

### اتصال به سرور:

```powershell
# دستور کلی plink برای سرور Mahak
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:SYxH9M23XV3h6WgGMS++8rw9byMflH5SfHEwE+SIolo" -pw "Hs-co@12321#" administrator@192.168.85.15 "COMMAND"
```

#### مثال‌های عملی:

```powershell
# وضعیت SQL Server
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:SYxH9M23XV3h6WgGMS++8rw9byMflH5SfHEwE+SIolo" -pw "Hs-co@12321#" administrator@192.168.85.15 "sc query state= all | findstr SQL"

# پورت SQL Server
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:SYxH9M23XV3h6WgGMS++8rw9byMflH5SfHEwE+SIolo" -pw "Hs-co@12321#" administrator@192.168.85.15 "powershell.exe -NoProfile -c Get-Content 'C:\Program Files\Microsoft SQL Server\MSSQL12.MAHAK\MSSQL\Log\ERRORLOG' -TotalCount 50" 2>&1 | findstr /i listening

# لیست دیتابیس‌ها (نیاز به یوزر SQL دارد)
# TODO: بعد از دریافت یوزر SQL، دستور زیر را تکمیل کنید:
# plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:SYxH9M23XV3h6WgGMS++8rw9byMflH5SfHEwE+SIolo" -pw "Hs-co@12321#" administrator@192.168.85.15 "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\Administrator\query_dbs.ps1"

# بررسی فایل‌های دیتابیس (.mdf)
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:SYxH9M23XV3h6WgGMS++8rw9byMflH5SfHEwE+SIolo" -pw "Hs-co@12321#" administrator@192.168.85.15 "powershell.exe -NoProfile -c Get-ChildItem 'C:\' -Recurse -Filter '*.mdf' -Name -ErrorAction SilentlyContinue"
```

### اجرای SQL Query (بعد از دریافت یوزر SQL):

```powershell
# فایل اسکریپت query روی سرور:
# C:\Users\Administrator\query_dbs.ps1 (قبلاً آپلود شده)
# محتوا:
#   $sqlcmd = 'C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\110\Tools\Binn\SQLCMD.EXE'
#   & $sqlcmd -S localhost,50492 -E -Q "SELECT name FROM sys.databases ORDER BY name" -W
#
# نکته: -E برای Windows Auth است. بعد از دریافت یوزر SQL،
# پارامترها را به -U <user> -P <pass> تغییر دهید.
```

---

## 🖥️ اتصال برنامه ACC Assist به سرور از راه دور (SSH Remote Connection)

> **فاز ۱۶** — قابلیت اتصال برنامه نصب‌شده روی کامپیوتر حسابدار به سرور از طریق تونل SSH.
> برنامه روی کامپیوتر شخصی نصب می‌شود و از طریق شبکه (LAN/WAN) به سرور متصل می‌شود.

### معماری اتصال

```
┌─────────────────────────────┐       SSH Tunnel (port forwarding)       ┌──────────────────────────┐
│   کامپیوتر حسابدار (Client)  │  localPort ──────────────────────────►   │   سرور (Remote)          │
│                              │                                          │                          │
│   ACC Assist (Electron)      │          127.0.0.1:localPort             │   SSH Server (port 2211) │
│     ├── SshTunnelService     │  ──────────────────────────────────────► │     └── forward to SQL   │
│     │     └── ssh2 Client    │                                          │         127.0.0.1:1433   │
│     ├── SqlConnectionManager │                                          │         (یا 50492)       │
│     │     └── mssql Pool     │                                          │                          │
│     └── ConnectionManager    │                                          │   SQL Server             │
│         └── SchemaAdapter    │                                          │     ├── Sepidar01        │
│                              │                                          │     └── Mahak DB         │
└─────────────────────────────┘                                          └──────────────────────────┘
```

### روش ۱: اتصال با Connection Wizard (پیشنهادی)

این روش از طریق رابط کاربری برنامه انجام می‌شود و نیازی به دانش فنی ندارد.

#### مراحل:

1. **نصب برنامه:** `ACC Assist` را روی کامپیوتر حسابدار نصب کنید (`npm run build:win` یا دانلود installer).
2. **باز کردن برنامه:** در اولین اجرا، Connection Wizard خودکار نمایش داده می‌شود.
3. **انتخاب نوع اتصال:** «SQL از طریق تونل SSH» را انتخاب کنید.
4. **اطلاعات SSH:**
   - **آدرس سرور SSH:** `192.168.85.56`
   - **پورت SSH:** `2211`
   - **نام کاربری:** `administrator`
   - **رمز عبور:** `Hs-co@12321#`
   - کلیک روی «تست اتصال SSH» → باید سبز شود.
5. **اطلاعات SQL Server:**
   - **آدرس:** `127.0.0.1` (محلی از طریق تونل)
   - **پورت:** `58033` (پورت SQL Server روی سرور)
   - **نام کاربری:** `damavand`
   - **رمز عبور:** `damavand`
   - کلیک روی «تست اتصال SQL» → باید سبز شود.
6. **انتخاب دیتابیس:** از لیست، `Sepidar01` را انتخاب کنید.
7. **انتخاب نرم‌افزار:** «سپیدار (پیش‌فرض)» را انتخاب کنید.
8. **نام پروفایل:** مثلاً «دفتر مرکزی - سپیدار» → کلیک روی «ذخیره».

بعد از این، برنامه خودکار در هر بار اجرا به سرور متصل می‌شود.

### روش ۲: اتصال دستی از طریق تنظیمات

اگر Connection Wizard در دسترس نیست، می‌توانید از صفحه تنظیمات استفاده کنید:

#### تنظیمات SSH:

| فیلد | مقدار |
|------|-------|
| **فعال‌سازی تونل SSH** | ✅ روشن |
| **آدرس سرور SSH** | `192.168.85.56` |
| **پورت SSH** | `2211` |
| **نام کاربری SSH** | `administrator` |
| **رمز عبور SSH** | `Hs-co@12321#` |
| **آدرس مقصد SQL** | `127.0.0.1` |
| **پورت مقصد SQL** | `58033` |
| **پورت محلی** | (خالی — خودکار انتخاب می‌شود) |

#### تنظیمات SQL:

| فیلد | مقدار |
|------|-------|
| **آدرس سرور** | `127.0.0.1` |
| **پورت** | (پورت محلی تونل — بعد از شروع تونل آپدیت می‌شود) |
| **نام دیتابیس** | `Sepidar01` |
| **نام کاربری** | `damavand` |
| **رمز عبور** | `damavand` |
| **رمزگذاری** | ✅ روشن |
| **Trust Server Certificate** | ✅ روشن |

#### مراحل اتصال:

1. کلیک روی «شروع تونل SSH» → باید پیام «تونل فعال شد» نمایش داده شود.
2. کلیک روی «تست اتصال SQL» → باید پیام «SQL connection is healthy» نمایش داده شود.
3. ذخیره تنظیمات.

### روش ۳: اتصال با کلید خصوصی (Private Key)

برای امنیت بیشتر، می‌توانید به‌جای رمز عبور از کلید خصوصی SSH استفاده کنید:

#### تولید کلید روی سرور (یکبار):

```powershell
# روی سرور 192.168.85.56
ssh-keygen -t ed25519 -f C:\Users\Administrator\.ssh\acc_assist_key -N ""
# کلید عمومی را به authorized_keys اضافه کنید:
Add-Content C:\Users\Administrator\.ssh\authorized_keys (Get-Content C:\Users\Administrator\.ssh\acc_assist_key.pub)
# کلید خصوصی (acc_assist_key) را به کامپیوتر حسابدار منتقل کنید
```

#### تنظیمات SSH با کلید خصوصی:

| فیلد | مقدار |
|------|-------|
| **فعال‌سازی تونل SSH** | ✅ روشن |
| **آدرس سرور SSH** | `192.168.85.56` |
| **پورت SSH** | `2211` |
| **نام کاربری SSH** | `administrator` |
| **رمز عبور SSH** | (خالی) |
| **کلید خصوصی SSH** | (محتوای فایل `acc_assist_key` — یا با file picker انتخاب کنید) |
| **Passphrase** | (در صورت نیاز) |

### اتصال به سرور Mahak (192.168.85.15)

برای اتصال به سرور تست بلایند Mahak، از همان مراحل بالا با مقادیر زیر استفاده کنید:

| فیلد | مقدار |
|------|-------|
| **آدرس سرور SSH** | `192.168.85.15` |
| **پورت SSH** | `2211` |
| **نام کاربری SSH** | `administrator` |
| **رمز عبور SSH** | `Hs-co@12321#` |
| **Host Key** | `ssh-ed25519 255 SHA256:SYxH9M23XV3h6WgGMS++8rw9byMflH5SfHEwE+SIolo` |
| **آدرس مقصد SQL** | `127.0.0.1` |
| **پورت مقصد SQL** | `50492` |
| **نام کاربری SQL** | _TODO — بعداً اضافه شود_ |
| **رمز عبور SQL** | _TODO — بعداً اضافه شود_ |

> ⚠️ **توجه:** یوزر و پسورد SQL Server مهک هنوز در دسترس نیست. بعد از دریافت، در جدول بالا تکمیل خواهد شد.

### عیب‌یابی اتصال SSH

#### مشکل: تونل SSH برقرار نمی‌شود

```powershell
# ۱. بررسی دسترسی شبکه به سرور
Test-NetConnection 192.168.85.56 -Port 2211

# ۲. تست دستی SSH
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "echo connected"

# ۳. بررسی سرویس SSH روی سرور
Get-Service sshd  # روی سرور اجرا شود
```

#### مشکل: SQL متصل نمی‌شود (تونل برقرار است)

```powershell
# ۱. بررسی پورت SQL روی سرور
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "netstat -an | findstr 58033"

# ۲. تست SQL از روی سرور
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "sqlcmd -S 127.0.0.1,58033 -U damavand -P damavand -Q 'SELECT 1 AS ok' -W"

# ۳. بررسی فایروال روی سرور
plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "Get-NetFirewallRule -DisplayName '*SQL*' | Select-Object DisplayName,Enabled,Direction"
```

#### مشکل: Host Key تغییر کرده

اگر سرور بازسازی شده و host key تغییر کرده:

1. در برنامه، هشدار «کلید سرور تغییر کرده» نمایش داده می‌شود.
2. اگر مطمئن هستید سرور امن است، کلیک روی «اعتماد و ادامه».
3. host key جدید خودکار ذخیره می‌شود.

یا به‌صورت دستی:

```powershell
# حذف host key قدیمی از settings
# در فایل settings.json، بخش sshHostKeys، کلید "192.168.85.56:2211" را حذف کنید
# سپس برنامه را restart کنید
```

#### مشکل: اتصال قطع و وصل می‌شود

- برنامه خودکار ۳ بار تلاش reconnect می‌کند (با delay افزایشی: ۱s, ۲s, ۴s).
- اگر پس از ۳ تلاش موفق نشد، status chip قرمز می‌شود.
- بررسی کنید: آیا شبکه پایدار است؟ آیا فایروال session‌های طولانی را قطع می‌کند؟
- در تنظیمات پیشرفته، `keepaliveIntervalMs` را کاهش دهید (مثلاً ۱۵۰۰۰).

### ساخت و نصب نسخه جدید

```powershell
cd "c:\Users\Moein\Documents\Codes\ACC Assist"

# ساخت نسخه ویندوز
npm run build:win

# نصب روی کامپیوتر محلی (تست)
# فایل installer از dist/ اجرا کنید

# نصب روی سرور از راه دور (deploy)
npm run remote:uninstall -- -ServerHost 192.168.85.56 -User administrator -Password 'Hs-co@12321#' -HostKey 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'
npm run remote:install -- -ServerHost 192.168.85.56 -User administrator -Password 'Hs-co@12321#' -HostKey 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'
npm run remote:start -- -ServerHost 192.168.85.56 -User administrator -Password 'Hs-co@12321#' -HostKey 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'
```

### اطلاعات اتصال سریع (Quick Reference)

| سرور | SSH Host | SSH Port | SQL Port | SQL User | SQL Pass | DB Name | Host Key |
|------|----------|----------|----------|----------|----------|---------|----------|
| **Sepidar** | 192.168.85.56 | 2211 | 58033 | damavand | damavand | Sepidar01 | `SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ` |
| **Mahak** | 192.168.85.15 | 2211 | 50492 | _TODO_ | _TODO_ | _TODO_ | `SHA256:SYxH9M23XV3h6WgGMS++8rw9byMflH5SfHEwE+SIolo` |

---

## ⚡ عملیاتِ سریع (Remote Ops Toolkit)

> **فاز ۴۳** — ماژولِ یکپارچهٔ `remote-server-control.ps1` با اکشن‌های جدید.
> همهٔ دستورات با `npm run remote:*` قابل اجرا هستند.
> پارامترهای SSH می‌توانند با Environment Variables تنظیم شوند (بخش ۳ را ببینید).

### تنظیمِ Environment Variables (یک‌بار)

```powershell
$env:ACC_REMOTE_HOST = "192.168.85.56"
$env:ACC_REMOTE_USER = "administrator"
$env:ACC_REMOTE_SSH_PASSWORD = "Hs-co@12321#"
$env:ACC_REMOTE_HOST_KEY = "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ"
$env:ACC_REMOTE_SQL_USER = "damavand"
$env:ACC_REMOTE_SQL_PASSWORD = "damavand"
```

### استقرارِ سریعِ app.asar (deploy-asar)

کلِ چرخهٔ stop → copy asar → (اختیاری write settings) → start در یک دستور:

```powershell
# بدون نوشتنِ settings (فقط asar کپی شود)
npm run remote:deploy-asar -- -LocalBuildDir dist/win-unpacked

# با نوشتنِ settings + اجرا در debug mode
npm run remote:deploy-asar -- -LocalBuildDir dist2/win-unpacked -WriteSettings -DebugMode

# با debug token مشخص
npm run remote:deploy-asar -- -LocalBuildDir dist2/win-unpacked -WriteSettings -DebugMode -DebugToken accassist-s39-field-test
```

### پرسش از AI (ask-ai) — با پشتیبانیِ فارسی

```powershell
# پرسشِ فارسی (base64 خودکار تبدیل می‌شود — دیگر mojibake نیست)
npm run remote:ask-ai -- -Prompt "مانده طرف حساب معین محسنی فرد"

# با debug token
npm run remote:ask-ai -- -Prompt "فروش ۱۴۰۲" -DebugToken accassist-s39-field-test

# با base64 از پیش محاسبه‌شده
npm run remote:ask-ai -- -PromptBase64 "2YXYp9mG2K/ZhyDYt9ix2YEg2K3Ys9in2Kgg2YXYuduM2YYg2YXYrdiz2YbbjCDZgdix2K8="
```

### پرسشِ دسته‌ای (ask-batch) — چند پرسش در یک نشستِ SSH

فایلِ JSON با فرمت:
```json
[
  { "id": "q1", "prompt": "فروش ۱۴۰۲", "expectedMetricId": "net_sales" },
  { "id": "q2", "prompt": "خرید ۱۴۰۲", "expectedMetricId": "total_purchases" },
  { "id": "q3", "prompt": "مانده طرف حساب معین محسنی فرد", "expectedMetricId": "party_balance" }
]
```

```powershell
# از فایل
npm run remote:ask-batch -- -QuestionsFile scripts/ops/test-questions.json

# با debug mode و timeout طولانی‌تر
npm run remote:ask-batch -- -QuestionsFile scripts/ops/test-questions.json -DebugToken accassist-test -QueryTimeoutSec 300 -QuestionDelaySec 5
```

خروجی: جدولِ نتایج با `id, verdict, requestId, finalTextLen` + پیش‌نمایشِ متن.

### بررسیِ سلامتِ Debug Endpoint (health)

```powershell
npm run remote:health
# خروجی: "Debug endpoint: HEALTHY" یا "NOT RUNNING"
```

### جستجوی Audit Log (audit-log)

```powershell
# بر اساسِ requestId
npm run remote:audit -- -RequestId ssh-1783407621593

# آخرین N خط
npm run remote:audit -- -Tail 30
```

### نوشتنِ settings.json (write-settings)

```powershell
# با تنظیماتِ پیش‌فرضِ Sepidar
npm run remote:write-settings -- -SqlDatabase Sepidar01 -SqlUser damavand -SqlPassword damavand -SqlPort 58033
```

### مرورِ کاملِ دستورات

| دستور | توضیح |
|-------|-------|
| `npm run remote:status` | وضعیتِ فرایند + تنظیمات + فایل‌های لاگ |
| `npm run remote:start` | شروعِ برنامه |
| `npm run remote:stop` | توقفِ برنامه |
| `npm run remote:restart` | راه‌اندازیِ مجدد |
| `npm run remote:deploy-asar` | استقرارِ app.asar (+ settings + debug) |
| `npm run remote:ask-ai` | یک پرسش از AI (پشتیبانیِ فارسی) |
| `npm run remote:ask-batch` | چند پرسش در یک نشست |
| `npm run remote:health` | بررسیِ debug endpoint |
| `npm run remote:audit` | جستجوی audit log |
| `npm run remote:write-settings` | نوشتنِ settings.json |
| `npm run remote:logs` | آخرین لاگ‌های تلمتری |
| `npm run remote:install` | نصب از installer |
| `npm run remote:uninstall` | حذفِ برنامه |
| `npm run remote:autoconfig-sql` | تنظیمِ خودکارِ SQL در settings |

---

**تاریخ آپدیت:** 2026-07-07 (بخشِ Remote Ops Toolkit — فاز ۴۳ اضافه شد)
**نسخه:** 4.0.0
