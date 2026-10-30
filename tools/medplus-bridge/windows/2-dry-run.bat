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
if not exist "queries.json" (
  echo [XATO] queries.json yo'q. U schema.json asosida Med.uz.ai jamoasi tomonidan tayyorlanadi.
  goto :end
)
echo Sinov o'qish: hech narsa yuborilmaydi, MedPlus'ga hech narsa yozilmaydi, faqat sonlar chiqadi...
"%NODE%" bridge.mjs --dry-run > dry-run.txt 2>&1
type dry-run.txt
echo.
echo Natija: %CD%\dry-run.txt - shu faylni yuboring (ichida faqat jadval nomlari va sonlar bor).
:end
echo.
pause
