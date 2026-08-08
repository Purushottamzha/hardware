@echo off
REM ===========================================================================
REM SafeRide Nepal — NATIVE STACK startup (no Docker, no WSL)
REM
REM Requires (already installed on this machine):
REM   - PostgreSQL 17 service ("postgresql-x64-17")
REM   - Mosquitto Windows service (listens on 1883, plain)
REM   - Node 22 + backend deps (backend/node_modules)
REM   - Python 3.13 venv (face-service/native-venv)
REM
REM Step 1: start the native face-matching service (port 5001)
REM Step 2: start the NestJS backend (port 3000) pointed at native Postgres
REM         + native Mosquitto (plain 1883, the ngrok branch)
REM ===========================================================================

setlocal
cd /d "%~dp0.."

echo [1/2] Starting face-service on 127.0.0.1:5001 ...
start "saferide-face-service" /min cmd /c "face-service\run_native.bat"

echo [2/2] Starting backend on :3000 (native Postgres + plain MQTT 1883) ...
set DATABASE_URL=postgresql://saferide:saferide_pass@localhost:5432/saferide
set ENCRYPTION_KEY=23e8ce271aa672427bccf42d273ebe03ee29343449250d5a2368b358f052e8db
set JWT_SECRET=0fb14d45adc38612bdc8301d383f9a85bd2e77d05fcf0c635b6acf51497b0432
set JWT_EXPIRY=8h
set ADMIN_PHONE=977-9800000000
set ADMIN_PASSWORD=75a7c51f9871e5da816107b38bc71a21
set MOSQUITTO_HOST=192.168.1.90
set MOSQUITTO_PORT=1883
set MOSQUITTO_USERNAME=backend
set MOSQUITTO_PASSWORD=f59acc7d9dc6907ee9ce39e4a9dbebdf
set MQTT_TLS_REJECT_UNAUTHORIZED=false
set STUDENT_TOKEN_SECRET=e2ee4c21298da8872caa93698bcac23352b9f0507f18324954b73e3d19fcc374
set DASHBOARD_ORIGIN=http://localhost:5173,http://192.168.1.90:5173
set PHOTO_UPLOAD_DIR=./uploads/photos
set FACE_SERVICE_URL=http://127.0.0.1:5001
set FACE_MATCH_THRESHOLD=0.60
set NODE_ENV=development

cd backend
node dist\main

echo.
echo Backend exited. Face-service still running (close its window to stop it).
endlocal
