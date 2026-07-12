#!/usr/bin/env python3
"""
SafeRide Nepal — Generate Student QR Token

Usage:
    python generate_student_qr.py <student-id>

Calls the backend API to generate a signed student token,
then renders it as a QR code image.

Requires: backend running, STUDENT_TOKEN_SECRET configured.
"""

import argparse
import json
import sys

import qrcode
import requests

API_URL = "http://localhost:3000"


def get_token(student_id: str, token: str) -> dict:
    """Call backend API to generate a signed student token."""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(
        f"{API_URL}/students/{student_id}/token",
        headers=headers,
    )

    if resp.status_code == 401:
        print("[ERROR] Authentication failed. Are you logged in?")
        print(f"  First, get a JWT via: curl {API_URL}/auth/login -d '{{\"phone\":\"...\",\"password\":\"...\"}}'")
        sys.exit(1)

    resp.raise_for_status()
    return resp.json()


def main():
    parser = argparse.ArgumentParser(description="Generate student QR token")
    parser.add_argument("student_id", help="Student ID (from the backend)")
    parser.add_argument("--token", help="Admin JWT token. If not provided, prompts for login.")
    parser.add_argument("--output", "-o", default="qr_student.png", help="Output PNG file")
    args = parser.parse_args()

    # Get admin token if not provided
    admin_token = args.token
    if not admin_token:
        print("Admin JWT token required.")
        print(f"  Get one via: curl {API_URL}/auth/login ...")
        print("  Then pass with: --token <jwt>")
        sys.exit(1)

    data = get_token(args.student_id, admin_token)
    qr_data = data.get("qrData", data.get("token", ""))

    qr = qrcode.QRCode(box_size=10, border=4)
    qr.add_data(qr_data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    img.save(args.output)

    print(f"[OK] QR code saved to {args.output}")
    print(f"[INFO] Token: {qr_data[:40]}...")
    print("[INFO] Show this QR to the bus device to scan.")


if __name__ == "__main__":
    main()
