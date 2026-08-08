#!/usr/bin/env bash
set -euo pipefail

# SafeRide Nepal — one-time Android/Termux phone setup (NATIVE stack)
# Run: bash setup_phone.sh
#
# Auto-registers the device with the native backend (NO Docker, NO /api prefix)
# and writes the phone config.json so the phone is ready after this script.
#
# Native architecture:
#   HTTP  -> http://LAPTOP_IP:3000   (NestJS backend; /auth/login, /devices/register)
#   MQTT  -> LAPTOP_IP:1883 (plain) or LAPTOP_IP:8883 (TLS)
#   Dash  -> http://LAPTOP_IP:5173
#   Scan  -> http://LAPTOP_IP:8100/scanner

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.json"

echo "============================================"
echo "  SafeRide Nepal — Phone Setup (Native)"
echo "============================================"
echo ""

# ---- 1. System packages ----
echo "[1/7] Installing system packages... (this may take a minute)"
pkg update -y
pkg install -y python termux-api curl 2>/dev/null || pkg install -y python termux-api
echo ""

# ---- 2. Python packages (paho-mqtt + requests only) ----
echo "[2/7] Installing Python packages..."
pip install paho-mqtt requests --break-system-packages
echo ""

# ---- 3. Laptop IP + health check BEFORE anything else ----
echo "[3/7] Laptop (backend) connectivity"
echo ""
read -p "  Laptop LAN IP (e.g. 192.168.1.90):   " LAPTOP_IP
LAPTOP_IP="${LAPTOP_IP:-}"

BASE_URL="http://${LAPTOP_IP}:3000"

echo "  Checking backend health: $BASE_URL/health"
HEALTH=$(curl -s --max-time 10 "$BASE_URL/health" 2>/dev/null || true)

if echo "$HEALTH" | grep -q '"status"'; then
  MQTT_STATE=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('mqtt','unknown'))" 2>/dev/null)
  FACE_STATE=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('faceService','unknown'))" 2>/dev/null)
  echo "  Backend reachable OK (mqtt=$MQTT_STATE, face=$FACE_STATE)"
  if [ "$MQTT_STATE" != "connected" ]; then
    echo "  WARNING: backend reports MQTT disconnected — events may not reach the dashboard."
  fi
  if [ "$FACE_STATE" != "online" ]; then
    echo "  WARNING: face-service reports offline — face identification will fail."
  fi
else
  echo "  ERROR: backend unreachable at $BASE_URL"
  echo "  Troubleshooting:"
  echo "    - Same Wi-Fi network? (laptop at $LAPTOP_IP, profile must be Private)"
  echo "    - Laptop firewall must allow port 3000 (Node)"
  echo "    - Backend running? ops\\start-backend-native.bat"
  exit 1
fi
echo ""

# ---- 4. Device identity ----
echo "[4/7] Device identity"
echo ""
read -p "  Device ID (unique per phone, e.g. bus-ba2kha4521-door-PHONE-TEAM1):   " DEVICE_ID
read -p "  Bus ID (e.g. bus-01 or bus-02):                                        " BUS_ID

if [ -z "$DEVICE_ID" ] || [ -z "$BUS_ID" ]; then
  echo "  ERROR: device ID and bus ID are required."
  exit 1
fi
echo "  NOTE: two phones must NEVER share the same device ID / secret / counter."
echo ""

# ---- 5. Admin login (device registration requires admin token) ----
echo "[5/7] Admin login (for device registration)"
echo ""
read -p "  Admin phone [default: +977-9800000000]:      " ADMIN_PHONE
ADMIN_PHONE="${ADMIN_PHONE:-+977-9800000000}"
read -s -p "  Admin password:                              " ADMIN_PASSWORD
echo ""

LOGIN_BODY=$(python3 -c "
import json, sys
args = sys.argv[1:]
print(json.dumps({'phone': args[0], 'password': args[1]}))
" "$ADMIN_PHONE" "$ADMIN_PASSWORD" 2>/dev/null)

LOGIN_RESP=$(curl -s --max-time 15 -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "$LOGIN_BODY" 2>/dev/null || true)

JWT=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)

if [ -z "$JWT" ]; then
  echo "  ERROR: login failed. Check admin credentials."
  echo "  Response: $LOGIN_RESP"
  exit 1
fi
echo "  Logged in as $ADMIN_PHONE"
echo ""

