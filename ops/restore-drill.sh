#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SafeRide Nepal — Backup Restore Drill
#
# Run to verify last night's encrypted backup is intact and restorable.
# Spins up a throwaway Postgres container, restores into it, runs a sanity
# query, then tears it down.
#
# Usage:
#   sudo ./restore-drill.sh [backup-file]
#
# If no backup file is given, the most recent one in BACKUP_DIR is used.
# =============================================================================

BACKUP_DIR="${BACKUP_DIR:-/var/backups/saferide}"
AGE_PRIVKEY="${AGE_PRIVKEY:-/etc/saferide/backup-key}"

if [ $# -ge 1 ]; then
  BACKUP_FILE="$1"
else
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/saferide-db-*.sql.gz.age 2>/dev/null | head -1)
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: No backup file found at ${BACKUP_DIR} or path: ${BACKUP_FILE:-}" >&2
  exit 1
fi

echo "=== Restore Drill ==="
echo "Backup file: ${BACKUP_FILE}"
BACKUP_SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null)
echo "Size: ${BACKUP_SIZE} bytes"
echo ""

# 1. Start throwaway Postgres
echo "--- Step 1: Starting throwaway Postgres container ---"
RESTORE_CONTAINER="saferide-restore-test-$(date +%s)"
docker run -d \
  --name "$RESTORE_CONTAINER" \
  -e POSTGRES_USER=saferide \
  -e POSTGRES_PASSWORD=test_pass \
  -e POSTGRES_DB=saferide \
  postgres:15-alpine > /dev/null

# Wait for it to be ready
for i in $(seq 1 30); do
  if docker exec "$RESTORE_CONTAINER" pg_isready -U saferide &>/dev/null; then
    echo "Postgres ready after ${i}s"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Postgres did not become ready" >&2
    docker rm -f "$RESTORE_CONTAINER" > /dev/null
    exit 1
  fi
  sleep 1
done

# 2. Decrypt and restore
echo "--- Step 2: Decrypting and restoring backup ---"
DECRYPTED_SIZE=$(age -d -i "$AGE_PRIVKEY" "$BACKUP_FILE" | gunzip | docker exec -i "$RESTORE_CONTAINER" psql -U saferide -d saferide 2>&1 | tail -1)
echo "Restore output: ${DECRYPTED_SIZE}"

# 3. Sanity query
echo "--- Step 3: Running sanity queries ---"
echo "Tables:"
docker exec "$RESTORE_CONTAINER" psql -U saferide -d saferide -c "\dt" 2>&1
echo ""
echo "Admin users:"
docker exec "$RESTORE_CONTAINER" psql -U saferide -d saferide -c "SELECT id, phone, role FROM \"AdminUser\";" 2>&1
echo ""
echo "Device count:"
docker exec "$RESTORE_CONTAINER" psql -U saferide -d saferide -c "SELECT count(*) FROM \"Device\";" 2>&1
echo ""
echo "Student count:"
docker exec "$RESTORE_CONTAINER" psql -U saferide -d saferide -c "SELECT count(*) FROM \"Student\";" 2>&1
echo ""

# 4. Tear down
echo "--- Step 4: Tearing down throwaway container ---"
docker rm -f "$RESTORE_CONTAINER" > /dev/null

echo ""
echo "=== Restore drill PASSED ==="
echo "Backup ${BACKUP_FILE} is intact and restorable."
