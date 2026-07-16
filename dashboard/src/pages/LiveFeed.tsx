import React, { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const API = import.meta.env.VITE_API_URL || 'https://localhost:3000';

const STATE_COLORS: Record<string, string> = {
  NOT_BOARDED: '#6b7280',
  BOARDED: '#f59e0b',
  ARRIVED_SCHOOL: '#22c55e',
  DEPARTED: '#f59e0b',
  ARRIVED_HOME: '#3b82f6',
};

const STATE_LABELS: Record<string, string> = {
  NOT_BOARDED: 'Not Boarded',
  BOARDED: 'Boarded',
  ARRIVED_SCHOOL: 'At School',
  DEPARTED: 'Departed',
  ARRIVED_HOME: 'Home',
};

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
  class: string;
  currentState: string;
  lastEvent: LastEvent | null;
  routeOrder?: number | null;
  routeName?: string | null;
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
  routeName?: string | null;
}

function StateBadge({ state }: { state: string }) {
  const color = STATE_COLORS[state] || '#6b7280';
  const label = STATE_LABELS[state] || state;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      color: '#fff',
      backgroundColor: color,
    }}>
      {label}
    </span>
  );
}

function StudentRow({ student, onSelectLocation, isSelected }: {
  student: StudentState;
  onSelectLocation: (lat: number, lon: number) => void;
  isSelected: boolean;
}) {
  const time = student.lastEvent
    ? new Date(student.lastEvent.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '—';

  const statusColor = student.lastEvent?.verified
    ? (student.lastEvent.flagged ? '#f59e0b' : '#22c55e')
    : '#ef4444';

  const statusText = student.lastEvent?.verified
    ? (student.lastEvent.flagged ? `⚠ ${student.lastEvent.flagReason}` : STATE_LABELS[student.currentState] || student.currentState)
    : 'Rejected';

  const routeLabel = student.routeName || '—';

  const locationLabel = student.lastEvent?.lat && student.lastEvent?.lon
    ? `${student.lastEvent.lat.toFixed(4)}, ${student.lastEvent.lon.toFixed(4)}`
    : '—';

  const handleClick = () => {
    if (student.lastEvent?.lat && student.lastEvent?.lon) {
      onSelectLocation(student.lastEvent.lat, student.lastEvent.lon);
    }
  };

  return (
    <tr
      onClick={handleClick}
      style={{
        borderBottom: '1px solid #e5e7eb',
        cursor: student.lastEvent?.lat ? 'pointer' : 'default',
        background: isSelected ? '#f0f9ff' : undefined,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#f9fafb'; }}
      onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = ''; }}
    >
      <td style={{ padding: '12px 16px', fontWeight: 500 }}>{student.name}</td>
      <td style={{ padding: '12px 16px', color: '#6b7280' }}>{student.class || '—'}</td>
      <td style={{ padding: '12px 16px', color: '#6b7280', fontSize: 13 }}>{routeLabel}</td>
      <td style={{ padding: '12px 16px', color: '#374151', fontFamily: 'monospace', fontSize: 14 }}>{time}</td>
      <td style={{ padding: '12px 16px', color: '#6b7280', fontSize: 13, fontFamily: 'monospace' }}>{locationLabel}</td>
      <td style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: statusColor,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 14, fontWeight: 500, color: statusColor }}>{statusText}</span>
        </div>
      </td>
    </tr>
  );
}

