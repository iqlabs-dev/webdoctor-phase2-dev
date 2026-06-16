@echo off
cd /d "%~dp0.."
node scripts\theme-content-pages.js
echo.
echo Done. Hard refresh pages in your browser.
pause
