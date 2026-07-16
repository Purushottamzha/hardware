import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost } from '../utils/api';

interface Device {
  id: string;
  busId: string;
  status: string;
  lastSeenCounter: number;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/50 hover:text-white/80 transition-all"
    >
      {copied ? (
        <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg><span className="text-teal-400">Copied</span></>
      ) : (
        <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>Copy</>
      )}
    </button>
  );
}

export function DeviceRegistry() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newId, setNewId] = useState('');
  const [newBusId, setNewBusId] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const loadDevices = useCallback(async () => {
    try {
      setError('');
      const data = await apiGet<Device[]>('/devices');
      setDevices(data);
    } catch {
      setError('Could not load devices. Retrying…');
      setTimeout(loadDevices, 5000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  const registerDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setFormError('');
    setNewSecret('');
    setSubmitting(true);
    try {
      const data = await apiPost<{ id: string; busId: string; secret: string }>('/devices/register', { id: newId, busId: newBusId });
      setNewSecret(data.secret);
      setNewId('');
      setNewBusId('');
      loadDevices();
    } catch (err: any) {
      setFormError(err.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const suspendDevice = async (id: string) => {
    await apiPost(`/devices/${id}/suspend`).catch(() => {});
    loadDevices();
  };

  const reactivateDevice = async (id: string) => {
    await apiPost(`/devices/${id}/reactivate`).catch(() => {});
    loadDevices();
  };

  const relativeTime = (counter: number) => {
    if (counter === 0) return 'Never';
    return `Counter: ${counter}`;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-teal-400/10 border border-teal-400/20 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>
        <div>
          <h1 className="text-base font-semibold text-white/90">Device Registry</h1>
          <p className="text-xs text-white/40">{devices.length} scanner{devices.length !== 1 ? 's' : ''} registered</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3 text-xs text-amber-400">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          {error}
        </div>
      )}

      {/* Register Form */}
      <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-white/80 mb-4">Register New Device</h2>
        <form onSubmit={registerDevice} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-white/40 uppercase tracking-wider mb-1.5">Device ID</label>
            <input
              id="device-id-input"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              required
              placeholder="SCN-001"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/20 outline-none focus:border-teal-400/40 focus:ring-1 focus:ring-teal-400/20 transition-all font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-white/40 uppercase tracking-wider mb-1.5">Bus ID</label>
            <input
              id="bus-id-input"
              value={newBusId}
              onChange={(e) => setNewBusId(e.target.value)}
              required
              placeholder="ba2kha4521"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/20 outline-none focus:border-teal-400/40 focus:ring-1 focus:ring-teal-400/20 transition-all"
            />
          </div>
          <div className="sm:col-span-2 flex items-center gap-3">
            <button
              id="register-device-btn"
              type="submit"
              disabled={submitting}
              className="bg-teal-400/10 hover:bg-teal-400/20 border border-teal-400/30 text-teal-400 rounded-lg px-4 py-2 text-sm font-medium transition-all disabled:opacity-50"
            >
              {submitting ? 'Registering…' : 'Register Device'}
            </button>
            {formError && <span className="text-xs text-red-400">{formError}</span>}
          </div>
        </form>

        {newSecret && (
          <div className="mt-4 bg-amber-400/5 border border-amber-400/25 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-400">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              <span className="text-xs font-semibold uppercase tracking-wider">You will not see this secret again</span>
            </div>
            <p className="text-xs text-white/50">Copy and store this secret securely. It is required to configure the device's MQTT credentials and cannot be recovered.</p>
            <div className="flex items-center gap-2 mt-2">
              <code className="flex-1 bg-black/30 rounded-lg px-3 py-2 text-xs font-mono text-teal-400 break-all">{newSecret}</code>
              <CopyButton text={newSecret} />
            </div>
          </div>
        )}
      </div>

      {/* Device Table */}
      <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.06]">
          <span className="text-sm font-semibold text-white/80">Registered Scanners</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-xs text-white/30">Loading devices…</div>
        ) : devices.length === 0 ? (
          <div className="p-8 text-center text-xs text-white/30">No devices registered yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-white/30 uppercase tracking-wider border-b border-white/[0.06]">
                  <th className="px-5 py-3 text-left font-medium">Device ID</th>
                  <th className="px-5 py-3 text-left font-medium">Bus ID</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-left font-medium">Last Counter</th>
                  <th className="px-5 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id} className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs text-white/80">{d.id}</td>
                    <td className="px-5 py-3.5 text-white/60">{d.busId}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                        d.status === 'active'
                          ? 'bg-teal-400/10 text-teal-400 border border-teal-400/20'
                          : 'bg-red-400/10 text-red-400 border border-red-400/20'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${d.status === 'active' ? 'bg-teal-400' : 'bg-red-400'}`} />
                        {d.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-white/40">{relativeTime(d.lastSeenCounter)}</td>
                    <td className="px-5 py-3.5">
                      {d.status === 'active' ? (
                        <button
                          onClick={() => suspendDevice(d.id)}
                          className="px-3 py-1 rounded-md text-xs bg-red-400/10 hover:bg-red-400/20 border border-red-400/20 text-red-400 transition-all"
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          onClick={() => reactivateDevice(d.id)}
                          className="px-3 py-1 rounded-md text-xs bg-teal-400/10 hover:bg-teal-400/20 border border-teal-400/20 text-teal-400 transition-all"
                        >
                          Reactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
