#!/usr/bin/env python3
"""
SafeRide Nepal — Bus Scanner Bridge

Serves the student-facing web scanner UI (phone browser) and performs the
exact phone tap protocol server-side: face identify -> face-token mint ->
signed MQTT publish (QoS 1). Reuses the verified transport functions from
simulator/simulate_sap.py — no new cryptography, no new protocol.

Endpoints:
  GET  /scanner          -> student-facing scanner page
  GET  /health           -> backend/MQTT/face status
  POST /identify         -> {photo: <dataURL jpeg>} -> scan result

Config: scanner-bridge/config.json  (gitignored; device credentials)
Counter state persists in state.json (gitignored).
"""

import base64
import json
import ssl
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT.parent / "simulator"))

import requests  # noqa: E402
from simulate_tap import (  # noqa: E402
    build_payload,
    mint_face_token,
    publish_mqtt,
    sign_photo_upload,
)

CONFIG_PATH = ROOT / "config.json"
STATE_PATH = ROOT / "state.json"
DEFAULT_LAT = 27.6939
DEFAULT_LON = 85.3374
PORT = 8100

_scan_lock = Lock()
_config = None


def load_config():
    global _config
    if _config is None:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            _config = json.load(f)
    return _config


def get_counter():
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            return int(json.load(f).get("counter", 0))
    except (OSError, ValueError, json.JSONDecodeError):
        return 0


def save_counter(counter):
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump({"counter": counter}, f)


def identify_photo(cfg, photo_bytes):
    """POST photo to /face/identify (same signing scheme as the phone)."""
    counter = get_counter() + 1
    photo_timestamp = int(time.time() * 1000)
    sig = sign_photo_upload(cfg["deviceId"], counter, photo_timestamp, cfg["deviceSecret"])
    try:
        resp = requests.post(
            f"{cfg['apiBaseUrl']}/face/identify",
            files={"photo": ("scan.jpg", photo_bytes, "image/jpeg")},
            data={
                "deviceId": cfg["deviceId"],
                "counter": str(counter),
                "photoSignature": sig,
                "photoTimestamp": str(photo_timestamp),
            },
            timeout=20,
        )
    except requests.RequestException as e:
        return {"error": f"identify-unreachable: {e}"}
    if resp.status_code != 200:
        return {"error": f"identify-http-{resp.status_code}"}
    return resp.json()


def bump(cfg):
    cfg["counter"] = get_counter() + 1
    save_counter(cfg["counter"])
    return cfg["counter"]


def run_scan(photo_bytes):
    """Full tap: identify -> (match?) -> token mint -> signed MQTT publish."""
    with _scan_lock:
        cfg = load_config()
        bump(cfg)

        result = identify_photo(cfg, photo_bytes)
        if "error" in result:
            return {"recorded": False, "service": "unreachable", "message": "Can't reach the SafeRide API."}
        student_id = result.get("studentId")
        confidence = result.get("confidence", 0.0)
        threshold = cfg.get("faceMatchThreshold", 0.70)
        if not student_id or confidence < threshold:
            return {
                "recorded": False,
                "service": "ok",
                "message": "FACE NOT RECOGNIZED",
                "confidence": confidence,
                "student": None,
            }

        bump(cfg)
        token = mint_face_token(cfg, student_id, confidence)
        if not token:
            return {"recorded": False, "service": "ok", "message": "Token could not be issued.", "confidence": confidence}

        bump(cfg)
        payload = build_payload(
            cfg,
            token,
            result.get("lat", DEFAULT_LAT),
            result.get("lon", DEFAULT_LON),
            int(time.time() * 1000),
            cfg["counter"],
        )
        ok = publish_mqtt(cfg, payload)
        student = {
            "studentId": student_id,
            "studentName": result.get("studentName"),
            "class": result.get("class"),
            "busId": result.get("busId"),
            "routeName": result.get("routeName"),
        }
        if not ok:
            return {"recorded": False, "service": "mqtt-down", "message": "Attendance NOT recorded (MQTT down).",
                    "student": student, "confidence": confidence}
        return {"recorded": True, "service": "ok", "message": "ATTENDANCE RECORDED",
                "student": student, "confidence": confidence}


class ScannerHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/scanner", "/"):
            body = (ROOT / "scanner.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/health":
            cfg = load_config()
            try:
                h = requests.get(f"{cfg['apiBaseUrl']}/health", timeout=8).json()
            except requests.RequestException:
                h = {"status": "down", "mqtt": "disconnected", "faceService": "unknown"}
            self._send_json({
                "bridge": "online",
                "backend": h.get("status", "down"),
                "mqtt": h.get("mqtt", "disconnected"),
                "faceService": h.get("faceService", "unknown"),
                "device": cfg.get("deviceId"),
            })
            return
        self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/identify":
            self._send_json({"error": "not found"}, 404)
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send_json({"error": "bad body"}, 400)
            return
        data_url = payload.get("photo", "")
        if not data_url or "," not in data_url:
            self._send_json({"error": "photo required"}, 400)
            return
        try:
            photo_bytes = base64.b64decode(data_url.split(",", 1)[1])
        except (ValueError, TypeError):
            self._send_json({"error": "bad photo data"}, 400)
            return
        self._send_json(run_scan(photo_bytes))


def main():
    # Plain HTTP fallback: usable even without TLS (chrome://flags workaround not needed).
    http_server = ThreadingHTTPServer(("0.0.0.0", PORT), ScannerHandler)
    print(f"SafeRide scanner bridge HTTP : http://0.0.0.0:{PORT}/scanner")

    # HTTPS: a secure context so the phone's camera (getUserMedia) works after a
    # single "Proceed anyway" certificate warning — no chrome://flags needed.
    cert = ROOT / "certs" / "server.crt"
    key = ROOT / "certs" / "server.key"
    tls_port = 8443
    if not (cert.exists() and key.exists()):
        print("WARNING: no TLS certs in scanner-bridge/certs/ — skipping HTTPS (phone camera may be blocked)")
    else:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=str(cert), keyfile=str(key))
        try:
            https_server = ThreadingHTTPServer(("0.0.0.0", tls_port), ScannerHandler)
            https_server.socket = ctx.wrap_socket(https_server.socket, server_side=True)
        except OSError as e:
            print(f"WARNING: could not bind HTTPS :{tls_port} — {e}")
            https_server = None
        if https_server:
            print(f"SafeRide scanner bridge HTTPS: https://0.0.0.0:{tls_port}/scanner (self-signed)")
            threading.Thread(target=https_server.serve_forever, daemon=True).start()

    http_server.serve_forever()


if __name__ == "__main__":
    main()