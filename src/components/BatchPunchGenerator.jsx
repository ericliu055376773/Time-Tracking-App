// BatchPunchGenerator.jsx
// 批量模擬打卡紀錄生成器
import React, { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, query, where, deleteDoc, doc, getDoc } from 'firebase/firestore';
import { Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { format, getDaysInMonth, parseISO } from 'date-fns';
import { fetchTaiwanHolidaysForMonth } from '../utils/fetchHolidays';

// ── 樣式常數 ──────────────────────────────────────────────
const card = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '18px 22px',
};
const label = { fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6, display: 'block', letterSpacing: '0.06em', textTransform: 'uppercase' };
const input = {
  width: '100%', padding: '9px 12px',
  border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
const chip = (active) => ({
  padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: active ? 700 : 400,
  background: active ? 'var(--amber)' : 'var(--bg-elevated)',
  color: active ? '#fff' : 'var(--text-secondary)',
  border: `1px solid ${active ? 'var(--amber)' : 'var(--border)'}`,
  cursor: 'pointer', userSelect: 'none',
});
const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

export default function BatchPunchGenerator({ employees, onClose, onDone }) {
  const [step, setStep] = useState(1); // 1=設定 2=預覽 3=完成
  const [empId, setEmpId]       = useState('');
  const [month, setMonth]       = useState(format(new Date(), 'yyyy-MM'));
  const [inTime, setInTime]     = useState('09:00');
  const [outTime, setOutTime]   = useState('18:00');
  const [workDays, setWorkDays] = useState([1,2,3,4,5]); // 週一到週五
  const [lateMinutes, setLateMinutes] = useState(0);   // 遲到幾分鐘（0=準時）
  const [lateDays, setLateDays]       = useState([]);  // 哪幾天遲到（日期 'MM-DD'）
  const [missedDays, setMissedDays]   = useState([]);  // 忘打下班卡的日期
  const [leaveDays, setLeaveDays]     = useState([]); // [{ day: '5', type: '事假' }]
  const [clearFirst, setClearFirst]   = useState(true);
  const [nationalHolidays, setNationalHolidays] = useState([]); // 當月國定假日
  const [generating, setGenerating]   = useState(false);
  const [preview, setPreview]         = useState([]);
  const [result, setResult]           = useState(null);

  const emp = employees.find(e => e.id === empId);

  useEffect(() => {
    if (!month) return;
    setNationalHolidays([]);
    fetchTaiwanHolidaysForMonth(month)
      .then(holidays => {
        setNationalHolidays(holidays);
        // 存入 Firestore
        if (holidays.length > 0) {
          getDoc(doc(db, 'settings', `holidays_${month}`))
            .then(() => import('firebase/firestore').then(({ setDoc: sd, doc: fd }) =>
              sd(fd(db, 'settings', `holidays_${month}`), { month, dates: holidays })
            )).catch(() => {});
        }
      })
      .catch(() => {
        getDoc(doc(db, 'settings', `holidays_${month}`))
          .then(snap => setNationalHolidays(snap.exists() ? (snap.data().dates || []) : []))
          .catch(() => setNationalHolidays([]));
      });
  }, [month]);

  // 計算當月所有工作日
  function buildSchedule() {
    const daysInMonth = getDaysInMonth(parseISO(month + '-01'));
    const records = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${month}-${String(d).padStart(2,'0')}`;
      const dow = new Date(dateStr).getDay(); // 0=日 6=六
      if (!workDays.includes(dow)) continue;

      const isLate    = lateDays.includes(String(d));
      const isMissed  = missedDays.includes(String(d));
      const actualLate = isLate ? (lateMinutes || 5) : 0;

      const [ih, im] = inTime.split(':').map(Number);
      const [oh, om] = outTime.split(':').map(Number);

      const inDt  = new Date(`${dateStr}T${String(ih).padStart(2,'0')}:${String(im + actualLate).padStart(2,'0')}:00`);
      const outDt = new Date(`${dateStr}T${String(oh).padStart(2,'0')}:${String(om).padStart(2,'0')}:00`);

      const leaveEntry = leaveDays.find(l => l.day === String(d));
      const isNH = nationalHolidays.includes(dateStr);
      records.push({
        date: dateStr, dow,
        inTime: leaveEntry ? null : format(inDt, 'HH:mm'),
        outTime: leaveEntry ? null : (isMissed ? null : format(outDt, 'HH:mm')),
        inDt: leaveEntry ? null : inDt,
        outDt: leaveEntry ? null : (isMissed ? null : outDt),
        lateMinutes: leaveEntry ? 0 : actualLate,
        isMissed: leaveEntry ? false : isMissed,
        leaveType: leaveEntry?.type || null,
        isNationalHoliday: isNH,
      });
    }
    return records;
  }

  function handlePreview() {
    if (!empId) return alert('請選擇員工');
    if (workDays.length === 0) return alert('請至少選擇一個工作天');
    setPreview(buildSchedule());
    setStep(2);
  }

  async function handleGenerate() {
    if (!empId || preview.length === 0) return;
    setGenerating(true);
    try {
      // 清除舊資料（只查 uid，日期過濾在記憶體做，不需要複合索引）
      if (clearFirst) {
        const snap = await getDocs(query(
          collection(db, 'punches'),
          where('uid', '==', empId),
        ));
        const toDelete = snap.docs.filter(d => {
          const date = d.data().date || '';
          return date >= `${month}-01` && date <= `${month}-31`;
        });
        await Promise.all(toDelete.map(d => deleteDoc(doc(db, 'punches', d.id))));
        // 同時清除該月模擬請假
        const leaveSnap = await getDocs(query(collection(db, 'leaves'), where('uid', '==', empId)));
        const leavesToDel = leaveSnap.docs.filter(d => {
          const date = d.data().date || '';
          return date >= `${month}-01` && date <= `${month}-31` && d.data().reason === '批量模擬請假';
        });
        await Promise.all(leavesToDel.map(d => deleteDoc(doc(db, 'leaves', d.id))));
      }

      // 批量寫入
      let written = 0;
      for (const r of preview) {
        // 請假日：寫入 leaves collection，不產生打卡
        if (r.leaveType) {
          await addDoc(collection(db, 'leaves'), {
            uid: empId,
            userName: emp?.name || '',
            type: r.leaveType,
            date: r.date,
            workdays: 1,
            status: 'approved',
            reason: '批量模擬請假',
            createdAt: Timestamp.fromDate(new Date()),
          });
          written++;
          continue;
        }

        // 上班打卡
        await addDoc(collection(db, 'punches'), {
          uid: empId,
          userName: emp?.name || '',
          type: 'in',
          timestamp: Timestamp.fromDate(r.inDt),
          date: r.date,
          lateMinutes: r.lateMinutes,
          overtimeMinutes: 0,
          shiftId: '',
          session: 1,
          note: `批量模擬 ${r.lateMinutes > 0 ? `（遲到${r.lateMinutes}分）` : ''}`,
          networkName: '模擬生成',
          publicIP: '',
          isMakeup: true,
        });
        written++;

        // 下班打卡（若非忘打）
        if (r.outDt) {
          await addDoc(collection(db, 'punches'), {
            uid: empId,
            userName: emp?.name || '',
            type: 'out',
            timestamp: Timestamp.fromDate(r.outDt),
            date: r.date,
            lateMinutes: 0,
            overtimeMinutes: 0,
            shiftId: '',
            session: 1,
            note: '批量模擬',
            networkName: '模擬生成',
            publicIP: '',
            isMakeup: true,
          });
          written++;
        }
      }

      setResult({ days: preview.length, punches: written });
      setStep(3);
      if (onDone) onDone();
    } catch (err) {
      alert('生成失敗：' + err.message);
    } finally {
      setGenerating(false);
    }
  }

  function toggleWorkDay(d) {
    setWorkDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }
  function toggleDay(arr, setArr, day) {
    const s = String(day);
    setArr(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  const daysInMonth = month ? getDaysInMonth(parseISO(month + '-01')) : 31;

  // ── UI ──────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: 16, width: '100%', maxWidth: 640,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>🤖 批量模擬打卡</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              步驟 {step}/3 — {step === 1 ? '設定出勤樣板' : step === 2 ? '確認預覽' : '生成完成'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 20, color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ── STEP 1: 設定 ── */}
          {step === 1 && (<>
            {/* 員工 + 月份 */}
            <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <span style={label}>選擇員工</span>
                <select value={empId} onChange={e => setEmpId(e.target.value)} style={{ ...input }}>
                  <option value="">請選擇...</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <span style={label}>模擬月份</span>
                <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={input} />
              </div>
            </div>

            {/* 工作天 */}
            <div style={card}>
              <span style={label}>工作天（星期幾上班）</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {DAY_NAMES.map((name, i) => (
                  <button key={i} onClick={() => toggleWorkDay(i)} style={chip(workDays.includes(i))}>
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* 上下班時間 */}
            <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <span style={label}>上班時間</span>
                <input type="time" value={inTime} onChange={e => setInTime(e.target.value)} style={input} />
              </div>
              <div>
                <span style={label}>下班時間</span>
                <input type="time" value={outTime} onChange={e => setOutTime(e.target.value)} style={input} />
              </div>
            </div>

            {/* 遲到設定 */}
            <div style={card}>
              <span style={label}>遲到設定（分鐘，0 = 不遲到）</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>遲到</span>
                <input type="number" min={0} max={120} value={lateMinutes}
                  onChange={e => setLateMinutes(Number(e.target.value))}
                  style={{ ...input, width: 80 }} />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>分鐘</span>
              </div>
              {lateMinutes > 0 && (
                <>
                  <span style={{ ...label, marginBottom: 8 }}>哪幾號遲到（不選 = 整月都遲到）</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                      const dateStr = `${month}-${String(d).padStart(2,'0')}`;
                      const dow = new Date(dateStr).getDay();
                      if (!workDays.includes(dow)) return null;
                      const sel = lateDays.includes(String(d));
                      return (
                        <button key={d} onClick={() => toggleDay(lateDays, setLateDays, d)}
                          style={{ ...chip(sel), padding: '3px 9px', fontSize: 11 }}>
                          {d}
                        </button>
                      );
                    })}
                  </div>
                  {lateDays.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 8 }}>
                      未選擇特定日期 → 整月工作日都套用遲到 {lateMinutes} 分鐘
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 忘打下班卡 */}
            <div style={card}>
              <span style={label}>忘打下班卡（哪幾號）</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                  const dateStr = `${month}-${String(d).padStart(2,'0')}`;
                  const dow = new Date(dateStr).getDay();
                  if (!workDays.includes(dow)) return null;
                  const sel = missedDays.includes(String(d));
                  return (
                    <button key={d} onClick={() => toggleDay(missedDays, setMissedDays, d)}
                      style={{ ...chip(sel), padding: '3px 9px', fontSize: 11, background: sel ? 'var(--red)' : undefined, borderColor: sel ? 'var(--red)' : undefined }}>
                      {d}
                    </button>
                  );
                })}
              </div>
              {missedDays.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>
                  {missedDays.length} 天忘打下班卡（只有上班紀錄）
                </div>
              )}
            </div>

            {/* 請假設定 */}
            <div style={card}>
              <span style={label}>請假設定（哪幾號請事假/病假）</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                  const dateStr = `${month}-${String(d).padStart(2,'0')}`;
                  const dow = new Date(dateStr).getDay();
                  if (!workDays.includes(dow)) return null;
                  const entry = leaveDays.find(l => l.day === String(d));
                  return (
                    <div key={d} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{d}</span>
                      <button
                        onClick={() => {
                          setLeaveDays(prev => {
                            const exists = prev.find(l => l.day === String(d));
                            if (!exists) return [...prev, { day: String(d), type: '事假' }];
                            if (exists.type === '事假') return prev.map(l => l.day === String(d) ? { ...l, type: '病假' } : l);
                            if (exists.type === '病假') return prev.map(l => l.day === String(d) ? { ...l, type: '特休' } : l);
                            return prev.filter(l => l.day !== String(d));
                          });
                        }}
                        style={{
                          width: 36, height: 28, borderRadius: 6, fontSize: 10, fontWeight: 700,
                          border: `1px solid ${entry ? (entry.type === '事假' ? 'var(--red)' : entry.type === '病假' ? 'var(--amber)' : 'var(--green)') : 'var(--border)'}`,
                          background: entry ? (entry.type === '事假' ? 'rgba(239,68,68,0.15)' : entry.type === '病假' ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)') : 'var(--bg-elevated)',
                          color: entry ? (entry.type === '事假' ? 'var(--red)' : entry.type === '病假' ? 'var(--amber)' : 'var(--green)') : 'var(--text-muted)',
                          cursor: 'pointer',
                        }}>
                        {entry ? (entry.type === '事假' ? '事' : entry.type === '病假' ? '病' : '休') : '—'}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                點一下 → 事假（紅）｜再點 → 病假（橘）｜再點 → 特休（綠）｜再點 → 取消
                {leaveDays.length > 0 && (
                  <span style={{ marginLeft: 12, color: 'var(--red)' }}>
                    事假 {leaveDays.filter(l=>l.type==='事假').length} 天，
                    病假 {leaveDays.filter(l=>l.type==='病假').length} 天，
                    特休 {leaveDays.filter(l=>l.type==='特休').length} 天
                  </span>
                )}
              </div>
            </div>

            {/* 清除舊資料 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="clearFirst" checked={clearFirst} onChange={e => setClearFirst(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer' }} />
              <label htmlFor="clearFirst" style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                生成前先清除該員工當月所有舊打卡紀錄
              </label>
            </div>

            <button onClick={handlePreview} style={{
              padding: '12px 24px', borderRadius: 9, fontWeight: 700, fontSize: 14,
              background: 'var(--amber)', color: '#fff', border: 'none', cursor: 'pointer',
            }}>
              預覽排程 →
            </button>
          </>)}

          {/* ── STEP 2: 預覽 ── */}
          {step === 2 && (<>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span>員工：<strong style={{ color: 'var(--text-primary)' }}>{emp?.name}</strong></span>
              <span>月份：<strong style={{ color: 'var(--text-primary)' }}>{month}</strong></span>
              <span>工作日：<strong style={{ color: 'var(--amber)' }}>{preview.length}</strong> 天</span>
              {preview.filter(r => r.isNationalHoliday && !r.leaveType).length > 0 && (
                <span style={{ color: 'var(--green)', fontWeight: 700 }}>
                  🎌 國定假日出勤：{preview.filter(r => r.isNationalHoliday && !r.leaveType).length} 天（雙薪）
                </span>
              )}
              {nationalHolidays.length === 0 && (
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>⚠ 請先至月薪算法頁面載入假日資料</span>
              )}
            </div>
            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)' }}>
                    {['日期', '星期', '上班', '下班', '遲到', '備註', '估算日薪'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'left', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={r.date} style={{ borderTop: '1px solid var(--border)', background: r.isNationalHoliday && !r.leaveType ? 'rgba(34,197,94,0.06)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'var(--mono)' }}>
                        {r.date}
                        {r.isNationalHoliday && !r.leaveType && <span style={{ fontSize: 10, color: 'var(--green)', marginLeft: 4 }}>🎌</span>}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-secondary)' }}>週{DAY_NAMES[r.dow]}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'var(--mono)', color: r.lateMinutes > 0 ? 'var(--red)' : 'var(--green)' }}>{r.inTime}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'var(--mono)', color: r.isMissed ? 'var(--text-muted)' : 'var(--red)' }}>{r.isMissed ? '--' : r.outTime}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12 }}>
                        {r.lateMinutes > 0
                          ? <span style={{ color: 'var(--amber)', fontWeight: 700 }}>+{r.lateMinutes}m</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11 }}>
                        {r.leaveType
                          ? <span style={{ color: r.leaveType === '事假' ? 'var(--red)' : r.leaveType === '病假' ? 'var(--amber)' : 'var(--green)', fontWeight: 700 }}>📋 {r.leaveType}</span>
                          : r.isMissed ? <span style={{ color: 'var(--text-muted)' }}>⚠ 忘打下班</span>
                          : r.isNationalHoliday ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>🎌 國定假日</span> : ''}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11, fontFamily: 'var(--mono)', color: r.isNationalHoliday && !r.leaveType ? 'var(--green)' : 'var(--text-muted)' }}>
                        {r.leaveType ? '--' : r.isNationalHoliday ? '×2 雙薪' : '正常'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep(1)} style={{
                padding: '11px 20px', borderRadius: 9, fontWeight: 700, fontSize: 13,
                background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                border: '1px solid var(--border)', cursor: 'pointer',
              }}>← 修改設定</button>
              <button onClick={handleGenerate} disabled={generating} style={{
                flex: 1, padding: '11px 24px', borderRadius: 9, fontWeight: 700, fontSize: 14,
                background: generating ? 'var(--text-muted)' : 'var(--green)',
                color: '#fff', border: 'none', cursor: generating ? 'not-allowed' : 'pointer',
              }}>
                {generating ? '生成中...' : `✓ 確認生成 ${preview.length * 2 - missedDays.length} 筆打卡紀錄`}
              </button>
            </div>
          </>)}

          {/* ── STEP 3: 完成 ── */}
          {step === 3 && result && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>生成完成</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>
                {emp?.name} · {month}<br />
                共 {result.days} 個工作日，{result.punches} 筆打卡紀錄
              </div>
              <button onClick={onClose} style={{
                padding: '11px 32px', borderRadius: 9, fontWeight: 700, fontSize: 14,
                background: 'var(--amber)', color: '#fff', border: 'none', cursor: 'pointer',
              }}>關閉並重新整理</button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
