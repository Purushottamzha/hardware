@echo off
REM ===========================================================================
REM SafeRide Nepal — NATIVE STACK startup (no Docker, no WSL)
REM
REM Requires (already installed on this machine):
REM   - PostgreSQL 17 service ("postgresql-x64-17")
REM   - Mosquitto LAN broker on 0.0.0.0:1883 + 0.0.0.0:8883 (see FINAL_DEMO_RUNBOOK §3)
REM   - Node 22 + backend deps (backend/node_modules)
REM   - Python 3.13 venv (face-service/native-venv)
REM
REM Secrets are NOT stored in this file. They live in ops\native.env (gitignored).
REM Copy ops\native.env.example -> ops\native.env and fill real values.
REM
REM Step 1: start the native face-matching service (port 5001)
REM Step 2: start the scanner bridge (port 8100, student-facing web scanner UI)
REM Step 3: start the NestJS backend (port 3000) pointed at native Postgres
REM         + the LAN Mosquitto broker (plain 1883)
REM ===========================================================================

setlocal
cd /d "%~dp0.."

if not exist "%~dp0native.env" (
  echo [ERROR] ops\native.env not found. Copy ops\native.env.example to ops\native.env and fill real values.
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0native.env") do set "%%a=%%b"

echo [1/3] Starting face-service on 127.0.0.1:5001 ...
start "saferide-face-service" /min cmd /c "face-service\run_native.bat"

echo [2/3] Starting scanner bridge on 0.0.0.0:8100 ...
start "saferide-scanner-bridge" /min cmd /c "scanner-bridge\run_bridge.bat"

echo [3/3] Starting backend on :3000 (native Postgres + LAN MQTT 1883) ...
cd backend
node dist\main

echo.
echo Backend exited. Face-service still running (close its window to stop it).
endlocal