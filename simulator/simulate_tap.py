#!/usr/bin/env python3
"""
SafeRide Nepal — Attendance Tap Simulator (Phase 1 + Offline Buffering)

Runs in Termux on Android or any Python 3 environment.

Usage:
    python simulate_tap.py
    python simulate_tap.py --qr-file path/to/qr.png
    python simulate_tap.py --token "base64token..."
    python simulate_tap.py --tamper    # corrupts signature for attack simulation
    python simulate_tap.py --replay    # re-publishes last captured payload
    python simulate_tap.py --flush     # flush offline buffer
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
import requests

from offline_buffer import buffer_event, flush_buffer, get_last_counter

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

    if not cfg.get("apiBaseUrl"):
        print("[ERROR] apiBaseUrl is empty. Add it to config.json (e.g. \"apiBaseUrl\": \"http://localhost:3000\")")
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
    client = mqtt.Client(
        client_id=f"sim-{cfg['deviceId']}-{int(time.time())}",
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )
    client.tls_set(cfg["broker"]["caCert"])
    client.tls_insecure_set(True)
    client.username_pw_set(cfg["broker"]["username"], cfg["broker"]["password"])

    try:
        client.connect(cfg["broker"]["host"], cfg["broker"]["port"], 10)
        client.loop_start()
        topic = cfg["topic"].replace("{deviceId}", cfg["deviceId"])
        info = client.publish(topic, json.dumps(payload), qos=1, retain=False)
        info.wait_for_publish(timeout=10)
        print(f"[OK] Published to {topic}")
        client.loop_stop()
        client.disconnect()
        return True
    except Exception as e:
        print(f"[ERROR] MQTT publish failed: {e}")
        try:
            client.loop_stop()
            client.disconnect()
        except:
            pass
        return False


def sign_photo_upload(device_id, counter, photo_timestamp, secret):
    """Compute HMAC-SHA256 over {deviceId, counter, photoTimestamp}."""
    canonical = build_canonical_json({
        "deviceId": device_id,
        "counter": counter,
        "photoTimestamp": photo_timestamp,
    })
    return hmac.new(
        secret.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def upload_photo(cfg, photo_path, counter, tamper=False):
    """Upload captured photo to backend via HTTP multipart POST, HMAC-signed."""
    backend_url = cfg.get("apiBaseUrl")
    if not backend_url:
        print("[ERROR] apiBaseUrl not set in config.json. Add it: \"apiBaseUrl\": \"http://your-backend:3000\"")
        return
    photo_timestamp = int(time.time() * 1000)
    sig = sign_photo_upload(cfg["deviceId"], counter, photo_timestamp, cfg["deviceSecret"])

    if tamper:
        sig = "0" * 64
        print(f"[TAMPER] Photo signature corrupted: {sig[:16]}...")

    try:
        with open(photo_path, "rb") as f:
            files = {"photo": f}
            data = {
                "deviceId": cfg["deviceId"],
                "counter": str(counter),
                "photoSignature": sig,
                "photoTimestamp": str(photo_timestamp),
            }
            resp = requests.post(
                f"{backend_url}/attendance/photo",
                files=files,
                data=data,
                timeout=15,
            )
        if resp.status_code == 201 or resp.status_code == 200:
            print(f"[OK] Photo uploaded: {resp.json().get('photoPath')}")
        else:
            print(f"[WARN] Photo upload failed ({resp.status_code}): {resp.text[:200]}")
    except Exception as e:
        print(f"[WARN] Photo upload error: {e}")


def poll_status():
    """Poll backend status endpoint to see if event was accepted."""
    print("[NOTE] Check the Live Feed dashboard to verify acceptance.")


def publish_with_buffer(cfg, payload):
    """
    Try to publish via MQTT. If it fails, buffer the event locally.
    Returns True if published immediately, False if buffered.
    """
    success = publish_mqtt(cfg, payload)
    if success:
        return True

    # Buffer the event for later retry
    print("[BUFFER] MQTT unavailable, buffering event locally...")
    buffer_event(
        device_id=cfg["deviceId"],
        student_token=payload["studentToken"],
        lat=payload["lat"],
        lon=payload["lon"],
        timestamp=payload["timestamp"],
        counter=payload["counter"],
        signature=payload["signature"],
    )
    return False


def flush_buffer_cmd(cfg):
    """Flush all buffered events."""
    print("[BUFFER] Flushing offline buffer...")
    sent = flush_buffer(lambda p: publish_mqtt(cfg, p))
    print(f"[BUFFER] Flushed {sent} events")


def simulate_tap(args):
    cfg = load_config()

    # Resume counter from buffer if higher
    buffered_counter = get_last_counter()
    if buffered_counter > cfg["counter"]:
        print(f"[BUFFER] Resuming counter from buffer: {buffered_counter}")
        cfg["counter"] = buffered_counter
        save_config(cfg)

    print("=" * 50)
    print("SafeRide Nepal — Attendance Tap")
    print("=" * 50)

    # --- Flush buffer first ---
    flush_buffer_cmd(cfg)

    # --- Replay mode ---
    if args.replay:
        print("\n[REPLAY MODE] Re-publishing last captured payload verbatim...")
        payload = load_last_payload()
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

    # --- Publish (with offline buffering) ---
    publish_with_buffer(cfg, payload)

    # --- Upload photo (non-blocking, best-effort, HMAC-signed) ---
    if photo_path and photo_path.exists():
        upload_photo(cfg, photo_path, cfg["counter"], tamper=args.tamper)

    poll_status()


def main():
    parser = argparse.ArgumentParser(description="SafeRide Nepal Attendance Tap Simulator")
    parser.add_argument("--qr-file", help="Path to QR code image file")
    parser.add_argument("--token", help="Raw student token string")
    parser.add_argument("--tamper", action="store_true", help="Corrupt signature for attack simulation")
    parser.add_argument("--replay", action="store_true", help="Re-publish last captured payload verbatim")
    parser.add_argument("--flush", action="store_true", help="Flush offline buffer and exit")
    args = parser.parse_args()

    cfg = load_config()

    if args.flush:
        flush_buffer_cmd(cfg)
        return

    simulate_tap(args)


if __name__ == "__main__":
    main()