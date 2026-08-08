#!/usr/bin/env bash
# =============================================================================
# SafeRide Nepal — Secure Attendance Gateway
# ONE-TIME DEMO SETUP
#
# Run this once. It will:
#   1. Check prerequisites
#   2. Generate .env with all secrets (idempotent — won't overwrite existing)
#   3. Generate TLS certs + Mosquitto password file (idempotent)
#   4. Build and start everything with Docker Compose
#   5. Wait for the backend to be healthy
#   6. Log in as admin, register a demo bus device, create a demo student
#   7. Add MQTT broker credentials for that device
#   8. Write simulator/config.json — fully pre-filled, ready to run
#   9. Create a demo student (faces are enrolled from the Dashboard)
#
# After this finishes, your ENTIRE re-run command for future demo days is:
#   docker-compose up -d
#
# Usage:
#   ./demo-quickstart.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}▸${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

API="http://localhost:3000"
DEMO_DEVICE_ID="bus-demo-01"
DEMO_BUS_ID="BA-2-KHA-4521"
DEMO_STUDENT_NAME="Aarav Sharma"

# --- 1. Prerequisite checks -------------------------------------------------
log "Checking prerequisites..."
command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install it first: https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1 || fail "Docker Compose is not available."
command -v openssl >/dev/null 2>&1 || fail "OpenSSL is not installed."
command -v curl >/dev/null 2>&1 || fail "curl is not installed."
command -v python >/dev/null 2>&1 || warn "python not found locally — you'll only be able to run the simulator from your phone (Termux)."
ok "Prerequisites present."

DC="docker compose"
docker compose version >/dev/null 2>&1 || DC="docker-compose"

# --- 2. Generate .env (idempotent) ------------------------------------------
if [ -f .env ]; then
  ok ".env already exists — leaving it untouched."
else
  log "Generating .env with fresh random secrets..."
  cp .env.example .env
  ENCRYPTION_KEY="$(openssl rand -hex 32)"
  JWT_SECRET="$(openssl rand -hex 32)"
  STUDENT_TOKEN_SECRET="$(openssl rand -hex 32)"
  ADMIN_PASSWORD="$(openssl rand -hex 12)"

  sed -i.bak \
    -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" \
    -e "s|^STUDENT_TOKEN_SECRET=.*|STUDENT_TOKEN_SECRET=${STUDENT_TOKEN_SECRET}|" \
    -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASSWORD}|" \
    .env
  rm -f .env.bak
  ok ".env created — admin password: ${ADMIN_PASSWORD} (also saved, see summary at the end)."
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

# --- 3. TLS certs + Mosquitto password file (idempotent) -------------------
if [ -f mosquitto/certs/ca.crt ] && [ -f mosquitto/certs/passwd ]; then
  ok "TLS certs and Mosquitto password file already exist — skipping."
else
  log "Generating TLS certs and Mosquitto password file..."
  chmod +x setup-certs.sh
  ./setup-certs.sh
  ok "Certs generated."
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

# --- 4. Build and start everything ------------------------------------------
log "Building and starting containers (this can take a few minutes the first time)..."
$DC up --build -d
ok "Containers started."

# --- 5. Wait for backend health ---------------------------------------------
log "Waiting for backend to become healthy..."
for i in $(seq 1 60); do
  if curl -sf "${API}/health" >/dev/null 2>&1; then
    ok "Backend is up."
    break
  fi
  if [ "$i" -eq 60 ]; then
    fail "Backend did not become healthy in time. Run '${DC} logs backend' to investigate."
  fi
  sleep 2
done

# --- 6. Admin login -----------------------------------------------------
log "Logging in as admin..."
LOGIN_RESPONSE="$(curl -sf -X POST "${API}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"${ADMIN_PHONE}\",\"password\":\"${ADMIN_PASSWORD}\"}")" \
  || fail "Admin login failed. Check ADMIN_PHONE/ADMIN_PASSWORD in .env match what the backend seeded."

ADMIN_JWT="$(echo "$LOGIN_RESPONSE" | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")"
ok "Admin JWT acquired."

# --- 7. Register demo device -------------------------------------------
log "Registering demo device '${DEMO_DEVICE_ID}'..."
DEVICE_RESPONSE="$(curl -sf -X POST "${API}/devices/register" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_JWT}" \
  -d "{\"id\":\"${DEMO_DEVICE_ID}\",\"busId\":\"${DEMO_BUS_ID}\"}" 2>/dev/null)" || true

if [ -z "$DEVICE_RESPONSE" ] || echo "$DEVICE_RESPONSE" | grep -q "already registered"; then
  warn "Device '${DEMO_DEVICE_ID}' already registered — reusing existing simulator/config.json if present."
  DEVICE_SECRET=""
