import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, where, orderBy, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { calcSalaryFromPunches, fmtMoney, fmtHours } from '../hooks/useSalaryCalc';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';

export default function Layout({ children }) {
  const { user, profile, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // 員工才抓本月統計
  useEffect(() => {
    if (!user || profile?.role !== 'employee') return;
    async function fetchStats() {
      try {
        const month = format(new Date(), 'yyyy-MM');
        const start = Timestamp.fromDate(startOfMonth(parseISO(month + '-01')));
        const end   = Timestamp.fromDate(endOfMonth(parseISO(month + '-01')));
        const snap = await getDocs(query(
          collection(db, 'punches'),
          where('uid', '==', user.uid),
          where('timestamp', '>=', start),
          where('timestamp', '<=', end),
          orderBy('timestamp', 'asc')
        ));
        const punches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const { totalHours, totalOvertimeHours, totalSalary, salaryBreakdown } = calcSalaryFromPunches(punches, profile);
        setStats({ totalHours, totalOvertimeHours, totalSalary, salaryBreakdown, month });
      } catch (err) { console.error(err); }
    }
    fetchStats();
  }, [user, profile]);

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
            width: 220, flexShrink: 0,
            borderRight: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            display: 'flex', flexDirection: 'column',
            padding: '20px 12px',
            ...(isMobile ? {
              position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 300,
            } : {}),
          }}>
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--amber)', letterSpacing: '0.1em' }}>TIMECLOCK</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>v1.0</div>
              </div>
              {isMobile && (
                <button onClick={() => setSidebarOpen(false)} style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer',
                }}>✕</button>
              )}
            </div>

            <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* 打卡介面連結 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderRadius: 8, background: 'var(--amber-glow)',
                border: '1px solid rgba(245,158,11,0.25)',
                fontSize: 13, fontWeight: 500, color: 'var(--amber)',
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                打卡介面
              </div>

              {/* 本月統計卡片（僅員工顯示） */}
              {profile?.role === 'employee' && stats && (
                <div style={{
                  marginTop: 8,
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  overflow: 'hidden',
                }}>
                  {/* 標題列 */}
                  <div style={{
                    background: 'var(--bg-base)',
                    padding: '8px 12px',
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--border)',
                  }}>
                    本月統計 · {stats.month}
                  </div>

                  <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <SideStatRow label="工作時數" value={fmtHours(stats.totalHours)} />
                    {stats.totalOvertimeHours > 0 && (
                      <SideStatRow label="加班時數" value={fmtHours(stats.totalOvertimeHours)} color="var(--amber)" />
                    )}
                    <SideStatRow label="薪資類型" value={profile?.payType === 'hourly' ? `時薪 $${profile?.hourlyRate}` : '月薪制'} />

                    {/* 月薪制：顯示全勤狀況 */}
                    {profile?.payType === 'monthly' && stats.salaryBreakdown && (
                      <div style={{
                        fontSize: 10,
                        padding: '5px 8px',
                        borderRadius: 6,
                        background: stats.salaryBreakdown.hasFullAttendance ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                        color: stats.salaryBreakdown.hasFullAttendance ? 'var(--green)' : 'var(--red)',
                        border: `1px solid ${stats.salaryBreakdown.hasFullAttendance ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                      }}>
                        {stats.salaryBreakdown.hasFullAttendance ? '✓ 全勤達標' : `✗ 全勤未達標`}
                      </div>
                    )}

                    {/* 預估薪資 */}
                    <div style={{
                      marginTop: 2,
                      paddingTop: 8,
                      borderTop: '1px solid var(--border)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>預估薪資</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, color: 'var(--amber)' }}>
                        {fmtMoney(stats.totalSalary)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </nav>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{profile?.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 14 }}>
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

function SideStatRow({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: color || 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}
