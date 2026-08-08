# SafeRide Nepal — Demo Script

> Face-recognition based school bus attendance and tracking system.
> Students are identified by facial recognition; the QR flow has been removed.

## Prerequisites

- Docker + Docker Compose installed
- Python 3.8+ with `pip`
- OpenSSL (for cert generation)
- Native Windows face-service running on `127.0.0.1:5001` (`face-service/run_native.bat`, or
  the Docker service if available)

## Setup

```bash
# 1. Start the envelope (DB, MQTT, backend, dashboard, face-service)
#    Native Windows stack:
./ops/start-native-stack.bat

#    Or Docker (if WSL/docker works):
docker-compose up -d
```

# 2. Enroll a student's face
#    Dashboard → Students → click "Face" next to a student → upload a photo

## Demo Scenarios

### 1. Normal Tap (Happy Path)

```bash
# Simulate a face-recognition tap (face photo identifies the student)
python simulator/simulate_tap.py --face-photo /path/to/enrolled-face.jpg
```

**Expected:** Green checkmark on Live Feed within ~1 second.

### 2. Tampered Signature

```bash
python simulator/simulate_tap.py --face-photo /path/to/enrolled-face.jpg --tamper
```

**Expected:** `INVALID_DEVICE_SIGNATURE` appears in Security Log.

### 3. Replay Attack

```bash
# First, run a normal tap to capture a valid payload
python simulator/simulate_tap.py --face-photo /path/to/enrolled-face.jpg

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
for i in 1 2 3 4 5; do
  python simulator/simulate_tap.py --face-photo /path/to/enrolled-face.jpg --tamper
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

- [ ] `docker-compose up` works with zero manual steps after cert setup.
- [ ] MQTT traffic runs over TLS (port 8883, not 1883) when the broker
      listens on 8883; for the ngrok demo the simulator uses plain MQTT
      on a forwarded TCP port.
- [ ] Dashboard is served over HTTPS/WSS.
- [ ] Simulator publishes with `retain=False` (verify in Mosquitto logs).
- [ ] Device secrets are encrypted at rest — `SELECT * FROM "Device";`
      shows no plaintext secret.
- [ ] AuditLog hash chain is verifiable — `GET /audit/verify`.
- [ ] No secrets appear in `git log` or any committed file.
- [ ] All attendance events recorded with `identMethod = 'FACE'`.