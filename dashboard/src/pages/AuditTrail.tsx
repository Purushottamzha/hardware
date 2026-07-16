import React, { useEffect, useState, useCallback } from 'react';
import { apiGet } from '../utils/api';

interface AuditEntry {
  id: number;
  adminId: number;
  action: string;
  targetId: string | null;
  hash: string;
  prevHash: string;
  createdAt: string;
}

const ACTION_COLORS: Record<string, string> = {
  CREATE_STUDENT: 'text-teal-400',
  UPDATE_STUDENT: 'text-blue-400',
  GENERATE_TOKEN: 'text-blue-400',
  REGISTER_DEVICE: 'text-teal-400',
  SUSPEND_DEVICE: 'text-amber-400',
  REACTIVATE_DEVICE: 'text-teal-400',
  AUTO_SUSPENDED: 'text-red-400',
};

export function AuditTrail() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chainStatus, setChainStatus] = useState<{ valid: boolean; brokenAt?: number } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await apiGet<AuditEntry[]>('/audit');
      setLogs(data);
    } catch {
      setError('Could not load audit trail. Retrying…');
      setTimeout(load, 5000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const verifyChain = async () => {
    setVerifying(true);
    try {
      const data = await apiGet<{ valid: boolean; brokenAt?: number }>('/audit/verify');
      setChainStatus(data);
    } catch {
      setChainStatus(null);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-white/90">Audit Trail</h1>
            <p className="text-xs text-white/40">{logs.length} entries · cryptographically chained</p>
          </div>
        </div>
        <button
          onClick={verifyChain}
          disabled={verifying}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/60 font-medium transition-all disabled:opacity-50"
        >
          {verifying ? (
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
          )}
          Verify Chain Integrity
        </button>
      </div>

      {error && <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3 text-xs text-amber-400">{error}</div>}

      {chainStatus && (
        <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
          chainStatus.valid
            ? 'bg-teal-400/10 border-teal-400/20 text-teal-400'
            : 'bg-red-400/10 border-red-400/20 text-red-400'
        }`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {chainStatus.valid ? <><polyline points="20 6 9 17 4 12" /></> : <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>}
          </svg>
          <span className="text-sm font-medium">
            {chainStatus.valid
              ? 'Chain integrity verified — no tampering detected'
              : `Chain integrity broken at log entry #${chainStatus.brokenAt}`}
          </span>
        </div>
      )}

      <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-white/30">Loading audit trail…</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-xs text-white/30">No audit entries yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-white/30 uppercase tracking-wider border-b border-white/[0.06]">
                  <th className="px-5 py-3 text-left font-medium">Action</th>
                  <th className="px-5 py-3 text-left font-medium">Target</th>
                  <th className="px-5 py-3 text-left font-medium">Admin</th>
                  <th className="px-5 py-3 text-left font-medium">When</th>
                  <th className="px-5 py-3 text-left font-medium">Hash</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className={`px-5 py-3 text-xs font-mono font-medium ${ACTION_COLORS[log.action] || 'text-white/60'}`}>
                      {log.action}
                    </td>
                    <td className="px-5 py-3 text-xs font-mono text-white/40">{log.targetId || '—'}</td>
                    <td className="px-5 py-3 text-xs text-white/40">#{log.adminId}</td>
                    <td className="px-5 py-3 text-xs text-white/40 tabular-nums">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="px-5 py-3">
                      <code className="text-xs font-mono text-white/20">{log.hash.slice(0, 12)}…</code>
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
