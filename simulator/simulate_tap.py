#!/usr/bin/env python3
"""
SafeRide Nepal — Face Attendance Tap Simulator (Phase 1 + Offline Buffering)

Runs in Termux on Android or any Python 3 environment.

Usage:
    python simulate_tap.py --face-photo path/to/face.jpg   # face identification
    python simulate_tap.py --token "base64token..."        # publish a pre-minted token
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
    """Publish MQTT.

    TLS branch: the demo broker normally listens on 8883 (TLS with a local CA).
    For the ngrok demo we expose PLAIN MQTT on 1883 via ``ngrok tcp 1883`` — the
    forwarded port won't be 8883, so TLS is skipped entirely here (no tls_set).
    This is an intentional scope decision: ``allow_anonymous false`` +
    per-device password + HMAC-signed payloads still authorise/integrate the
    link for the demo window. If you DO want TLS, set broker.port == 8883.
    """
    client = mqtt.Client(
        client_id=f"sim-{cfg['deviceId']}-{int(time.time())}",
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )
    use_tls = cfg["broker"].get("port") == 8883 and bool(cfg["broker"].get("caCert"))
    if use_tls:
        print(f"[MQTT] TLS enabled (port {cfg['broker']['port']}, caCert set)")
        client.tls_set(cfg["broker"]["caCert"])
        client.tls_insecure_set(True)
    else:
        print(f"[MQTT] PLAIN (no TLS) on port {cfg['broker']['port']} — ngrok TCP demo branch")
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


def build_payload(cfg, student_token, lat, lon, timestamp, counter):
    """Build a signed attendance payload for MQTT (same shape as the phone flow)."""
    payload_without_sig = {
        "deviceId": cfg["deviceId"],
        "studentToken": student_token,
        "lat": lat,
        "lon": lon,
        "timestamp": timestamp,
        "counter": counter,
    }
    signature = sign_payload(payload_without_sig, cfg["deviceSecret"])
    return {**payload_without_sig, "signature": signature}


def identify_face(cfg, photo_path, threshold=0.60):
    """POST the face photo to /face/identify (same signing scheme as photo upload).

    Returns (student_id, confidence) or (None, 0.0). Threshold is applied here
    only to decide whether to attempt minting; the backend re-checks it.
    """
    backend_url = cfg.get("apiBaseUrl")
    if not backend_url:
        print("[ERROR] apiBaseUrl not set in config.json.")
        return None, 0.0

    counter = cfg["counter"]
    photo_timestamp = int(time.time() * 1000)
    sig = sign_photo_upload(cfg["deviceId"], counter, photo_timestamp, cfg["deviceSecret"])

    try:
        with open(photo_path, "rb") as f:
            files = {"photo": f}
            data = {
                "deviceId": cfg["deviceId"],
                "counter": str(counter),
                "photoSignature": sig,
                "photoTimestamp": str(photo_timestamp),
            }
            resp = requests.post(f"{backend_url}/face/identify", files=files, data=data, timeout=15)
        if resp.status_code != 200:
            print(f"[WARN] Face identify failed ({resp.status_code}): {resp.text[:200]}")
            return None, 0.0
        result = resp.json()
        student_id = result.get("studentId")
        confidence = result.get("confidence", 0.0)
        print(f"[FACE] Identify result: studentId={student_id}, confidence={confidence:.3f}")
        if not student_id or confidence < threshold:
            return None, confidence
        return student_id, confidence
    except Exception as e:
        print(f"[WARN] Face identify error: {e}")
        return None, 0.0


def mint_face_token(cfg, student_id, confidence):
    """Mint a student token from a face match (same signing scheme as identify).

    NOTE: this advances the backend's lastSeenCounter to cfg['counter'], so the
    follow-up MQTT publish MUST use a higher counter.
    """
    counter = cfg["counter"]
    photo_timestamp = int(time.time() * 1000)
    sig = sign_photo_upload(cfg["deviceId"], counter, photo_timestamp, cfg["deviceSecret"])

    try:
        resp = requests.post(
            f"{cfg['apiBaseUrl']}/students/{student_id}/face-token",
            json={
                "confidence": confidence,
                "deviceId": cfg["deviceId"],
                "counter": counter,
                "photoTimestamp": photo_timestamp,
                "photoSignature": sig,
            },
            timeout=15,
        )
        if resp.status_code == 201 or resp.status_code == 200:
            return resp.json().get("token")
        print(f"[WARN] Face-token mint failed ({resp.status_code}): {resp.text[:200]}")
        return None
    except Exception as e:
        print(f"[WARN] Face-token mint error: {e}")
        return None


def simulate_tap(args):
    cfg = load_config()

    # Resume counter from buffer if higher
    buffered_counter = get_last_counter()
    if buffered_counter > cfg["counter"]:
        print(f"[BUFFER] Resuming counter from buffer: {buffered_counter}")
        cfg["counter"] = buffered_counter
        save_config(cfg)

    # --- Flush buffer first ---
    flush_buffer_cmd(cfg)

    print("=" * 50)
    print("SafeRide Nepal — Face Attendance Tap")
    print("=" * 50)

    # --- Replay mode ---
    if args.replay:
        print("\n[REPLAY MODE] Re-publishing last captured payload verbatim...")
        payload = load_last_payload()
        publish_mqtt(cfg, payload)
        return

    threshold = cfg.get("faceMatchThreshold", 0.60)

    # --- Obtain the student token: minted from a face match, or pre-minted ---
    if args.token:
        student_token = args.token
        print(f"[OK] Using provided token (len={len(student_token)})")
    else:
        photo_path = Path(args.face_photo or "/tmp/saferide_face.png")
        if args.face_photo:
            print(f"[OK] Using face photo: {photo_path}")
        elif not capture_photo(photo_path):
            print("[WARN] No face photo available. Use --face-photo <path> or --token <raw>.")
            return
        print(f"[FACE] Threshold: {threshold}")

        print(f"[COUNTER] {cfg['counter'] + 1}")
        cfg["counter"] += 1
        save_config(cfg)
        student_id, confidence = identify_face(cfg, photo_path, threshold)
        if not student_id:
            print("[FACE] No match above threshold — skipping mint.")
            return
        student_token = mint_face_token(cfg, student_id, confidence)
        if not student_token:
            print("[FACE] Token mint failed — aborting tap.")
            return
        print(f"[FACE] Token minted (len={len(student_token)})")

    # --- Get GPS ---
    lat, lon = get_gps_fix()
    print(f"[GPS] Lat: {lat:.4f}, Lon: {lon:.4f}")

    # --- Increment counter ---
    cfg["counter"] += 1
    save_config(cfg)
    print(f"[COUNTER] {cfg['counter']}")

    # --- Build payload ---
    timestamp = int(time.time() * 1000)
    payload = build_payload(cfg, student_token, lat, lon, timestamp, cfg["counter"])

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

    poll_status()


def run_health_check():
    """Diagnostic mode (--check): verify config, API, MQTT, CA, camera, GPS.

    Read-only: no DB writes, no MQTT publish, no counters advanced.
    """
    import platform
    import socket
    import shutil
    from pathlib import Path as _Path

    ok = True
    print("=== SafeRide phone/device environment check ===")

    # --- Python + required modules ---
    print(f"[PY] {platform.python_version()}")
    required = ["paho.mqtt", "requests"]
    for mod in required:
        try:
            __import__(mod)
            print(f"[MOD] {mod}: OK")
        except ImportError:
            print(f"[MOD] {mod}: MISSING (pip install {mod})")
            ok = False

    # --- Config ---
    cfg_path = CONFIG_PATH
    if not cfg_path.exists():
        print(f"[CFG] FAIL: {cfg_path} not found — copy config.example.json to config.json")
        return False
    try:
        cfg = json.loads(cfg_path.read_text())
    except json.JSONDecodeError as e:
        print(f"[CFG] FAIL: invalid JSON in {cfg_path}: {e}")
        return False
    for key in ("deviceId", "deviceSecret", "apiBaseUrl", "broker"):
        if not cfg.get(key):
            print(f"[CFG] FAIL: missing key '{key}' in {cfg_path}")
            ok = False
    broker = cfg.get("broker", {})
    host = broker.get("host", "")
    port = broker.get("port", 1883)
    if not host:
        print("[CFG] FAIL: broker.host empty")
        ok = False
    dev_id = cfg.get("deviceId", "")
    api = cfg.get("apiBaseUrl", "")

    # --- Backend API ---
    try:
        r = requests.get(f"{api}/health", timeout=8)
        h = r.json() if r.status_code == 200 else {}
        mqtt_state = h.get("mqtt", "unknown")
        face_state = h.get("faceService", "unknown")
        print(f"[API] {api}/health -> HTTP {r.status_code} (mqtt={mqtt_state}, face={face_state})")
        if r.status_code != 200:
            ok = False
    except Exception as e:
        print(f"[API] FAIL: {api}/health unreachable: {e}")

    # --- MQTT broker reachability (TCP connect only) ---
    if host:
        try:
            s = socket.create_connection((host, port), timeout=8)
            s.close()
            print(f"[MQTT] {host}:{port} reachable")
        except Exception as e:
            print(f"[MQTT] FAIL: {host}:{port} unreachable -> {e}")
            ok = False

    # --- CA certificate (TLS 8883: required; plain 1883: optional) ---
    ca = broker.get("caCert", "")
    if port == 8883:
        if not ca or not _Path(ca).exists():
            print(f"[TLS] FAIL: port 8883 requires caCert file (get it from the laptop admin). Set broker.caCert in config.")
            ok = False
        else:
            print(f"[TLS] caCert present: {ca}")
    elif ca and not _Path(ca).exists():
        print(f"[TLS] WARN: caCert set but not found ({ca}) — plain port {port} still works")

    # --- Camera ---
    cam_bin = shutil.which("termux-camera-photo")
    if cam_bin:
        print(f"[CAM] termux-camera-photo available: {cam_bin}")
    elif sys.platform.startswith("linux"):
        print("[CAM] WARN: termux-camera-photo not found — install Termux:API + 'pkg install termux-api'")
        ok = False
    else:
        print(f"[CAM] Note: camera capture is Termux-only; on PC use --face-photo <image>")

    # --- Device id ---
    print(f"[DEV] {dev_id or '(empty deviceId)'}")
    if not dev_id:
        ok = False

    print("=== " + ("ALL CHECKS PASSED" if ok else "ISSUES FOUND — fix the FAIL lines above") + " ===")
    return ok


def main():
    parser = argparse.ArgumentParser(description="SafeRide Nepal Face Attendance Tap Simulator")
    parser.add_argument("--face-photo", help="Path to face photo; defaults to device camera capture")
    parser.add_argument("--token", help="Pre-minted student token to publish directly")
    parser.add_argument("--tamper", action="store_true", help="Corrupt signature for attack simulation")
    parser.add_argument("--replay", action="store_true", help="Re-publish last captured payload verbatim")
    parser.add_argument("--flush", action="store_true", help="Flush offline buffer and exit")
    parser.add_argument("--check", action="store_true", help="Diagnose environment (no MQTT publish, no DB writes)")
    args = parser.parse_args()

    if args.check:
        run_health_check()
        return

    cfg = load_config()

    if args.flush:
        flush_buffer_cmd(cfg)
        return

    simulate_tap(args)


if __name__ == "__main__":
    main()