#!/usr/bin/env python3
"""
SafeRide Nepal — Termux Tap Publisher

Standalone script for Android/Termux: reads a student token from argv,
builds an HMAC-SHA256 signed MQTT payload matching the backend's
buildCanonicalJson exactly, and publishes over TLS to Mosquitto.

Usage:
    python termux_tap.py <student_token>

Config file: termux_config.json (gitignored, see termux_config.example.json)
Dependencies: paho-mqtt (pip install paho-mqtt)
"""

import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path

import paho.mqtt.client as mqtt

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CONFIG_PATH = Path(__file__).parent / "termux_config.json"


def load_config():
    if not CONFIG_PATH.exists():
        print(f"[ERROR] {CONFIG_PATH} not found.", file=sys.stderr)
        print(f"  Copy termux_config.example.json to termux_config.json", file=sys.stderr)
        print(f"  and fill in device credentials.", file=sys.stderr)
        sys.exit(1)
    with open(CONFIG_PATH) as f:
        return json.load(f)


def save_config(cfg):
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)


# ---------------------------------------------------------------------------
# Canonical JSON (must match backend's buildCanonicalJson / Python simulator)
# ---------------------------------------------------------------------------
def build_canonical_json(obj):
    """Alphabetically sorted keys, no whitespace — matches backend's JSON.stringify(sorted)."""
    sorted_keys = sorted(obj.keys())
    parts = []
    for k in sorted_keys:
        v = obj[k]
        if isinstance(v, float):
            parts.append(f'"{k}":{v}')
        elif isinstance(v, int):
            parts.append(f'"{k}":{v}')
        elif v is None:
            parts.append(f'"{k}":null')
        else:
            parts.append(f'"{k}":"{v}"')
    return "{" + ",".join(parts) + "}"


# ---------------------------------------------------------------------------
# HMAC-SHA256 signature
# ---------------------------------------------------------------------------
def sign_payload(payload_without_sig, secret):
    canonical = build_canonical_json(payload_without_sig)
    sig = hmac.new(
        secret.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return sig


# ---------------------------------------------------------------------------
# MQTT publish (TLS, QoS 1, retain=False)
# ---------------------------------------------------------------------------
def publish_mqtt(cfg, payload):
    client = mqtt.Client(
        client_id=f"termux-{cfg['deviceId']}-{int(time.time())}",
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )

    ca_path = cfg.get("caCertPath")
    if ca_path and os.path.isfile(ca_path):
        client.tls_set(ca_path)
        client.tls_insecure_set(True)
    else:
        if ca_path:
            print(f"[WARN] CA cert not found at {ca_path}, skipping TLS verification", file=sys.stderr)
        else:
            print("[INFO] No caCertPath configured, skipping TLS verification", file=sys.stderr)
        import ssl
        client.tls_set_context(ssl.create_default_context())
        client.tls_insecure_set(True)
    client.username_pw_set(cfg.get("mqttUsername"), cfg.get("mqttPassword"))

    try:
        client.connect(cfg["brokerHost"], cfg["brokerPort"], 10)
        client.loop_start()
        topic = f"saferide/hardware/{cfg['deviceId']}/attendance"
        info = client.publish(topic, json.dumps(payload), qos=1, retain=False)
        info.wait_for_publish(timeout=10)
        print(f"[OK] Published to {topic}")
        client.loop_stop()
        client.disconnect()
        return True
    except Exception as e:
        print(f"[ERROR] MQTT publish failed: {e}", file=sys.stderr)
        try:
            client.loop_stop()
            client.disconnect()
        except Exception:
            pass
        return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    if len(sys.argv) < 2:
        print(f"Usage: python {sys.argv[0]} <student_token>", file=sys.stderr)
        print(f"  (get the token by scanning the QR with zbarimg)", file=sys.stderr)
        sys.exit(1)

    student_token = sys.argv[1]
    config = load_config()

    # Use fixed lat/lon from config (edit in termux_config.json)
    lat = config.get("lat", 27.6939)
    lon = config.get("lon", 85.3374)
    print(f"[GPS] Lat: {lat:.4f}, Lon: {lon:.4f}  (from config)")

    # Increment and persist counter
    config["counter"] += 1
    save_config(config)
    print(f"[COUNTER] {config['counter']}")

    # Build payload (signature excluded from canonical JSON)
    timestamp = int(time.time() * 1000)
    payload_without_sig = {
        "deviceId": config["deviceId"],
        "studentToken": student_token,
        "lat": lat,
        "lon": lon,
        "timestamp": timestamp,
        "counter": config["counter"],
    }

    signature = sign_payload(payload_without_sig, config["deviceSecret"])
    payload = {**payload_without_sig, "signature": signature}

    print(f"\n--- Payload ---")
    print(json.dumps(payload, indent=2))
    print(f"--- Signature valid: YES ---")

    publish_mqtt(config, payload)


if __name__ == "__main__":
    main()
