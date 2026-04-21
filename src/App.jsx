import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import EmployeeDashboard from './components/EmployeeDashboard';
import AdminDashboard from './components/AdminDashboard';
import Layout from './components/Layout';
import { NavProvider } from './contexts/NavContext';
import { AdminNavProvider } from './contexts/AdminNavContext';

function AppRoutes() {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--bg-base)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--mono)',
            color: 'var(--amber)',
            fontSize: 13,
            letterSpacing: '0.1em',
            animation: 'blink 1.2s ease infinite',
          }}
        >
          INITIALIZING...
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (profile.role === 'admin') {
    return (
      <AdminNavProvider>
        <Layout>
          <Routes>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/employee" element={<EmployeeDashboard />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </Layout>
      </AdminNavProvider>
    );
  }

  return (
    <NavProvider>
      <Layout>
        <Routes>
          <Route path="/employee" element={<EmployeeDashboard />} />
          <Route path="*" element={<Navigate to="/employee" replace />} />
        </Routes>
      </Layout>
    </NavProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
