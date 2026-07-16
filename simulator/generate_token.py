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
print("Logged in")

# Generate new QR token for Rohan Karki
student_id = "cmrn1vipg000dzjwbv1i1cf60"  # current Rohan Karki
req2 = urllib.request.Request(f"{base}/api/students/{student_id}/token",
    data=b'{}',
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    method="POST")
resp2 = json.load(urllib.request.urlopen(req2, context=ctx))
print("Token generated:")
qr = resp2.get("qrData") or resp2.get("token") or json.dumps(resp2)
print(qr[:80] + "...")
print()
print(qr)
