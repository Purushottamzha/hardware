# SafeRide Nepal — Production Deployment Runbook

A step-by-step guide for deploying the SafeRide Nepal attendance gateway on
a real VPS with real TLS, hardened security, encrypted backups, and alerting.

---

## 1. Prerequisites

- **VPS**: Ubuntu 22.04 or 24.04, 2 GB RAM, 20 GB disk (minimum).
- **Domain**: `yourdomain.example.com` pointed at the VPS IP. A subdomain
  `dashboard.yourdomain.example.com` should also resolve (CNAME or A record).
- **SSH key**: Key-based access to the VPS (password auth will be disabled).
- **Docker + Compose** installed on the VPS:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- **Git**: `apt install -y git`

On your local machine, clone the repo, then `scp` the project to the VPS:

```bash
# From local machine
scp -r saferide-hardware-module user@yourdomain.example.com:~/
```

---

## 2. Host Hardening

SSH into the VPS:

```bash
ssh user@yourdomain.example.com
cd ~/saferide-hardware-module
chmod +x ops/harden-host.sh
sudo ./ops/harden-host.sh
```

This script does four things:

1. **ufw** — Deny all inbound by default; allow only 443 (HTTPS), 8883 (MQTT
   TLS), and 22 (SSH). If you SSH from a single known IP, optionally restrict
   port 22 further (see comment in the script).

2. **SSH hardening** — Disables password authentication, disables root login,
   restricts host keys to Ed25519 only.

3. **fail2ban** — Enables the default SSH jail plus a custom jail
   (`saferide-backend`) watching the backend's login endpoint for brute-force
   attempts (log path: `/var/log/saferide/backend.log`).

4. **Unattended upgrades** — Automatically installs OS-level security updates
   daily. No automatic reboot.

### Verify hardening

```bash
sudo ufw status verbose
# Should show: 22, 443, 8883 allowed. Everything else DENY.

sudo fail2ban-client status
# Should show: sshd and saferide-backend jails.

sudo fail2ban-client status saferide-backend
# Should show 0 banned initially.
```

---

## 3. Disk Encryption

Enable the VPS provider's **disk encryption at rest** option before
deploying anything (most providers offer this in the control panel under
"Volume" or "Disk" settings).

If self-managing the disk (dedicated server), set up LUKS:

```bash
# Identify the data disk (NOT your OS disk):
lsblk
# Example: /dev/sdb

# Encrypt it:
sudo cryptsetup luksFormat /dev/sdb
sudo cryptsetup open /dev/sdb saferide-crypt
sudo mkfs.ext4 /dev/mapper/saferide-crypt
sudo mount /dev/mapper/saferide-crypt /var/lib/docker
```

> **Note**: The live database is inside Docker's named volume on an
> encrypted disk. This ensures encryption at rest without modifying
> Postgres config.

---

## 4. TLS with Let's Encrypt

Production uses **two separate TLS mechanisms** for two different purposes:

### 4a. HTTP reverse proxy (Caddy) — for backend API + dashboard

Caddy automatically obtains and renews Let's Encrypt certs. It handles
`yourdomain.example.com` (reverse-proxied to backend:3000) and
`dashboard.yourdomain.example.com` (reverse-proxied to dashboard:80).

### 4b. MQTT TLS (certbot) — for device-to-mosquitto

Caddy cannot reverse-proxy MQTT traffic. Mosquitto reads the Let's Encrypt
cert directly. Use `certbot` standalone mode:

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d yourdomain.example.com
```

This creates certs at `/etc/letsencrypt/live/yourdomain.example.com/`.
A cron job renews them automatically:

```bash
echo "0 3 * * * root certbot renew --quiet && docker exec saferide-hardware-module-mosquitto-1 kill -HUP 1" \
  | sudo tee /etc/cron.d/saferide-cert-renew
```

The `mosquitto.prod.conf` points `cafile`, `certfile`, and `keyfile` at
these paths. Mosquitto is reloaded via SIGHUP after renewal.

### Verify TLS

```bash
# Caddy certs:
curl -v https://yourdomain.example.com/health 2>&1 | grep "SSL certificate"

