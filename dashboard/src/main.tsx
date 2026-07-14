import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Login } from './pages/Login';
import { LiveFeed } from './pages/LiveFeed';
import { SecurityLog } from './pages/SecurityLog';
import { DeviceRegistry } from './pages/DeviceRegistry';
import { LiveOps } from './pages/LiveOps';
import { ThemeProvider, useTheme } from './context/ThemeContext';

const API = import.meta.env.VITE_API_URL || 'https://localhost:3000';

function requireAuth() {
  const token = sessionStorage.getItem('token');
  if (!token) return false;
  return true;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!requireAuth()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const loc = useLocation();
  const active = loc.pathname === href;
  return (
    <a
      href={href}
      style={{
        marginRight: '0.75rem',
        fontSize: 13,
        color: active ? '#2dd4bf' : 'inherit',
        fontWeight: active ? 600 : 400,
        textDecoration: active ? 'underline' : 'none',
        textUnderlineOffset: 3,
      }}
    >
      {children}
    </a>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  const logout = () => {
    sessionStorage.removeItem('token');
    window.location.href = '/login';
  };

  const isDark = theme === 'dark';

  return (
    <div style={{
      fontFamily: 'system-ui, sans-serif',
      minHeight: '100vh',
      backgroundColor: isDark ? '#0A0E14' : '#f5f5f5',
      color: isDark ? '#E8ECF1' : '#1e293b',
      transition: 'background-color 0.2s, color 0.2s',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem',
        borderBottom: `2px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#d1d5db'}`,
        padding: '0.75rem 1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>SafeRide Nepal</h1>
          <NavLink href="/">Live Feed</NavLink>
          <NavLink href="/ops">Live Ops</NavLink>
          <NavLink href="/security">Security Log</NavLink>
          <NavLink href="/devices">Devices</NavLink>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={toggleTheme}
            title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
            style={{
              background: 'none',
              border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.15)' : '#d1d5db'),
              borderRadius: 6,
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 14,
              color: 'inherit',
            }}
          >
            {isDark ? '☀️' : '🌙'}
          </button>
          <button
            onClick={logout}
            style={{
              background: isDark ? 'rgba(248,113,113,0.1)' : '#fef2f2',
              border: '1px solid ' + (isDark ? 'rgba(248,113,113,0.3)' : '#fecaca'),
              borderRadius: 6,
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: 12,
              color: isDark ? '#f87171' : '#dc2626',
            }}
          >
            Logout
          </button>
        </div>
      </div>
      <div style={{ padding: '0 1rem 1rem' }}>
        {children}
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={
            <ProtectedRoute>
              <Layout><LiveFeed /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/ops" element={
            <ProtectedRoute>
              <LiveOps />
            </ProtectedRoute>
          } />
          <Route path="/security" element={
            <ProtectedRoute>
              <Layout><SecurityLog /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/devices" element={
            <ProtectedRoute>
              <Layout><DeviceRegistry /></Layout>
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
