# SafeRide Nepal — From-Scratch Setup Guide

> **Never commit `.env` or `mosquitto/certs/` — see `.gitignore`.**

## Prerequisites

- **Docker + Docker Compose** (Docker Desktop on Windows/Mac, or docker-compose plugin on Linux)
- **Python 3.8+** with `pip install requests qrcode[pil] paho-mqtt`
- **OpenSSL** on PATH (or use Git Bash / WSL on Windows — see cert step below)
- Ports **443** (Caddy) and **8883** (Mosquitto) free on the host

## Step-by-Step

### 1. Clone

```bash
git clone <repo-url>
cd saferide-hardware-module
```

### 2. Generate TLS certificates and Mosquitto credentials

```bash
# Linux / macOS / WSL / Git Bash:
./setup-certs.sh
```

> **Windows:** `setup-certs.sh` is a bash script. Run it via **Git Bash**, **WSL**, or **Cygwin**. If none are available, manually:
> 1. Generate a CA key + cert, server key + cert in `mosquitto/certs/` (use `openssl` from any shell)
> 2. Create the Mosquitto password file:
>    ```powershell
>    # Run once to create empty file, then add users
>    docker run --rm -v "$(pwd)/mosquitto/certs:/certs" eclipse-mosquitto:2 mosquitto_passwd -b /certs/passwd backend <random-password>
>    ```
> 3. Copy the printed password — it goes into `.env` as `MOSQUITTO_PASSWORD`

### 3. Create `.env` from the template

```bash
cp .env.example .env
```

Fill in every `=` value:

```bash
# Generate each with:
#   openssl rand -hex 32

ENCRYPTION_KEY=<32-byte-hex>       # AES-256-GCM key for device secrets at rest
JWT_SECRET=<32-byte-hex>           # JWT signing key
STUDENT_TOKEN_SECRET=<32-byte-hex> # HMAC key for student QR tokens

# Password printed by setup-certs.sh for the 'backend' MQTT user:
MOSQUITTO_PASSWORD=<from-setup-certs-sh>

# Admin credentials for the dashboard login:
ADMIN_PASSWORD=<openssl rand -hex 16>   # do NOT use a weak default
# ADMIN_PHONE defaults to +977-9800000000

# TLS verification on — the backend rejects unauthenticated Mosquitto connections:
MQTT_TLS_REJECT_UNAUTHORIZED=true

# Dashboard API URL (served through Caddy HTTPS):
VITE_API_URL=https://localhost/api
DASHBOARD_ORIGIN=https://localhost
```

### 4. Start the stack

```bash
docker-compose up -d --build
```

First build takes 2–5 minutes (npm install + TypeScript compilation).

### 5. Verify the services

```bash
docker-compose ps
```

Expected output:

| Service    | Ports exposed to host     |
|------------|---------------------------|
| `caddy`    | `0.0.0.0:443->443/tcp`   |
| `mosquitto`| `0.0.0.0:8883->8883/tcp` |
| `postgres` | `5432/tcp` (internal only)|
| `backend`  | (none, internal only)     |
| `dashboard`| (none, internal only)     |

Backend and dashboard are **not** directly reachable from the host. All HTTP traffic goes through **Caddy** on `https://localhost`.

### 6. Open the dashboard

Visit **https://localhost** in your browser. Accept the self-signed certificate warning (Caddy uses `tls internal`). The login page should load.

### 7. Seed initial data

The backend seed script automatically creates the admin user on first startup. Log in:

```bash
# Replace <password> with your ADMIN_PASSWORD from .env
curl -k -X POST https://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"+977-9800000000","password":"<ADMIN_PASSWORD>"}'
```

Save the returned `access_token` — you'll need it for the next steps.

### 8. Register a device

```bash
curl -k -X POST https://localhost/api/devices/register \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"busId":"ba2kha4521","locationDesc":"Door"}'
```

Save the returned `id` and `secret`. Then create MQTT credentials for the device:

```bash
docker run --rm -v "$(pwd)/mosquitto/certs:/certs" eclipse-mosquitto:2 \
  mosquitto_passwd -b /certs/passwd <device-id> <device-secret>
```

Restart Mosquitto to pick up the new password file:
```bash
docker-compose restart mosquitto
```

### 9. Create a student

```bash
curl -k -X POST https://localhost/api/students \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo Student"}'
```

Save the returned `id`.

### 10. Generate a student QR token

```bash
python simulator/generate_student_qr.py <student-id> --token <admin-jwt>
```

This creates `qr_<student-id>.png` in the current directory.

### 11. Configure the simulator

Create `simulator/config.json`:

```json
{
  "deviceId": "<device-id>",
  "deviceSecret": "<device-secret>",
  "apiBaseUrl": "http://localhost:3000",
  "broker": {
    "host": "localhost",
    "port": 8883,
    "username": "<device-id>",
    "password": "<device-secret>",
    "caCert": "mosquitto/certs/ca.crt"
  },
  "topic": "saferide/hardware/{deviceId}/attendance",
  "counter": 0
}
```

> This file is gitignored. Use `config.example.json` as a reference.

### 12. Run a normal tap

```bash
python simulator/simulate_tap.py --qr-file qr_<student-id>.png
```

Expected output:
```
--- Payload ---
...signature valid: YES...
[OK] Published to saferide/hardware/...
```

### 13. Verify on the dashboard

1. Go to **https://localhost** — the Live Feed page.
2. Within ~1 second, a green event card appears showing `BOARDED` (or the next state).
3. Go to **Attendance Overview** — the student's status updates to `BOARDED`.
4. Go to **Security Log** — the event is logged as `verified: true`.

## Running in Docker (simulator as a container)

```bash
# Build and run the simulator container (tools profile)
docker-compose run --rm simulator --help
```

The container reads its config from `simulator/config.docker.json` (gitignored — copy from `config.example.json`).

## Demo scenarios

See [DEMO.md](./DEMO.md) for the full demo script covering:
- Happy path tap
- Tampered signature → `INVALID_DEVICE_SIGNATURE`
- Replay attack → `REPLAY_SUSPECTED`
- Invalid state sequence → `INVALID_SEQUENCE`
- 5 invalid taps → auto-suspend → `AUTO_SUSPENDED`
- Manual reactivation

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| Dashboard doesn't load at https://localhost | Caddy didn't start — check `docker-compose logs caddy` |
| Login returns 401 Unauthorized | `ADMIN_PASSWORD` in `.env` differs from what was seeded. Rebuild: `docker-compose up -d --build backend` |
| MQTT connection refused | Mosquitto password file missing or wrong path in `mosquitto.conf`. Ensure `setup-certs.sh` ran. |
| `SIGNATURE_MISMATCH` on every tap | `deviceSecret` in `simulator/config.json` doesn't match the encrypted secret in the DB. Re-register the device. |
| `REPLAY_SUSPECTED` on first tap | `simulator/config.json` counter is <= `device.lastSeenCounter`. Increment counter or reset via admin API. |