# MQTT TLS:
openssl s_client -connect localhost:8883 -CApath /etc/ssl/certs 2>&1 | grep "Verify return code"
# Should show: 0 (ok)
```

---

## 5. Secrets Setup

Production never stores plaintext secrets in `.env`. Instead, it uses
**Docker secrets** — each secret is a file under `./secrets/` mounted into
the container at `/run/secrets/<name>`. The backend code reads from
`/run/secrets/*` when present (`_FILE` env var pattern), falling back to
`process.env` for local dev.

### 5a. Generate secrets

```bash
cd ~/saferide-hardware-module
export DOMAIN=yourdomain.example.com
sudo ./ops/setup-secrets.sh
```

This creates:
- `secrets/` directory with files for `db_password`, `encryption_key`,
  `jwt_secret`, `student_token_secret`, `mosquitto_password`,
  `admin_password`
- `.env.prod` with non-secret production env vars (Domain, JWT_EXPIRY, etc.)
- Updates the Mosquitto password file with the backend user's credentials

**Important**: Copy the generated `admin_password` somewhere safe (password
manager):

```bash
cat secrets/admin_password
```

### 5b. Verify no secrets in git

```bash
git log -p --all | grep -E "ENCRYPTION_KEY|JWT_SECRET|STUDENT_TOKEN_SECRET|MOSQUITTO_PASSWORD" | grep -v "^[+-].*=$" | head -5
# Should show only empty key names (no values).

git grep -n "23e8ce271"  # the dev ENCRYPTION_KEY from .env
# Should match nothing in committed files.
```

---

## 6. Deploy

```bash
cd ~/saferide-hardware-module
sudo docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### Verify services

```bash
sudo docker-compose -f docker-compose.prod.yml ps -a
# All services should show "Up" or "healthy".

# Check Caddy cert issuance:
sudo docker logs saferide-hardware-module-caddy-1 2>&1 | grep -i "certificate"
# Should show successful ACME challenge and certificate issued.

# Health endpoint:
curl -s https://yourdomain.example.com/health
# {"status":"ok","timestamp":"..."}

# Admin login:
ADMIN_PASS=$(sudo cat secrets/admin_password)
curl -s -X POST https://yourdomain.example.com/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"+977-9800000000\",\"password\":\"${ADMIN_PASS}\"}"
# Should return an access_token.
```

---

## 7. Backup Setup

### 7a. Install age for encryption

```bash
sudo apt install -y age
```

### 7b. Generate backup keypair

```bash
sudo mkdir -p /etc/saferide
sudo age-keygen -o /etc/saferide/backup-key
sudo cp /etc/saferide/backup-key{,.pub}
# The .pub file is the recipient; share it with anyone who needs to encrypt backups.
# The private key must be kept secret — consider printing and storing offline.
```

### 7c. Install the backup script

```bash
sudo cp ops/backup-db.sh /usr/local/bin/saferide-backup-db
sudo chmod +x /usr/local/bin/saferide-backup-db
```

### 7d. Install the systemd timer

```bash
sudo cp ops/saferide-backup.service /etc/systemd/system/
sudo cp ops/saferide-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable saferide-backup.timer
sudo systemctl start saferide-backup.timer
```

### 7e. Verify the timer

```bash
sudo systemctl status saferide-backup.timer
# Should show: "Active: active (waiting)"

# Manually trigger a backup to test:
sudo systemctl start saferide-backup.service
# Check the result:
ls -la /var/backups/saferide/
# Should show a .sql.gz.age file.
```

---

## 8. Restore Procedure

This is a **copy-paste runbook** for someone restoring the database after
a failure. It assumes the backup key is available.

### Prerequisites

```bash
# The backup private key (needed to decrypt):
#   /etc/saferide/backup-key
```

### Restore commands

```bash
# 1. Find the most recent backup
ls -lt /var/backups/saferide/saferide-db-*.sql.gz.age

# 2. Run the restore drill
sudo ./ops/restore-drill.sh /var/backups/saferide/saferide-db-20260712-030000.sql.gz.age

# 3. If the drill passes, restore into the live database:
#    (This shuts down the backend first to prevent writes during restore)
docker-compose -f docker-compose.prod.yml stop backend
BACKUP_FILE="/var/backups/saferide/saferide-db-20260712-030000.sql.gz.age"
age -d -i /etc/saferide/backup-key "$BACKUP_FILE" \
  | gunzip \
  | docker exec -i saferide-hardware-module-postgres-1 psql -U saferide -d saferide
docker-compose -f docker-compose.prod.yml start backend
```

### Verify restore

```bash
curl -s https://yourdomain.example.com/students -H "Authorization: Bearer $(your-jwt)"
# Should show the same students as before the failure.
```

---

## 9. Alerting Setup

### 9a. Install the alerting script

```bash
sudo cp ops/check-alerts.sh /usr/local/bin/saferide-check-alerts
sudo chmod +x /usr/local/bin/saferide-check-alerts
```

### 9b. Configure alert destinations

Edit `/usr/local/bin/saferide-check-alerts` and set:
- `ALERT_EMAIL` — email address for alerts (requires `mailx` installed)
- `GAMMU_ALERT_NUMBER` — phone number for SMS (requires project's Gammu
  infrastructure; optional)

### 9c. Install the systemd timer

```bash
sudo cp ops/saferide-alert.service /etc/systemd/system/
sudo cp ops/saferide-alert.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable saferide-alert.timer
sudo systemctl start saferide-alert.timer
```

### 9d. Test the alert

```bash
# Manually trigger the check:
sudo /usr/local/bin/saferide-check-alerts

# Or trigger a real tamper event via the simulator, then check:
sudo journalctl -u saferide-alert.service --since "5 min ago"

# If email is configured, check your inbox.
```

---

## 10. Log Rotation

```bash
sudo cp ops/logrotate.conf /etc/logrotate.d/saferide-backend
sudo logrotate -d /etc/logrotate.d/saferide-backend
# The -d (debug) flag shows what would be rotated without doing it.
```

Also set Docker's own log rotation by adding to `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Then restart Docker: `sudo systemctl restart docker`.

---

## 11. Key/Secret Rotation Procedures

### Rotate a device secret

```bash
# 1. Suspend the device
curl -s -X POST https://yourdomain.example.com/devices/<device-id>/suspend \
  -H "Authorization: Bearer $(your-jwt)"

# 2. Register it again (generates a new secret)
curl -s -X POST https://yourdomain.example.com/devices/register \
  -H "Authorization: Bearer $(your-jwt)" \
  -H "Content-Type: application/json" \
  -d '{"id":"<device-id>","busId":"<bus-id>"}'
# Returns new secret.

# 3. Update the Mosquitto password file with the new device MQTT password
docker run --rm -v /path/to/mosquitto/certs:/certs eclipse-mosquitto:2 \
  mosquitto_passwd -b /certs/passwd <device-id> <new-mqtt-password>

# 4. Reload Mosquitto
docker exec saferide-hardware-module-mosquitto-1 kill -HUP 1

# 5. Update the physical device with the new secret.
```

### Rotate ENCRYPTION_KEY

This is a **destructive operation** — all existing device secrets will need
to be re-registered:

```bash
# 1. List all devices and note their IDs
curl -s https://yourdomain.example.com/devices -H "Authorization: Bearer $(your-jwt)"

# 2. Generate new key
openssl rand -hex 32

# 3. Update the secret file
printf '%s' 'new-key-hex' | sudo tee /run/secrets/encryption_key

# 4. Re-register every device (see "Rotate a device secret" above)
#    Each device gets a new secret encrypted with the new key.

# 5. Restart the backend
docker-compose -f docker-compose.prod.yml restart backend
```

### Recover from a compromised admin password

```bash
# 1. SSH into the VPS
# 2. Read the current admin_password
sudo cat /run/secrets/admin_password
# If it was changed without updating the secret file:
printf '%s' 'new-admin-password' | sudo tee /run/secrets/admin_password
docker-compose -f docker-compose.prod.yml restart backend
```

---

## 12. Verification Checklist

After completing all steps above:

- [ ] `sudo ufw status` — only 22, 443, 8883 allowed
- [ ] `curl -v https://yourdomain.example.com/health 2>&1 | grep "200 OK"` — backend reachable
- [ ] `openssl s_client -connect localhost:8883 -CApath /etc/ssl/certs 2>&1 | grep "0 (ok)"` — MQTT TLS
- [ ] `sudo docker-compose -f docker-compose.prod.yml ps` — all services Up
- [ ] `sudo systemctl status saferide-backup.timer` — active
- [ ] `sudo systemctl status saferide-alert.timer` — active
- [ ] `ls /var/backups/saferide/ | head -5` — backup files exist
- [ ] `sudo ./ops/restore-drill.sh` — backup is restorable
- [ ] `git log -p --all | grep -E "(ENCRYPTION_KEY|JWT_SECRET)=" | grep -v "^[+-].*=$" | wc -l` — 0 (no real secrets in git)
