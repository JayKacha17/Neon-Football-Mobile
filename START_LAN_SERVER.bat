@echo off
title Neon Football Mobile - Offline LAN Server
echo ========================================================
echo     NEON FOOTBALL MOBILE - OFFLINE LAN SERVER
echo         (0 INTERNET REQUIRED - PURE LOCAL WI-FI)
echo ========================================================
echo.
cd /d "%~dp0"

echo Checking node_modules...
if not exist "node_modules\" (
    echo Installing local dependencies...
    call npm install
)

echo Starting Local LAN Server...
node server/index.js
pause
