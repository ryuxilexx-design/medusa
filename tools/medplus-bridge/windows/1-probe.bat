@echo off
chcp 65001 >nul
setlocal
rem works from the package root (C:\medplus-bridge) and from the repo folder tools\medplus-bridge\windows
cd /d "%~dp0"
if not exist "bridge.mjs" cd ..
set "NODE=node"
if exist "node\node.exe" set "NODE=%CD%\node\node.exe"
"%NODE%" --version >nul 2>&1
if errorlevel 1 (
  echo [XATO] Node.js topilmadi. Papkada node\node.exe yo'q va kompyuterda Node.js 20+ o'rnatilmagan.
  echo        Windows 7/8 bo'lsa: probe-phpmyadmin.sql yo'lidan foydalaning ^(README-UZ.txt, 3-qadam B^).
  goto :end
)
if not exist "node_modules\mysql2" (
  echo [XATO] node_modules\mysql2 yo'q. To'plam to'liq ko'chirilmagan - zip'ni qaytadan oching.
  goto :end
)
if not exist "config.json" (
  copy /y "config.example.json" "config.json" >nul
  echo config.json yaratildi. Notepad ochiladi: "mysql" bo'limiga user, password, database yozing va saqlang.
  echo Keyin shu faylni qayta ishga tushiring.
  start /wait notepad "config.json"
  goto :end
)
echo MedPlus bazasining tuzilishi o'qilmoqda (faqat jadval va ustun nomlari, bemor ma'lumoti EMAS)...
"%NODE%" bridge.mjs --probe --out schema.json
if errorlevel 1 (
  echo.
  echo [XATO] Yuqoridagi xabarni suratga oling va yuboring.
  goto :end
)
echo.
echo Tayyor: %CD%\schema.json
echo Shu faylni Med.uz.ai jamoasiga yuboring. Agar ichida "databases" ro'yxati chiqsa -
echo MedPlus bazasi nomini config.json dagi "database" ga yozib, 1-probe.bat ni qayta ishga tushiring.
:end
echo.
pause
