#!/usr/bin/env bash
set -euo pipefail

# SafeRide Nepal — one-time Android/Termux phone setup
# Run: bash setup_phone.sh
#
# Auto-registers the device with the backend so the phone is
# fully ready after this single script — no separate admin steps.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.json"

echo "============================================"
echo "  SafeRide Nepal — Phone Setup"
echo "============================================"
echo ""

# ---- 1. System packages ----
echo "[1/5] Installing system packages... (this may take a minute)"
pkg update -y
pkg install -y python termux-api mosquitto curl 2>/dev/null || pkg install -y python termux-api curl
echo ""

# ---- 2. Python packages ----
echo "[2/5] Installing Python packages..."
pip install paho-mqtt pyzbar pillow qrcode --break-system-packages
echo ""

# ---- 3. Prompt for config ----
echo "[3/5] Configuration (enter values, no quotes needed)"
echo ""
read -p "  Broker host / LAN IP (e.g. 192.168.1.100):   " BROKER_HOST
read -p "  Device ID (e.g. bus-01-door-PHONE):          " DEVICE_ID
read -p "  Bus ID (which bus, e.g. bus-01 or bus-02):   " BUS_ID
read -p "  Admin phone [default: +977-9800000000]:      " ADMIN_PHONE
ADMIN_PHONE="${ADMIN_PHONE:-+977-9800000000}"
read -s -p "  Admin password:                              " ADMIN_PASSWORD
echo ""

# ---- 4. Register device via backend API ----
echo ""
echo "[4/5] Registering device with backend..."
echo ""

# 4a. Login — use Python argv to build JSON safely (no quoting issues)
API_BASE="https://$BROKER_HOST/api"
LOGIN_BODY=$(python3 -c "
import json, sys
args = sys.argv[1:]
print(json.dumps({'phone': args[0], 'password': args[1]}))
" "$ADMIN_PHONE" "$ADMIN_PASSWORD" 2>/dev/null)
LOGIN_RESP=$(curl -sk -X POST "$API_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "$LOGIN_BODY" 2>/dev/null)

JWT=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)

if [ -z "$JWT" ]; then
  echo "  ERROR: Login failed. Check admin credentials."
  echo "  Response: $LOGIN_RESP"
  exit 1
fi
echo "  Logged in as $ADMIN_PHONE"

# 4b. Register device
REG_BODY=$(python3 -c "
import json, sys
args = sys.argv[1:]
print(json.dumps({'id': args[0], 'busId': args[1]}))
" "$DEVICE_ID" "$BUS_ID" 2>/dev/null)
REG_RESP=$(curl -sk -X POST "$API_BASE/devices/register" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "$REG_BODY" 2>/dev/null)

DEVICE_SECRET=$(echo "$REG_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('secret',''))" 2>/dev/null)

if [ -z "$DEVICE_SECRET" ]; then
  echo "  ERROR: Registration failed."
  echo "  Response: $REG_RESP"
  exit 1
fi
echo "  Device registered: $DEVICE_ID (bus: $BUS_ID)"

# ---- 5. Write config.json ----
echo ""
echo "[5/5] Generating config.json..."

cat > "$CONFIG_FILE" << CONFEOF
{
  "deviceId": "$DEVICE_ID",
  "deviceSecret": "$DEVICE_SECRET",
  "apiBaseUrl": "http://$BROKER_HOST:3000",
  "broker": {
    "host": "$BROKER_HOST",
    "port": 1883,
    "username": "$DEVICE_ID",
    "password": "$DEVICE_SECRET",
    "caCert": ""
  },
  "topic": "saferide/hardware/{deviceId}/attendance",
  "counter": 0
}
CONFEOF

echo "  Config written to: $CONFIG_FILE"
echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "  Your phone is registered and ready."
echo ""
echo "  Every time you want to run the demo:"
echo "    python continuous_scan.py"
echo ""
echo "  For a single test scan:"
echo "    python simulate_tap.py --token <student-token>"
echo ""
echo "  IMPORTANT: The MQTT broker password for this device"
echo "  must be set to the same deviceSecret. Ask your admin"
echo "  to run on the server:"
echo "    docker exec saferide-hardware-module-mosquitto-1 \\"
echo "      mosquitto_passwd -b /mosquitto/certs/passwd \\"
echo "        \"$DEVICE_ID\" \"$DEVICE_SECRET\""
echo "  then restart Mosquitto."
echo ""
