import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function Layout({ children }) {
  const { profile, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 768) setSidebarOpen(false);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-base)', position: 'relative' }}>

      {/* 手機版遮罩 */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 40, backdropFilter: 'blur(2px)',
        }} />
      )}

      {/* 側邊欄 */}
      <aside style={{
        width: 220, flexShrink: 0, borderRight: '1px solid var(--border)',
        background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column',
        padding: '20px 12px',
        // 手機版
        position: window.innerWidth < 768 ? 'fixed' : 'relative',
        top: 0, left: 0, bottom: 0, zIndex: 50,
        transform: window.innerWidth < 768 ? (sidebarOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none',
        transition: 'transform 0.25s ease',
      }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--amber)', letterSpacing: '0.1em' }}>TIMECLOCK</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>v1.0</div>
        </div>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            borderRadius: 8, background: 'var(--amber-glow)', border: '1px solid rgba(245,158,11,0.25)',
            fontSize: 13, fontWeight: 500, color: 'var(--amber)',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            打卡介面
          </div>
        </nav>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{profile?.name}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 14 }}>
            {profile?.role?.toUpperCase()}
          </div>
          <button onClick={logout} style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '8px 10px', borderRadius: 7, fontSize: 12, fontWeight: 500,
            color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            登出
          </button>
        </div>
      </aside>

      {/* 主內容 */}
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        {/* 手機版頂部導覽列 */}
        {window.innerWidth < 768 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
            borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)',
            position: 'sticky', top: 0, zIndex: 30,
          }}>
            <button onClick={() => setSidebarOpen(true)} style={{
              background: 'var(--bg-base)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-primary)',
            }}>
              ☰
            </button>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--amber)', letterSpacing: '0.08em' }}>
              TIMECLOCK
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
