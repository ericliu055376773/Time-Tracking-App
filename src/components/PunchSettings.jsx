import React, { useState, useEffect } from 'react';
import { getDoc, setDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';

const DEFAULT = {
  maxMissedPunchForFullAtt: 0,
  earlyClockInMinutes: 15,
};

export default function PunchSettings({ onSaved }) {
  const [settings, setSettings] = useState(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'punchSettings'))
      .then(snap => { if (snap.exists()) setSettings({ ...DEFAULT, ...snap.data() }); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function update(key, val) { setSettings(s => ({ ...s, [key]: val })); }

  async function handleSave() {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'punchSettings'), settings, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      if (onSaved) onSaved();
    } catch (err) { alert('儲存失敗：' + err.message); }
    finally { setSaving(false); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>載入中...</div>;

  const missed = settings.maxMissedPunchForFullAtt ?? 0;
  const early  = settings.earlyClockInMinutes ?? 15;
  const totalMins = 9 * 60 - early;
  const hh = String(Math.floor(totalMins / 60)).padStart(2, '0');
  const mm = String(totalMins % 60).padStart(2, '0');

  const card = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 };
  const inputStyle = { width: 72, padding: '8px 10px', textAlign: 'center', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, outline: 'none' };
  const row = { display: 'flex', alignItems: 'center', gap: 10 };
  const muted = { fontSize: 13, color: 'var(--text-secondary)' };

  return (
    <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>👆 打卡設定</div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>全勤容許未補打次數</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>當月忘打卡未補打次數超過上限則失去全勤，有補打不計次。</div>
        <div style={row}>
          <span style={muted}>允許未補打</span>
          <input type="number" min={0} max={30} value={missed} onChange={e => update('maxMissedPunchForFullAtt', Math.max(0, Math.min(30, Number(e.target.value))))} style={inputStyle} />
          <span style={muted}>次（0 = 完全不容許）</span>
        </div>
        <div style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, color: missed === 0 ? 'var(--red)' : 'var(--amber)', background: missed === 0 ? 'rgba(229,62,62,0.1)' : 'rgba(245,158,11,0.1)' }}>
          {missed === 0 ? '任何一次未補打都會失去全勤' : `超過 ${missed} 次才失去全勤`}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>提前上班打卡時間</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>員工最早可在班別開始幾分鐘前打上班卡。</div>
        <div style={row}>
          <span style={muted}>最早提前</span>
          <input type="number" min={0} max={60} value={early} onChange={e => update('earlyClockInMinutes', Math.max(0, Math.min(60, Number(e.target.value))))} style={inputStyle} />
          <span style={muted}>分鐘打上班卡</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 10px', borderRadius: 6, background: 'var(--bg-elevated)' }}>
          例如 09:00 上班，設 {early} 分鐘 → 最早 {hh}:{mm} 可打卡
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>提前上班打卡時間</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>員工最早可在班別開始幾分鐘前打上班卡。</div>
        <div style={row}>
          <span style={muted}>最早提前</span>
          <input type="number" min={0} max={60} value={early} onChange={e => update('earlyClockInMinutes', Math.max(0, Math.min(60, Number(e.target.value))))} style={inputStyle} />
          <span style={muted}>分鐘打上班卡</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 10px', borderRadius: 6, background: 'var(--bg-elevated)' }}>
          例如 09:00 上班，設 {early} 分鐘 → 最早 {hh}:{mm} 可打卡
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={handleSave} disabled={saving} style={{ padding: '11px 28px', borderRadius: 9, fontWeight: 700, fontSize: 14, background: saving ? 'var(--text-muted)' : 'var(--amber)', color: '#fff', border: 'none', cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? '儲存中...' : '儲存設定'}
        </button>
        {saved && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>✓ 已儲存</span>}
      </div>
    </div>
  );
}
