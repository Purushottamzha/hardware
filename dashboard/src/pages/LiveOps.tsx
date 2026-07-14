import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTheme } from '../context/ThemeContext';

function useWideLayout(breakpoint = 1024): boolean {
  const [wide, setWide] = useState(window.innerWidth >= breakpoint);
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return wide;
}

const API = import.meta.env.VITE_API_URL || 'https://localhost:3000';
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

interface LastEvent {
  id: number;
  eventType: string;
  eventTimestamp: string;
  createdAt: string;
  lat: number;
  lon: number;
  verified: boolean;
  flagged: boolean;
  flagReason: string | null;
  rejectionReason: string | null;
}

interface StudentState {
  id: string;
  name: string;
  currentState: string;
  lastEvent: LastEvent | null;
}

interface DeviceInfo {
  id: string;
  busId: string;
  status: string;
  lastSeenCounter: number;
}

interface OverviewData {
  students: StudentState[];
  devices: DeviceInfo[];
}

interface AttendanceEventPayload {
  studentId: string;
  student: string;
  deviceId: string;
  event: string;
  eventTimestamp: string;
  lat: number;
  lon: number;
  status: string;
  verified: boolean;
  flagged: boolean;
  flagReason: string | null;
  rejectionReason: string | null;
}

interface StudentEntry {
  id: string;
  name: string;
  time: string;
  lat: number;
  lon: number;
  verified: boolean;
  flagged: boolean;
  flagReason: string | null;
  deviceId: string;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '--:--';
  }
}

const DEMO_FIRST = ['Anjali', 'Suman', 'Kritika', 'Rajesh', 'Nisha', 'Prakash'];
const DEMO_LAST = ['Poudel', 'Rai', 'Karki', 'Thapa', 'Magar'];

function randomDemoStudent(): AttendanceEventPayload {
  const name = `${DEMO_FIRST[Math.floor(Math.random() * DEMO_FIRST.length)]} ${DEMO_LAST[Math.floor(Math.random() * DEMO_LAST.length)]}`;
  return {
    studentId: `demo-${Date.now()}`,
    student: name,
    deviceId: 'SCN-DEMO',
    event: 'BOARDED',
    eventTimestamp: new Date().toISOString(),
    lat: 27.6789 + Math.random() * 0.012,
    lon: 85.3494 + Math.random() * 0.007,
    status: 'verified',
    verified: true,
    flagged: Math.random() < 0.15,
    flagReason: null,
    rejectionReason: null,
  };
}

function StatusChip({ status, flagged, flagReason, colors }: { status: string; flagged: boolean; flagReason: string | null; colors: any }) {
  const isFlagged = status === 'flagged' || flagged;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        padding: '2px 10px',
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.03em',
        backgroundColor: isFlagged ? colors.warningBg : colors.accentBg,
        color: isFlagged ? colors.warningText : colors.accentText,
        border: `1px solid ${isFlagged ? 'rgba(251,191,36,0.3)' : colors.accentBorder}`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: isFlagged ? colors.warning : colors.accent,
        }}
      />
      {isFlagged ? (flagReason || 'Flagged') : 'Verified'}
    </span>
  );
}

