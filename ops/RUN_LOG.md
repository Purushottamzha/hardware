# SafeRide Nepal — Run Log

**Date:** 2026-07-12  
**Stack:** Docker Desktop (Windows) — postgres, mosquitto, backend, dashboard  
**Simulator:** `simulator/simulate_tap.py` (Phase 1)  

---

## Bug Fixes Applied During Run

| Bug | File | Fix |
|-----|------|-----|
| `validateStateSequence()` always returned `true` | `attendance.service.ts:270` | Added actual `config.nextStates.includes(nextEventType)` check |
| `encryptedSecret` not decryptable at startup (DI resolution order) | `src/common/common.module.ts` | Moved `SecretCipherService` to `@Global()` `CommonModule` |
| `password_file` path not writable | `mosquitto.conf` | Mapped `/mosquitto/certs/passwd` (writable) instead of `/mosquitto/passwd` |
| Auto-suspend wrote `hash: ''` (empty) | `attendance.service.ts:314` | Replaced direct `prisma.auditLog.create()` with `auditService.log()` |
| `AuditService.log()` timestamp drift in hash computation | `audit.service.ts:15` | Reused same `Date` object for hash input and `createdAt` field |
| `generate_student_qr.py` used HTTPS | `generate_student_qr.py:21` | Changed `API_URL` from `https://` to `http://` |

---

## Scenario Results

### S1 — Normal Tap
- Published valid HMAC-signed attendance payload via MQTT
- Backend verified signature, created `AttendanceEvent{verified: true, flagged: true, flagReason: OUTSIDE_TIME_WINDOW}`
- `studentToken` HMAC validated against `STUDENT_TOKEN_SECRET`
- Device counter incremented correctly

### S2 — Tampered Tap
- Published payload with `--tamper` flag (corrupted device signature)
- Backend rejected with `INVALID_DEVICE_SIGNATURE` SecurityEvent
- Device counter remained unchanged

### S3 — Replay Attack
- Re-published identical payload verbatim
- Backend detected counter mismatch → `REPLAY_SUSPECTED` SecurityEvent created

### S4 — Invalid Sequence
- Student state set to `ARRIVED_HOME` (terminal state with no `nextStates`)
- Normal tap produced `AttendanceEvent{verified: false, rejectionReason: INVALID_SEQUENCE}`

### S5 — Auto-Suspend
- 5 consecutive tampered taps within 5 minutes
- Device status flipped: `active` → `suspended`
- `AUTO_SUSPENDED` AuditLog entry created with valid SHA-256 hash chain linkage

### S6 — AuditLog Hash-Chain Tamper Detection
```
Initial:         {"valid":true}
After tamper:    {"valid":false, "brokenAt":2}
After restore:   {"valid":true}
```
- `GET /audit/verify` correctly detects DB-level tampering
- Hash format: 64-char hex SHA-256 digest

### S7 — Database Plaintext Verification
- `Device.encryptedSecret` stores 128-char Base64 ciphertext
- Not plaintext; AES-256-GCM (12-byte nonce + ciphertext + 16-byte auth tag = 96 bytes → 128 Base64)
- Decryption only possible via `SecretCipherService` using `ENCRYPTION_KEY`

### S8 — Git Secret Leak Scan
- `.env` confirmed gitignored: `git check-ignore .env` returns `.env`
- `.env.example` contains placeholder values only
- No real secret values found in git history (all key names have empty values)

### S9 — QR Code Generation
```
$ python generate_student_qr.py cmrhum14x0000equo072uf7qa --token <jwt> --output qr.png
[OK] QR code saved to student_qr.png
```
- QR encodes the signed student token for offline scanning

---

## Key Metrics

| Metric | Value |
|--------|-------|
| MQTT auth | TLS 1.3 + per-device password file |
| HMAC scheme | SHA-256 of canonical JSON, matches Python simulator |
| Counter sync | Device-side counter verified against DB `lastSeenCounter` |
| Audit chain algorithm | `SHA256(prevHash|action|targetId|timestamp)` |
| Encryption | AES-256-GCM with 96-bit nonce per `SecretCipherService` |
| Encryption key source | `openssl rand -hex 32` → `ENCRYPTION_KEY` |
| Auto-suspend threshold | 5 invalid signatures within 5 minutes |

---

## Device Registration Record

| Field | Value |
|-------|-------|
| Device ID | `bus-ba2kha4521-door-SIM` |
| Secret | `9b36b20d...` (stored AES-256-GCM encrypted in DB) |
| Counter | Increments per valid tap |
| Status | Active → Suspended (toggled by abuse) |
