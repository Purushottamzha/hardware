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