function TimelineModal({ studentId, studentName, onClose }: { studentId: string; studentName: string; onClose: () => void }) {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/attendance/timeline/${studentId}`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('token')}` },
    })
      .then((r) => r.json())
      .then((data) => { setEvents(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [studentId]);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 8, padding: '1.5rem',
        maxWidth: 500, width: '90%', maxHeight: '80vh', overflow: 'auto',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>{studentName} — Today</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>&times;</button>
        </div>
        {loading ? (
          <p>Loading...</p>
        ) : events.length === 0 ? (
          <p style={{ color: '#666' }}>No events today.</p>
        ) : (
          <div>
            {events.map((ev, i) => {
              const time = new Date(ev.createdAt).toLocaleTimeString();
              const color = ev.verified ? (ev.flagged ? '#f59e0b' : '#22c55e') : '#ef4444';
              return (
                <div key={ev.id} style={{
                  display: 'flex', gap: '0.75rem', padding: '0.5rem 0',
                  borderLeft: `3px solid ${color}`, paddingLeft: '0.75rem',
                  marginBottom: '0.5rem', opacity: ev.verified ? 1 : 0.7,
                }}>
                  <div style={{ minWidth: 60, fontSize: 12, color: '#666' }}>{time}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {STATE_LABELS[ev.eventType] || ev.eventType}
                      {!ev.verified && <span style={{ color: '#ef4444', marginLeft: 8, fontSize: 12 }}>(Rejected)</span>}
                      {ev.verified && ev.flagged && <span style={{ color: '#f59e0b', marginLeft: 8, fontSize: 12 }}>(Flagged: {ev.flagReason})</span>}
                    </div>
                    {ev.lat && ev.lon && (
                      <div style={{ fontSize: 11, color: '#999' }}>{ev.lat.toFixed(4)}, {ev.lon.toFixed(4)}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function LiveFeed() {
  const [students, setStudents] = useState<StudentState[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<{ id: string; name: string } | null>(null);
  const [latestGps, setLatestGps] = useState<{ lat: number; lon: number } | null>(null);
  const [selectedEventLocation, setSelectedEventLocation] = useState<{ lat: number; lon: number } | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const highlightMarkerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    fetch(`${API}/attendance/overview`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('token')}` },
    })
      .then((r) => r.json())
      .then((data: OverviewData) => {
        setStudents(data.students);
        setDevices(data.devices);
        const lastGps = data.students
          .map((s) => s.lastEvent)
          .filter((e): e is LastEvent => e !== null && e.lat !== 0 && e.lon !== 0)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        if (lastGps) setLatestGps({ lat: lastGps.lat, lon: lastGps.lon });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const socket: Socket = io(API, { transports: ['websocket', 'polling'] });

    socket.on('attendanceEvent', (data: AttendanceEventPayload & { routeName?: string | null }) => {
      setStudents((prev) => {
        const updated = [...prev];
        const idx = updated.findIndex((s) => s.id === data.studentId);
        if (idx !== -1) {
          updated[idx] = {
            ...updated[idx],
            currentState: data.verified ? data.event : updated[idx].currentState,
            routeName: data.routeName ?? updated[idx].routeName,
            lastEvent: {
              id: 0,
              eventType: data.event,
              eventTimestamp: data.eventTimestamp,
              createdAt: data.eventTimestamp,
              lat: data.lat,
              lon: data.lon,
              verified: data.verified,
              flagged: data.flagged,
              flagReason: data.flagReason,
              rejectionReason: data.rejectionReason,
            },
          };
        }
        return updated;
      });

      if (data.lat && data.lon) {
        setLatestGps({ lat: data.lat, lon: data.lon });
      }
    });

    return () => { socket.disconnect(); };
  }, []);

  useEffect(() => {
    const el = document.getElementById('map');
    if (!el) return;
    if (!mapRef.current) {
      const map = L.map(el, {
        center: [latestGps?.lat ?? 27.6939, latestGps?.lon ?? 85.3374],
        zoom: 14,
        zoomControl: true,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
    }
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (mapRef.current && latestGps) {
      if (markerRef.current) {
        markerRef.current.setLatLng([latestGps.lat, latestGps.lon]);
      } else {
        const icon = L.divIcon({
          className: '',
          html: '<div style="background:#ef4444;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });
        markerRef.current = L.marker([latestGps.lat, latestGps.lon], { icon }).addTo(mapRef.current);
      }
    }
  }, [latestGps]);

  useEffect(() => {
    if (!mapRef.current || !selectedEventLocation) return;

    mapRef.current.setView([selectedEventLocation.lat, selectedEventLocation.lon], 16);

    if (highlightMarkerRef.current) {
      highlightMarkerRef.current.setLatLng([selectedEventLocation.lat, selectedEventLocation.lon]);
    } else {
      const icon = L.divIcon({
        className: '',
        html: '<div style="background:#3b82f6;width:20px;height:20px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 4px rgba(59,130,246,0.4);transition:all 0.3s"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      highlightMarkerRef.current = L.marker([selectedEventLocation.lat, selectedEventLocation.lon], { icon }).addTo(mapRef.current);
    }
  }, [selectedEventLocation]);

  const lastSeen = devices.length > 0
    ? Math.max(...devices.filter((d) => d.lastSeenCounter > 0).map((d) => d.lastSeenCounter))
    : 0;
  const online = lastSeen > 0;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Device health strip */}
      <div style={{
        display: 'flex', gap: '1rem', marginBottom: '1rem', padding: '0.75rem 1rem',
        background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb',
        fontSize: 13, alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: online ? '#22c55e' : '#ef4444',
          }} />
          <span>{online ? 'Online' : 'Offline'}</span>
        </div>
        <span style={{ color: '#9ca3af' }}>|</span>
        {devices.map((d) => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontWeight: 500 }}>{d.id}</span>
            <span style={{
              fontSize: 11, padding: '1px 6px', borderRadius: 8,
              background: d.status === 'active' ? '#dcfce7' : '#fef2f2',
              color: d.status === 'active' ? '#16a34a' : '#dc2626',
            }}>{d.status}</span>
          </div>
        ))}
      </div>

      {/* Attendance summary */}
      <div style={{
        display: 'flex', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap',
      }}>
        {Object.entries(STATE_LABELS).map(([key, label]) => {
          const count = students.filter((s) => s.currentState === key).length;
          const color = STATE_COLORS[key] || '#6b7280';
          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 8,
              background: '#f9fafb', border: '1px solid #e5e7eb',
              fontSize: 13,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: color, flexShrink: 0,
              }} />
              <span style={{ color: '#374151', fontWeight: 500 }}>{count}</span>
              <span style={{ color: '#6b7280' }}>{label}</span>
            </div>
          );
        })}
      </div>

      {/* Attendance table */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, fontSize: 13, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Student Name</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, fontSize: 13, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Class</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, fontSize: 13, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Route</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, fontSize: 13, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Arrival Time</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, fontSize: 13, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Location</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, fontSize: 13, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <StudentRow
                key={s.id}
                student={s}
                onSelectLocation={(lat, lon) => setSelectedEventLocation({ lat, lon })}
                isSelected={
                  !!selectedEventLocation &&
                  s.lastEvent?.lat === selectedEventLocation.lat &&
                  s.lastEvent?.lon === selectedEventLocation.lon
                }
              />
            ))}
            {students.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af' }}>
                  No students registered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mini map */}
      <div
        id="map"
        style={{
          marginTop: '1rem',
          height: 240,
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          overflow: 'hidden',
        }}
      />

      {/* Timeline modal */}
      {selectedStudent && (
        <TimelineModal
          studentId={selectedStudent.id}
          studentName={selectedStudent.name}
          onClose={() => setSelectedStudent(null)}
        />
      )}
    </div>
  );
}
