#!/usr/bin/env python3
"""Register a device on the SafeRide backend.

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

    req = urllib.request.Request(
        f"{base}/auth/login",
        data=json.dumps({"phone": phone, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    resp = json.load(urllib.request.urlopen(req))
    token = resp["access_token"]
    print("Logged in OK")

    device_id = os.environ.get("DEVICE_ID", "bus-bus001-door-PHONE2")
    body = json.dumps({"id": device_id, "busId": "bus-01"}).encode()
    req2 = urllib.request.Request(
        f"{base}/devices/register",
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        resp2 = json.load(urllib.request.urlopen(req2))
        print("Device registered:")
        print(json.dumps(resp2, indent=2))
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}")
        print(f"Request body was: {body.decode()}")


if __name__ == "__main__":
    main()