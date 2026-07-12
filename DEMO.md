# SafeRide Nepal — Demo Script

## Prerequisites

- Docker + Docker Compose installed
- Python 3.8+ with `pip`
- OpenSSL (for cert generation)

## Setup

```bash
# 1. Generate TLS certs and Mosquitto password file
./setup-certs.sh

# 2. Copy and configure environment
cp .env.example .env
# Edit .env:
#   - Generate ENCRYPTION_KEY: openssl rand -hex 32
#   - Generate JWT_SECRET: openssl rand -hex 32
#   - Generate STUDENT_TOKEN_SECRET: openssl rand -hex 32
#   - Set MOSQUITTO_PASSWORD (use the one printed by setup-certs.sh)

# 3. Start everything
docker-compose up
```

## Demo Scenarios

### 1. Normal Tap (Happy Path)

```bash
# Generate a student QR token
python simulator/generate_student_qr.py <student-id> --token <admin-jwt>

# Simulate a normal tap
python simulator/simulate_tap.py --qr-file qr_student.png
```

**Expected:** Green checkmark on Live Feed within ~1 second.

### 2. Tampered Signature

```bash
python simulator/simulate_tap.py --qr-file qr_student.png --tamper
```

**Expected:** `INVALID_DEVICE_SIGNATURE` appears in Security Log.

### 3. Replay Attack

```bash
# First, run a normal tap to capture a valid payload
python simulator/simulate_tap.py --qr-file qr_student.png

# Then replay it verbatim
python simulator/simulate_tap.py --replay
```

**Expected:** `REPLAY_SUSPECTED` appears in Security Log (counter ≤ lastSeenCounter).

### 4. Invalid State Sequence

```bash
# With student in NOT_BOARDED state, simulate a DEPARTED tap
# (The simulator uses the state machine; tapping out of sequence)
# Run multiple taps in rapid succession to trigger sequence violations
```

**Expected:** `INVALID_SEQUENCE` logged, event stored with `verified: false`.

### 5. Auto-Suspend on Abuse

```bash
# Run --tamper 5 times within 5 minutes
for i in 1 2 3 4 5; do
  python simulator/simulate_tap.py --qr-file qr_student.png --tamper
  sleep 2
done
```

**Expected:**
- Device flips to `suspended` in Device Registry after 5th invalid signature.
- `AUTO_SUSPENDED` entry in Security Log and Audit Log.
- Subsequent normal taps are rejected with `DEVICE_SUSPENDED`.

### 6. Manual Reactivation

1. Go to Device Registry in the dashboard.
2. Click "Reactivate" on the suspended device.
3. Run a normal tap — it works again.

## Verification Checklist

- [ ] `docker-compose up` works with zero manual steps after `./setup-certs.sh`.
- [ ] All MQTT traffic runs over TLS (port 8883, not 1883).
- [ ] Dashboard is served over HTTPS/WSS.
- [ ] Simulator publishes with `retain=False` (verify in Mosquitto logs).
- [ ] Device secrets are encrypted at rest — query `SELECT * FROM "Device";` in
      the database and confirm no plaintext secret.
- [ ] AuditLog hash chain is verifiable — call `GET /audit/verify` to check.
- [ ] No secrets appear in `git log` or any committed file.
