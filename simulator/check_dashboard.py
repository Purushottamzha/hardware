#!/usr/bin/env python3
"""Quick dashboard checklist against the SafeRide backend.

Credentials are read from the ADMIN_PHONE / ADMIN_PASSWORD environment
variables, falling back to ops/native.env (gitignored) at the repo root.
No credentials are stored in this file.
"""
import json, os, sys, urllib.request
from pathlib import Path


def load_credentials():
    env_file = Path(__file__).resolve().parent.parent / "ops" / "native.env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())
    phone = os.environ.get("ADMIN_PHONE") or "+977-9800000000"
    password = os.environ.get("ADMIN_PASSWORD")
    if not password:
        print("ADMIN_PASSWORD not set. Copy ops/native.env.example -> ops/native.env and fill it.")
        sys.exit(1)
    return phone, password


def main():
    base = os.environ.get("BASE_URL", "http://localhost:3000").rstrip("/")
    phone, password = load_credentials()

    try:
        req = urllib.request.Request(
            f"{base}/auth/login",
            data=json.dumps({"phone": phone, "password": password}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = json.load(urllib.request.urlopen(req))
    except Exception as e:
        print(f"Login failed: {e}")
        sys.exit(1)

    token = resp.get("access_token") or resp.get("accessToken") or ""
    print("Logged in OK")

    req2 = urllib.request.Request(
        f"{base}/attendance/overview",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    try:
        data = json.load(urllib.request.urlopen(req2))
        print(f"\nStudents ({len(data.get('students', []))}):")
        for s in data.get("students", []):
            name = s.get("name", "?")
            state = s.get("currentState", "?")
            ev = s.get("lastEvent")
            if ev:
                print(f"  {name:20s}  state={state:20s}  verified={ev.get('verified')}  ts={ev.get('createdAt', '?')[:19]}")
            else:
                print(f"  {name:20s}  state={state:20s}  (no event)")
        print(f"\nDevices ({len(data.get('devices', []))}):")
        for d in data.get("devices", []):
            print(f"  {d.get('id', '?'):30s}  status={d.get('status', '?')}  counter={d.get('lastSeenCounter', 0)}")
    except Exception as e:
        print(f"Overview failed: {e}")
        print(f"Response: {e.read() if hasattr(e, 'read') else 'N/A'}")


if __name__ == "__main__":
    main()