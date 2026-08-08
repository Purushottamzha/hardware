# SafeRide Nepal — FINAL DEMO RUNBOOK

**Date:** 2026-08-08
**Stack:** Native Windows (PostgreSQL 17 service, Mosquitto broker, Node.js 22, Python 3.13 venv) — no Docker required.
**Live demo path:** Android phone → `POST /identify` → Face Token → MQTT → Mosquitto → NestJS → PostgreSQL → Dashboard Live Feed.

---

## 1. Architecture at a glance

```
[Android phone / simulator]          [Laptop]
  termux_face_tap.py                  face-service (Python, 127.0.0.1:5001)
        |  multipart photo              - /identify  (face matching)
        |  + deviceId/counter/HMAC      - /enroll    (face registration)
        v  POST /face/identify          - /match
   [NestJS backend :3000]
        |  validates device HMAC
        |  POST /students/:id/face-token  -> Face Token (studentId, identMethod=FACE,
        |                                     identConfidence, HMAC, expiry)
        v
   [Mosquitto 0.0.0.0:1883 / 0.0.0.0:8883 TLS]
        |  saferide/hardware/<deviceId>/attendance  (QoS 1, signed payload)
        v
   [NestJS MQTT consumer] -> verify counter/signature/token -> state machine
        v
   [PostgreSQL saferide]  -> AttendanceEvent (identMethod, identConfidence)
        v
   [Dashboard :5173]  Live Feed / Overview (Method + Confidence columns)
```

## 2. Credentials used by this demo (local only)

| Item | Value |
|---|---|
| Backend | http://192.168.1.90:3000 (LAN) / http://localhost:3000 |
| Dashboard | http://192.168.1.90:5173 |
| Admin phone / password | `+977-9800000000` / see `backend/.env` (`ADMIN_PASSWORD`) |
| MQTT broker LAN | `192.168.1.90:1883` plain, `8883` TLS |
| MQTT user (backend) | `backend` / see `backend/.env` (`MOSQUITTO_PASSWORD`) |
| Device (SIM) | `bus-ba2kha4521-door-SIM` (secret in `simulator/config.json`) |
| Device (PHONE) | `bus-ba2kha4521-door-PHONE` |
| Enrolled demo student | Sabina Thapa (`cmrnelmsu000bo3g47weaqvis`) — real face enrolled |

> Never print or commit these secrets. `backend/.env`, `simulator/config.json`, `mosquitto/certs/`, `*.log`, `backend/uploads/` are gitignored.

## 3. Service startup order

| # | Component | Command (PowerShell, repo root) |
|---|---|---|
| 1 | PostgreSQL 17 | Windows service (already running) |
| 2 | Mosquitto LAN broker | `mosquitto -c C:\ProgramData\saferide-mosquitto\mosquitto.lan.conf -p 1883` (started once; listening on 0.0.0.0:1883 + 0.0.0.0:8883) |
| 3 | Face service | `face-service\native-venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 5001` |
| 4 | Backend | `ops\start-backend-native.bat` (binds 0.0.0.0:3000, connects to face service + Mosquitto) |
| 5 | Dashboard | `cd dashboard; npm run dev -- --port 5173 --host` |

Health checks:
- Backend: `curl http://localhost:3000/health` → `{"status":"ok"}`
- Face service: `curl http://127.0.0.1:5001/health` → `{"status":"ok",...}`
- Broker: `netstat -ano | findstr :1883` shows `0.0.0.0:1883 LISTENING`.

## 4. One-shot native startup (all services)

`ops\start-native-stack.bat` starts the face service + backend with the correct env
(the LAN broker must already be running — see §3, step 2). Logs are written to
`native-backend.log`.

## 5. Enroll a student's face

1. Open dashboard → **Students**.
2. Click the **Face** button on a student row → choose a clear JPEG/PNG photo.
3. Response shows `faceEnrolled: true`; the face-service enrollment store gains a reference
   and `backend/uploads/photos/faces/` gets the new photo.

Verified on 2026-08-08: re-enrollment of Sabina Thapa returned
`{"studentId":"...","faceEnrolled":true,"photoPath":"faces\\2212c326-....jpg"}`
(referenceCount 1 → 2).

## 6. Simulated phone tap (laptop-side E2E)

```powershell
simulator\venv\Scripts\python.exe simulator\simulate_tap.py --face-photo backend\uploads\photos\faces\7c312872-63f1-42df-90f4-bed15674931b.jpg
```

