import React, { useEffect, useState, useCallback } from 'react';
import { apiGet } from '../utils/api';

interface Student {
  id: string;
  name: string;
  class: string;
  busId: string | null;
  currentState: string;
  lastEvent?: {
    eventType: string;
    eventTimestamp: string;
    verified: boolean;
    flagged: boolean;
  } | null;
}

const STATE_LABELS: Record<string, string> = {
  NOT_BOARDED: 'Not Boarded', BOARDED: 'Boarded',
  ARRIVED_SCHOOL: 'At School', DEPARTED: 'Departed', ARRIVED_HOME: 'Home',
};

function downloadCSV(students: Student[], filterClass: string, filterBus: string) {
  const header = ['Name', 'Class', 'Bus/Route', 'Status', 'Last Event', 'Arrival Time'];
  const rows = students.map((s) => [
    s.name,
    s.class || '',
    s.busId || '',
    STATE_LABELS[s.currentState] || s.currentState,
    s.lastEvent?.eventType || '',
    s.lastEvent?.eventTimestamp ? new Date(s.lastEvent.eventTimestamp).toLocaleString() : '',
  ]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `saferide-attendance-${new Date().toISOString().slice(0, 10)}${filterClass ? '-' + filterClass : ''}${filterBus ? '-' + filterBus : ''}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const [overviewData, setOverviewData] = useState<{ students: Student[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterBus, setFilterBus] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await apiGet<{ students: Student[] }>('/attendance/overview');
      setOverviewData(data);
    } catch {
      setError('Could not load data. Retrying…');
      setTimeout(load, 5000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const allStudents = overviewData?.students || [];
  const classes = [...new Set(allStudents.map((s) => s.class).filter(Boolean))].sort();
  const buses = [...new Set(allStudents.map((s) => s.busId).filter(Boolean) as string[])].sort();

  const filtered = allStudents.filter((s) => {
    if (filterClass && s.class !== filterClass) return false;
    if (filterBus && s.busId !== filterBus) return false;
    return true;
  });

  const counts = {
    total: filtered.length,
    arrived: filtered.filter((s) => ['ARRIVED_SCHOOL', 'ARRIVED_HOME'].includes(s.currentState)).length,
    boarded: filtered.filter((s) => s.currentState === 'BOARDED').length,
    absent: filtered.filter((s) => s.currentState === 'NOT_BOARDED').length,
  };

  const printReport = () => window.print();

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-white/90">Reports</h1>
            <p className="text-xs text-white/40">Daily attendance export — {new Date().toLocaleDateString()}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => downloadCSV(filtered, filterClass, filterBus)}
            disabled={loading || filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm bg-teal-400/10 hover:bg-teal-400/20 border border-teal-400/30 text-teal-400 font-medium transition-all disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Export CSV
          </button>
          <button
            onClick={printReport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/60 font-medium transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
            Print
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-surface-card border border-white/[0.06] rounded-xl p-4 flex flex-wrap gap-3">
        <div className="flex-1 min-w-36">
          <label className="block text-xs text-white/30 uppercase tracking-wider mb-1">Class</label>
          <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/70 outline-none focus:border-teal-400/40 transition-all">
            <option value="">All classes</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-36">
          <label className="block text-xs text-white/30 uppercase tracking-wider mb-1">Bus / Route</label>
          <select value={filterBus} onChange={(e) => setFilterBus(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/70 outline-none focus:border-teal-400/40 transition-all">
            <option value="">All buses</option>
            {buses.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        {(filterClass || filterBus) && (
          <div className="flex items-end">
            <button onClick={() => { setFilterClass(''); setFilterBus(''); }}
              className="px-3 py-2 rounded-lg text-xs bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/40 transition-all">
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Students', value: counts.total, color: 'text-white/80' },
          { label: 'At School / Home', value: counts.arrived, color: 'text-teal-400' },
          { label: 'In Transit', value: counts.boarded, color: 'text-amber-400' },
          { label: 'Not Boarded', value: counts.absent, color: 'text-red-400' },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-card border border-white/[0.06] rounded-xl p-4">
            <div className={`text-2xl font-bold tabular-nums ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-white/30 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {error && <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3 text-xs text-amber-400">{error}</div>}

      <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.06]">
          <span className="text-sm font-semibold text-white/80">Attendance — {filtered.length} students</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-xs text-white/30">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-white/30">No students match the current filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-white/30 uppercase tracking-wider border-b border-white/[0.06]">
                  <th className="px-5 py-3 text-left font-medium">Name</th>
                  <th className="px-5 py-3 text-left font-medium">Class</th>
                  <th className="px-5 py-3 text-left font-medium">Bus</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-left font-medium">Arrival Time</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-5 py-3 font-medium text-white/90">{s.name}</td>
                    <td className="px-5 py-3 text-white/50">{s.class || '—'}</td>
                    <td className="px-5 py-3 font-mono text-xs text-white/40">{s.busId || '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium ${
                        ['ARRIVED_SCHOOL','ARRIVED_HOME'].includes(s.currentState) ? 'text-teal-400' :
                        s.currentState === 'BOARDED' ? 'text-amber-400' :
                        s.currentState === 'NOT_BOARDED' ? 'text-white/30' : 'text-blue-400'
                      }`}>{STATE_LABELS[s.currentState] || s.currentState}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-white/40 tabular-nums">
                      {s.lastEvent?.eventTimestamp ? new Date(s.lastEvent.eventTimestamp).toLocaleTimeString() : '—'}
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
