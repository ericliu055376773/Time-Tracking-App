import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNav } from '../contexts/NavContext';
import { useAdminNav } from '../contexts/AdminNavContext';

const ADMIN_TABS = [
  { key: '薪資結算',  icon: '💰' },
  { key: '打卡紀錄',  icon: '🕐' },
  { key: '員工查詢',  icon: '🔍' },
  { key: '請假審核',  icon: '📋' },
  { key: '員工管理',  icon: '👥' },
  { key: 'WiFi 設定', icon: '📡' },
  { key: '月薪算法',  icon: '📐' },
  { key: '職位薪資',  icon: '🏷️' },
  { key: '班別設定',  icon: '⏰' },
  { key: '排班管理',  icon: '📅' },
  { key: '特休及補償', icon: '🌴', children: ['特休天數', '未休補償'] },
];

const EMP_TABS = [
  { id: 'punch', label: '打卡介面', icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
  { id: 'stats',  label: '本月統計', icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
];

export default function Layout({ children }) {
  const { profile, logout } = useAuth();
  const nav = useNav();
  const adminNav = useAdminNav();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>

      {/* 手機版頂部列 */}
      {isMobile && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          position: 'sticky', top: 0, zIndex: 100,
        }}>
          <button onClick={() => setSidebarOpen(true)} style={{
            background: 'var(--bg-base)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
            color: 'var(--text-primary)', fontSize: 18, lineHeight: 1,
          }}>☰</button>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--amber)', letterSpacing: '0.08em' }}>
            TIMECLOCK
          </div>
          {isAdmin && adminNav && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 4 }}>
              {adminNav.activeTab}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', minHeight: isMobile ? 'calc(100vh - 49px)' : '100vh' }}>

        {/* 遮罩 */}
        {isMobile && sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200,
          }} />
        )}

        {/* 側邊欄 */}
        {(!isMobile || sidebarOpen) && (
          <aside style={{
            width: 200, flexShrink: 0,
            borderRight: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            display: 'flex', flexDirection: 'column',
            padding: '20px 10px',
            ...(isMobile ? { position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 300, overflowY: 'auto' } : { overflowY: 'auto' }),
          }}>
            {/* Logo */}
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--amber)', letterSpacing: '0.1em' }}>TIMECLOCK</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>v1.0</div>
              </div>
              {isMobile && (
                <button onClick={() => setSidebarOpen(false)} style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer',
                }}>✕</button>
              )}
            </div>

            {/* 導航 */}
            <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {isAdmin && adminNav ? (
                // 管理員導航（支援子分類）
                ADMIN_TABS.map(tab => {
                  const hasChildren = tab.children && tab.children.length > 0;
                  const isParentActive = hasChildren && tab.children.includes(adminNav.activeTab);
                  const active = adminNav.activeTab === tab.key || isParentActive;
                  return (
                    <div key={tab.key}>
                      <button
                        onClick={() => {
                          if (hasChildren) {
                            adminNav.setActiveTab(tab.children[0]);
                          } else {
                            adminNav.setActiveTab(tab.key);
                          }
                          setSidebarOpen(false);
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '9px 12px', borderRadius: 8, width: '100%',
                          fontSize: 13, fontWeight: active ? 700 : 400,
                          background: active ? 'var(--amber-glow)' : 'transparent',
                          border: active ? '1px solid rgba(245,158,11,0.25)' : '1px solid transparent',
                          color: active ? 'var(--amber)' : 'var(--text-secondary)',
                          cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                        }}>
                        <span style={{ fontSize: 14 }}>{tab.icon}</span>
                        <span style={{ flex: 1 }}>{tab.key}</span>
                        {hasChildren && <span style={{ fontSize: 10 }}>{isParentActive ? '▾' : '▸'}</span>}
                      </button>
                      {/* 子分類 */}
                      {hasChildren && isParentActive && (
                        <div style={{ marginLeft: 16, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {tab.children.map(child => {
                            const childActive = adminNav.activeTab === child;
                            return (
                              <button key={child}
                                onClick={() => { adminNav.setActiveTab(child); setSidebarOpen(false); }}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 8,
                                  padding: '7px 12px', borderRadius: 7, width: '100%',
                                  fontSize: 12, fontWeight: childActive ? 700 : 400,
                                  background: childActive ? 'rgba(245,158,11,0.15)' : 'transparent',
                                  border: childActive ? '1px solid rgba(245,158,11,0.2)' : '1px solid transparent',
                                  color: childActive ? 'var(--amber)' : 'var(--text-secondary)',
                                  cursor: 'pointer', textAlign: 'left',
                                }}>
                                <span style={{ fontSize: 11 }}>{'└'}</span>
                                {child}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                // 員工導航
                EMP_TABS.map(item => {
                  const active = nav?.activePage === item.id;
                  return (
                    <button key={item.id}
                      onClick={() => { nav?.setActivePage(item.id); setSidebarOpen(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 12px', borderRadius: 8, width: '100%',
                        fontSize: 13, fontWeight: active ? 600 : 400,
                        background: active ? 'var(--amber-glow)' : 'transparent',
                        border: active ? '1px solid rgba(245,158,11,0.25)' : '1px solid transparent',
                        color: active ? 'var(--amber)' : 'var(--text-secondary)',
                        cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                      }}>
                      {item.icon}
                      {item.label}
                    </button>
                  );
                })
              )}
            </nav>

            {/* 使用者資訊 + 登出 */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{profile?.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 12 }}>
                {profile?.role?.toUpperCase()}
              </div>
              <button onClick={() => { setSidebarOpen(false); logout(); }} style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '8px 10px', borderRadius: 7, fontSize: 12, fontWeight: 500,
                color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer',
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                登出
              </button>
            </div>
          </aside>
        )}

        {/* 主內容 */}
        <main style={{ flex: 1, overflow: 'auto', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
