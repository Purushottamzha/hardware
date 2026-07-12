import React, { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const API = import.meta.env.VITE_API_URL || 'https://localhost:3000';

interface SecurityEvent {
  type: string;
  deviceId?: string;
  time: string;
  raw: any;
}

export function SecurityLog() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    const socket: Socket = io(API, {
      transports: ['websocket'],
    });

    socket.on('securityEvent', (data: SecurityEvent) => {
      setEvents((prev) => [data, ...prev].slice(0, 100));
    });

    return () => { socket.disconnect(); };
  }, []);

  return (
    <div>
      <h2>Security Log</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
            <th>Type</th>
            <th>Device</th>
            <th>Time</th>
            <th>Payload</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <React.Fragment key={i}>
              <tr style={{ borderBottom: '1px solid #ccc' }}>
                <td style={{ color: 'red' }}>{e.type}</td>
                <td>{e.deviceId || '-'}</td>
                <td>{e.time}</td>
                <td>
                  <button onClick={() => setExpanded(expanded === i ? null : i)}>
                    {expanded === i ? 'Hide' : 'Show'} Raw
                  </button>
                </td>
              </tr>
              {expanded === i && (
                <tr>
                  <td colSpan={4} style={{ background: '#f5f5f5', padding: '1rem' }}>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                      {JSON.stringify(e.raw, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
          {events.length === 0 && (
            <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>No security events yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
