@echo off
setlocal enabledelayedexpansion
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
title FSEB — Fully Safe Exam Browser

if exist "release\win-unpacked\FSEB.exe" (
    start "" "release\win-unpacked\FSEB.exe" %*
    exit /b 0
)

echo Packaged binary not found. Running development build...
npm start -- %*

