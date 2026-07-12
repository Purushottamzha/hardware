# SafeRide Nepal — Security Analysis

## Threat Model

### Trusted Components
- Backend server and database (with encryption at rest)
- Admin dashboard when accessed by an authenticated admin

### Untrusted Components
- The network (MQTT and HTTP traffic can be intercepted)
- Physical devices (an attacker may gain physical access to a bus-mounted ESP32 and extract flash contents)
- QR codes (can be photographed and copied by anyone)

### Explicitly Not Defended Against (Known Limitations)
- A well-resourced attacker with physical device access who extracts the device secret from flash
- GPS spoofing at the radio level
- Physical tampering with the bus hardware

## Defenses Implemented

### 1. Device Signature Verification
Every event payload includes an HMAC-SHA256 signature computed over canonical JSON with the device's unique secret. The backend recomputes the signature and rejects mismatches, logging `INVALID_DEVICE_SIGNATURE`.

### 2. Monotonic Counter (Replay Defense)
Each device maintains a monotonically increasing counter persisted locally. The backend stores `lastSeenCounter` per device and rejects any event where `counter <= lastSeenCounter`. This prevents replay attacks even if the attacker controls timing.

### 3. Timestamp Window (Defense in Depth)
Events with timestamps more than 60 seconds from the server's clock are rejected as a secondary check alongside the counter.

### 4. State Machine Enforcement
Student attendance follows a strict state machine (NOT_BOARDED → BOARDED → ARRIVED_SCHOOL → DEPARTED → ARRIVED_HOME). Invalid transitions are rejected and logged.

### 5. Student Token Separation
The device never holds `STUDENT_TOKEN_SECRET`. It decodes the QR and forwards the raw token to the backend, which is the sole verifier. A compromised device can only impersonate itself, not forge tokens for any student.

### 6. Auto-Suspend on Abuse
If a device produces 5+ invalid signatures within 5 minutes, it is automatically suspended until an admin manually reactivates it.

### 7. Per-Device MQTT Authentication
Each device authenticates to Mosquitto with unique credentials. Broker has `allow_anonymous false`.

### 8. TLS Everywhere
- Mosquitto: TLS on port 8883
- Backend API: HTTPS
- Socket.IO: WSS

### 9. Secrets Encrypted at Rest
Device secrets stored via AES-256-GCM. Decryption key from `ENCRYPTION_KEY` env var. Plaintext never in database or source code.

### 10. JWT-Secured Dashboard (Secure by Default)
Global `JwtAuthGuard` protects all routes. Explicit `@Public()` decorator opts routes out. Prevents "forgot to add a guard" bugs.

### 11. Password Hygiene
- bcrypt with cost factor ≥ 12
- Account lockout for 15 minutes after 5 failed attempts
- IP-based rate limiting via `@nestjs/throttler`

### 12. IDOR Prevention
All queries scoped to authenticated caller's permissions. Client-supplied IDs never trusted as sole authorization.

### 13. Input Validation
Every DTO uses `class-validator` decorators. Malformed payloads rejected before business logic.

### 14. Security Headers & Body Limits
- `helmet()` enabled
- JSON body size capped at 100KB

### 15. CORS Allowlist
Dashboard origin only, not `*`.

### 16. No Secrets in Git
`.env`, `config.json`, `secrets.h`, `*.pem` all gitignored. `.env.example` committed with placeholder values.

### 17. Hash-Chained Audit Log
Each `AuditLog` row includes `prevHash` (hash of previous row) and `hash` (hash of content + prevHash). Tampering breaks the chain, detectable via `GET /audit/verify`.

### 18. Photo Auto-Deletion
Any captured photos deleted after configurable retention window (default 30 days) via scheduled job. Children's biometric-adjacent data is minimized.

### 19. Generic Error Responses
`NODE_ENV=production` suppresses stack traces and internal error details.

### 20. Raw Payload Safety
Security Log UI renders raw payloads as escaped plain text in `<pre>` tags. Explicitly avoids `dangerouslySetInnerHTML`.

---

## Production Deployment Controls

This section maps the production deployment (via `docker-compose.prod.yml`
and `ops/` runbook) against applicable legal and regulatory frameworks.

### Nepal IT Act 2063 (2008) — Key Provisions Addressed

