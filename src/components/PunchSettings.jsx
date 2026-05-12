import React, { useState, useEffect } from 'react';
import { getDoc, setDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { format } from 'date-fns';

const DEFAULT = {
  maxMissedPunchForFullAtt: 0,   // 允許未補打忘打卡次數（0 = 完全不容許）
  earlyClockInMinutes: 15,       // 可提前打上班卡的分鐘數
};

const cardStyle = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '20px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const labelStyle = { fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' };
const subStyle   = { fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, marginBottom: 10 };
const rowStyle   = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' };
const numInput   = (val, onChange, min = 0, max = 120) => (
  <input
    type="number" min={min} max={max} value={val}
    onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
    style={{
      width: 72, padding: '8px 10px', textAlign: 'center',
      border: '1px solid var(--border)', borderRadius: 8,
      background: 'var(--bg-elevated)', color: 'var(--text-primary)',
      fontSize: 15, fontWeight: 700, outline: 'none',
    }}
  />
);

// 手動管理國定假日（當政府 API 失敗時使用）
function ManualHolidayManager() {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [dates, setDates] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!month) return;
    getDoc(doc(db, 'settings', `holidays_${month}`))
      .then(snap => setDates(snap.exists() ? (snap.data().dates || []) : []))
      .catch(() => setDates([]));
  }, [month]);

  async function addDate() {
    const d = input.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || dates.includes(d)) return;
    const newDates = [...dates, d].sort();
    setDates(newDates);
    setInput('');
    await setDoc(doc(db, 'settings', `holidays_${month}`), { month, dates: newDates });
  }

  async function removeDate(d) {
    const newDates = dates.filter(x => x !== d);
    setDates(newDates);
    await setDoc(doc(db, 'settings', `holidays_${month}`), { month, dates: newDates });
  }

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>🎌 國定假日手動設定</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        若政府行事曆 API 失敗，可在此手動新增國定假日日期（平日放假才需填，不含週末）
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>月份</span>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13 }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {dates.map(d => (
          <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 20 }}>
            <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>🎌 {d}</span>
            <button onClick={() => removeDate(d)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
        ))}
        {dates.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>尚未設定任何假日</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="date" value={input} onChange={e => setInput(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13 }} />
        <button onClick={addDate} disabled={!input}
          style={{ padding: '8px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13, background: 'var(--green)', color: '#fff', border: 'none', cursor: 'pointer', opacity: input ? 1 : 0.4 }}>
          + 新增
        </button>
      </div>
    </div>
  );
}

export default function PunchSettings({ onSaved }) {
  const [settings, setSettings] = useState(DEFAULT);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'punchSettings')).then(snap => {
      if (snap.exists()) setSettings({ ...DEFAULT, ...snap.data() });
    }).finally(() => setLoading(false));
  }, []);

  function update(key, val) {
    setSettings(s => ({ ...s, [key]: val }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'punchSettings'), settings, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      if (onSaved) onSaved();
    } catch (err) {
      alert('儲存失敗：' + err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>載入中...</div>;

  const missed = settings.maxMissedPunchForFullAtt ?? 0;
  const early  = settings.earlyClockInMinutes ?? 15;

  return (
    <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>👆 打卡設定</div>

      {/* 未打卡次數 */}
      <div style={cardStyle}>
        <div style={labelStyle}>全勤容許未補打次數</div>
        <div style={subStyle}>
          當月有忘打卡但未補打的次數，超過此上限則失去全勤資格。<br />
          <span style={{ color: 'var(--green)' }}>有補打卡 = 不計入次數</span>；
          <span style={{ color: 'var(--red)' }}> 未補打 = 計入次數</span>。
        </div>
        <div style={rowStyle}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>允許未補打忘打卡</span>
          {numInput(missed, v => update('maxMissedPunchForFullAtt', v), 0, 30)}
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>次（0 = 完全不容許）</span>
        </div>
        {missed === 0
          ? <div style={{ fontSize: 11, color: 'var(--red)', background: 'var(--red-glow)', padding: '6px 10px', borderRadius: 6 }}>
              任何一次未補打的忘打卡都會失去全勤
            </div>
          : <div style={{ fontSize: 11, color: 'var(--amber)', background: 'var(--amber-glow)', padding: '6px 10px', borderRadius: 6 }}>
              當月未補打忘打卡超過 {missed} 次才失去全勤
            </div>
        }
      </div>

      {/* 提前打卡時間 */}
      <div style={cardStyle}>
        <div style={labelStyle}>提前上班打卡時間</div>
        <div style={subStyle}>
          員工最早可以在班別開始時間的幾分鐘前打上班卡。<br />
          <span style={{ color: 'var(--red)' }}>下班打卡必須準時（不得提前）。</span>
        </div>
        <div style={rowStyle}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>上班卡最早可提前</span>
          {numInput(early, v => update('earlyClockInMinutes', v), 0, 60)}
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>分鐘打卡</span>
        </div>
        {(() => {
          const totalMins = 9*60 - early;
          const hh = String(Math.floor(totalMins/60)).padStart(2,'0');
          const mm = String(totalMins % 60).padStart(2,'0');
          return (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '6px 10px', borderRadius: 6 }}>
              例如班別 09:00 上班，設定 {early} 分鐘 → 員工最早 {hh}:{mm} 可打上班卡
            </div>
          );
        })()}
      </div>

      {/* 手動新增國定假日（API 備用方案）*/}
      <ManualHolidayManager />

      {/* 手動新增國定假日（API 備用方案）*/}
      <ManualHolidayManager />

      {/* 儲存 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={handleSave} disabled={saving}
          style={{
            padding: '11px 28px', borderRadius: 9, fontWeight: 700, fontSize: 14,
            background: saving ? 'var(--text-muted)' : 'var(--amber)',
            color: '#fff', border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {saving ? '儲存中...' : '儲存設定'}
        </button>
        {saved && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>✓ 已儲存</span>}
      </div>
    </div>
  );
}
