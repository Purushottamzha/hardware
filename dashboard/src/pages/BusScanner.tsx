import React, { useEffect, useState, useCallback } from 'react';
import { apiGet } from '../utils/api';

interface Device {
  id: string;
  busId: string;
  status: string;
  lastSeenCounter: number;
}

interface BusRoute {
  id: string;
  routeId: string;
  route: { id: string; name: string };
}

interface LastEvent {
  eventType?: string;
  eventTimestamp?: string;
  identMethod?: string;
  identConfidence?: number;
  studentName?: string;
  className?: string;
}

interface OverviewStudent {
  id: string;
  name?: string;
  className?: string;
  currentState?: string;
  lastEvent?: LastEvent | null;
}

interface Health {
  status?: string;
  mqtt?: string;
  faceService?: string;
}

const STATUS_GOOD: Record<string, string> = {
  ok: 'text-teal-400',
  connected: 'text-teal-400',
  online: 'text-teal-400',
  active: 'text-teal-400',
  disconnected: 'text-red-400',
  offline: 'text-red-400',
  down: 'text-red-400',
};

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-teal-400',
  connected: 'bg-teal-400',
  online: 'bg-teal-400',
  active: 'bg-teal-400',
  disconnected: 'bg-red-400',
  offline: 'bg-red-400',
  down: 'bg-red-400',
};

function StatusRow({ label, value, good }: { label: string; value: string; good?: boolean }) {
  const dot = good ? 'bg-teal-400' : 'bg-red-400';
  const txt = good ? 'text-teal-400' : 'text-red-400';
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.04] last:border-b-0">
      <span className="text-xs text-white/40 uppercase tracking-wider">{label}</span>
      <span className={`flex items-center gap-2 text-xs font-semibold ${txt}`}>
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        {value.toUpperCase()}
      </span>
    </div>
  );
}

export function BusScanner() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [overview, setOverview] = useState<OverviewStudent[]>([]);
  const [buses, setBuses] = useState<BusRoute[]>([]);
  const [health, setHealth] = useState<Health>({});
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      const [dev, ov, hs, bs] = await Promise.all([
        apiGet<Device[]>('/devices'),
        apiGet<any>('/attendance/overview'),
        apiGet<Health>('/health'),
        apiGet<BusRoute[]>('/students/buses'),
      ]);
      setDevices(dev);
      setOverview(ov.students || ov);
      setBuses(bs);
      setHealth(hs);
      setLastUpdated(new Date());
    } catch {
      setError('Could not refresh scanner status. Retrying…');
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

const terminal = devices.find((d) => d.id.includes('WEB')) || devices[0];
  const onboardCount = overview.filter((s) => s.lastEvent?.eventType === 'BOARDED').length;

  const bus = buses.find((b) => b.id === terminal?.busId);
  const lastScan = overview
    .filter((s) => s.lastEvent?.eventTimestamp)
    .sort((a, b) => (b.lastEvent!.eventTimestamp! > a.lastEvent!.eventTimestamp! ? 1 : -1))[0];

  const fmt = (iso?: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const systemOk = health.mqtt === 'connected' && health.faceService === 'online';
  const terminalOk = terminal?.status === 'active';

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-400/10 border border-teal-400/20 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="7" y1="19" x2="7" y2="21" /><line x1="17" y1="19" x2="17" y2="21" /></svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-white/90">Bus Scanner</h1>
            <p className="text-xs text-white/40">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading…'}</p>
          </div>
        </div>
        <a
          href="http://192.168.1.90:8100/scanner"
          target="_blank"
          rel="noreferrer"
          className="px-3 py-2 rounded-lg text-xs font-medium bg-teal-400/10 hover:bg-teal-400/20 border border-teal-400/30 text-teal-400 transition-all"
        >
          Open Phone Scanner UI ↗
        </a>
      </div>

      {error && (
        <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3 text-xs text-amber-400">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Terminal card */}
        <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
            <span className="text-sm font-semibold text-white/80">Scanner Terminal</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${terminalOk ? 'bg-teal-400/10 text-teal-400 border border-teal-400/20' : 'bg-red-400/10 text-red-400 border border-red-400/20'}`}>
              {terminalOk ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <div className="py-1">
            <StatusRow label="Device" value={terminal?.id || '—'} good={terminalOk} />
            <StatusRow label="Bus" value={terminal?.busId || '—'} good={terminalOk} />
            <StatusRow label="Route" value={bus?.route?.name || '—'} good={terminalOk} />
            <StatusRow label="Last Counter" value={terminal ? String(terminal.lastSeenCounter) : '—'} good={terminalOk} />
          </div>
        </div>

        {/* Last scan card */}
        <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/[0.06]">
            <span className="text-sm font-semibold text-white/80">Last Scan</span>
          </div>
          {lastScan ? (
            <div className="px-5 py-4">
              <p className="text-lg font-semibold text-white/90">{lastScan.name || lastScan.id}</p>
              <p className="text-xs text-white/40 mt-0.5">{lastScan.lastEvent?.eventType || '—'} · {fmt(lastScan.lastEvent?.eventTimestamp)}</p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {lastScan.lastEvent?.identMethod && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal-400/10 text-teal-400 border border-teal-400/20">
                    {lastScan.lastEvent.identMethod}
                  </span>
                )}
                {typeof lastScan.lastEvent?.identConfidence === 'number' && (
                  <span className="text-[10px] text-white/40 font-mono">
                    {(lastScan.lastEvent.identConfidence * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="px-5 py-8 text-center text-xs text-white/30">No scans yet today.</div>
          )}
        </div>

        {/* System card */}
        <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
            <span className="text-sm font-semibold text-white/80">System</span>
            <span className={`w-2 h-2 rounded-full ${systemOk ? 'bg-teal-400 animate-pulse' : 'bg-red-400'}`} />
          </div>
          <div className="py-1">
            <StatusRow label="Backend" value={health.status || '—'} good={health.status === 'ok'} />
            <StatusRow label="Face Service" value={health.faceService || '—'} good={health.faceService === 'online'} />
            <StatusRow label="MQTT" value={health.mqtt || '—'} good={health.mqtt === 'connected'} />
          </div>
        </div>
      </div>

      {/* Today */}
      <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-5">
        <span className="text-sm font-semibold text-white/80">Today</span>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
            <p className="text-2xl font-bold text-teal-400">{onboardCount}</p>
            <p className="text-[11px] text-white/40 uppercase tracking-wider mt-1">On Board Now</p>
          </div>
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
            <p className="text-2xl font-bold text-white/80">{overview.length}</p>
            <p className="text-[11px] text-white/40 uppercase tracking-wider mt-1">Students Enrolled</p>
          </div>
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
            <p className="text-2xl font-bold text-white/80">{devices.length}</p>
            <p className="text-[11px] text-white/40 uppercase tracking-wider mt-1">Terminals</p>
          </div>
        </div>
      </div>
    </div>
  );
}