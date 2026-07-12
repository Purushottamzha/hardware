import React, { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'https://localhost:3000';

interface Device {
  id: string;
  busId: string;
  status: string;
  lastSeenCounter: number;
}

export function DeviceRegistry() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [newId, setNewId] = useState('');
  const [newBusId, setNewBusId] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [message, setMessage] = useState('');

  const token = sessionStorage.getItem('token');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const loadDevices = async () => {
    try {
      const res = await fetch(`${API}/devices`, { headers });
      if (res.ok) setDevices(await res.json());
    } catch {}
  };

  useEffect(() => { loadDevices(); }, []);

  const registerDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');

    try {
      const res = await fetch(`${API}/devices/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: newId, busId: newBusId }),
      });

      if (res.ok) {
        const data = await res.json();
        setNewSecret(data.secret);
        setMessage(`Device registered! Secret (shown once): ${data.secret}`);
        setNewId('');
        setNewBusId('');
        loadDevices();
      } else {
        const text = await res.text();
        setMessage(`Error: ${text}`);
      }
    } catch (err: any) {
      setMessage('Connection error');
    }
  };

  const suspendDevice = async (id: string) => {
    await fetch(`${API}/devices/${id}/suspend`, { method: 'POST', headers });
    loadDevices();
  };

  const reactivateDevice = async (id: string) => {
    await fetch(`${API}/devices/${id}/reactivate`, { method: 'POST', headers });
    loadDevices();
  };

  return (
    <div>
      <h2>Device Registry</h2>

      <form onSubmit={registerDevice} style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #ccc' }}>
        <h3>Register New Device</h3>
        <div style={{ marginBottom: '0.5rem' }}>
          <label>Device ID:</label><br />
          <input type="text" value={newId} onChange={(e) => setNewId(e.target.value)} style={{ width: 300, padding: '0.3rem' }} />
        </div>
        <div style={{ marginBottom: '0.5rem' }}>
          <label>Bus ID:</label><br />
          <input type="text" value={newBusId} onChange={(e) => setNewBusId(e.target.value)} style={{ width: 300, padding: '0.3rem' }} />
        </div>
        <button type="submit">Register</button>
        {message && <pre style={{ marginTop: '0.5rem', background: '#f0f0f0', padding: '0.5rem' }}>{message}</pre>}
      </form>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
            <th>Device ID</th>
            <th>Bus ID</th>
            <th>Status</th>
            <th>Last Counter</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id} style={{ borderBottom: '1px solid #ccc' }}>
              <td>{d.id}</td>
              <td>{d.busId}</td>
              <td style={{ color: d.status === 'active' ? 'green' : 'red' }}>{d.status}</td>
              <td>{d.lastSeenCounter}</td>
              <td>
                {d.status === 'active' ? (
                  <button onClick={() => suspendDevice(d.id)}>Suspend</button>
                ) : (
                  <button onClick={() => reactivateDevice(d.id)}>Reactivate</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