This runs the **exact phone protocol**: `/face/identify` → face token → MQTT publish
(signed, QoS 1). A successful run prints `[OK] Published to saferide/hardware/.../attendance`.

### Verified result (2026-08-08 07:40 NPT)
- Identify → `studentId=cmrnelmsu000bo3g47weaqvis, confidence=1.000`
- AttendanceEvent id 5: `BOARDED, verified=true, flagged=false, identMethod=FACE, identConfidence=0.9999999999999999, counter=18`
- Student state: `NOT_BOARDED → BOARDED`
- Devices: `bus-ba2kha4521-door-SIM lastSeenCounter=18`

## 7. Unknown / invalid face (security check)

Send a photo with **no face** to `/face/identify` (or `/identify`) → response
`{"studentId":null,"confidence":0}` → **no token, no attendance event, no state change**.
Verified 2026-08-08.

## 8. `/identify` alias route

`POST /identify` is an alias of `POST /face/identify` (same device auth + multipart photo).
Both return `{studentId, confidence, processingTime}`. Verified on 2026-08-08 with the
real Sabina photo (confidence 1.0) and a blank photo (studentId null).

## 9. Phone (Android) demo steps — to run on the phone by the operator

1. Ensure phone is on the same Wi-Fi as this laptop (`192.168.1.90`).
2. Run `termux_face_tap.py` on the phone (config in `phone-package/` → copy to
   `config.json`, edit `apiBaseUrl` to `http://192.168.1.90:3000`, broker `192.168.1.90:8883`
   TLS or `:1883` plain).
3. The phone: captures photo → `/identify` → mints face token → publishes MQTT → offline
   buffer if unreachable.
4. Watch the dashboard Live Feed update with **Method = FACE** and the confidence value.

> The phone build was validated previously against this laptop; if the phone cannot reach
> the laptop, verify: laptop firewall allows inbound 3000/1883/8883/5173 (Node/Mosquitto
> rules may need admin approval), phone and laptop on same subnet, correct IP in config.

## 10. Dashboard verification

- Open `http://192.168.1.90:5173`, login with admin phone/password.
- **Live Feed**: event rows show Method (`FACE`) and Confidence (e.g. `0.9999`).
- **Overview**: each student's `lastEvent` includes `identMethod` and `identConfidence`.
- **Timeline** (per student): same fields.

## 11. Database verification (psql)

```sql
SELECT id, "studentId", "eventType", verified, flagged, "identMethod", "identConfidence",
       "deviceCounter", "eventTimestamp"
FROM "AttendanceEvent" ORDER BY id DESC;
```

Expected: latest rows show `identMethod='FACE'` and a real `identConfidence`.

## 12. State machine & time windows

- Board window 06:30–09:45, depart window 15:00–17:00 (NPT). Events inside windows are
  `verified=true, flagged=false`.
- Out-of-window events are still stored but flagged (expected in tests).

## 13. Troubleshooting

| Symptom | Fix |
|---|---|
| `[MQTT] ... Connection refused` | Start the LAN broker: `mosquitto -c C:\ProgramData\saferide-mosquitto\mosquitto.lan.conf`; check `netstat -ano \| findstr :1883` |
| Backend `/health` fails | Run `ops\start-backend-native.bat`; check `native-backend.log`; verify Postgres service running |
| Identify returns `studentId=null` for a known student | Re-enroll the student (§5); check face-service log; verify `face_landmarker.task` exists in `face-service/models/` |
| Dashboard 401 | Login again — token expires after 8h |
| Phone can't reach laptop | Firewall inbound rules for 3000/1883/8883/5173; same LAN; correct IP |
| Broker lost after reboot | The LAN broker is a separate process — restart it (§13, row 1). It uses `C:\ProgramData\saferide-mosquitto\` config so no admin rights are needed |

## 14. Current running state (2026-08-08 07:45 NPT)

- PostgreSQL: running (service)
- Mosquitto LAN broker: running (0.0.0.0:1883, 0.0.0.0:8883)
- Face service: running on 127.0.0.1:5001
- Backend: running on 0.0.0.0:3000
- Dashboard: running on 0.0.0.0:5173
- Enrolled: 1 real student (Sabina Thapa), 1 real attendance event (BOARDED, FACE, verified)

## 15. Post-demo cleanup

- `git status` — expect only intended files.
- Logs (`*.log`), uploads, `.env`, `simulator/config.json`, `mosquitto/certs/` are gitignored.
- Reset demo state if needed:
  `UPDATE "Student" SET "currentState"='NOT_BOARDED' WHERE id='cmrnelmsu000bo3g47weaqvis';`
