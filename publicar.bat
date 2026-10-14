@echo off
rem Doble clic para publicar la app en GitHub Pages (usa tools\publicar.ps1).
rem Si Windows bloquea los scripts de PowerShell, este archivo los permite solo para esta ejecución.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\publicar.ps1" %*
echo.
pause
