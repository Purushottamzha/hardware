import React, { useEffect, useState, useCallback } from 'react';
import { apiGet } from '../utils/api';
import { useSocketContext } from '../main';

interface SecurityEvent {
  id: number;
  type: string;
  deviceId?: string;
  createdAt: string;
  rawPayload: any;
}

const EVENT_COLORS: Record<string, string> = {
  INVALID_DEVICE_SIGNATURE: 'text-red-400',
  REPLAY_SUSPECTED: 'text-red-400',
  AUTO_SUSPENDED: 'text-red-400',
  UNKNOWN_DEVICE: 'text-amber-400',
  DEVICE_SUSPENDED: 'text-amber-400',
  TIMESTAMP_OUT_OF_WINDOW: 'text-amber-400',
  INVALID_SEQUENCE: 'text-amber-400',
  INVALID_STUDENT_TOKEN: 'text-amber-400',
  UNKNOWN_STUDENT: 'text-amber-400',
};

const EVENT_TYPE_OPTIONS = [
  'INVALID_DEVICE_SIGNATURE', 'REPLAY_SUSPECTED', 'AUTO_SUSPENDED',
  'UNKNOWN_DEVICE', 'DEVICE_SUSPENDED', 'TIMESTAMP_OUT_OF_WINDOW',
  'INVALID_SEQUENCE', 'INVALID_STUDENT_TOKEN', 'UNKNOWN_STUDENT',
];

export function SecurityLog() {
  const { socket } = useSocketContext();
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterType, setFilterType] = useState('');
  const [filterDevice, setFilterDevice] = useState('');
  const limit = 30;

  const load = useCallback(async () => {
    try {
      setError('');
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filterType) params.set('type', filterType);
      if (filterDevice) params.set('deviceId', filterDevice);
      const data = await apiGet<{ events: SecurityEvent[]; total: number }>(`/security-events?${params}`);
      setEvents(data.events);
      setTotal(data.total);
    } catch {
      setError('Could not load security events. Retrying…');
      setTimeout(load, 5000);
    } finally {
      setLoading(false);
    }
  }, [page, filterType, filterDevice]);

  useEffect(() => { load(); }, [load]);

  // Live events via socket
  useEffect(() => {
    if (!socket) return;
    const handler = (data: any) => {
      const ev: SecurityEvent = {
        id: Date.now(),
        type: data.type,
        deviceId: data.deviceId,
        createdAt: new Date().toISOString(),
        rawPayload: data.raw,
      };
      setEvents((prev) => [ev, ...prev].slice(0, limit));
      setTotal((t) => t + 1);
    };
    socket.on('securityEvent', handler);
    return () => { socket.off('securityEvent', handler); };
  }, [socket]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-red-400/10 border border-red-400/20 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-white/90">Security Log</h1>
            <p className="text-xs text-white/40">{total} event{total !== 1 ? 's' : ''} total</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-surface-card border border-white/[0.06] rounded-xl p-4 flex flex-wrap gap-3">
        <div className="flex-1 min-w-40">
          <label className="block text-xs text-white/30 uppercase tracking-wider mb-1">Event Type</label>
          <select
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/70 outline-none focus:border-teal-400/40 transition-all"
          >
            <option value="">All types</option>
            {EVENT_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-40">
          <label className="block text-xs text-white/30 uppercase tracking-wider mb-1">Device ID</label>
          <input
            value={filterDevice}
            onChange={(e) => { setFilterDevice(e.target.value); setPage(1); }}
            placeholder="Filter by device…"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/70 placeholder-white/20 outline-none focus:border-teal-400/40 transition-all font-mono"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={() => { setFilterType(''); setFilterDevice(''); setPage(1); }}
            className="px-3 py-2 rounded-lg text-xs bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/40 hover:text-white/60 transition-all"
          >
            Clear
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3 text-xs text-amber-400">{error}</div>
      )}

      <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-white/30">Loading security events…</div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-xs text-white/30">No security events match the current filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-white/30 uppercase tracking-wider border-b border-white/[0.06]">
                  <th className="px-5 py-3 text-left font-medium">Type</th>
                  <th className="px-5 py-3 text-left font-medium">Device</th>
                  <th className="px-5 py-3 text-left font-medium">Time</th>
                  <th className="px-5 py-3 text-left font-medium">Payload</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev, i) => (
                  <React.Fragment key={ev.id}>
                    <tr className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className={`px-5 py-3 text-xs font-mono font-medium ${EVENT_COLORS[ev.type] || 'text-white/60'}`}>
                        <span className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${EVENT_COLORS[ev.type]?.includes('red') ? 'bg-red-400' : 'bg-amber-400'}`} />
                          {ev.type}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs font-mono text-white/40">{ev.deviceId || '—'}</td>
                      <td className="px-5 py-3 text-xs text-white/40 tabular-nums">{new Date(ev.createdAt).toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => setExpanded(expanded === i ? null : i)}
                          className="px-2.5 py-1 rounded-md text-xs bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/40 hover:text-white/60 transition-all"
                        >
                          {expanded === i ? 'Hide' : 'Show'} raw
                        </button>
                      </td>
                    </tr>
                    {expanded === i && (
                      <tr className="border-t border-white/[0.04]">
                        <td colSpan={4} className="px-5 py-3 bg-black/20">
                          <pre className="text-xs font-mono text-white/40 whitespace-pre-wrap overflow-x-auto max-h-40">
                            {JSON.stringify(ev.rawPayload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between">
            <span className="text-xs text-white/30">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 rounded-md text-xs bg-white/[0.04] border border-white/[0.08] text-white/40 hover:text-white/60 disabled:opacity-30 transition-all"
              >← Prev</button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 rounded-md text-xs bg-white/[0.04] border border-white/[0.08] text-white/40 hover:text-white/60 disabled:opacity-30 transition-all"
              >Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
