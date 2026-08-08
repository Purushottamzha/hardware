# SafeRide Nepal

School bus attendance & tracking system using **facial recognition** — camera → face identification →
confidence gate → signed MQTT event → backend → PostgreSQL → live dashboard.

> The legacy **QR-code attendance system has been replaced by face attendance**.
> There is no active QR path in this repository; remaining mentions exist only as
> historical notes in `ops/RUN_LOG.md` and the FINAL status documents.

## System architecture

```
[Android phone camera / web scanner]      [Laptop]
   browser scanner UI (:8100/scanner)     face-service (Python, :5001)
         |  POST photo                        - /identify  (face matching)
         |  + deviceId/counter/HMAC           - /enroll    (face registration)
         v
   [NestJS backend :3000]
         |  validates device HMAC
         |  confidence gate (threshold 0.60–0.70)
         |  POST /students/:id/face-token -> Face Token
         |     (studentId, identMethod=FACE, identConfidence, HMAC, expiry)
         v
   [Mosquitto broker :1883 plain / :8883 TLS]
         |  saferide/hardware/<deviceId>/attendance  (QoS 1, signed payload)
         v
   [NestJS MQTT consumer] -> counter/signature/token checks -> state machine
         v
   [PostgreSQL] -> AttendanceEvent (identMethod=FACE, identConfidence)
         v
   [Dashboard :5173]  Live Feed / Overview / Bus Scanner (Method + Confidence)
```

## Components

| Directory | Role |
|---|---|
| `backend/` | NestJS API: auth (JWT), device registration + HMAC auth, face token minting, MQTT consumer, attendance state machine, PostgreSQL (Prisma) |
| `dashboard/` | React/Vite admin dashboard: login, students + face enrollment, attendance overview/history, live feed (Socket.IO), bus scanner page, devices, security log |
| `face-service/` | FastAPI face matching (MediaPipe embeddings): `/enroll`, `/identify`, `/match`, `/health` |
| `scanner-bridge/` | Student-facing web scanner UI served by the bridge (`/scanner`), runs the exact phone-tap protocol server-side |
| `simulator/` | `simulate_tap.py` (phone protocol on PC + Termux), offline buffer, device registration helper |
| `mosquitto/` | MQTT broker config (TLS + plain listen) |
| `ops/` | Native Windows launchers (`start-native-stack.bat`), Caddy/AWS ops scripts, backup tooling |

## Face enrollment

1. Dashboard → **Students** → **Manage Face** on a student row.
2. Upload a reference photo (JPG/PNG ≤ 5 MB) → local preview → **Save & Enroll**.
3. Embedding stored in `face-service/enrollments.json` (gitignored) and mirrored to Postgres `FaceEmbedding`; reference photo saved to `backend/uploads/photos/faces/` (gitignored) and viewable in the dialog (`GET /students/:id/face-photo`, admin JWT).
4. Replace photo → re-upload (referenceCount increases). **Remove Enrollment** deletes the enrollment and stored photo.

## Bus scanner (Android)

The phone is mounted at the bus entrance and shows the browser page served by the
scanner bridge — a live front-camera preview with a face oval, automatic scans.

- URL: `http://<laptop-ip>:8100/scanner`
- Screen states: `READY TO SCAN` → `DETECTING FACE — HOLD STILL…` → `IDENTIFYING…` → `✓ FACE MATCHED` + name/class/bus/route/Confidence + `✓ ATTENDANCE RECORDED` → back to `READY`.
- Unknown person: `FACE NOT RECOGNIZED` — **no event is created**.
- Failure: `SYSTEM OFFLINE` — never shows false success.
- Camera permission: Android Chrome needs a one-time `chrome://flags` → *Insecure origins treated as secure* entry for `http://<laptop-ip>:8100` (or use the HTTPS listener on :8443 with the self-signed cert in `scanner-bridge/certs/`).

