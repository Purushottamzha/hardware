#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERT_DIR="$SCRIPT_DIR/mosquitto/certs"
mkdir -p "mosquitto/certs"
# Convert to Windows path for native tools when on MSYS
case "$(uname -o 2>/dev/null)" in
  Msys|Cygwin) NATIVE_CERT_DIR="$(cd "$SCRIPT_DIR/mosquitto/certs" && pwd -W)" ;;
  *)           NATIVE_CERT_DIR="$CERT_DIR" ;;
esac

# CA key + cert
openssl genrsa -out "mosquitto/certs/ca.key" 2048
openssl req -x509 -new -nodes -key "mosquitto/certs/ca.key" -sha256 -days 365 \
  -out "mosquitto/certs/ca.crt" \
  -subj "/C=NP/ST=Bagmati/L=Kathmandu/O=SafeRide/CN=SafeRideCA"

# Detect LAN IPv4 address (for phone-on-Wi-Fi access)
# Use the interface IP of the default route (0.0.0.0/0)
LAN_IP=""
if command -v route &>/dev/null; then
  LAN_IP="$(route print 0.0.0.0 2>/dev/null | grep -E "^[[:space:]]*0\.0\.0\.0[[:space:]]" | awk '{print $4}' | head -1)"
fi
# Fall back: try ipconfig, pick first non-loopback, non-virtual IPv4
if [ -z "$LAN_IP" ] && command -v ipconfig &>/dev/null; then
  LAN_IP="$(ipconfig 2>/dev/null | grep -i "IPv4" | grep -v "127.0.0.1\|192\.168\.56\.\|192\.168\.137\.\|172\.1[6-9]\." | awk '{print $NF}' | head -1)"
fi
# Last resort: any non-loopback IPv4
if [ -z "$LAN_IP" ] && command -v ipconfig &>/dev/null; then
  LAN_IP="$(ipconfig 2>/dev/null | grep -i "IPv4" | grep -v "127.0.0.1" | awk '{print $NF}' | head -1)"
fi
# Generate SAN config
cat > "mosquitto/certs/san.conf" << EOF
[v3_req]
subjectAltName = DNS:mosquitto,DNS:localhost,IP:127.0.0.1,IP:${LAN_IP:-127.0.0.1}
EOF
echo "Generated san.conf with SAN entries (LAN IP: ${LAN_IP:-not detected})"

# Server key + CSR + cert
openssl genrsa -out "mosquitto/certs/server.key" 2048
openssl req -new -key "mosquitto/certs/server.key" -out "mosquitto/certs/server.csr" \
  -subj "/C=NP/ST=Bagmati/L=Kathmandu/O=SafeRide/CN=mosquitto"
openssl x509 -req -in "mosquitto/certs/server.csr" \
  -CA "mosquitto/certs/ca.crt" -CAkey "mosquitto/certs/ca.key" -CAcreateserial \
  -out "mosquitto/certs/server.crt" -days 365 -sha256 \
  -extensions v3_req -extfile "mosquitto/certs/san.conf"

rm "mosquitto/certs/server.csr"

# Mosquitto password file — create user entries
touch "mosquitto/certs/passwd"
MQTT_PASS="$(openssl rand -hex 16)"
echo "Creating Mosquitto password entries..."
docker run --rm -v "$NATIVE_CERT_DIR:/certs" eclipse-mosquitto:2 mosquitto_passwd -b /certs/passwd backend "$MQTT_PASS"
echo "Created 'backend' user with password: $MQTT_PASS"

# Update .env with the generated password
ENV_FILE="$SCRIPT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  if grep -q "MOSQUITTO_PASSWORD=" "$ENV_FILE"; then
    sed -i "s/^MOSQUITTO_PASSWORD=.*/MOSQUITTO_PASSWORD=$MQTT_PASS/" "$ENV_FILE"
  else
    echo "MOSQUITTO_PASSWORD=$MQTT_PASS" >> "$ENV_FILE"
  fi
  echo "Updated .env with MOSQUITTO_PASSWORD=$MQTT_PASS"
fi

echo ""
echo "Certificates generated in $CERT_DIR"
echo "Add per-device MQTT users by running:"
echo "  docker run --rm -v $CERT_DIR:/certs eclipse-mosquitto:2 mosquitto_passwd -b /certs/passwd <device-id> <password>"
