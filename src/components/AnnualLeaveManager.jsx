// src/components/AnnualLeaveManager.jsx
// 特休天數 & 未休補償計算
import React, { useState, useEffect } from 'react';
import { getDocs, collection, getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';

// 依年資計算特休天數
function calcAnnualLeaveDays(months) {
  if (months < 6) return 0;
  if (months < 12) return 3;
  if (months < 24) return 7;
  if (months < 36) return 10;
  if (months < 60) return 14;
  if (months < 120) return 15;
  // 滿10年：15天起，每滿1年+1天，最多30天
  const yearsOver10 = Math.floor(months / 12) - 10;
  return Math.min(15 + yearsOver10, 30);
}

function seniorityLabel(months) {
  if (months < 6) return '未滿6個月';
  if (months < 12) return '滿6個月未滿1年';
  if (months < 24) return '滿1年未滿2年';
  if (months < 36) return '滿2年未滿3年';
  if (months < 60) return '滿3年未滿5年';
  if (months < 120) return '滿5年未滿10年';
  const y = Math.floor(months / 12);
  return `滿${y}年`;
}

const RULES = [
  { label: '滿6個月，未滿1年', days: 3 },
  { label: '滿1年，未滿2年', days: 7 },
  { label: '滿2年，未滿3年', days: 10 },
  { label: '滿3年，未滿5年', days: 14 },
  { label: '滿5年，未滿10年', days: 15 },
  { label: '滿10年以上', days: '15天起，每年+1天，最多30天' },
];

export default function AnnualLeaveManager({ subTab }) {
  const [employees, setEmployees] = useState([]);
  const [positions, setPositions] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [empSnap, posSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDoc(doc(db, 'settings', 'positions')),
        ]);
        setEmployees(empSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.role === 'employee'));
        const posList = posSnap.exists() ? (posSnap.data().list || []) : [];
        const posMap = {};
        posList.forEach(p => posMap[p.id] = p);
        setPositions(posMap);
      } catch (err) { console.error(err); }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>載入中...</div>;

  // ── 特休天數 ──
  if (subTab === '特休天數') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 法定規則 */}
        <div className="card" style={{ padding: '20px 24px', border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.04)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--amber)', marginBottom: 14 }}>📋 勞基法特休天數規定</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {RULES.map((r, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 0', borderBottom: i < RULES.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{r.label}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--amber)' }}>
                  {typeof r.days === 'number' ? `${r.days} 天` : r.days}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 員工特休一覽 */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>👥 員工特休天數一覽</div>
          {employees.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>尚無員工資料</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {employees.map(emp => {
                const hired = emp.hiredAt?.toDate ? emp.hiredAt.toDate() : emp.createdAt?.toDate ? emp.createdAt.toDate() : null;
                const months = hired ? Math.floor((Date.now() - hired.getTime()) / (1000 * 60 * 60 * 24 * 30.44)) : null;
                const days = months !== null ? calcAnnualLeaveDays(months) : null;
                const label = months !== null ? seniorityLabel(months) : '未知';
                return (
                  <div key={emp.id} className="card" style={{ padding: '16px 18px' }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{emp.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>{label}</div>
                    {days !== null ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>今年特休</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>{days} 天</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>請至員工管理設定到職日</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── 未休補償 ──
  if (subTab === '未休補償') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 說明 */}
        <div className="card" style={{ padding: '16px 20px', border: '1px solid rgba(96,165,250,0.25)', background: 'rgba(96,165,250,0.04)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#60a5fa', marginBottom: 8 }}>💡 未休補償計算公式</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8 }}>
            未休補償 ＝（職位薪資預估實發金額 ÷ 30天）× 未休特休天數<br />
            <span style={{ fontSize: 11 }}>※ 職位薪資預估實發金額 = 底薪 + 餐費（依職位設定）</span>
          </div>
        </div>

        {/* 員工未休補償計算 */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>👥 員工未休補償一覽</div>
          {employees.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>尚無員工資料</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {employees.filter(e => e.payType === 'monthly').map(emp => {
                const hired = emp.hiredAt?.toDate ? emp.hiredAt.toDate() : emp.createdAt?.toDate ? emp.createdAt.toDate() : null;
                const months = hired ? Math.floor((Date.now() - hired.getTime()) / (1000 * 60 * 60 * 24 * 30.44)) : null;
                const leaveDays = months !== null ? calcAnnualLeaveDays(months) : 0;
                const pos = positions[emp.positionId];
                const dailySalary = pos
                  ? ((pos.baseSalary || 0) + (pos.mealAllowance || 0)) / 30
                  : ((emp.monthlySalary || 0) + (emp.mealAllowance || 0)) / 30;
                const compensation = Math.round(dailySalary * leaveDays);

                return (
                  <div key={emp.id} className="card" style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{emp.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                          {pos ? pos.name : '未設定職位'} · {months !== null ? seniorityLabel(months) : '未知年資'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                          日薪：${Math.round(dailySalary).toLocaleString()}<br />
                          特休天數：{leaveDays} 天
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>若全部未休補償</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: '#60a5fa' }}>
                          ${compensation.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    {/* 計算明細 */}
                    <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-base)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                      (${Math.round(dailySalary).toLocaleString()} ÷ 30) × {leaveDays} = ${compensation.toLocaleString()}
                    </div>
                  </div>
                );
              })}
              {employees.filter(e => e.payType === 'monthly').length === 0 && (
                <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                  未休補償僅適用月薪制員工
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
