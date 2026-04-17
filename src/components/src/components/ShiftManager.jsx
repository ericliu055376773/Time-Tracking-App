import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const SHIFT_COLORS = [
  '#f59e0b','#22c55e','#3b82f6','#ef4444','#a855f7',
  '#06b6d4','#f97316','#ec4899','#84cc16','#14b8a6',
];

const DEFAULT_SHIFTS = [
  { id: 'A', name: 'A 班', start: '08:00', end: '17:00', color: '#f59e0b' },
  { id: 'B', name: 'B 班', start: '14:00', end: '23:00', color: '#22c55e' },
  { id: 'C', name: 'C 班', start: '00:00', end: '09:00', color: '#3b82f6' },
];

export default function ShiftManager() {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [form, setForm] = useState({ id: '', name: '', start: '09:00', end: '18:00', color: '#f59e0b' });
  const [formError, setFormError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'settings', 'shifts'));
        if (snap.exists()) {
          setShifts(snap.data().list || []);
        } else {
          setShifts(DEFAULT_SHIFTS);
          await setDoc(doc(db, 'settings', 'shifts'), { list: DEFAULT_SHIFTS });
        }
      } catch (err) { console.error(err); }
      setLoading(false);
    }
    load();
  }, []);

  async function saveShifts(newList) {
    await setDoc(doc(db, 'settings', 'shifts'), { list: newList });
    setShifts(newList);
  }

  function openAdd() {
    const usedIds = shifts.map(s => s.id);
    const nextId = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(c => !usedIds.includes(c)) || '';
    setForm({ id: nextId, name: nextId + ' 班', start: '09:00', end: '18:00', color: SHIFT_COLORS[shifts.length % SHIFT_COLORS.length] });
    setEditingId(null);
    setFormError('');
    setShowForm(true);
  }

  function openEdit(shift) {
    setForm({ ...shift });
    setEditingId(shift.id);
    setFormError('');
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.id.trim()) { setFormError('請輸入班別代號'); return; }
    if (!form.name.trim()) { setFormError('請輸入班別名稱'); return; }
    if (!form.start || !form.end) { setFormError('請設定上下班時間'); return; }
    if (!/^[A-Z]$/.test(form.id.toUpperCase())) { setFormError('班別代號必須是單一英文字母（A-Z）'); return; }
    const id = form.id.toUpperCase();
    if (!editingId && shifts.find(s => s.id === id)) { setFormError(`班別代號 ${id} 已存在`); return; }
    let newList;
    if (editingId) {
      newList = shifts.map(s => s.id === editingId ? { ...form, id } : s);
    } else {
      newList = [...shifts, { ...form, id }].sort((a, b) => a.id.localeCompare(b.id));
    }
    await saveShifts(newList);
    setShowForm(false);
    setEditingId(null);
  }

  async function handleDelete(shiftId) {
    const newList = shifts.filter(s => s.id !== shiftId);
    await saveShifts(newList);
    setDeleteConfirm(null);
  }

  function calcHours(start, end) {
    if (!start || !end) return '--';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins < 0) mins += 24 * 60;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 12, padding: 20 }}>載入中...</div>;

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>班別設定</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>目前共 {shifts.length} 個班別</div>
        </div>
        <button onClick={openAdd} disabled={shifts.length >= 26} style={{
          padding: '9px 18px', background: 'var(--amber)', color: '#000',
          border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>+ 新增班別</button>
      </div>

      {shifts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          尚無班別，點「新增班別」開始建立
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shifts.map(shift => (
            <div key={shift.id} className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)',
                    background: shift.color + '22', color: shift.color,
                    border: `1px solid ${shift.color}44`, flexShrink: 0,
                  }}>{shift.id}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>{shift.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--green)' }}>{shift.start}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>→</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--red)' }}>{shift.end}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '2px 8px', borderRadius: 99, border: '1px solid var(--border)' }}>
                        {calcHours(shift.start, shift.end)}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => openEdit(shift)} style={{ padding: '7px 14px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, cursor: 'pointer' }}>編輯</button>
                  <button onClick={() => setDeleteConfirm(shift)} style={{ padding: '7px 14px', background: 'var(--red-glow)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7, fontSize: 12, cursor: 'pointer' }}>刪除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}
          onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 420, margin: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>{editingId ? '編輯班別' : '新增班別'}</h2>
              <button onClick={() => setShowForm(false)} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '4px 9px', borderRadius: 6 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 12 }}>
                <label style={lbl}>
                  <span>代號</span>
                  <input value={form.id} maxLength={1}
                    onChange={e => { const v = e.target.value.toUpperCase().replace(/[^A-Z]/g,''); setForm(f => ({ ...f, id: v, name: v ? v + ' 班' : f.name })); }}
                    placeholder="A" disabled={!!editingId}
                    style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700 }} />
                </label>
                <label style={lbl}>
                  <span>班別名稱</span>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例如：早班" />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={lbl}><span>上班時間</span><input type="time" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} /></label>
                <label style={lbl}><span>下班時間</span><input type="time" value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} /></label>
              </div>
              {form.start && form.end && (
                <div style={{ background: 'var(--amber-glow)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>工作時數</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: 'var(--amber)' }}>{calcHours(form.start, form.end)}</span>
                </div>
              )}
              <label style={lbl}>
                <span>顏色標示</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  {SHIFT_COLORS.map(c => (
                    <div key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                      style={{ width: 28, height: 28, borderRadius: 7, background: c, cursor: 'pointer', border: form.color === c ? '3px solid #fff' : '3px solid transparent', boxShadow: form.color === c ? `0 0 0 2px ${c}` : 'none', transition: 'all .15s' }} />
                  ))}
                </div>
              </label>
              {formError && <div style={{ background: 'var(--red-glow)', border: '1px solid rgba(239,68,68,0.3)', padding: '10px 14px', borderRadius: 6, color: 'var(--red)', fontSize: 13 }}>{formError}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '11px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>取消</button>
                <button onClick={handleSave} style={{ flex: 2, padding: '11px', background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  {editingId ? '儲存變更' : '建立班別'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001, backdropFilter: 'blur(4px)' }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 380, margin: 20 }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--red-glow)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>確認刪除「{deleteConfirm.name}」？</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                此操作無法復原。<br />
                班別代號 <span style={{ fontFamily: 'var(--mono)', color: deleteConfirm.color, fontWeight: 700 }}>{deleteConfirm.id}</span>（{deleteConfirm.start} - {deleteConfirm.end}）將被永久刪除。
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: '12px', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>取消</button>
              <button onClick={() => handleDelete(deleteConfirm.id)} style={{ flex: 1, padding: '12px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>確認刪除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const lbl = {
  display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
  color: 'var(--text-muted)', textTransform: 'uppercase',
};