else
  DEVICE_SECRET="$(echo "$DEVICE_RESPONSE" | python -c "import sys,json; print(json.load(sys.stdin)['secret'])")"
  ok "Device registered. Secret captured (shown only this once by the API)."
fi

# --- 8. Add MQTT broker credentials for the device --------------------------
if [ -n "${DEVICE_SECRET}" ]; then
  log "Creating MQTT broker credentials for the device..."
  MQTT_DEVICE_PASSWORD="$(openssl rand -hex 16)"
  docker run --rm -v "${ROOT}/mosquitto/certs:/certs" eclipse-mosquitto:2 \
    mosquitto_passwd -b /certs/passwd "${DEMO_DEVICE_ID}" "${MQTT_DEVICE_PASSWORD}" >/dev/null 2>&1
  $DC restart mosquitto >/dev/null 2>&1
  ok "MQTT credentials created for ${DEMO_DEVICE_ID}."
fi

# --- 9. Create demo student --------------------------------------------
log "Creating demo student '${DEMO_STUDENT_NAME}'..."
STUDENT_RESPONSE="$(curl -sf -X POST "${API}/students" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_JWT}" \
  -d "{\"name\":\"${DEMO_STUDENT_NAME}\"}")"
STUDENT_ID="$(echo "$STUDENT_RESPONSE" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")"
ok "Student created: ${DEMO_STUDENT_NAME} (${STUDENT_ID})"

# --- 10. Write simulator/config.json ----------------------------------------
if [ -n "${DEVICE_SECRET}" ]; then
  log "Writing simulator/config.json..."
  cat > simulator/config.json <<EOF
{
  "deviceId": "${DEMO_DEVICE_ID}",
  "deviceSecret": "${DEVICE_SECRET}",
  "broker": {
    "host": "localhost",
    "port": 8883,
    "username": "${DEMO_DEVICE_ID}",
    "password": "${MQTT_DEVICE_PASSWORD}",
    "caCert": "$(cd mosquitto/certs && pwd)/ca.crt"
  },
  "topic": "saferide/hardware/{deviceId}/attendance",
  "counter": 0
}
EOF
  ok "simulator/config.json ready."
fi

# --- 11. Install simulator Python deps (best-effort, local only) -----------
if command -v pip3 >/dev/null 2>&1; then
  log "Installing simulator Python dependencies locally (best-effort)..."
  pip3 install -q -r simulator/requirements.txt --break-system-packages 2>/dev/null \
    || pip3 install -q -r simulator/requirements.txt 2>/dev/null \
    || warn "Could not auto-install simulator deps. Run manually: pip3 install -r simulator/requirements.txt"
fi

# --- 12. Remind to enroll the demo student's face -----------------------
log "Demo student created. Enroll the face from the Dashboard:"
echo ""
echo "  Open  http://localhost:5173/students"
echo "  Find '${DEMO_STUDENT_NAME}' → click the 'Face' button → upload a photo."
echo ""

# --- Summary -----------------------------------------------------------
echo ""
echo -e "${GREEN}=========================================================${NC}"
echo -e "${GREEN}  SafeRide Nepal — Demo environment is ready${NC}"
echo -e "${GREEN}=========================================================${NC}"
echo ""
echo "  Dashboard:        http://localhost:5173"
echo "  Backend API:      http://localhost:3000"
echo "  Admin phone:      ${ADMIN_PHONE}"
echo "  Admin password:   ${ADMIN_PASSWORD}"
echo "  Demo device:      ${DEMO_DEVICE_ID}  (bus: ${DEMO_BUS_ID})"
echo "  Demo student:     ${DEMO_STUDENT_NAME}  (${STUDENT_ID})"
echo ""
echo "  Try a real face tap right now (from this machine):"
echo "    cd simulator && python3 simulate_tap.py --face-photo <path-to-face-photo.jpg>"
echo ""
echo "  Try the attack demos:"
echo "    python3 simulate_tap.py --face-photo <photo.jpg> --tamper   # INVALID_DEVICE_SIGNATURE"
echo "    python3 simulate_tap.py --replay                            # REPLAY_SUSPECTED"
echo ""
echo "  To move to your phone later:"
echo "    1. Install Termux + Termux:API app on Android"
echo "    2. Copy the simulator/ folder to the phone"
echo "    3. pkg install python termux-api && pip install -r requirements.txt"
echo "    4. Enroll the student's face on the Dashboard, then run:"
echo "       python simulate_tap.py"
echo ""
echo "  Next time, you only need:  ${DC} up -d"
echo -e "${GREEN}=========================================================${NC}"
