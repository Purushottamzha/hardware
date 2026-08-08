@echo off
REM ===========================================================================
REM SafeRide Nepal — native backend launcher (plain MQTT 1883 + native face-service on 5001)
REM
REM Secrets are NOT stored in this file. They live in ops\native.env (gitignored).
REM Copy ops\native.env.example -> ops\native.env and fill real values.
REM ===========================================================================
cd /d "%~dp0.."

if not exist "%~dp0native.env" (
  echo [ERROR] ops\native.env not found. Copy ops\native.env.example to ops\native.env and fill real values.
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0..\ops\native.env") do set "%%a=%%b"

cd backend
node dist\main