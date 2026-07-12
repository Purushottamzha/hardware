import React, { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const API = import.meta.env.VITE_API_URL || 'https://localhost:3000';

interface AttendanceEvent {
  student: string;
  event: string;
  time: string;
  lat: number;
  lon: number;
  status: string;
}

export function LiveFeed() {
  const [events, setEvents] = useState<AttendanceEvent[]>([]);

  useEffect(() => {
    const socket: Socket = io(API, {
      transports: ['websocket'],
    });

    socket.on('attendanceEvent', (data: AttendanceEvent) => {
      setEvents((prev) => [data, ...prev].slice(0, 100));
    });

    return () => { socket.disconnect(); };
  }, []);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'success': return '\u2705';
      case 'warning': return '\u26A0\uFE0F';
      case 'error': return '\u274C';
      default: return '\u2753';
    }
  };

  return (
    <div>
      <h2>Live Feed</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
            <th>Student</th>
            <th>Event</th>
            <th>Time</th>
            <th>GPS</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #ccc' }}>
              <td>{e.student}</td>
              <td>{e.event}</td>
              <td>{e.time}</td>
              <td>{e.lat.toFixed(4)}, {e.lon.toFixed(4)}</td>
              <td>{statusIcon(e.status)}</td>
            </tr>
          ))}
          {events.length === 0 && (
            <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Waiting for events...</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
