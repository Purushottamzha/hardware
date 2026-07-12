/**
 * SafeRide Nepal — ESP32-CAM Attendance Device (Phase 2 Skeleton)
 *
 * Implements the same MQTT contract as the Python simulator.
 * Intended for ESP32-CAM with OV2640 camera + GPS module.
 *
 * Provisioning: device secret is loaded from gitignored secrets.h,
 *                not hardcoded. See firmware/README.md.
 *
 * Security note: This is a documented scope-limited implementation.
 *                Production would use NVS encryption or a secure element.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <esp_camera.h>
#include <ArduinoJson.h>
#include <mbedtls/md.h>

// ---- secrets.h (gitignored) ----
// Create this file with:
//   #define DEVICE_ID "bus-xxx-door-001"
//   #define DEVICE_SECRET "hex-secret-from-backend"
//   #define WIFI_SSID "your-ssid"
//   #define WIFI_PASS "your-password"
//   #define MQTT_USER "device-mqtt-username"
//   #define MQTT_PASS "device-mqtt-password"
#include "secrets.h"

// ---- Configuration ----
#define MQTT_HOST "your-mosquitto-host"
#define MQTT_PORT 8883
#define MQTT_TOPIC_PREFIX "saferide/hardware/"
#define MQTT_TOPIC_SUFFIX "/attendance"
#define GPS_BAUD 9600
#define PIR_PIN 13

WiFiClientSecure wifiClient;
PubSubClient mqttClient(wifiClient);

long counter = 0;
unsigned long lastTapTime = 0;

// Forward declarations
bool captureFrame(uint8_t **buf, size_t *len);
bool decodeQR(const uint8_t *buf, size_t len, char *tokenOut, size_t tokenMax);
bool getGPSFix(float *lat, float *lon);
void buildPayload(const char *token, float lat, float lon, unsigned long ts,
                  long ctr, char *payloadOut, size_t maxLen);
void signPayload(const char *payload, const char *secret, char *sigOut);
bool publishMQTT(const char *topic, const char *payload);

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("SafeRide ESP32-CAM Attendance Device");

  // WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected");

  // Camera config
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_QVGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count = 1;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return;
  }

  // MQTT
  wifiClient.setInsecure();  // self-signed cert; production would pin CA
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);

  // GPS
  Serial2.begin(GPS_BAUD, SERIAL_8N1, 16, 17);  // RX=16, TX=17

  Serial.println("Ready. Waiting for tap...");
}

void loop() {
  if (!mqttClient.connected()) {
    reconnectMQTT();
  }
  mqttClient.loop();

  // Simulate PIR-triggered tap (in production: check PIR_PIN)
  if (digitalRead(PIR_PIN) == HIGH && (millis() - lastTapTime) > 10000) {
    lastTapTime = millis();
    handleTap();
  }

  delay(100);
}

void mqttCallback(char *topic, byte *payload, unsigned int length) {
  // Handle any responses if needed
  Serial.printf("MQTT message on %s\n", topic);
}

void reconnectMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("Connecting to MQTT...");
    String clientId = String("esp32-") + String(DEVICE_ID) + "-" + String(random(0xffff), HEX);
    if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println("connected");
    } else {
      Serial.print("failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" retrying in 5s");
      delay(5000);
    }
  }
}

void handleTap() {
  Serial.println("Tap detected!");

  // 1. Capture frame from camera
  uint8_t *frameBuf = NULL;
  size_t frameLen = 0;
  if (!captureFrame(&frameBuf, &frameLen)) {
    Serial.println("Frame capture failed");
    return;
  }

  // 2. Decode QR from frame
  char studentToken[256];
  if (!decodeQR(frameBuf, frameLen, studentToken, sizeof(studentToken))) {
    Serial.println("No QR code found");
    return;
  }
  Serial.printf("Student token: %s\n", studentToken);

  // 3. Get GPS fix
  float lat = 0.0, lon = 0.0;
  if (!getGPSFix(&lat, &lon)) {
    Serial.println("GPS fix failed, using defaults");
    lat = 27.6939;
    lon = 85.3374;
  }

  // 4. Increment counter
  counter++;

  // 5. Build and sign payload
  unsigned long timestamp = millis();  // would use NTP in production
  char payloadBuf[512];
  buildPayload(studentToken, lat, lon, timestamp, counter, payloadBuf, sizeof(payloadBuf));

  char signature[65];
  signPayload(payloadBuf, DEVICE_SECRET, signature);

  // 6. Build final JSON with signature
  StaticJsonDocument<768> doc;
  deserializeJson(doc, payloadBuf);
  doc["signature"] = signature;

  char finalPayload[768];
  serializeJson(doc, finalPayload, sizeof(finalPayload));

  // 7. Publish
  String topic = String(MQTT_TOPIC_PREFIX) + DEVICE_ID + MQTT_TOPIC_SUFFIX;
  publishMQTT(topic.c_str(), finalPayload);

  Serial.println("Tap complete. Payload:");
  Serial.println(finalPayload);
}

bool captureFrame(uint8_t **buf, size_t *len) {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) return false;
  *buf = fb->buf;
  *len = fb->len;
  esp_camera_fb_return(fb);
  return true;
}

bool decodeQR(const uint8_t *buf, size_t len, char *tokenOut, size_t tokenMax) {
  // TODO Phase 2: Implement QR decode using quirc library
  // For now, return a placeholder that indicates the QR decode must be implemented.
  // quirc is MIT-licensed and available at https://github.com/dlbeer/quirc
  strncpy(tokenOut, "PLACEHOLDER_TOKEN", tokenMax);
  return true;
}

bool getGPSFix(float *lat, float *lon) {
  // TODO Phase 2: Implement GPS parsing using TinyGPS++
  // Read from Serial2 and feed to TinyGPSPlus object.
  *lat = 27.6939;
  *lon = 85.3374;
  return false;
}

void buildPayload(const char *token, float lat, float lon, unsigned long ts,
                  long ctr, char *payloadOut, size_t maxLen) {
  StaticJsonDocument<512> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["studentToken"] = token;
  doc["lat"] = lat;
  doc["lon"] = lon;
  doc["timestamp"] = ts;
  doc["counter"] = ctr;
  serializeJson(doc, payloadOut, maxLen);
}

void signPayload(const char *payload, const char *secret, char *sigOut) {
  // Use mbedtls HMAC-SHA256 which is included with ESP32 Arduino core
  byte hmacResult[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_type_t mdType = MBEDTLS_MD_SHA256;

  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(mdType), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char *)secret, strlen(secret));
  mbedtls_md_hmac_update(&ctx, (const unsigned char *)payload, strlen(payload));
  mbedtls_md_hmac_finish(&ctx, hmacResult);
  mbedtls_md_free(&ctx);

  for (int i = 0; i < 32; i++) {
    sprintf(sigOut + (i * 2), "%02x", hmacResult[i]);
  }
  sigOut[64] = '\0';
}

bool publishMQTT(const char *topic, const char *payload) {
  return mqttClient.publish(topic, payload, false);  // retain=false
}