| Provision | How Addressed |
|-----------|---------------|
| **Sec 45 — Unauthorized access to computer material** | Per-device MQTT auth + JWT-gated API + bcrypt account lockout. `fail2ban` adds host-level brute-force defense. |
| **Sec 46 — Unauthorized access to computer program** | Docker secrets (`/run/secrets/*`) keep keys off the filesystem in plaintext. `ENCRYPTION_KEY` only in memory. |
| **Sec 47 — Damage to computer system** | Backups encrypted and stored off-host. Restorable via documented drill (`ops/restore-drill.sh`). DS_GB impact limited to one bus's counter window. |
| **Sec 57 — Confidentiality of data** | AES-256-GCM at rest for device secrets. TLS 1.2+ in transit. Disk encryption at rest (LUKS or provider option). |

**Not fully addressed:** Formal incident response plan with defined roles
and notification timelines. The alerting script (`ops/check-alerts.sh`)
detects incidents but does not enforce a documented response procedure.

### ISO 27001:2022 — Control Families Addressed

| Annex A Control | How Addressed |
|-----------------|---------------|
| **5.1 — Information security policies** | Enforced by code (guards, validators, state machine). Documented in this file. |
| **5.15 — Access control** | JWT + per-device MQTT creds + AdminUser table with phone/password. |
| **5.20 — Non-conformities** | SecurityEvent log captures every invalid attempt with full payload context. |
| **5.25 — Risk assessment** | Threat model documented above. Residual risks (physical device extraction, GPS spoofing) explicitly accepted. |
| **5.29 — Security in development** | `class-validator` DTOs, whitelist-only validation, global JWT guard (`@Public()` opt-out). |
| **5.33 — Protection of records** | Hash-chained AuditLog (tamper-evident). Photo auto-deletion after 30 days. |
| **6.8 — Event logging** | SecurityEvent + AuditLog + AttendanceEvent. Hourly spike checker (`check-alerts.sh`). |
| **7.1 — Operating procedures** | `ops/README.md` runbook covers deploy, backup, restore, rotation. |
| **7.2 — Change management** | Image-based deploys (Docker); `docker-compose.prod.yml` is the sole production source of truth. |
| **7.10 — Storage medium disposal** | `mosquitto_data` volume from old deployments wiped on `down -v`. Photo deletion job runs daily. |
| **8.1 — Cryptographic controls** | AES-256-GCM (device secrets), HMAC-SHA256 (payload signatures + student tokens), bcrypt (passwords). |
| **8.3 — Secure authentication** | JWT (admin), HMAC token (student QR), per-device MQTT password (`allow_anonymous false`). |
| **8.10 — Redundancy** | Backups stored off-host. Restore procedure tested via drill. |
| **8.11 — Backup** | Nightly encrypted (`age`) `pg_dump` with 30-day rotation and off-host copy. |
| **8.16 — Log retention** | `logrotate` caps backend logs at 30 daily rotations. Docker logs at 3 files × 10 MB. |

**Not addressed:** Formal business continuity plan (BCP), regular penetration
testing schedule, supplier/vendor risk assessments (no third-party
processors).

### GDPR-Style Principles (Reference for Nepal Deployment)

Even without GDPR applicability in Nepal, its data-protection principles
provide useful design guidance:

| Principle | How Addressed |
|-----------|---------------|
| **Data minimization** | Only essential PII stored (student name, parent phone). No addresses, no biometrics in DB. Photos auto-deleted after 30 days. |
| **Purpose limitation** | Attendance tracking only. No data shared with third parties. |
| **Storage limitation** | Photo retention capped at 30 days. Audit log trimmed to last 100 entries in API (DB retains all). Backups rotated at 30 days. |
| **Integrity & confidentiality** | TLS + encryption at rest + access controls + tamper-evident audit log. |
| **Accountability** | Hash-chained AuditLog documents all admin actions. `/audit/verify` detects tampering. |

**Not addressed:** Formal privacy notice (not applicable for a school-internal
demo, but needed before real deployment). Data subject access request (DSAR)
procedure.

---

## Security Architecture Diagram

```
┌──────────────┐     TLS MQTT (8883)     ┌──────────────┐
│  ESP32-CAM   │ ───────────────────────▶ │   Mosquitto  │
│  (or Phone)  │     per-device auth      │   (Broker)   │
└──────────────┘                          └──────┬───────┘
                                                  │ subscribe
                                                  ▼
┌──────────────┐     HTTPS/WSS            ┌──────────────┐
│  Dashboard   │ ◀─────────────────────── │   Backend    │
│  (React)     │     JWT auth             │   (NestJS)   │
└──────────────┘                          └──────┬───────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │  PostgreSQL   │
                                          │ (encrypted)   │
                                          └──────────────┘
```
