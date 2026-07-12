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
                  <div>
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

function StudentCard({ student, onClick }: { student: StudentState; onClick: () => void }) {
  const time = student.lastEvent
    ? new Date(student.lastEvent.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div onClick={onClick} style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      padding: '0.75rem 1rem',
      cursor: 'pointer',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      transition: 'box-shadow 0.15s',
    }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{student.name}</div>
        {student.lastEvent && (
          <div style={{ fontSize: 12, color: '#9ca3af' }}>
            {student.lastEvent.verified
              ? (student.lastEvent.flagged ? `⚠ ${student.lastEvent.flagReason}` : '')
              : '✗ Rejected'}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ marginBottom: 4 }}><StateBadge state={student.currentState} /></div>
        {time && <div style={{ fontSize: 11, color: '#9ca3af' }}>{time}</div>}
      </div>
    </div>
  );
}

export function LiveFeed() {
  const [students, setStudents] = useState<StudentState[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<{ id: string; name: string } | null>(null);
  const [latestGps, setLatestGps] = useState<{ lat: number; lon: number } | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

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
    const socket: Socket = io(API, { transports: ['websocket'] });

    socket.on('attendanceEvent', (data: AttendanceEventPayload) => {
      setStudents((prev) => {
        const updated = [...prev];
        const idx = updated.findIndex((s) => s.id === data.studentId);
        if (idx !== -1) {
          updated[idx] = {
            ...updated[idx],
            currentState: data.verified ? data.event : updated[idx].currentState,
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
    if (!mapRef.current) {
      const map = L.map('map', {
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
      mapRef.current.setView([latestGps.lat, latestGps.lon], mapRef.current.getZoom());
    }
  }, [latestGps]);

  const lastSeen = devices.length > 0
    ? Math.max(...devices.filter((d) => d.lastSeenCounter > 0).map((d) => d.lastSeenCounter))
    : 0;
  const hasActiveDevice = devices.some((d) => d.status === 'active');
  const online = lastSeen > 0;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Map panel */}
      <div style={{ marginBottom: '1rem', borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb', height: 250 }}>
        <div id="map" style={{ width: '100%', height: '100%' }} />
      </div>

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

      {/* Student roster */}
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 0.75rem' }}>Students</h2>
      <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {students.map((s) => (
          <StudentCard key={s.id} student={s} onClick={() => setSelectedStudent({ id: s.id, name: s.name })} />
        ))}
        {students.length === 0 && (
          <p style={{ color: '#9ca3af', gridColumn: '1 / -1' }}>No students registered yet.</p>
        )}
      </div>

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
