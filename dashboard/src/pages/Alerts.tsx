import React, { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost } from '../utils/api';

interface AlertEvent {
  id: number;
  eventType: string;
  createdAt: string;
  lat: number;
  lon: number;
  verified: boolean;
  flagged: boolean;
  flagReason: string | null;
  rejectionReason: string | null;
  resolved: boolean;
  resolutionNote: string | null;
  student: { id: string; name: string; class: string };
  device: { id: string; busId: string };
}

function ResolveModal({ event, onClose, onResolved }: { event: AlertEvent; onClose: () => void; onResolved: () => void }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const resolve = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiPost(`/attendance/alerts/${event.id}/resolve`, { note });
      onResolved();
      onClose();
    } catch {
      setError('Failed to resolve alert');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface-card border border-white/[0.08] rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white/90">Resolve Alert</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">✕</button>
        </div>
        <div className="bg-amber-400/5 border border-amber-400/20 rounded-xl p-3 mb-4">
          <p className="text-xs text-white/60"><span className="text-amber-400 font-medium">{event.student.name}</span> · {event.eventType}</p>
          <p className="text-xs text-white/30 mt-1">{new Date(event.createdAt).toLocaleString()}</p>
          {event.flagReason && <p className="text-xs text-amber-400 mt-1">⚠ {event.flagReason}</p>}
          {event.rejectionReason && <p className="text-xs text-red-400 mt-1">✗ {event.rejectionReason}</p>}
        </div>
        <form onSubmit={resolve} className="space-y-3">
          <div>
            <label className="block text-xs text-white/40 uppercase tracking-wider mb-1.5">Resolution Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe the resolution or add context…"
              rows={3}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/80 placeholder-white/20 outline-none focus:border-teal-400/40 resize-none transition-all"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="flex-1 py-2 rounded-lg text-sm bg-teal-400/10 hover:bg-teal-400/20 border border-teal-400/30 text-teal-400 font-medium transition-all disabled:opacity-50">
              {saving ? 'Resolving…' : 'Mark Resolved'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm bg-white/[0.04] border border-white/[0.08] text-white/50 transition-all">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Alerts() {
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState<AlertEvent | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await apiGet<AlertEvent[]>('/attendance/alerts');
      setAlerts(data);
    } catch {
      setError('Could not load alerts. Retrying…');
      setTimeout(load, 5000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      {resolving && <ResolveModal event={resolving} onClose={() => setResolving(null)} onResolved={load} />}

      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div>
          <h1 className="text-base font-semibold text-white/90">Alerts</h1>
          <p className="text-xs text-white/40">{alerts.length} unresolved alert{alerts.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {error && <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3 text-xs text-amber-400">{error}</div>}

      {loading ? (
        <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-8 text-center text-xs text-white/30">Loading alerts…</div>
      ) : alerts.length === 0 ? (
        <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-12 text-center">
          <div className="text-3xl mb-3">✓</div>
          <p className="text-sm font-medium text-white/50">No unresolved alerts</p>
          <p className="text-xs text-white/30 mt-1">All flagged and rejected events have been reviewed.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((ev) => (
            <div key={ev.id} className="bg-surface-card border border-white/[0.06] rounded-xl p-4 flex items-start justify-between gap-4 hover:border-white/[0.1] transition-all">
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${ev.flagged && ev.verified ? 'bg-amber-400/10 border border-amber-400/20' : 'bg-red-400/10 border border-red-400/20'}`}>
                  {ev.flagged && ev.verified ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white/90">{ev.student.name}</span>
                    <span className="text-xs text-white/30">·</span>
                    <span className="text-xs text-white/50">{ev.student.class}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ev.flagged && ev.verified ? 'bg-amber-400/10 border-amber-400/20 text-amber-400' : 'bg-red-400/10 border-red-400/20 text-red-400'}`}>
                      {ev.flagged && ev.verified ? '⚠ Flagged' : '✗ Rejected'}
                    </span>
                  </div>
                  <p className="text-xs text-white/40 mt-0.5">{ev.eventType} · Bus {ev.device.busId} · {new Date(ev.createdAt).toLocaleString()}</p>
                  {(ev.flagReason || ev.rejectionReason) && (
                    <p className="text-xs text-white/30 mt-0.5">{ev.flagReason || ev.rejectionReason}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setResolving(ev)}
                className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/50 hover:text-white/70 transition-all"
              >
                Resolve
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