# ---- 6. Register device ----
echo "[6/7] Registering device with backend..."
echo ""
REG_BODY=$(python3 -c "
import json, sys
args = sys.argv[1:]
print(json.dumps({'id': args[0], 'busId': args[1]}))
" "$DEVICE_ID" "$BUS_ID" 2>/dev/null)

REG_RESP=$(curl -s --max-time 15 -X POST "$BASE_URL/devices/register" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "$REG_BODY" 2>/dev/null || true)

DEVICE_SECRET=$(echo "$REG_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('secret',''))" 2>/dev/null || true)

if [ -z "$DEVICE_SECRET" ]; then
  echo "  ERROR: registration failed."
  echo "  Response: $REG_RESP"
  echo "  (If the device ID already exists, use a different ID or ask the admin"
  echo "   to suspend/re-register it.)"
  exit 1
fi
echo "  Device registered: $DEVICE_ID (bus: $BUS_ID)"
echo ""

# ---- 7. MQTT broker choice + write config.json ----
echo "[7/7] MQTT broker + phone config"
echo ""
echo "  Broker port on the laptop:"
echo "    1) 8883 TLS (recommended — certificates required)"
echo "    2) 1883 plain (LAN demo fallback)"
read -p "  Choose [1/2] (default 1): " MQTT_CHOICE
MQTT_CHOICE="${MQTT_CHOICE:-1}"

if [ "$MQTT_CHOICE" = "2" ]; then
  MQTT_PORT=1883
  CA_CERT=""
  echo "  Using plain MQTT on port 1883."
else
  MQTT_PORT=8883
  echo "  TLS mode: the phone needs the PUBLIC CA certificate from the laptop."
  echo "  On the laptop:  C:\\ProgramData\\saferide-mosquitto\\ca.crt"
  echo "  Copy that file to the phone (e.g. via file manager / ADB) — NEVER the"
  echo "  private keys (ca.key / server.key)."
  read -p "  Path to ca.crt on THIS phone (e.g. /sdcard/Download/ca.crt): " CA_CERT
  CA_CERT="${CA_CERT:-}"
  if [ -z "$CA_CERT" ] || [ ! -f "$CA_CERT" ]; then
    echo "  ERROR: ca.crt not found at '$CA_CERT' — TLS requires it."
    exit 1
  fi
fi

cat > "$CONFIG_FILE" << CONFEOF
{
  "deviceId": "$DEVICE_ID",
  "deviceSecret": "$DEVICE_SECRET",
  "apiBaseUrl": "$BASE_URL",
  "broker": {
    "host": "$LAPTOP_IP",
    "port": $MQTT_PORT,
    "username": "$DEVICE_ID",
    "password": "$DEVICE_SECRET",
    "caCert": "$CA_CERT"
  },
  "topic": "saferide/hardware/{deviceId}/attendance",
  "counter": 0,
  "faceMatchThreshold": 0.6
}
CONFEOF

chmod 600 "$CONFIG_FILE"
echo "  Config written to: $CONFIG_FILE"
echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "  HTTP  backend : $BASE_URL"
echo "  MQTT  broker  : $LAPTOP_IP:$MQTT_PORT"
echo "  Dashboard     : http://$LAPTOP_IP:5173"
echo "  Scanner       : http://$LAPTOP_IP:8100/scanner"
echo ""
echo "  IMPORTANT — one admin step on the laptop:"
echo "  The MQTT broker needs a credential for this device. Run on the laptop:"
echo "    C:\\Program Files\\Mosquitto\\mosquitto_passwd.exe -b"
echo "      C:\\ProgramData\\saferide-mosquitto\\passwd"
echo "      \"$DEVICE_ID\" \"<deviceSecret from config.json on this phone>\""
echo "  then restart the LAN broker (kill + re-run mosquitto.lan.conf)."
echo "  The deviceSecret is stored ONLY in this phone's config.json — do not"
echo "  share it in chat or commit it to git."
echo ""
echo "  Verify the phone environment:"
echo "    python simulate_tap.py --check"
echo ""
echo "  Face-attendance tap with a saved photo:"
echo "    python simulate_tap.py --face-photo /sdcard/DCIM/student.jpg"
echo ""
echo "  Full tap (camera capture + identify + attendance):"
echo "    python simulate_tap.py"
