@echo off
setlocal enabledelayedexpansion
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
title FSEB — Setup and Run

echo ===================================================
echo     FSEB — Setup, Build and Launch
echo ===================================================

if not exist "node_modules\" (
    echo [1/4] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo Error installing dependencies.
        pause
        exit /b 1
    )
)

echo [2/4] Building TypeScript assets...
call npm run build
if errorlevel 1 (
    echo TypeScript build failed.
    pause
    exit /b 1
)

echo [3/4] Packaging desktop application...
if exist "release\win-unpacked\FSEB.exe" (
    echo Updated release\win-unpacked\resources\app.asar successfully.
) else (
    call npm run pack
    if errorlevel 1 (
        echo Packaging failed. Falling back to dev start...
        npm start -- %*
        exit /b 0
    )
)

echo [4/4] Launching FSEB...
start "" "release\win-unpacked\FSEB.exe" %*

