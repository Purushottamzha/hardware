#!/usr/bin/env python3
"""
SafeRide Nepal — Offline Buffer (SQLite)
Buffers events when MQTT is unavailable and flushes on reconnect.
"""

import json
import sqlite3
import time
from pathlib import Path
from threading import Lock
from typing import Optional, List, Dict, Any

BUFFER_DB_PATH = Path(__file__).parent / "offline_buffer.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    student_token TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    timestamp INTEGER NOT NULL,
    counter INTEGER NOT NULL,
    signature TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    sent_at INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_unsent ON events (sent_at, counter);
CREATE INDEX IF NOT EXISTS idx_events_counter ON events (counter);
"""

_init_lock = Lock()
_initialized = False


def _init_db():
    """Initialize the SQLite database and schema."""
    global _initialized
    with _init_lock:
        if _initialized:
            return
        conn = sqlite3.connect(BUFFER_DB_PATH, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.executescript(_SCHEMA)
        conn.close()
        _initialized = True


def _get_conn():
    """Get a new database connection (not thread-safe across threads, use per-thread)."""
    conn = sqlite3.connect(BUFFER_DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    return conn


def buffer_event(
    device_id: str,
    student_token: str,
    lat: float,
    lon: float,
    timestamp: int,
    counter: int,
    signature: str,
) -> int:
    """
    Store an event in the local buffer. Returns the row ID.
    """
    _init_db()
    conn = _get_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO events (device_id, student_token, lat, lon, timestamp, counter, signature, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (device_id, student_token, lat, lon, timestamp, counter, signature, int(time.time())),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def get_unsent_events(limit: int = 100) -> List[Dict[str, Any]]:
    """
    Get unsent events ordered by counter (oldest first).
    """
    _init_db()
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT id, device_id, student_token, lat, lon, timestamp, counter, signature
            FROM events
            WHERE sent_at = 0
            ORDER BY counter ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def mark_event_sent(event_id: int):
    """Mark an event as successfully sent."""
    _init_db()
    conn = _get_conn()
    try:
        conn.execute(
            "UPDATE events SET sent_at = ? WHERE id = ?",
            (int(time.time()), event_id),
        )
        conn.commit()
    finally:
        conn.close()


def increment_attempts(event_id: int):
    """Increment the attempt counter for an event."""
    _init_db()
    conn = _get_conn()
    try:
        conn.execute("UPDATE events SET attempts = attempts + 1 WHERE id = ?", (event_id,))
        conn.commit()
    finally:
        conn.close()


def get_last_counter() -> int:
    """Get the highest counter value in the buffer (for resuming)."""
    _init_db()
    conn = _get_conn()
    try:
        row = conn.execute("SELECT MAX(counter) as max_counter FROM events").fetchone()
        return row["max_counter"] if row and row["max_counter"] is not None else 0
    finally:
        conn.close()


def flush_buffer(publish_func, max_attempts: int = 3) -> int:
    """
    Flush buffered events by calling publish_func for each.
    publish_func should accept a payload dict and return True on success.
    Returns the number of events successfully sent.
    """
    sent_count = 0
    events = get_unsent_events(limit=500)

    for event in events:
        payload = {
            "deviceId": event["device_id"],
            "studentToken": event["student_token"],
            "lat": event["lat"],
            "lon": event["lon"],
            "timestamp": event["timestamp"],
            "counter": event["counter"],
            "signature": event["signature"],
        }

        success = False
        try:
            success = publish_func(payload)
        except Exception as e:
            print(f"[BUFFER] Publish error for counter {event['counter']}: {e}")

        if success:
            mark_event_sent(event["id"])
            sent_count += 1
            print(f"[BUFFER] Flushed event counter={event['counter']}")
        else:
            increment_attempts(event["id"])
            if event.get("attempts", 0) + 1 >= max_attempts:
                print(f"[BUFFER] Event counter={event['counter']} exceeded max attempts, keeping for retry")

    return sent_count


def clear_sent_events(older_than_days: int = 7):
    """Clean up old sent events to prevent database growth."""
    _init_db()
    conn = _get_conn()
    try:
        cutoff = int(time.time()) - older_than_days * 86400
        conn.execute("DELETE FROM events WHERE sent_at > 0 AND sent_at < ?", (cutoff,))
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    # Quick test
    _init_db()
    print("Buffer database initialized at:", BUFFER_DB_PATH)
    print("Last counter:", get_last_counter())