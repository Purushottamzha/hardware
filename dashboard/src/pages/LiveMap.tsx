import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const API = import.meta.env.VITE_API_URL || 'https://localhost:3000';

interface DeviceInfo {
  id: string;
  busId: string;
  status: string;
  lastSeenCounter: number;
}

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
  student: { id: string; name: string; class: string };
  device: { id: string; busId: string };
}

interface BusMarkerData {
  deviceId: string;
  busId: string;
  lat: number;
  lon: number;
  lastEventType: string;
  lastEventTime: string;
  studentsAtStop: string[];
}

const STATE_LABELS: Record<string, string> = {
  NOT_BOARDED: 'Not Boarded',
  BOARDED: 'Boarded',
  ARRIVED_SCHOOL: 'At School',
  DEPARTED: 'Departed',
  ARRIVED_HOME: 'Home',
};

const STATE_COLORS: Record<string, string> = {
  NOT_BOARDED: '#6b7280',
  BOARDED: '#f59e0b',
  ARRIVED_SCHOOL: '#22c55e',
  DEPARTED: '#f59e0b',
  ARRIVED_HOME: '#3b82f6',
};

function BusMarkerIcon({ color = '#ef4444' }: { color?: string }) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:20px;height:20px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.1.9l-2 9c-.1.6.3 1.1.9 1.1h2" /><circle cx="9" cy="18" r="2" /><circle cx="17" cy="18" r="2" /><path d="M10 10V5c0-.6-.4-1-1-1H6" /></svg></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function SchoolMarkerIcon() {
  return L.divIcon({
    className: '',
    html: '<div style="background:#22c55e;width:16px;height:16px;border-radius:4px;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);transform:rotate(45deg);"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function animateMarker(marker: L.Marker, to: L.LatLng, duration = 600) {
  const from = marker.getLatLng();
  const start = performance.now();
  function frame(now: number) {
    const t = Math.min((now - start) / duration, 1);
    const lat = from.lat + (to.lat - from.lat) * t;
    const lng = from.lng + (to.lng - from.lng) * t;
    marker.setLatLng([lat, lng]);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

export function LiveMap() {
  const [busMarkers, setBusMarkers] = useState<BusMarkerData[]>([]);
  const [selectedBus, setSelectedBus] = useState<BusMarkerData | null>(null);
  const [events, setEvents] = useState<LastEvent[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    fetch(`${API}/attendance/overview`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('token')}` },
    })
      .then((r) => r.json())
      .then((data: { students: any[]; devices: DeviceInfo[] }) => {
        setDevices(data.devices);
        buildBusMarkers(data.students);
      })
      .catch(() => {});

    fetch(`${API}/attendance`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('token')}` },
    })
      .then((r) => r.json())
      .then((data: LastEvent[]) => {
        setEvents(data);
        buildBusMarkersFromEvents(data);
      })
      .catch(() => {});
  }, []);

  const buildBusMarkersFromEvents = (events: LastEvent[]) => {
    const busMap = new Map<string, BusMarkerData>();

    events
      .filter((e) => e.verified && e.lat !== 0 && e.lon !== 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .forEach((e) => {
        const key = e.device.id;
        if (!busMap.has(key)) {
          busMap.set(key, {
            deviceId: e.device.id,
            busId: e.device.busId,
            lat: e.lat,
            lon: e.lon,
            lastEventType: e.eventType,
            lastEventTime: e.createdAt,
            studentsAtStop: [e.student.name],
          });
        } else {
          const existing = busMap.get(key)!;
          if (!existing.studentsAtStop.includes(e.student.name)) {
            existing.studentsAtStop.push(e.student.name);
          }
        }
      });

    setBusMarkers(Array.from(busMap.values()));
  };

  const buildBusMarkers = (students: any[]) => {
    const busMap = new Map<string, BusMarkerData>();

    students.forEach((s) => {
      if (s.lastEvent && s.lastEvent.lat !== 0 && s.lastEvent.lon !== 0) {
        const key = s.lastEvent.deviceId || s.id;
        if (!busMap.has(key)) {
          busMap.set(key, {
            deviceId: s.lastEvent.deviceId || s.id,
            busId: s.busId || 'Unknown',
            lat: s.lastEvent.lat,
            lon: s.lastEvent.lon,
            lastEventType: s.lastEvent.eventType,
            lastEventTime: s.lastEvent.createdAt,
            studentsAtStop: [s.name],
          });
        } else {
          const existing = busMap.get(key)!;
          if (!existing.studentsAtStop.includes(s.name)) {
            existing.studentsAtStop.push(s.name);
          }
        }
      }
    });

    setBusMarkers(Array.from(busMap.values()));
  };

  useEffect(() => {
    const socket: Socket = io(API, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('attendanceEvent', (data: AttendanceEventPayload) => {
      if (data.verified && data.lat !== 0 && data.lon !== 0) {
        setBusMarkers((prev) => {
          const idx = prev.findIndex((m) => m.deviceId === data.deviceId);
          const newMarker: BusMarkerData = {
            deviceId: data.deviceId,
            busId: data.busId || 'Unknown',
            lat: data.lat,
            lon: data.lon,
            lastEventType: data.event,
            lastEventTime: data.eventTimestamp,
            studentsAtStop: idx >= 0 ? [...prev[idx].studentsAtStop, data.student] : [data.student],
          };

          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = newMarker;
            return updated;
          }
          return [newMarker, ...prev];
        });
      }
    });

    return () => { socket.disconnect(); };
  }, []);

  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map('map', {
        center: [27.6939, 85.3374],
        zoom: 13,
        zoomControl: true,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const schoolIcon = SchoolMarkerIcon();
      L.marker([27.7010, 85.3150], { icon: schoolIcon }).addTo(map)
        .bindPopup('<strong>School</strong><br>Main Campus');

      mapRef.current = map;
    }
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    const currentMarkerIds = new Set(busMarkers.map((m) => m.deviceId));
    const existingMarkerIds = new Set(markersRef.current.keys());

    existingMarkerIds.forEach((id) => {
      if (!currentMarkerIds.has(id)) {
        const marker = markersRef.current.get(id);
        if (marker) {
          mapRef.current?.removeLayer(marker);
          markersRef.current.delete(id);
        }
      }
    });

    busMarkers.forEach((bus) => {
      const existingMarker = markersRef.current.get(bus.deviceId);
      const color = STATE_COLORS[bus.lastEventType] || '#ef4444';
      const icon = BusMarkerIcon({ color });

      if (existingMarker) {
        animateMarker(existingMarker, L.latLng(bus.lat, bus.lon));
        existingMarker.setIcon(icon);
        existingMarker.bindPopup(createPopupContent(bus));
      } else {
        const marker = L.marker([bus.lat, bus.lon], { icon })
          .addTo(mapRef.current!)
          .bindPopup(createPopupContent(bus))
          .on('click', () => setSelectedBus(bus));
        markersRef.current.set(bus.deviceId, marker);
      }
    });
  }, [busMarkers]);

  const createPopupContent = (bus: BusMarkerData) => {
    const time = new Date(bus.lastEventTime).toLocaleTimeString();
    const label = STATE_LABELS[bus.lastEventType] || bus.lastEventType;
    const color = STATE_COLORS[bus.lastEventType] || '#ef4444';

    return `
      <div style="min-width: 200px; font-family: system-ui, sans-serif;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: ${color};"></span>
          <strong style="font-size: 14px;">${bus.busId}</strong>
        </div>
        <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">
          <strong>Last Event:</strong> ${label}
        </div>
        <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">
          <strong>Time:</strong> ${time}
        </div>
        <div style="font-size: 12px; color: #374151;">
          <strong>Students at stop:</strong>
          <ul style="margin: 4px 0 0 0; padding-left: 16px;">
            ${bus.studentsAtStop.slice(0, 5).map((s) => `<li>${s}</li>`).join('')}
            ${bus.studentsAtStop.length > 5 ? `<li>+${bus.studentsAtStop.length - 5} more</li>` : ''}
          </ul>
        </div>
      </div>
    `;
  };

  const handleMarkerClick = (bus: BusMarkerData) => {
    setSelectedBus(bus);
    mapRef.current?.setView([bus.lat, bus.lon], 15);
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#111827' }}>Live Map</h1>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: '#6b7280' }}>
              {busMarkers.length} bus{busMarkers.length !== 1 ? 'es' : ''} active
              {devices.length > 0 && ` · ${devices.filter(d => d.status === 'active').length}/${devices.length} devices online`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6b7280', padding: '4px 12px', background: '#f3f4f6', borderRadius: 12 }}>
              Last updated: {new Date().toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
        <div id="map" style={{ flex: 1, position: 'relative' }} />

        {selectedBus && (
          <div
            style={{
              position: 'absolute',
              bottom: 24,
              right: 24,
              width: 320,
              maxHeight: 300,
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
              border: '1px solid #e5e7eb',
              overflow: 'hidden',
zIndex: 1000,
            }}
          >
            <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: STATE_COLORS[selectedBus.lastEventType] || '#ef4444',
                  }}
                />
                <strong style={{ fontSize: 14 }}>{selectedBus.busId}</strong>
              </div>
              <button
                onClick={() => setSelectedBus(null)}
                style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9ca3af', padding: 0, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
                <strong>Last Event:</strong> {STATE_LABELS[selectedBus.lastEventType] || selectedBus.lastEventType}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                <strong>Time:</strong> {new Date(selectedBus.lastEventTime).toLocaleTimeString()}
              </div>
              <div style={{ fontSize: 13, color: '#374151' }}>
                <strong>Students at stop:</strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 13 }}>
                  {selectedBus.studentsAtStop.map((s) => (
                    <li key={s} style={{ marginBottom: 4 }}>{s}</li>
                  ))}
                </ul>
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb', fontSize: 12, color: '#9ca3af' }}>
                Coordinates: {selectedBus.lat.toFixed(6)}, {selectedBus.lon.toFixed(6)}
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: 24,
            background: '#fff',
            borderRadius: 8,
            padding: '12px 16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
            border: '1px solid #e5e7eb',
            fontSize: 12,
            color: '#374151',
            zIndex: 1000,
          }}
        >
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ef4444' }}></span>
              <span>Bus</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: '4px', background: '#22c55e', transform: 'rotate(45deg)', display: 'inline-block' }}></span>
              <span>School</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#f59e0b' }}></span>
              <span>Boarding</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#3b82f6' }}></span>
              <span>Arrived Home</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface AttendanceEventPayload {
  studentId: string;
  student: string;
  deviceId: string;
  busId: string;
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