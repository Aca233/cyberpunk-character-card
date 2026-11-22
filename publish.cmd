@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist "%~dp0node_modules\tsx\dist\cli.mjs" (
  echo [ERROR] node_modules\tsx not found. Please run "pnpm install" first.
  set "EXIT_CODE=1"
  goto :finish
)

node "%~dp0node_modules\tsx\dist\cli.mjs" "%~dp0tools\publish.ts" %*
set "EXIT_CODE=%ERRORLEVEL%"

:finish
if "%~1"=="" (
  echo %CMDCMDLINE% | find /i "/c ""%~f0""" >nul
  if not errorlevel 1 (
    echo.
    pause
  )
)
exit /b %EXIT_CODE%
