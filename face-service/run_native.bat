@echo off
REM SafeRide face-service (native Windows, no Docker).
cd /d "%~dp0"
native-venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 5001