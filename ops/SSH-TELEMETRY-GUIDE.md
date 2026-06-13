# راهنمای اتصال به سرورها (SSH، Plink، Telemetry)

این فایل شامل تمام دستورات و نکات مورد نیاز برای اتصال و مدیریت سرورها است.

---

## 📋 اطلاعات سرورها

| سرور | آدرس | پورت | کاربر | نوع |
|------|------|------|------|-----|
| **اپلیکیشن** | 192.168.85.56 | 2211 | administrator | Windows Server (SSH) |
| **تلمتری** | 192.168.85.84 | 8081 | - | Node.js (HTTP) |
| **Proxmox** | 192.168.85.37 | 22 | root | Linux (SSH) |

---

## 🔐 اطلاعات احراز هویت

```powershell
# سرور اصلی (192.168.85.56)
$ServerHost = "192.168.85.56"
$Port = 2211
$User = "administrator"
$Password = "Hs-co@12321#"
$HostKey = "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ"

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
Invoke-WebRequest -Uri "http://192.168.85.84:8081/health" -ErrorAction SilentlyContinue

# مثال پاسخ
# {"status":"healthy","events":142,"queue":0}
```

### دیدن رویدادهای دریافتی:

```powershell
# دیدن فایل رویدادها در Proxmox
# (نیاز به SSH به Proxmox دارد)
ssh root@192.168.85.37 "tail -50 /var/lib/acc-telemetry/events.ndjson"

# یا از طریق plink
plink -P 22 -ssh -batch -pw "PROXMOX_PASSWORD" root@192.168.85.37 "tail -50 /var/lib/acc-telemetry/events.ndjson"
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

**تاریخ آپدیت:** 2026-06-13  
**نسخه:** 1.0.0
