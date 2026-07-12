#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")" && pwd)/mosquitto/certs"
mkdir -p "$CERT_DIR"

# CA key + cert
openssl genrsa -out "$CERT_DIR/ca.key" 2048
openssl req -x509 -new -nodes -key "$CERT_DIR/ca.key" -sha256 -days 365 \
  -out "$CERT_DIR/ca.crt" \
  -subj "/C=NP/ST=Bagmati/L=Kathmandu/O=SafeRide/CN=SafeRideCA"

# Server key + CSR + cert
openssl genrsa -out "$CERT_DIR/server.key" 2048
openssl req -new -key "$CERT_DIR/server.key" -out "$CERT_DIR/server.csr" \
  -subj "/C=NP/ST=Bagmati/L=Kathmandu/O=SafeRide/CN=mosquitto"
openssl x509 -req -in "$CERT_DIR/server.csr" \
  -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
  -out "$CERT_DIR/server.crt" -days 365 -sha256

rm "$CERT_DIR/server.csr"

# Mosquitto password file — create user entries
touch "$CERT_DIR/passwd"
MQTT_PASS="$(openssl rand -hex 16)"
echo "Creating Mosquitto password entries..."
docker run --rm -v "$CERT_DIR:/certs" eclipse-mosquitto:2 mosquitto_passwd -b /certs/passwd backend "$MQTT_PASS"
echo "Created 'backend' user with password: $MQTT_PASS"

# Update .env with the generated password
ENV_FILE="$(cd "$(dirname "$0")" && pwd)/.env"
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
