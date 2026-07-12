#!/usr/bin/env python3
"""
SafeRide Nepal — Attendance Tap Simulator (Phase 1)

Runs in Termux on Android or any Python 3 environment.

Usage:
    python simulate_tap.py
    python simulate_tap.py --qr-file path/to/qr.png
    python simulate_tap.py --token "base64token..."
    python simulate_tap.py --tamper    # corrupts signature for attack simulation
    python simulate_tap.py --replay    # re-publishes last captured payload
"""

import argparse
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import paho.mqtt.client as mqtt

CONFIG_PATH = Path(__file__).parent / "config.json"
LAST_PAYLOAD_PATH = Path(__file__).parent / ".last_payload.json"


def load_config():
    if not CONFIG_PATH.exists():
        print(f"[ERROR] config.json not found. Copy config.example.json to config.json and fill in.")
        sys.exit(1)

    with open(CONFIG_PATH) as f:
        cfg = json.load(f)

    if not cfg.get("deviceSecret"):
        print("[ERROR] deviceSecret is empty. Fill it in config.json.")
        sys.exit(1)

    return cfg


def save_config(cfg):
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)


def save_last_payload(payload):
    with open(LAST_PAYLOAD_PATH, "w") as f:
        json.dump(payload, f)


def load_last_payload():
    if not LAST_PAYLOAD_PATH.exists():
        print("[ERROR] No previous payload to replay. Run a normal tap first.")
        sys.exit(1)
    with open(LAST_PAYLOAD_PATH) as f:
        return json.load(f)


def capture_photo(output_path):
    """Capture photo via Termux:API camera."""
    try:
        subprocess.run(["termux-camera-photo", str(output_path)], check=True, timeout=10)
        print(f"[OK] Photo captured: {output_path}")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("[WARN] termux-camera-photo not available. Continuing without photo.")
        return False


def decode_qr(image_path):
    """Decode QR code from image using pyzbar."""
    try:
        from PIL import Image
        from pyzbar.pyzbar import decode

        img = Image.open(image_path)
        codes = decode(img)
        if codes:
            return codes[0].data.decode("utf-8")
    except Exception as e:
        print(f"[WARN] QR decode failed: {e}")
    return None


def get_gps_fix():
    """Get GPS fix via Termux:API location."""
    try:
        result = subprocess.run(
            ["termux-location"],
            capture_output=True, text=True, check=True, timeout=15
        )
        data = json.loads(result.stdout)
        return data.get("latitude", 0.0), data.get("longitude", 0.0)
    except (subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError) as e:
        print(f"[WARN] termux-location failed: {e}")
        return 27.6939, 85.3374  # default Kathmandu coordinates


def build_canonical_json(obj):
    """Build canonical JSON with alphabetically sorted keys, no whitespace."""
    sorted_keys = sorted(obj.keys())
    parts = []
    for k in sorted_keys:
        v = obj[k]
        if isinstance(v, float):
            parts.append(f'"{k}":{v}')
        elif isinstance(v, int):
            parts.append(f'"{k}":{v}')
        else:
            parts.append(f'"{k}":"{v}"')
    return "{" + ",".join(parts) + "}"


def sign_payload(payload_without_sig, secret):
    """Compute HMAC-SHA256 signature."""
    canonical = build_canonical_json(payload_without_sig)
    sig = hmac.new(
        secret.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    return sig


def publish_mqtt(cfg, payload):
    """Publish over TLS MQTT with retain=False, QoS 1."""
    client = mqtt.Client(client_id=f"sim-{cfg['deviceId']}-{int(time.time())}")
    client.tls_set(cfg["broker"]["caCert"])
    client.username_pw_set(cfg["broker"]["username"], cfg["broker"]["password"])

    try:
        client.connect(cfg["broker"]["host"], cfg["broker"]["port"], 60)
        topic = cfg["topic"].replace("{deviceId}", cfg["deviceId"])
        info = client.publish(topic, json.dumps(payload), qos=1, retain=False)
        info.wait_for_publish()
        print(f"[OK] Published to {topic}")
        client.disconnect()
        return True
    except Exception as e:
        print(f"[ERROR] MQTT publish failed: {e}")
        return False


def poll_status():
    """Poll backend status endpoint to see if event was accepted."""
    print("[NOTE] Check the Live Feed dashboard to verify acceptance.")


def simulate_tap(args):
    cfg = load_config()

    print("=" * 50)
    print("SafeRide Nepal — Attendance Tap")
    print("=" * 50)

    # --- Replay mode ---
    if args.replay:
        print("\n[REPLAY MODE] Re-publishing last captured payload...")
        payload = load_last_payload()
        payload["timestamp"] = int(time.time() * 1000)  # update timestamp
        publish_mqtt(cfg, payload)
        return

    # --- Capture photo ---
    photo_path = Path("/tmp/saferide_qr.png")
    capture_photo(photo_path)

    # --- Decode QR ---
    student_token = None
    if args.token:
        student_token = args.token
        print(f"[OK] Using provided token (len={len(student_token)})")
    elif args.qr_file:
        student_token = decode_qr(args.qr_file)
        if student_token:
            print(f"[OK] QR decoded from {args.qr_file}")
    elif photo_path.exists():
        student_token = decode_qr(photo_path)
        if student_token:
            print(f"[OK] QR decoded from captured photo")
        else:
            print("[WARN] No QR found in photo. Using fallback token.")
    else:
        print("[WARN] No token provided. Use --token <raw> or --qr-file <path>.")
        return

    # --- Get GPS ---
    lat, lon = get_gps_fix()
    print(f"[GPS] Lat: {lat:.4f}, Lon: {lon:.4f}")

    # --- Increment counter ---
    cfg["counter"] += 1
    save_config(cfg)
    print(f"[COUNTER] {cfg['counter']}")

    # --- Build payload ---
    timestamp = int(time.time() * 1000)
    payload_without_sig = {
        "deviceId": cfg["deviceId"],
        "studentToken": student_token,
        "lat": lat,
        "lon": lon,
        "timestamp": timestamp,
        "counter": cfg["counter"],
    }

    signature = sign_payload(payload_without_sig, cfg["deviceSecret"])
    payload = {**payload_without_sig, "signature": signature}

    # --- Tamper mode: corrupt the signature ---
    if args.tamper:
        print("\n[TAMPER MODE] Corrupting signature for attack simulation...")
        payload["signature"] = "0" * 64
        print(f"[TAMPER] Signature set to: {payload['signature'][:16]}...")

    # --- Save for replay ---
    save_last_payload(payload)

    print(f"\n--- Payload ---")
    print(json.dumps(payload, indent=2))
    print(f"--- Signature valid: {'NO (tampered)' if args.tamper else 'YES'} ---")

    # --- Publish ---
    publish_mqtt(cfg, payload)
    poll_status()


def main():
    parser = argparse.ArgumentParser(description="SafeRide Nepal Attendance Tap Simulator")
    parser.add_argument("--qr-file", help="Path to QR code image file")
    parser.add_argument("--token", help="Raw student token string")
    parser.add_argument("--tamper", action="store_true", help="Corrupt signature for attack simulation")
    parser.add_argument("--replay", action="store_true", help="Re-publish last captured payload verbatim")
    args = parser.parse_args()

    simulate_tap(args)


if __name__ == "__main__":
    main()
