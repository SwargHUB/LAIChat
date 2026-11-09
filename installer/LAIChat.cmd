@echo off
rem ============================================================
rem  LAIChat - local AI chat launcher
rem ============================================================
title LAIChat
cd /d "%~dp0"

rem UTF-8 console so Cyrillic in the log is not garbage
chcp 65001 >nul 2>&1

set "NODE_ENV=production"
set "LAICHAT_OPEN_BROWSER=1"

set "APP_LOG=%~dp0laichat.log"

if exist "node\node.exe" (
  "node\node.exe" server.js >> "%APP_LOG%" 2>&1
  goto :after
)

where node >nul 2>&1
if errorlevel 1 goto :nonode

node server.js >> "%APP_LOG%" 2>&1
goto :after

:nonode
echo.
echo   Node.js not found.
echo   Install Node.js 18+ and run LAIChat again:
echo   https://nodejs.org
echo.
pause
exit /b 1

:after
if errorlevel 1 (
  echo.
  echo   LAIChat stopped with an error. Details: "%APP_LOG%"
  echo.
  pause
)
