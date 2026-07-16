#!/usr/bin/env python3
import json, ssl, urllib.request

ctx = ssl._create_unverified_context()
base = "https://192.168.1.85"

# Login
req = urllib.request.Request(f"{base}/api/auth/login",
    data=b'{"phone":"+977-9800000000","password":"75a7c51f9871e5da816107b38bc71a21"}',
    headers={"Content-Type": "application/json"}, method="POST")
resp = json.load(urllib.request.urlopen(req, context=ctx))
token = resp["access_token"]
print("Logged in OK")

# Register device
body = json.dumps({"id": "bus-bus001-door-PHONE2", "busId": "bus-01"}).encode()
req2 = urllib.request.Request(f"{base}/api/devices/register",
    data=body,
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    method="POST")
try:
    resp2 = json.load(urllib.request.urlopen(req2, context=ctx))
    print("Device registered:")
    print(json.dumps(resp2, indent=2))
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.read().decode()}")
    # Try reading the request body
    print(f"Request body was: {body.decode()}")