The Termux CLI (`simulate_tap.py` / `phone_face_tap.py`) remains as a fallback/debug transport.

## Identification path

1. Phone/bridge POSTs the face photo (plus `deviceId`, monotonic `counter`, HMAC) to `/face/identify` (alias `/identify`).
2. face-service returns `studentId`, `confidence`, and non-sensitive `studentName`/`class`/`busId`/`routeName`.
3. Confidence gate — match must be ≥ `FACE_MATCH_THRESHOLD` (phone 0.70, simulator 0.60).
4. Backend mints the face token (payload: studentId, name, issuedAt, tokenVersion 2, `identMethod: FACE`, `identConfidence`, HMAC).
5. Client builds the signed MQTT payload and publishes (QoS 1) to `saferide/hardware/<deviceId>/attendance`.
6. Backend consumer verifies signature, monotonic counter (replay protection), token, and the state-machine window; stores `AttendanceEvent` with `identMethod=FACE` and `identConfidence`.
7. Dashboard updates via overview API + Socket.IO live feed.

## Security

- Device secrets encrypted at rest (AES-256-GCM).
- HMAC-signed API calls and MQTT payloads; counter-based replay protection; auto-suspend after repeated invalid signatures.
- JWT admin auth; `.env`, `ops/native.env`, `config.json`, `mosquitto/certs/`, `backend/uploads/`, logs, and phone bundle are gitignored — **never commit secrets**.
- Full threat model in `SECURITY.md`.

## Startup (native Windows — the verified stack)

1. PostgreSQL 17 service running.
2. Mosquitto LAN broker: `mosquitto -c C:\ProgramData\saferide-mosquitto\mosquitto.lan.conf` (both the backend and phone use it on 0.0.0.0:1883).
3. `ops\native.env` — copy `ops\native.env.example` and fill real values (gitignored).
4. `ops\start-native-stack.bat` — starts face-service, scanner bridge, and backend.
5. Dashboard: `cd dashboard; npm run dev -- --port 5173 --host`.

Health checks: `http://localhost:3000/health` (backend, MQTT status included), `http://127.0.0.1:5001/health` (face-service).

**Docker variant:** `./setup-certs.sh` → `cp .env.example .env` → fill → `docker-compose up -d --build` (see `RUNNING.md`).

## Demo

Full scripted demo (happy path, tamper, replay, sequence, auto-suspend) in `DEMO.md`.
E2E walkthrough including phone steps and the verified 2026-08-08 results: `FINAL_DEMO_RUNBOOK.md`.

## Troubleshooting

See `FINAL_DEMO_RUNBOOK.md` §13. Highlights:

| Symptom | Fix |
|---|---|
| No events on dashboard | Backend must subscribe on the LAN broker (`192.168.1.90:1883`), not loopback |
| `studentId=null` for an enrolled student | Re-enroll the face; verify `face_landmarker.task` exists in `face-service/models/` |
| Phone can't reach laptop | Wi-Fi profile **Private**; firewall allows for Node/Python/Mosquitto ports |
| Camera blocked in Chrome | Grant permission; if plain-HTTP LAN origin, use the `chrome://flags` workaround or HTTPS :8443 |

## Repository hygiene

- QR-era code was deleted (`firmware/` ESP32-CAM sketch with QR decode, old `generate_student_qr.py`, Termux QR scripts, `qr_student.png`); `ops/RUN_LOG.md` is a historical log and intentionally keeps its past entries.
- `git rm `history stays intact — no `reset --hard`, no force push in the final synchronization.

## Final status

`FINAL_IMPLEMENTATION_STATUS.md` and `FINAL_DEMO_RUNBOOK.md` describe the verified 2026-08-08 freeze: full laptop-side fence (enrollment, identify, confidence gate, face token, HMAC, MQTT QoS1, PostgreSQL, verified state transition) plus phone-verified partials (device counter 4→36 on the LAN).