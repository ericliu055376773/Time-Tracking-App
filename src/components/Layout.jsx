// src/components/Layout.jsx
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

export default function Layout({ children }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const isAdmin = profile?.role === 'admin';

  const navItems = [
    ...(isAdmin ? [{ path: '/admin', icon: GridIcon, label: '管理後台' }] : []),
    { path: '/employee', icon: ClockIcon, label: '打卡介面' },
  ];

  async function handleLogout() {
    await signOut(auth);
    navigate('/login');
  }

  const W = collapsed ? 64 : 220;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: W,
          minWidth: W,
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* Brand */}
        <div
          style={{
            padding: '20px 0',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingInline: 16,
          }}
        >
          {!collapsed && (
            <div>
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--amber)',
                  letterSpacing: '0.1em',
                }}
              >
                TIMECLOCK
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--mono)',
                  letterSpacing: '0.06em',
                }}
              >
                v1.0
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              padding: 6,
              borderRadius: 6,
              display: 'flex',
            }}
          >
            <MenuIcon />
          </button>
        </div>

        {/* Nav */}
        <nav
          style={{
            flex: 1,
            padding: '12px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: collapsed ? '10px' : '10px 12px',
                  borderRadius: 8,
                  background: active ? 'var(--amber-glow)' : 'transparent',
                  color: active ? 'var(--amber)' : 'var(--text-secondary)',
                  border: active
                    ? '1px solid rgba(245,158,11,0.3)'
                    : '1px solid transparent',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  width: '100%',
                  textAlign: 'left',
                  fontSize: 13,
                  fontWeight: 500,
                  transition: 'all 0.15s',
                }}
              >
                <item.icon />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* User + Logout */}
        <div
          style={{ padding: '12px 8px', borderTop: '1px solid var(--border)' }}
        >
          {!collapsed && (
            <div
              style={{
                padding: '8px 12px',
                marginBottom: 8,
                borderRadius: 8,
                background: 'var(--bg-elevated)',
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {profile?.name}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--mono)',
                  marginTop: 2,
                }}
              >
                {profile?.role === 'admin' ? 'ADMIN' : 'EMPLOYEE'}
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: collapsed ? 10 : '9px 12px',
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--text-muted)',
              border: '1px solid transparent',
              width: '100%',
              fontSize: 13,
              justifyContent: collapsed ? 'center' : 'flex-start',
            }}
          >
            <LogoutIcon />
            {!collapsed && <span>登出</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg-base)' }}>
        {children}
      </main>
    </div>
  );
}

const MenuIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);
const ClockIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);
const GridIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);
const LogoutIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);