export function LiveOps() {
  const { colors, theme } = useTheme();
  const wide = useWideLayout(1024);

  const [students, setStudents] = useState<StudentEntry[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('time');
  const [sortDir, setSortDir] = useState('asc');
  const [clock, setClock] = useState(new Date());
  const [connected, setConnected] = useState(true);
  const [pulse, setPulse] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const mapRef = useRef<L.Map | null>(null);
  const busMarkerRef = useRef<L.Marker | null>(null);
  const studentMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const mapInitRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const fetchOverview = async () => {
      try {
        const token = sessionStorage.getItem('token');
        const res = await fetch(`${API}/attendance/overview`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data: OverviewData = await res.json();
        setDevices(data.devices);

        const entries: StudentEntry[] = data.students
          .filter((s) => s.lastEvent && s.lastEvent.lat && s.lastEvent.lon)
          .map((s) => ({
            id: s.id,
            name: s.name,
            time: formatTime(s.lastEvent!.eventTimestamp),
            lat: s.lastEvent!.lat,
            lon: s.lastEvent!.lon,
            verified: s.lastEvent!.verified,
            flagged: s.lastEvent!.flagged,
            flagReason: s.lastEvent!.flagReason,
            deviceId: '',
          }));
        setStudents(entries);

        const lastGps = data.students
          .map((s) => s.lastEvent)
          .filter((e): e is LastEvent => e !== null && e.lat !== 0 && e.lon !== 0)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        if (lastGps) setGps({ lat: lastGps.lat, lon: lastGps.lon });
      } catch {
      } finally {
        setLoading(false);
      }
    };
    fetchOverview();
  }, []);

  const handleAttendanceEvent = useCallback((data: AttendanceEventPayload) => {
    setStudents((prev) => {
      const idx = prev.findIndex((s) => s.id === data.studentId);
      const entry: StudentEntry = {
        id: data.studentId,
        name: data.student,
        time: formatTime(data.eventTimestamp),
        lat: data.lat,
        lon: data.lon,
        verified: data.verified,
        flagged: data.flagged,
        flagReason: data.flagReason,
        deviceId: data.deviceId,
      };
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = entry;
        return updated;
      }
      return [...prev, entry];
    });

    if (data.lat && data.lon) {
      setGps({ lat: data.lat, lon: data.lon });
      setPulse(true);
      setTimeout(() => setPulse(false), 900);
    }
  }, []);

  useEffect(() => {
    const token = sessionStorage.getItem('token');
    const socket: Socket = io(API, {
      transports: ['websocket'],
      auth: { token },
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('attendanceEvent', handleAttendanceEvent);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('attendanceEvent', handleAttendanceEvent);
      socket.disconnect();
    };
  }, [handleAttendanceEvent]);

  useEffect(() => {
    if (mapInitRef.current) return;
    const map = L.map('ops-map', {
      center: [gps?.lat ?? 27.6939, gps?.lon ?? 85.3374],
      zoom: 14,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    mapInitRef.current = true;
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const markers = studentMarkersRef.current;

    const existingIds = new Set(students.map((s) => s.id));

    for (const [id, marker] of markers.entries()) {
      if (!existingIds.has(id)) {
        map.removeLayer(marker);
        markers.delete(id);
      }
    }

    for (const s of students) {
      const existing = markers.get(s.id);
      if (existing) {
        existing.setLatLng([s.lat, s.lon]);
        if (s.id === selectedId) {
          existing.setOpacity(1);
        } else {
          existing.setOpacity(0.55);
        }
      } else {
        const isSelected = s.id === selectedId;
        const isFlagged = s.flagged;
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:${isSelected ? 16 : 10}px;height:${isSelected ? 16 : 10}px;
            border-radius:50%;
            background:${isFlagged ? '#fbbf24' : '#2dd4bf'};
            opacity:${isSelected ? 1 : 0.55};
            border:${isSelected ? '2px solid #fff' : 'none'};
            cursor:pointer;
            box-shadow:${isSelected ? '0 0 0 3px rgba(45,212,191,0.3)' : 'none'};
          "></div>`,
          iconSize: [isSelected ? 16 : 10, isSelected ? 16 : 10],
          iconAnchor: [isSelected ? 8 : 5, isSelected ? 8 : 5],
        });
        const marker = L.marker([s.lat, s.lon], { icon }).addTo(map);
        marker.on('click', () => setSelectedId(s.id));
        markers.set(s.id, marker);
      }
    }
  }, [students, selectedId]);

  useEffect(() => {
    if (!mapRef.current || !gps) return;
    const map = mapRef.current;
    if (busMarkerRef.current) {
      busMarkerRef.current.setLatLng([gps.lat, gps.lon]);
    } else {
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:rgba(45,212,191,0.12);
          display:flex;align-items:center;justify-content:center;
          border:2px solid #2dd4bf;
        "><div style="
          width:12px;height:12px;border-radius:50%;
          background:#2dd4bf;
        "></div></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      busMarkerRef.current = L.marker([gps.lat, gps.lon], { icon }).addTo(map);
      map.setView([gps.lat, gps.lon], map.getZoom());
    }
  }, [gps]);

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedId) || students[students.length - 1] || null,
    [students, selectedId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = students.filter(
      (s) => !q || s.name.toLowerCase().includes(q)
    );
    list = [...list].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      return a.time.localeCompare(b.time) * dir;
    });
    return list;
  }, [students, query, sortKey, sortDir]);

  const toggleSort = useCallback(
    (key: string) => {
      if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      else { setSortKey(key); setSortDir('asc'); }
    },
    [sortKey]
  );

  const simulateScan = useCallback(() => {
    const ev = randomDemoStudent();
    handleAttendanceEvent(ev);
    setSelectedId(ev.studentId);
  }, [handleAttendanceEvent]);

  const flaggedCount = students.filter((s) => s.flagged).length;
  const activeDevice = devices.find((d) => d.status === 'active');
  const busId = activeDevice?.busId || '--';
  const scannerId = activeDevice?.id || '--';

  const iconStyle: React.CSSProperties = {
    width: 14,
    height: 14,
    display: 'inline-block',
    verticalAlign: 'middle',
    flexShrink: 0,
  };

  const cardStyle: React.CSSProperties = {
    borderRadius: 12,
    backgroundColor: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
    marginBottom: 4,
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: colors.bg, color: colors.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        backgroundColor: colors.bg,
        color: colors.text,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 24px' }}>
        {/* Header */}
        <header
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            borderBottom: `1px solid ${colors.cardBorder}`,
            paddingBottom: 20,
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                backgroundColor: colors.accentBg,
                border: `1px solid ${colors.accentBorder}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={colors.accentText} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
                <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.1.9l-2 9c-.1.6.3 1.1.9 1.1h2" />
                <circle cx="9" cy="18" r="2" />
                <circle cx="17" cy="18" r="2" />
                <path d="M10 10V5c0-.6-.4-1-1-1H6" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', color: colors.text }}>SafeRide — Live Fleet</div>
              <div style={{ fontSize: 12, color: colors.textMuted }}>
                Route {busId} · {students.length} students tracked
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderRadius: 999,
                padding: '4px 12px',
                backgroundColor: colors.chipBg,
                border: `1px solid ${colors.cardBorder}`,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: connected ? colors.liveDot : colors.warning,
                  opacity: connected ? 1 : 0.7,
                }}
              />
              <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.03em', color: colors.textSecondary }}>
                {connected ? 'LIVE' : 'RECONNECTING'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: colors.textMuted, fontVariantNumeric: 'tabular-nums' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {clock.toLocaleTimeString('en-US', { hour12: false })}
            </div>
          </div>
        </header>

        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: wide ? '1fr 340px' : '1fr', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
            {/* Map card */}
            <section style={cardStyle}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: `1px solid ${colors.cardBorder}`,
                  padding: '14px 20px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.accentText} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
                    <polygon points="3 11 22 2 13 21 11 13 3 11" />
                  </svg>
                  <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, opacity: 0.9 }}>Live map — where student boarded</span>
                </div>
                <span style={{ fontSize: 11, color: colors.textMuted }}>{students.length} pins</span>
              </div>
              <div id="ops-map" style={{ width: '100%', height: 340, borderRadius: '0 0 12px 12px' }} />
            </section>

            {/* Attendance table */}
            <section style={cardStyle}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  borderBottom: `1px solid ${colors.cardBorder}`,
                  padding: '14px 20px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, opacity: 0.9 }}>Attendance</span>
                  <span
                    style={{
                      borderRadius: 999,
                      padding: '1px 8px',
                      fontSize: 11,
                      backgroundColor: colors.chipBg,
                      color: colors.textMuted,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {students.length}
                  </span>
                  {flaggedCount > 0 && (
                    <span
                      style={{
                        borderRadius: 999,
                        padding: '1px 8px',
                        fontSize: 11,
                        backgroundColor: colors.warningBg,
                        color: colors.warningText,
                        border: `1px solid rgba(251,191,36,0.3)`,
                      }}
                    >
                      {flaggedCount} flagged
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ position: 'relative' }}>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={colors.textMuted}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                    >
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search name"
                      style={{
                        width: 180,
                        borderRadius: 6,
                        padding: '5px 8px 5px 28px',
                        fontSize: 12,
                        backgroundColor: colors.inputBg,
                        color: colors.text,
                        border: `1px solid ${colors.inputBorder}`,
                        outline: 'none',
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = colors.accentBorder}
                      onBlur={(e) => e.currentTarget.style.borderColor = colors.inputBorder}
                    />
                  </div>
                  {DEMO_MODE && (
                    <button
                      onClick={simulateScan}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        borderRadius: 6,
                        padding: '5px 12px',
                        fontSize: 12,
                        fontWeight: 500,
                        backgroundColor: colors.accentBg,
                        color: colors.accentText,
                        border: `1px solid ${colors.accentBorder}`,
                        cursor: 'pointer',
                        transition: 'transform 0.1s',
                      }}
                      onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
                      onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                      onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
                        <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                        <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                        <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                        <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                        <circle cx="12" cy="12" r="1" />
                      </svg>
                      Simulate scan
                    </button>
                  )}
                </div>
              </div>

              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ fontSize: 11, letterSpacing: '0.03em', textTransform: 'uppercase', color: colors.textMuted }}>
                      {[
                        ['name', 'Student'],
                        ['time', 'Arrival'],
                      ].map(([key, label]) => (
                        <th key={key} style={{ padding: '10px 20px', fontWeight: 500 }}>
                          <button
                            onClick={() => toggleSort(key)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              border: 'none',
                              background: 'none',
                              color: 'inherit',
                              fontSize: 'inherit',
                              letterSpacing: 'inherit',
                              textTransform: 'inherit',
                              fontWeight: 'inherit',
                              cursor: 'pointer',
                              padding: 0,
                            }}
                          >
                            {label}
                            <svg
                              width="11"
                              height="11"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke={sortKey === key ? colors.accentText : colors.textMuted}
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={iconStyle}
                            >
                              <path d="m21 16-4 4-4-4" />
                              <path d="M17 20V4" />
                              <path d="m3 8 4-4 4 4" />
                              <path d="M7 4v16" />
                            </svg>
                          </button>
                        </th>
                      ))}
                      <th style={{ padding: '10px 20px', fontWeight: 500 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => setSelectedId(s.id)}
                        style={{
                          cursor: 'pointer',
                          borderTop: `1px solid ${colors.cardBorder}`,
                          fontSize: 13,
                          backgroundColor: s.id === selectedId ? colors.tableRowSelected : 'transparent',
                          transition: 'background-color 0.1s',
                        }}
                        onMouseEnter={(e) => { if (s.id !== selectedId) e.currentTarget.style.backgroundColor = colors.tableRowHover; }}
                        onMouseLeave={(e) => { if (s.id !== selectedId) e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        <td style={{ padding: '10px 20px', fontWeight: 500, color: colors.text, opacity: 0.9 }}>{s.name}</td>
                        <td style={{ padding: '10px 20px', color: colors.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{s.time}</td>
                        <td style={{ padding: '10px 20px' }}>
                          <StatusChip status={s.verified ? (s.flagged ? 'flagged' : 'verified') : 'rejected'} flagged={s.flagged} flagReason={s.flagReason} colors={colors} />
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ padding: 32, textAlign: 'center', fontSize: 12, color: colors.textMuted }}>
                          {query ? `No students match "${query}".` : 'No attendance events yet. Waiting for first tap...'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
            {/* Device card */}
            <section style={{ ...cardStyle, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, opacity: 0.9, marginBottom: 16 }}>Device</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    flex: 1,
                    borderRadius: 8,
                    padding: 12,
                    backgroundColor: colors.chipBg,
                    border: `1px solid ${colors.cardBorder}`,
                  }}
                >
                  <div style={labelStyle}>Bus No.</div>
                  <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 14, color: colors.text }}>{busId}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: colors.textMuted }}>
                  <div style={{ width: 24, height: 1, backgroundColor: colors.cardBorder }} />
                  <span style={{ fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase', margin: '2px 0' }}>linked</span>
                  <div style={{ width: 24, height: 1, backgroundColor: colors.cardBorder }} />
                </div>
                <div
                  style={{
                    flex: 1,
                    borderRadius: 8,
                    padding: 12,
                    backgroundColor: colors.chipBg,
                    border: `1px solid ${colors.cardBorder}`,
                  }}
                >
                  <div style={labelStyle}>Scanner</div>
                  <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 14, color: colors.text }}>{scannerId}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 11, color: colors.accentText }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
                  <path d="M22 2 11 13" />
                  <path d="M22 2v7" />
                  <path d="M22 2h-7" />
                  <path d="M7.5 16.5a4.5 4.5 0 1 1-3-7.7" />
                </svg>
                {connected ? 'Signal nominal' : 'Signal degraded'}
              </div>
            </section>

            {/* Location panel */}
            <section style={{ ...cardStyle, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.accentText} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, opacity: 0.9 }}>Location</span>
              </div>

              <div style={labelStyle}>Selected student</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 16 }}>
                {selectedStudent ? selectedStudent.name : '—'}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ borderRadius: 8, padding: 12, backgroundColor: colors.chipBg, border: `1px solid ${colors.cardBorder}` }}>
                  <div style={labelStyle}>Latitude</div>
                  <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13, color: colors.accentText, fontVariantNumeric: 'tabular-nums' }}>
                    {selectedStudent ? selectedStudent.lat.toFixed(5) : '—'}
                  </div>
                </div>
                <div style={{ borderRadius: 8, padding: 12, backgroundColor: colors.chipBg, border: `1px solid ${colors.cardBorder}` }}>
                  <div style={labelStyle}>Longitude</div>
                  <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13, color: colors.accentText, fontVariantNumeric: 'tabular-nums' }}>
                    {selectedStudent ? selectedStudent.lon.toFixed(5) : '—'}
                  </div>
                </div>
              </div>

              {selectedStudent && selectedStudent.deviceId && (
                <div style={{ marginTop: 12 }}>
                  <div style={labelStyle}>Scanned by</div>
                  <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12, color: colors.textSecondary }}>
                    {selectedStudent.deviceId}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 16, borderTop: `1px solid ${colors.cardBorder}`, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { label: 'Origin', color: colors.textMuted },
                  { label: 'Destination', color: colors.accentText },
                ].map((item, i) => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textSecondary }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: item.color }} />
                      {item.label}
                    </span>
                    <span style={{ color: colors.textMuted }}>{i === 0 ? 'morning pickup' : 'afternoon drop'}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
