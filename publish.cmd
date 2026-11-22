@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist "%~dp0node_modules\tsx\dist\cli.mjs" (
  echo [错误] 未找到 node_modules\tsx，请先在项目根目录执行 pnpm install。
  set "EXIT_CODE=1"
  goto :finish
)

node "%~dp0node_modules\tsx\dist\cli.mjs" "%~dp0tools\publish.ts" %*
set "EXIT_CODE=%ERRORLEVEL%"

:finish
echo %CMDCMDLINE% | find /i "%~f0" >nul
if %ERRORLEVEL%==0 (
  echo.
  pause
)
exit /b %EXIT_CODE%
