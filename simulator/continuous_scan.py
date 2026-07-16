#!/usr/bin/env python3
"""
SafeRide Nepal — Continuous QR-scanning Attendance Daemon

Runs on Android/Termux as an always-on camera scanner.
Captures photos, decodes QR codes, and auto-publishes attendance events.

Usage:
    python continuous_scan.py
    python continuous_scan.py --interval 2
    python continuous_scan.py --debounce 30
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from simulate_tap import (
    load_config,
    save_config,
    build_canonical_json,
    sign_payload,
    publish_mqtt,
)

DEFAULT_INTERVAL = 2
DEFAULT_DEBOUNCE = 30
FALLBACK_LAT = 27.6939
FALLBACK_LON = 85.3374

last_gps = (FALLBACK_LAT, FALLBACK_LON)
last_token = None
last_token_time = 0


def capture_photo_scan(output_path):
    try:
        subprocess.run(["termux-camera-photo", str(output_path)], check=True, timeout=10)
        return True
    except Exception as e:
        print(f"[WARN] Camera capture failed: {e}")
        return False


def decode_qr_scan(image_path):
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


def get_gps_fix_continuous(cfg):
    global last_gps
    try:
        result = subprocess.run(
            ["termux-location"],
            capture_output=True, text=True, check=True, timeout=5
        )
        data = json.loads(result.stdout)
        lat = data.get("latitude", last_gps[0])
        lon = data.get("longitude", last_gps[1])
        last_gps = (lat, lon)
        return lat, lon
    except Exception as e:
        print(f"[WARN] GPS fix failed ({e}), reusing last known: {last_gps[0]:.4f}, {last_gps[1]:.4f}")
        return last_gps


def main():
    parser = argparse.ArgumentParser(description="SafeRide Continuous QR Scanner")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL,
                        help="Seconds between capture attempts (default: 2)")
    parser.add_argument("--debounce", type=int, default=DEFAULT_DEBOUNCE,
                        help="Seconds before re-accepting same QR (default: 30)")
    args = parser.parse_args()

    cfg = load_config()
    interval = max(1, args.interval)
    debounce = max(1, args.debounce)

    global last_gps
    if "lat" in cfg and "lon" in cfg:
        last_gps = (cfg["lat"], cfg["lon"])

    photo_path = Path("/tmp/saferide_scan_qr.png")
    loop_count = 0

    print("=" * 50)
    print("SafeRide Nepal — Continuous QR Scanner")
    print(f"  Interval: {interval}s | Debounce: {debounce}s")
    print("=" * 50)

    while True:
        loop_count += 1
        print(f"[SCAN] waiting for QR... (loop #{loop_count})")

        if not capture_photo_scan(photo_path):
            time.sleep(interval)
            continue

        if not photo_path.exists():
            time.sleep(interval)
            continue

        token = decode_qr_scan(photo_path)
        if not token:
            time.sleep(interval)
            continue

        now = time.time()
        global last_token, last_token_time
        if token == last_token and (now - last_token_time) < debounce:
            print(f"[DEBOUNCE] Skipping duplicate QR (same token seen {(now - last_token_time):.0f}s ago)")
            time.sleep(interval)
            continue

        lat, lon = get_gps_fix_continuous(cfg)
        print(f"[GPS] Lat: {lat:.4f}, Lon: {lon:.4f}")

        cfg["counter"] += 1
        save_config(cfg)

        timestamp = int(now * 1000)
        payload_without_sig = {
            "deviceId": cfg["deviceId"],
            "studentToken": token,
            "lat": lat,
            "lon": lon,
            "timestamp": timestamp,
            "counter": cfg["counter"],
        }

        signature = sign_payload(payload_without_sig, cfg["deviceSecret"])
        payload = {**payload_without_sig, "signature": signature}

        try:
            ok = publish_mqtt(cfg, payload)
            if ok:
                prefix = token[:16] + "..." if len(token) > 16 else token
                print(f"[TAP] {prefix} published")
                last_token = token
                last_token_time = now
            else:
                print("[WARN] publish_mqtt returned False, continuing scan")
        except Exception as e:
            print(f"[WARN] MQTT publish exception: {e}")

        time.sleep(interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[SCAN] Shutting down.")
        sys.exit(0)
