#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SafeRide Nepal — Nightly encrypted database backup
#
# Requirements:
#   - age (age-encryption.org) installed: apt install age
#   - Recipient public key at /etc/saferide/backup-key.pub
#       (generate with: age-keygen -o /etc/saferide/backup-key)
#   - Off-host SCP destination or object storage (set BACKUP_TARGET)
#
# This script is intended to be run by a systemd timer or cron.
# =============================================================================

BACKUP_DIR="${BACKUP_DIR:-/var/backups/saferide}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_TARGET="${BACKUP_TARGET:-}"              # e.g. user@backup-host:/backups/saferide/
DB_CONTAINER="${DB_CONTAINER:-saferide-hardware-module-postgres-1}"
DB_NAME="${DB_NAME:-saferide}"
DB_USER="${DB_USER:-saferide}"
AGE_PUBKEY="${AGE_PUBKEY:-/etc/saferide/backup-key.pub}"
AGE_PRIVKEY="${AGE_PRIVKEY:-/etc/saferide/backup-key}"
ALERT_SCRIPT="${ALERT_SCRIPT:-/usr/local/bin/saferide-send-alert}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FILENAME="saferide-db-${TIMESTAMP}.sql.gz.age"
BACKUP_PATH="${BACKUP_DIR}/${FILENAME}"

echo "[$(date)] Starting backup: ${BACKUP_PATH}"

# Dump, compress, encrypt in a pipeline — never writes plaintext to disk
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" \
  | gzip \
  | age -e -R "$AGE_PUBKEY" \
  > "$BACKUP_PATH"

BACKUP_SIZE=$(stat -c%s "$BACKUP_PATH" 2>/dev/null || stat -f%z "$BACKUP_PATH" 2>/dev/null)
echo "[$(date)] Backup written: ${BACKUP_PATH} (${BACKUP_SIZE} bytes)"

# Rotate old backups
find "$BACKUP_DIR" -name 'saferide-db-*.sql.gz.age' -mtime +$BACKUP_RETENTION_DAYS -delete

# Copy off-host if target configured
if [ -n "$BACKUP_TARGET" ]; then
  echo "[$(date)] Copying to off-host: ${BACKUP_TARGET}"
  scp -i /etc/saferide/backup-ssh-key -o StrictHostKeyChecking=accept-new \
    "$BACKUP_PATH" "${BACKUP_TARGET%/}/"
  echo "[$(date)] Off-host copy complete."
fi

# Alert if backup is suspiciously small (likely corrupt)
if [ "$BACKUP_SIZE" -lt 1000 ]; then
  echo "[ALERT] Backup size ${BACKUP_SIZE} bytes — likely corrupt!" >&2
  if [ -x "$ALERT_SCRIPT" ]; then
    "$ALERT_SCRIPT" "DB backup too small: ${BACKUP_SIZE} bytes"
  fi
  exit 1
fi

echo "[$(date)] Backup complete."
