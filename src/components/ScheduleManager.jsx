import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { format, addDays, startOfWeek, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';

export default function ScheduleManager() {
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [schedule, setSchedule] = useState({});
  const [weekStart, setWeekStart] = useState(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(parseISO(weekStart), i);
    return { date: format(d, 'yyyy-MM-dd'), label: format(d, 'MM/dd EEE', { locale: zhTW }) };
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const empSnap = await getDocs(collection(db, 'users'));
        const emps = empSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.role === 'employee');
        setEmployees(emps);
        const shiftSnap = await getDoc(doc(db, 'settings', 'shifts'));
        setShifts(shiftSnap.exists() ? (shiftSnap.data().list || []) : []);
        const schedSnap = await getDoc(doc(db, 'settings', 'schedule'));
        setSchedule(schedSnap.exists() ? (schedSnap.data().assignments || {}) : {});
      } catch (err) { console.error(err); }
      setLoading(false);
    }
    load();
  }, [weekStart]);

  async function setAssignment(empId, date, shiftId) {
    const key = `${empId}_${date}`;
    const newSchedule = { ...schedule };
    if (shiftId === '') { delete newSchedule[key]; } else { newSchedule[key] = shiftId; }
    setSchedule(newSchedule);
    setSaving(true);
    await setDoc(doc(db, 'settings', 'schedule'), { assignments: newSchedule });
    setSaving(false);
  }

  function getAssignment(empId, date) { return schedule[`${empId}_${date}`] || ''; }
  function getShift(shiftId) { return shifts.find(s => s.id === shiftId); }
  function prevWeek() { setWeekStart(format(addDays(parseISO(weekStart), -7), 'yyyy-MM-dd')); }
  function nextWeek() { setWeekStart(format(addDays(parseISO(weekStart), 7), 'yyyy-MM-dd')); }
  function goToday() { setWeekStart(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')); }

  const today = format(new Date(), 'yyyy-MM-dd');

  if (loading) return <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 12, padding: 20 }}>載入中...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>排班管理</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
            為每位員工指定每日班別 · 員工打卡時自動驗證
            {saving && <span style={{ color: 'var(--amber)', marginLeft: 10 }}>儲存中...</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {shifts.map(s => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
              background: s.color + '22', border: `1px solid ${s.color}44`,
              borderRadius: 99, fontSize: 11, fontWeight: 700, color: s.color,
            }}>
              {s.id} <span style={{ fontWeight: 400 }}>{s.start}-{s.end}</span>
            </div>
          ))}
        </div>
      </div>

      {shifts.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', marginBottom: 16 }}>
          尚未設定班別，請先到「班別設定」新增班別
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button onClick={prevWeek} style={{ padding: '7px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>← 上週</button>
        <button onClick={goToday} style={{ padding: '7px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>本週</button>
        <button onClick={nextWeek} style={{ padding: '7px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>下週 →</button>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-muted)' }}>
          {weekDays[0].label} ~ {weekDays[6].label}
        </span>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr>
              <th style={{ background: 'var(--bg-elevated)', padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', minWidth: 120 }}>員工</th>
              {weekDays.map(d => (
                <th key={d.date} style={{
                  background: d.date === today ? 'var(--amber-glow)' : 'var(--bg-elevated)',
                  padding: '10px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700,
                  color: d.date === today ? 'var(--amber)' : 'var(--text-muted)',
                  borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)', minWidth: 90,
                }}>
                  {d.label}
                  {d.date === today && <div style={{ fontSize: 9 }}>今天</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>尚無員工</td></tr>
            ) : employees.map((emp, ei) => (
              <tr key={emp.id} style={{ borderBottom: ei < employees.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <td style={{ padding: '10px 16px', borderRight: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>{emp.empId}</div>
                </td>
                {weekDays.map(d => {
                  const assigned = getAssignment(emp.id, d.date);
                  const shift = getShift(assigned);
                  return (
                    <td key={d.date} style={{
                      padding: '6px', textAlign: 'center',
                      borderLeft: '1px solid var(--border)',
                      background: d.date === today ? 'rgba(245,158,11,0.04)' : 'transparent',
                    }}>
                      <select value={assigned} onChange={e => setAssignment(emp.id, d.date, e.target.value)}
                        style={{
                          width: '100%', padding: '5px 4px', borderRadius: 7, fontSize: 12,
                          fontWeight: 700, fontFamily: 'var(--mono)',
                          background: shift ? shift.color + '22' : 'var(--bg-elevated)',
                          color: shift ? shift.color : 'var(--text-muted)',
                          border: shift ? `1px solid ${shift.color}55` : '1px solid var(--border)',
                          cursor: 'pointer', textAlign: 'center',
                        }}>
                        <option value="">-- 休假</option>
                        {shifts.map(s => (
                          <option key={s.id} value={s.id}>{s.id} ({s.start}-{s.end})</option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
        · 選擇班別後自動儲存<br/>
        · 員工可提早 <strong style={{ color: 'var(--amber)' }}>15 分鐘</strong> 打卡上班<br/>
        · 超出下班時間以 <strong style={{ color: 'var(--amber)' }}>15 分鐘為單位</strong> 計算加班
      </div>
    </div>
  );
}
