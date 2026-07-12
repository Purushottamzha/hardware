#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SafeRide Nepal — Hourly SecurityEvent spike check
#
# Queries the SecurityEvent table for events in the last hour and alerts if
# any AUTO_SUSPENDED entry exists, or if total events exceed a threshold.
#
# Install as a cron job or systemd timer (see ops/README.md).
#
# Alert methods supported:
#   EMAIL — sendmail/mailx to ALERT_EMAIL
#   GAMMU — if gammu-smsd-inject is available, send SMS (reuses project infra)
#   LOG   — always logs to syslog
# =============================================================================

DB_CONTAINER="${DB_CONTAINER:-saferide-hardware-module-postgres-1}"
DB_NAME="${DB_NAME:-saferide}"
DB_USER="${DB_USER:-saferide}"
ALERT_EMAIL="${ALERT_EMAIL:-admin@yourdomain.example.com}"
SPIKE_THRESHOLD="${SPIKE_THRESHOLD:-20}"

log() {
  logger -t saferide-alert "$1"
  echo "[$(date)] $1"
}

send_email() {
  local subject="$1"
  local body="$2"
  echo "$body" | mail -s "$subject" "$ALERT_EMAIL" 2>/dev/null && \
    log "Email alert sent to ${ALERT_EMAIL}" || \
    log "WARN: Could not send email (mailx not installed?)"
}

send_sms() {
  if command -v gammu-smsd-inject &>/dev/null; then
    gammu-smsd-inject TEXT "$GAMMU_ALERT_NUMBER" -text "SafeRide: $1" 2>/dev/null && \
      log "SMS alert sent" || \
      log "WARN: Could not send SMS via Gammu"
  fi
}

# Query SecurityEvent count in the last hour
EVENTS_LAST_HOUR=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A \
  -c "SELECT count(*) FROM \"SecurityEvent\" WHERE \"createdAt\" > NOW() - INTERVAL '1 hour';" 2>/dev/null || echo "0")

# Query AUTO_SUSPENDED events in the last hour
SUSPENDED_LAST_HOUR=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A \
  -c "SELECT count(*) FROM \"SecurityEvent\" WHERE type='AUTO_SUSPENDED' AND \"createdAt\" > NOW() - INTERVAL '1 hour';" 2>/dev/null || echo "0")

log "Events last hour: ${EVENTS_LAST_HOUR}, Suspensions: ${SUSPENDED_LAST_HOUR}"

# Check for auto-suspensions
if [ "${SUSPENDED_LAST_HOUR}" -gt 0 ]; then
  ALERT_BODY="Auto-suspension events detected in the last hour: ${SUSPENDED_LAST_HOUR}"
  log "ALERT: ${ALERT_BODY}"
  send_email "SafeRide Alert — Device Auto-Suspended" "$ALERT_BODY"
  send_sms "Device auto-suspended: ${SUSPENDED_LAST_HOUR} event(s)"
fi

# Check for event spike
if [ "${EVENTS_LAST_HOUR}" -gt "${SPIKE_THRESHOLD}" ]; then
  ALERT_BODY="SecurityEvent spike detected: ${EVENTS_LAST_HOUR} events in the last hour (threshold: ${SPIKE_THRESHOLD})"
  log "ALERT: ${ALERT_BODY}"
  send_email "SafeRide Alert — SecurityEvent Spike" "$ALERT_BODY"
fi

log "Check complete."
