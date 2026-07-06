@echo off
set ACC_ENABLE_AGENT_DEBUG_SERVER=1
set ACC_AGENT_DEBUG_TOKEN=testtoken123
taskkill /F /IM ACCAssist.exe 2>nul
ping -n 4 127.0.0.1 >nul
start "" "C:\Users\Administrator\AppData\Local\Programs\acc-assist\ACCAssist.exe"
echo Done
