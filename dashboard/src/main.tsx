import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { LiveFeed } from './pages/LiveFeed';
import { SecurityLog } from './pages/SecurityLog';
import { DeviceRegistry } from './pages/DeviceRegistry';

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

function Layout({ children }: { children: React.ReactNode }) {
  const logout = () => {
    sessionStorage.removeItem('token');
    window.location.href = '/login';
  };

  return (
    <div style={{ fontFamily: 'monospace', padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '2px solid #333', paddingBottom: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>SafeRide Nepal</h1>
        <div>
          <a href="/" style={{ marginRight: '1rem' }}>Live Feed</a>
          <a href="/security" style={{ marginRight: '1rem' }}>Security Log</a>
          <a href="/devices" style={{ marginRight: '1rem' }}>Devices</a>
          <button onClick={logout}>Logout</button>
        </div>
      </div>
      {children}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={
          <ProtectedRoute>
            <Layout><LiveFeed /></Layout>
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
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
