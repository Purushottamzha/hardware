#!/usr/bin/env python3
import json, ssl, urllib.request, sys

ctx = ssl._create_unverified_context()
base = "https://192.168.1.85"

# Login
req = urllib.request.Request(
    f"{base}/api/auth/login",
    data=b'{"phone":"+977-9800000000","password":"75a7c51f9871e5da816107b38bc71a21"}',
    headers={"Content-Type": "application/json"},
    method="POST"
)
try:
    resp = json.load(urllib.request.urlopen(req, context=ctx))
except Exception as e:
    print(f"Login failed: {e}")
    sys.exit(1)

token = resp.get("access_token") or resp.get("accessToken") or ""
print("Logged in OK")

# Overview
req2 = urllib.request.Request(
    f"{base}/api/attendance/overview",
    headers={"Authorization": f"Bearer {token}"},
    method="GET"
)
try:
    data = json.load(urllib.request.urlopen(req2, context=ctx))
    print(f"\nStudents ({len(data.get('students',[]))}):")
    for s in data.get("students", []):
        name = s.get("name","?")
        state = s.get("currentState","?")
        ev = s.get("lastEvent")
        if ev:
            print(f"  {name:20s}  state={state:20s}  verified={ev.get('verified')}  ts={ev.get('createdAt','?')[:19]}")
        else:
            print(f"  {name:20s}  state={state:20s}  (no event)")
    print(f"\nDevices ({len(data.get('devices',[]))}):")
    for d in data.get("devices", []):
        print(f"  {d.get('id','?'):30s}  status={d.get('status','?')}  counter={d.get('lastSeenCounter',0)}")
except Exception as e:
    print(f"Overview failed: {e}")
    print(f"Response: {e.read() if hasattr(e,'read') else 'N/A'}")
