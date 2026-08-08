# SafeRide ESP32-CAM Firmware (Legacy — QR era)

> **Status: LEGACY.** This ESP32-CAM sketch predates the face-recognition
> pipeline and is NOT part of the current architecture. Attendance is now
> face-based: an Android phone (Termux) captures the student's face and sends
> it to the face-service for identification. Keep this sketch only as
> reference; the phone is the supported demo device.

## Wiring

| Component | ESP32-CAM Pin |
|-----------|--------------|
| OV2640 Camera | Onboard FPC |
| GPS TX | GPIO 16 |
| GPS RX | GPIO 17 |
| PIR Sensor OUT | GPIO 13 |
| PIR VCC | 3.3V |
| PIR GND | GND |

## Provisioning Flow

1. Register the device via the backend API: `POST /devices/register`
2. Copy the returned `secret` (shown once).
3. Create a `secrets.h` file in this directory (gitignored):
   ```c
   #define DEVICE_ID "bus-xxx-door-001"
   #define DEVICE_SECRET "paste-hex-secret-here"
   #define WIFI_SSID "your-wifi"
   #define WIFI_PASS "your-wifi-password"
   #define MQTT_USER "device-mqtt-username"
   #define MQTT_PASS "device-mqtt-password"
   ```
4. Create MQTT credentials in Mosquitto for this device:
   ```
   mosquitto_passwd -b /mosquitto/data/passwd <device-id> <password>
   ```
5. Flash the sketch via Arduino IDE or PlatformIO.
6. Verify the device appears in the Device Registry dashboard.

## Security Scope Limitation

This firmware loads the device secret from a `secrets.h` file flashed alongside
the sketch. In production, this should use:
- ESP32 NVS (Non-Volatile Storage) with encryption enabled
- Or a secure element (ATECC608A) for hardware-backed key storage

See `SECURITY.md` for the full threat model.

## Dependencies

- ESP32 Arduino Core 2.0.x+
- PubSubClient (for MQTT)
- TinyGPS++ (for GPS parsing)
- ArduinoJson (for JSON construction)
