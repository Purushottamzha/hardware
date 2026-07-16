import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../utils/api';

export function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Invalid credentials');
        return;
      }

      const data = await res.json();
      sessionStorage.setItem('token', data.access_token);
      navigate('/');
    } catch {
      setError('Cannot reach server. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-teal-400/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-teal-400/10 border border-teal-400/30 flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.1.9l-2 9c-.1.6.3 1.1.9 1.1h2" />
              <circle cx="9" cy="18" r="2" />
              <circle cx="17" cy="18" r="2" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white/90 tracking-tight">SafeRide Nepal</h1>
          <p className="text-xs text-white/40 mt-1 uppercase tracking-widest">Fleet Operations Centre</p>
        </div>

        {/* Card */}
        <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-6">
          <h2 className="text-sm font-medium text-white/60 mb-5">Admin Sign In</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-white/40 uppercase tracking-wider mb-1.5">Phone</label>
              <input
                id="login-phone"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+977-9800000000"
                autoComplete="username"
                required
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-white/90 placeholder-white/20 outline-none focus:border-teal-400/40 focus:ring-1 focus:ring-teal-400/20 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs text-white/40 uppercase tracking-wider mb-1.5">Password</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-white/90 placeholder-white/20 outline-none focus:border-teal-400/40 focus:ring-1 focus:ring-teal-400/20 transition-all"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span className="text-xs text-red-400">{error}</span>
              </div>
            )}

            <button
              id="login-submit"
              type="submit"
              disabled={loading}
              className="w-full bg-teal-400/10 hover:bg-teal-400/20 border border-teal-400/30 hover:border-teal-400/50 text-teal-400 rounded-lg py-2.5 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Signing in…
                </>
              ) : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-white/20 mt-6">SafeRide Nepal · Secure Fleet Management</p>
      </div>
    </div>
  );
}
