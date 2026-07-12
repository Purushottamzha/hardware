#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SafeRide Nepal — Production Secrets Setup
#
# Creates the secrets/ directory with Docker-secret-compatible files.
# Must be run on the production VPS (not in local dev).
#
# Usage:
#   sudo ./setup-secrets.sh
#
# Environment variables (set these before running, or edit the defaults below):
#   DOMAIN          — your domain (required)
#   DB_PASSWORD     — Postgres password
#   ENCRYPTION_KEY  — 64 hex chars (openssl rand -hex 32)
#   JWT_SECRET      — 64 hex chars
#   STUDENT_TOKEN_SECRET — 64 hex chars
#   MOSQUITTO_PASS  — MQTT password for backend user
#   ADMIN_PHONE     — Admin login phone
#   ADMIN_PASS      — Admin login password
# =============================================================================

SECRETS_DIR="$(cd "$(dirname "$0")/.." && pwd)/secrets"
mkdir -p "$SECRETS_DIR"
chmod 0700 "$SECRETS_DIR"

echo "=== SafeRide Production Secrets Setup ==="
echo "Secrets directory: ${SECRETS_DIR}"
echo ""

# Generate missing secrets
generate_if_empty() {
  local var_name="$1"
  local file_name="$2"
  local file_path="${SECRETS_DIR}/${file_name}"
  if [ ! -f "$file_path" ]; then
    local val="${!var_name:-}"
    if [ -z "$val" ]; then
      val="$(openssl rand -hex 32)"
    fi
    printf '%s' "$val" > "$file_path"
    chmod 0400 "$file_path"
    echo "  Created ${file_name}"
  else
    echo "  ${file_name} already exists, not overwriting"
  fi
}

generate_if_empty DB_PASSWORD db_password
generate_if_empty ENCRYPTION_KEY encryption_key
generate_if_empty JWT_SECRET jwt_secret
generate_if_empty STUDENT_TOKEN_SECRET student_token_secret

# Mosquitto password
MOSQUITTO_PASS="${MOSQUITTO_PASS:-$(openssl rand -hex 16)}"
if [ ! -f "${SECRETS_DIR}/mosquitto_password" ]; then
  printf '%s' "$MOSQUITTO_PASS" > "${SECRETS_DIR}/mosquitto_password"
  chmod 0400 "${SECRETS_DIR}/mosquitto_password"
  # Also add backend user to Mosquitto password file
  MOSQUITTO_CERTS="$(cd "$(dirname "$0")/.." && pwd)/mosquitto/certs"
  if [ -d "$MOSQUITTO_CERTS" ]; then
    docker run --rm -v "$MOSQUITTO_CERTS:/certs" eclipse-mosquitto:2 \
      mosquitto_passwd -b /certs/passwd backend "$MOSQUITTO_PASS" 2>/dev/null || true
    echo "  Updated Mosquitto password file with backend user"
  fi
  echo "  Created mosquitto_password"
fi

# Admin password
ADMIN_PASS="${ADMIN_PASS:-$(openssl rand -hex 16)}"
if [ ! -f "${SECRETS_DIR}/admin_password" ]; then
  printf '%s' "$ADMIN_PASS" > "${SECRETS_DIR}/admin_password"
  chmod 0400 "${SECRETS_DIR}/admin_password"
  echo "  Created admin_password"
fi

# Create .env.prod for docker-compose (only non-secret vars + file references)
PROD_ENV="$(cd "$(dirname "$0")/.." && pwd)/.env.prod"
cat > "$PROD_ENV" << ENVEOF
# Production env vars — non-secret values only
# Secrets are in ./secrets/ directory, mounted as Docker secrets

DOMAIN=${DOMAIN?DOMAIN environment variable is required}
JWT_EXPIRY=8h
PHOTO_RETENTION_DAYS=30
NODE_ENV=production
ENVEOF
chmod 0600 "$PROD_ENV"
echo "  Created .env.prod"

echo ""
echo "=== Secrets setup complete ==="
echo ""
echo "Files in ${SECRETS_DIR}:"
ls -la "$SECRETS_DIR"
echo ""
echo "IMPORTANT: Copy the admin_password value — you'll need it to log in:"
echo "  cat ${SECRETS_DIR}/admin_password"
echo ""
echo "Next: docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d"
