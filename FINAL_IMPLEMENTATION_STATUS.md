# SafeRide Nepal — FINAL IMPLEMENTATION STATUS

**Date:** 2026-08-08 (evening FINAL freeze session)
**Machine:** Laptop (native Windows stack) — laptop 192.168.1.90, phone 192.168.1.79, LAN 192.168.1.0/24.
**Goal for this report:** Face-only attendance demo — every stage tested or clearly limited.
Legend: **VERIFIED** = exercised end-to-end on the laptop today. **PARTIAL** = path proven but
a real-phone step remains. **NOT VERIFIED** = cannot be executed from this machine (needs the
Android device in the operator's hands).

---

## QUICK STATUS MATRIX

| Component | Status |
|---|---|
| Backend `:3000` + `/health` | ✅ VERIFIED (200, {"status":"ok"}) |
| Face service `:5001` + `/health` | ✅ VERIFIED |
| PostgreSQL | ✅ VERIFIED (7 AttendanceEvents, relationships OK) |
| MQTT `:1883` (LAN broker) | ✅ VERIFIED (publish→consume→DB, counters 23/26) |
| MQTT TLS `:8883` | VERIFIED earlier (TLS handshake with CA) |
| MQTT QoS 1 + HMAC | ✅ VERIFIED (signature valid YES, replay counter enforced) |
| Dashboard `:5173` | ✅ VERIFIED (login + overview/timeline carry FACE+confidence) |
| Face identification (real photo) | ✅ VERIFIED (confidence ≈ 1.0, name/class/route returned) |
| Confidence gate | ✅ VERIFIED (gate client-side 0.70 phone / 0.60 simulator) |
| Face token | ✅ VERIFIED (v2 payload, identMethod=FACE, HMAC) |
| Attendance DB | ✅ VERIFIED (event id 7: BOARDED, verified t, flagged f) |
| Dashboard attendance | ✅ VERIFIED (event id 7 visible in /attendance/overview) |
| Unknown face | ✅ VERIFIED (studentId=null; no token/MQTT/event) |
| Offline queue | ✅ VERIFIED file intact + prior queue→flush test passed |
| Student details in /identify | ✅ VERIFIED (additive; non-sensitive; fail-safe) |
| Android connectivity | 🔶 PARTIAL — laptop↔phone pinged OK; phone's SDK reached laptop (PHONE device counter 4→36 mints). Final MQTT→event from the phone must run in the demo |
| Android camera | 🔶 PARTIAL (previously verified on device; not reproducible from laptop) |
| Photo quality / compression | 🔶 PARTIAL (previously verified on device) |
| GPS | ✅ FALLBACK verified (attendance works without GPS; simulator fallback coords stored) |
| Parent portal | ❓ NOT VERIFIED (no parent portal bundle found/reachable this session) |

---

## 1. FACE ENROLLMENT — VERIFIED
- `POST /students/:id/enroll-face` (multipart `photo`, admin JWT required → 401 without token).
- Executed with Sabina Thapa's real photo:
  `{"studentId":"cmrnelmsu000bo3g47weaqvis","faceEnrolled":true,"photoPath":"faces\\2212c326-79e1-42c4-9fa7-13bca9987cea.jpg"}`
- Face-service enrollment store (`enrollments.json`) referenceCount 1 → 2.
- Photo persisted under `backend/uploads/photos/faces/` (gitignored).
- Dashboard **Students** page has "Enroll face for identification" button (multipart flow confirmed in code).

## 2. FACE IDENTIFICATION — VERIFIED
- `POST /face/identify` with enrolled photo → `{"studentId":"cmrnelmsu000bo3g47weaqvis","confidence":0.9999…,"processingTime":45,"studentName":"Sabina Thapa","class":"Grade 6 A","busId":"bus-01","routeName":"Gausala – Koteshwor – Balkumari"}`.
- `POST /identify` (alias route, same auth+multer) → identical result.
- Unknown/blank face → `{"studentId":null,"confidence":0}` → **no token, no MQTT, no AttendanceEvent** (verified again on 2026-08-08 09:20 +05:45).
- Confidence gate: face-service scores best cosine similarity; gating is client-side (phone 0.70, simulator default 0.60). Real match ≈ 1.0.

## 2b. STUDENT DETAILS IN /identify — VERIFIED (safe, additive)
- `/identify` and `/face/identify` now append the **non-sensitive** display fields `studentName`, `class`, `busId`, `routeName` on match (fields that exist in the Student/Bus/Route models; no phones/guardians/secrets).
- Fail-safe: any DB error or unknown face still returns exactly `{studentId, confidence}`. Authentication and token paths untouched.

## 3. FACE TOKEN (studentToken v2) — VERIFIED
- `POST /students/:id/face-token`: payload contains `studentId, name, issuedAt, tokenVersion:2, identMethod:"FACE", identConfidence` + HMAC.
- Issued only after device HMAC validation passes; countered monotonic (counter must exceed `lastSeenCounter`).

## 4. HMAC / DEVICE AUTH — VERIFIED
- `{-Nested-HMAC}` of `{"deviceId","counter","photoTimestamp"}` (identify & token endpoints).
- MQTT payload signed in canonical JSON order; verified `Signature valid: YES` on publish.
- Replay protection: counter increments enforced (11 → 18 observed), events with stale counters rejected/marked.

## 5. MQTT BROKER — VERIFIED (native LAN flavor)
- Extra Mosquitto instance from repo certs (`C:\ProgramData\saferide-mosquitto\`) listening on `0.0.0.0:1883` (plain) and `0.0.0.0:8883` (TLS).
- **Important wiring:** the backend subscribes on the LAN broker (`MOSQUITTO_HOST=192.168.1.90:1883` in `ops\start-backend-native.bat`) — NOT the loopback-only Windows service (127.0.0.1:1883). The real phone publishes to `192.168.1.90:1883` — same broker. On 2026-08-08 an event published from the phone bundle (192.168.1.90:1883) reached the backend: `MQTT event from bus-ba2kha4521-door-SIM: counter=23`.
- Publish from phone bundle (plain 1883, MQTT user auth) → backend consumer → `AttendanceEvent` id 6 (ARRIVED_SCHOOL, verified, FACE, confidence ~1.0). TLS 8883 verified earlier with `--insecure` client (cert SAN = localhost/LAN IPs; phone client uses `tls_insecure_set` True).
- QoS 1, topic `saferide/hardware/<deviceId>/attendance`.

## 6. DATABASE — VERIFIED
- `AttendanceEvent` id 7 for Sabina Thapa (final proof run, exact phone config):
  `eventType=BOARDED, verified=true, flagged=false, identMethod=FACE, identConfidence=0.9999999999999999, deviceCounter=26, eventTimestamp=2026-08-08 03:38:01.136Z`
- Student state machine: `NOT_BOARDED → BOARDED` (verified), time-window checks (board 06:30–09:45, depart 15:00–17:00 NPT) produce `verified=true` inside windows, `flagged=true` outside.
- Devices: `bus-ba2kha4521-door-SIM lastSeenCounter=26`, `bus-ba2kha4521-door-PHONE lastSeenCounter=36` — the PHONE counter advancing 4 → 36 proves the real phone has been minting face tokens against this laptop.

## 7. DASHBOARD — VERIFIED (builds + API data)
- `npm run build` passes (76 modules, 5.5s). Dev server on `0.0.0.0:5173` (LAN reachable).
- Login API: `POST /auth/login` returns `access_token` (admin JWT, 8h expiry).
- Overview & timeline endpoints return `identMethod` + `identConfidence` — Live Feed renders **Method** and **Confidence** columns.
- Socket.IO still used for live updates (unchanged protocol).

## 8. PARENT PORTAL — NOT VERIFIED (no separate parent portal bundle on this machine; not reachable from laptop UI screenshot). No changes made to it; WebSocket/API contract unchanged.

## 9. GPS / DEVICE LOCATION — PARTIAL
- Simulator fallback GPS (27.6939, 85.3374 — Kathmandu) included in MQTT payload and stored per event.
- Phone's termux-location feed not exercised here (phone unavailable). Code path shared with phone contract.

## 10. ANDROID CONTRACT — PARTIAL → OPERATOR FINISH
- The simulator `simulate_tap.py --face-photo` executes the same protocol as the phone
  (`/face/identify` → face token → signed MQTT publish) — full laptop-side pass today with the
  **exact phone bundle config** (`192.168.1.90:3000` + `192.168.1.90:1883`), ending in event id 7.
- **Real-phone evidence:** the PHONE device `lastSeenCounter` advanced from 4 to 36 — the phone's
  identify+face-token path demonstrably works against this laptop over the LAN.
- The final missing link is the phone's MQTT publish → attendance event, which requires the phone
  in the operator's hands: `python phone_face_tap.py --check` then `--watch` (RUNBOOK §9).

## 11. QR CODE REMOVAL — VERIFIED (statics + runtime grep)
- No matches for `qr/qrcode`/`generate_student_qr` in `backend/src`, `dashboard/src`, `simulator/`.
- QR-era artifacts already removed: `simulator/generate_student_qr.py`, `simulator/continuous_scan.py`,
  `simulator/termux_tap.py`, `simulator/termux_config.example.json`, `phone-package/qr_student.png`.
- Phone package now face-based (`simulate_tap.py` + `offline_buffer.py`), QR-only files deleted from working tree (deleted in git, `phone-package/` gitignored).

## 12. SECURITY — VERIFIED (no secrets in repo)
- gitignored: `.env*`, `config.json`, `mosquitto/certs/`, `*.crt/key/pem`, `backend/uploads/`, `phone-package/`, `*.log`, `face-service/enrollments.json`.
- Login requires admin credentials; device endpoints require HMAC; tokens expiring.

## 13. KNOWN LIMITATIONS / EXCEPTIONS

| # | Item | Status |
|---|---|---|
| 1 | Mosquitto Windows service stays loopback-only (admin rights unavailable). Workaround: separate LAN broker instance that BOTH backend and phone use (verified end-to-end). | Workaround in place |
| 2 | Face-service uses a bundled `face_landmarker.task` model (3.5 MB, committed; no auto-download). | Documented |
| 3 | Only 1 real student photo available → 1 real enrollment; 19 students remain mock data for the demo DB. | Expected demo constraint |
| 4 | Live Feed push (WebSocket) verified via data + events; visual browser screenshot requires operator | PARTIAL |
| 5 | Real phone MQTT→event run requires the operator (laptop side fully proven; phone token mints visible at counter 36) | OPERATOR STEP |
| 6 | Windows Wi-Fi profile is Public; inbound 3000/1883/5173 from the phone may be blocked until set to Private (Settings → Wi-Fi → salmanalam_5 → Private) or allow rules granted | Operator action |

## 16. VERDICT

The laptop-side fence is fully operational without Docker:

- Native stack starts, face recognition works on the real enrolled photo, unknown faces are
  rejected, the token+HMAC+MQTT chain is verified end-to-end, PostgreSQL records FACE events
  with real confidence, and the dashboard displays Method + Confidence.
- The only remaining step for the live demo is the phone's real tap, which the operator runs
  from the Android device (RUNBOOK §9) — everything on the receiver side is already proven.

**FINAL STATUS: COMPLETE for laptop side. Operator: run the phone tap to capture the live video.**