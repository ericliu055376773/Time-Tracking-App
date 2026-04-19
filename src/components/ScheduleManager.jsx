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
        setEmployees(empSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.role === 'employee'));
        const shiftSnap = await getDoc(doc(db, 'settings', 'shifts'));
        setShifts(shiftSnap.exists() ? (shiftSnap.data().list || []) : []);
        const schedSnap = await getDoc(doc(db, 'settings', 'schedule'));
        setSchedule(schedSnap.exists() ? (schedSnap.data().assignments || {}) : {});
      } catch (err) { console.error(err); }
      setLoading(false);
    }
    load();
  }, [weekStart]);

  async function setAssignment(empId, date, slot, shiftId) {
    const key = `${empId}_${date}`;
    const current = schedule[key] || {};
    const updated = { ...current, [slot]: shiftId };
    if (!updated.shift1 && !updated.shift2) {
      const newSchedule = { ...schedule };
      delete newSchedule[key];
      setSchedule(newSchedule);
      setSaving(true);
      await setDoc(doc(db, 'settings', 'schedule'), { assignments: newSchedule });
    } else {
      const newSchedule = { ...schedule, [key]: updated };
      setSchedule(newSchedule);
      setSaving(true);
      await setDoc(doc(db, 'settings', 'schedule'), { assignments: newSchedule });
    }
    setSaving(false);
  }

  function getAssignment(empId, date) {
    const val = schedule[`${empId}_${date}`];
    if (!val) return { shift1: '', shift2: '' };
    if (typeof val === 'string') return { shift1: val, shift2: '' };
    return { shift1: val.shift1 || '', shift2: val.shift2 || '' };
  }

  function getShift(shiftId) { return shifts.find(s => s.id === shiftId); }
  function prevWeek() { setWeekStart(format(addDays(parseISO(weekStart), -7), 'yyyy-MM-dd')); }
  function nextWeek() { setWeekStart(format(addDays(parseISO(weekStart), 7), 'yyyy-MM-dd')); }
  function goToday() { setWeekStart(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')); }

  const today = format(new Date(), 'yyyy-MM-dd');

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 20 }}>載入中...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>排班管理</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
            每格可設定早班＋晚班（雙頭班）
            {saving && <span style={{ color: 'var(--amber)', marginLeft: 8 }}>儲存中...</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {shifts.map(s => (
            <div key={s.id} style={{
              padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
              background: s.color + '22', border: `1px solid ${s.color}44`, color: s.color,
            }}>
              {s.id} {s.start}-{s.end}
            </div>
          ))}
        </div>
      </div>

      {shifts.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', marginBottom: 16 }}>
          請先到「班別設定」新增班別
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
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
              <th style={{ background: 'var(--bg-elevated)', padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', minWidth: 120 }}>員工</th>
              {weekDays.map(d => (
                <th key={d.date} style={{
                  background: d.date === today ? 'var(--amber-glow)' : 'var(--bg-elevated)',
                  padding: '8px 6px', textAlign: 'center', fontSize: 11, fontWeight: 700,
                  color: d.date === today ? 'var(--amber)' : 'var(--text-muted)',
                  borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)', minWidth: 100,
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
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{emp.empId}</div>
                </td>
                {weekDays.map(d => {
                  const { shift1, shift2 } = getAssignment(emp.id, d.date);
                  const s1 = getShift(shift1);
                  const s2 = getShift(shift2);
                  return (
                    <td key={d.date} style={{
                      padding: '5px', borderLeft: '1px solid var(--border)',
                      background: d.date === today ? 'rgba(245,158,11,0.04)' : 'transparent',
                      verticalAlign: 'top',
                    }}>
                      {/* 早班 */}
                      <div style={{ marginBottom: 4 }}>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2, textAlign: 'center' }}>早班</div>
                        <select value={shift1} onChange={e => setAssignment(emp.id, d.date, 'shift1', e.target.value)}
                          style={{
                            width: '100%', padding: '4px 3px', borderRadius: 6, fontSize: 11,
                            fontWeight: 700, fontFamily: 'var(--mono)',
                            background: s1 ? s1.color + '22' : 'var(--bg-elevated)',
                            color: s1 ? s1.color : 'var(--text-muted)',
                            border: s1 ? `1px solid ${s1.color}55` : '1px solid var(--border)',
                            cursor: 'pointer',
                          }}>
                          <option value="">-- 休</option>
                          {shifts.map(s => <option key={s.id} value={s.id}>{s.id} {s.start}</option>)}
                        </select>
                      </div>
                      {/* 晚班 */}
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2, textAlign: 'center' }}>晚班</div>
                        <select value={shift2} onChange={e => setAssignment(emp.id, d.date, 'shift2', e.target.value)}
                          style={{
                            width: '100%', padding: '4px 3px', borderRadius: 6, fontSize: 11,
                            fontWeight: 700, fontFamily: 'var(--mono)',
                            background: s2 ? s2.color + '22' : 'var(--bg-elevated)',
                            color: s2 ? s2.color : 'var(--text-muted)',
                            border: s2 ? `1px solid ${s2.color}55` : '1px solid var(--border)',
                            cursor: 'pointer',
                          }}>
                          <option value="">-- 無</option>
                          {shifts.map(s => <option key={s.id} value={s.id}>{s.id} {s.start}</option>)}
                        </select>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
        · 早班＋晚班都選 = 雙頭班（打 4 次卡）<br/>
        · 只選早班 = 一般班（打 2 次卡）<br/>
        · 可提早 <strong style={{ color: 'var(--amber)' }}>15 分鐘</strong> 打卡・加班以 <strong style={{ color: 'var(--amber)' }}>15 分鐘</strong> 為單位計算
      </div>
    </div>
  );
}
