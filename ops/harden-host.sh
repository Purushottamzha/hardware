#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SafeRide Nepal — VPS Host Hardening
# Run ONCE on a fresh Ubuntu 22.04 / 24.04 VPS.
# This script is idempotent — safe to re-run.
# =============================================================================

echo "=== 1. ufw — firewall ==="
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 443/tcp comment 'HTTPS (Caddy)'
ufw allow 8883/tcp comment 'MQTT TLS (Mosquitto)'
# If SSH is only ever used from a known IP, restrict further:
# ufw allow from YOUR_IP to any port 22 proto tcp
ufw --force enable
ufw status verbose

echo "=== 2. SSH hardening ==="
SSHD_CONFIG=/etc/ssh/sshd_config
# Disable password auth — key-only
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"
sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' "$SSHD_CONFIG"
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONFIG"
sed -i 's/^#\?PermitEmptyPasswords.*/PermitEmptyPasswords no/' "$SSHD_CONFIG"
# Use only Ed25519 keys
sed -i 's/^#\?HostKey \/etc\/ssh\/ssh_host_rsa_key/\#HostKey \/etc\/ssh\/ssh_host_rsa_key/' "$SSHD_CONFIG"
sed -i 's/^#\?HostKey \/etc\/ssh\/ssh_host_ecdsa_key/\#HostKey \/etc\/ssh\/ssh_host_ecdsa_key/' "$SSHD_CONFIG"
# Ensure Ed25519 key exists
if [ ! -f /etc/ssh/ssh_host_ed25519_key ]; then
  ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N ''
fi
systemctl restart sshd
echo "SSH hardened — key-only, no root login."

echo "=== 3. fail2ban ==="
apt-get install -y fail2ban
cat > /etc/fail2ban/jail.local << 'F2B'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = 22
logpath = %(sshd_log)s

[saferide-backend]
enabled = true
port = 443
logpath = /var/log/saferide/backend.log
maxretry = 10
findtime = 300
bantime = 1800
F2B
systemctl enable fail2ban
systemctl restart fail2ban
echo "fail2ban enabled — SSH + backend login jails active."

echo "=== 4. Automatic security updates ==="
apt-get install -y unattended-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'UPGRADES'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
UPGRADES
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'UPGRADES2'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
UPGRADES2
systemctl enable unattended-upgrades
systemctl restart unattended-upgrades
echo "Unattended security upgrades enabled."

echo ""
echo "=== Hardening complete ==="
echo "Next steps:"
echo "  1. Verify SSH key login works in a NEW terminal before closing this one."
echo "  2. Run: ufw status | grep -E '443|8883|22'"
echo "  3. Run: fail2ban-client status"
echo "  4. Proceed to ops/README.md for secrets setup + deploy."
