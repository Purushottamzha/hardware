import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import './index.css';

import { Login } from './pages/Login';
import { LiveFeed } from './pages/LiveFeed';
import { LiveMap } from './pages/LiveMap';
import { LiveOps } from './pages/LiveOps';
import { Students } from './pages/Students';
import { Alerts } from './pages/Alerts';
import { AuditTrail } from './pages/AuditTrail';
import { SecurityLog } from './pages/SecurityLog';
import { DeviceRegistry } from './pages/DeviceRegistry';
import { ThemeProvider, useTheme } from './context/ThemeContext';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function requireAuth() {
  const token = sessionStorage.getItem('token');
  if (!token) return false;
  return true;
}

function useAuth() {
  const [token, setToken] = useState<string | null>(sessionStorage.getItem('token'));
  const login = useCallback((t: string) => {
    sessionStorage.setItem('token', t);
    setToken(t);
  }, []);
  const logout = useCallback(() => {
    sessionStorage.removeItem('token');
    setToken(null);
    window.location.href = '/login';
  }, []);
  return { token, isAuthenticated: !!token, login, logout };
}

const AuthContext = React.createContext<ReturnType<typeof useAuth> | null>(null);
export function useAuthContext() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be inside AuthProvider');
  return ctx;
}

const SocketContext = React.createContext<{
  connected: boolean;
  socket: Socket | null;
}>({ connected: false, socket: null });
export function useSocketContext() {
  return React.useContext(SocketContext);
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

function SocketProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem('token');
    if (!token) return;

    const s: Socket = io(API, {
      transports: ['websocket', 'polling'],
      auth: { token },
    });

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    setSocket(s);

    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, []);

  return (
    <SocketContext.Provider value={{ connected, socket }}>
      {children}
    </SocketContext.Provider>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!requireAuth()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function NavItem({
  href,
  icon,
  children,
  collapsed,
}: {
  href: string;
  icon: string;
  children: React.ReactNode;
  collapsed: boolean;
}) {
  const loc = useLocation();
  const active = loc.pathname === href;
  const { colors } = useTheme();
  return (
    <a
      href={href}
      style={{
        color: active ? colors.accentText : colors.textSecondary,
        backgroundColor: active ? colors.accentBg : undefined,
      }}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        collapsed ? 'justify-center px-2' : ''
      }`}
      title={collapsed ? String(children) : undefined}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.backgroundColor = colors.tableRowHover; e.currentTarget.style.color = colors.text; }}}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.textSecondary; }}}
    >
      <span className="text-base flex-shrink-0">{icon}</span>
      {!collapsed && <span>{children}</span>}
    </a>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { logout } = useAuthContext();
  const { connected } = useSocketContext();
  const { colors, theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const env =
    API.includes('localhost') || API.includes('5173')
      ? 'DEV'
      : API.includes('staging')
        ? 'STAGING'
        : 'PROD';

  const navItems = [
    { href: '/', icon: '◉', label: 'Live Feed' },
    { href: '/map', icon: '🗺', label: 'Live Map' },
    { href: '/ops', icon: '◆', label: 'Live Ops' },
    { href: '/students', icon: '👤', label: 'Students' },
    { href: '/devices', icon: '📡', label: 'Devices' },
    { href: '/alerts', icon: '⚠', label: 'Alerts' },
    { href: '/security', icon: '🔒', label: 'Security Log' },
    { href: '/audit', icon: '📋', label: 'Audit Trail' },
  ];

  return (
    <div style={{ backgroundColor: colors.bg, color: colors.text }} className="h-screen flex overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        style={{ backgroundColor: colors.cardBg, borderColor: colors.cardBorder }}
        className={`${
          collapsed ? 'w-16' : 'w-60'
        } flex-shrink-0 border-r flex flex-col transition-all duration-200 z-30 ${
          sidebarOpen ? 'fixed inset-y-0 left-0' : 'hidden lg:flex'
        }`}
      >
        {/* Logo */}
        <div style={{ borderColor: colors.cardBorder }} className="h-14 flex items-center gap-3 px-4 border-b">
          <div className="w-8 h-8 rounded-lg bg-teal-400/10 border border-teal-400/30 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.1.9l-2 9c-.1.6.3 1.1.9 1.1h2" />
              <circle cx="9" cy="18" r="2" />
              <circle cx="17" cy="18" r="2" />
              <path d="M10 10V5c0-.6-.4-1-1-1H6" />
            </svg>
          </div>
          {!collapsed && (
            <span style={{ color: colors.text }} className="text-sm font-semibold">SafeRide</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavItem key={item.href} href={item.href} icon={item.icon} collapsed={collapsed}>
              {item.label}
            </NavItem>
          ))}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{ borderColor: colors.cardBorder, color: colors.textMuted }}
          className="hidden lg:flex items-center justify-center h-10 border-t hover:opacity-80 text-sm"
        >
          {collapsed ? '▶' : '◀'}
        </button>

        {/* Logout */}
        <button
          onClick={logout}
          style={{ borderColor: colors.cardBorder }}
          className="flex items-center gap-3 px-4 py-3 border-t text-red-400/70 hover:text-red-400 hover:bg-red-400/5 text-sm transition-colors"
        >
          <span>↩</span>
          {!collapsed && <span>Logout</span>}
        </button>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header
          style={{ backgroundColor: colors.cardBg, borderColor: colors.cardBorder, color: colors.text }}
          className="h-14 flex items-center justify-between px-4 border-b flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              style={{ color: colors.textSecondary }}
              className="lg:hidden hover:opacity-80"
            >
              ☰
            </button>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  connected ? 'bg-teal-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              <span style={{ color: colors.textSecondary }} className="text-xs font-medium tracking-wide uppercase">
                {connected ? 'LIVE' : 'RECONNECTING'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={toggleTheme}
              style={{ color: colors.textMuted }}
              className="hover:opacity-70 transition-all text-sm"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <span
              style={{ backgroundColor: colors.chipBg, color: colors.textMuted }}
              className="text-xs px-2 py-0.5 rounded font-mono uppercase tracking-wider"
            >
              {env}
            </span>
            <span style={{ color: colors.textMuted }} className="text-xs font-mono tabular-nums">
              {clock.toLocaleTimeString('en-US', { hour12: false })}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <ThemeProvider>
                <SocketProvider>
                  <AppShell>
                    <Routes>
                      <Route path="/" element={<LiveFeed />} />
                      <Route path="/map" element={<LiveMap />} />
                      <Route path="/ops" element={<LiveOps />} />
                      <Route path="/students" element={<Students />} />
                      <Route path="/alerts" element={<Alerts />} />
                      <Route path="/audit" element={<AuditTrail />} />
                      <Route path="/security" element={<SecurityLog />} />
                      <Route path="/devices" element={<DeviceRegistry />} />
                    </Routes>
                  </AppShell>
                </SocketProvider>
                </ThemeProvider>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
