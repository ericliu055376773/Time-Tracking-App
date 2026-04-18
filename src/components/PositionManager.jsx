import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const DEFAULT_POSITIONS = [
  { id: 'pos1', name: '外場-正職', baseSalary: 29500, fullAttendance: 2000, mealAllowance: 3000, bonus: 3500, laborInsurance: 700, healthInsurance: 426, deduction: 0 },
  { id: 'pos2', name: '外場-教育員/副領班', baseSalary: 29500, fullAttendance: 2000, mealAllowance: 3000, bonus: 8500, laborInsurance: 700, healthInsurance: 426, deduction: 0 },
  { id: 'pos3', name: '外場-領班', baseSalary: 29500, fullAttendance: 2000, mealAllowance: 3000, bonus: 5500, laborInsurance: 700, healthInsurance: 426, deduction: 0 },
];

export default function PositionManager() {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [form, setForm] = useState({
    id: '', name: '', baseSalary: 29500, fullAttendance: 2000,
    mealAllowance: 3000, bonus: 3500, laborInsurance: 700,
    healthInsurance: 426, deduction: 0
  });
  const [formError, setFormError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'settings', 'positions'));
        if (snap.exists()) {
          setPositions(snap.data().list || []);
        } else {
          setPositions(DEFAULT_POSITIONS);
          await setDoc(doc(db, 'settings', 'positions'), { list: DEFAULT_POSITIONS });
        }
      } catch (err) { console.error(err); }
      setLoading(false);
    }
    load();
  }, []);

  async function savePositions(newList) {
    await setDoc(doc(db, 'settings', 'positions'), { list: newList });
    setPositions(newList);
  }

  function openAdd() {
    const nextNum = positions.length + 1;
    setForm({
      id: `pos${nextNum}`, name: '', baseSalary: 29500, fullAttendance: 2000,
      mealAllowance: 3000, bonus: 3500, laborInsurance: 700,
      healthInsurance: 426, deduction: 0
    });
    setEditingId(null);
    setFormError('');
    setShowForm(true);
  }

  function openEdit(position) {
    setForm({ ...position });
    setEditingId(position.id);
    setFormError('');
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { setFormError('請輸入職位名稱'); return; }
    let newList;
    if (editingId) {
      newList = positions.map(p => p.id === editingId ? form : p);
    } else {
      newList = [...positions, form];
    }
    await savePositions(newList);
    setShowForm(false);
    setEditingId(null);
  }

  async function handleDelete(posId) {
    const newList = positions.filter(p => p.id !== posId);
    await savePositions(newList);
    setDeleteConfirm(null);
  }

  function calcTotal(p) {
    return p.baseSalary + p.fullAttendance + p.mealAllowance + p.bonus - p.laborInsurance - p.healthInsurance - p.deduction;
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 12, padding: 20 }}>載入中...</div>;

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>職位薪資結構管理</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>目前共 {positions.length} 個職位</div>
        </div>
        <button onClick={openAdd} style={{
          padding: '9px 18px', background: 'var(--amber)', color: '#000',
          border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>+ 新增職位</button>
      </div>

      {positions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          尚無職位，點「新增職位」開始建立
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {positions.map(pos => (
            <div key={pos.id} className="card" style={{ padding: '18px 22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', marginBottom: 12 }}>{pos.name}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px 16px', fontSize: 12 }}>
                    <SalaryItem label="底薪(A)" value={pos.baseSalary} color="var(--text-primary)" />
                    <SalaryItem label="全勤(B)" value={pos.fullAttendance} color="var(--green)" />
                    <SalaryItem label="餐費(C)" value={pos.mealAllowance} color="var(--blue)" />
                    <SalaryItem label="紅利(D)" value={pos.bonus} color="var(--amber)" />
                    <SalaryItem label="勞保自付額" value={pos.laborInsurance} color="var(--red)" negative />
                    <SalaryItem label="健保自付額" value={pos.healthInsurance} color="var(--red)" negative />
                    <SalaryItem label="代扣獎退" value={pos.deduction} color="var(--red)" negative />
                    <div style={{ gridColumn: 'span 1', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>預估實發</span>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, color: 'var(--amber)' }}>
                        ${calcTotal(pos).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginLeft: 20 }}>
                  <button onClick={() => openEdit(pos)} style={{ padding: '7px 14px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, cursor: 'pointer' }}>編輯</button>
                  <button onClick={() => setDeleteConfirm(pos)} style={{ padding: '7px 14px', background: 'var(--red-glow)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7, fontSize: 12, cursor: 'pointer' }}>刪除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}
          onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: 520, margin: 20, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>{editingId ? '編輯職位' : '新增職位'}</h2>
              <button onClick={() => setShowForm(false)} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '4px 9px', borderRadius: 6 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={lbl}>
                <span>職位名稱</span>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例如：外場-正職" />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={lbl}><span>底薪(A)</span><input type="number" value={form.baseSalary} onChange={e => setForm(f => ({ ...f, baseSalary: Number(e.target.value) }))} /></label>
                <label style={lbl}><span>全勤(B)</span><input type="number" value={form.fullAttendance} onChange={e => setForm(f => ({ ...f, fullAttendance: Number(e.target.value) }))} /></label>
                <label style={lbl}><span>餐費(C)</span><input type="number" value={form.mealAllowance} onChange={e => setForm(f => ({ ...f, mealAllowance: Number(e.target.value) }))} /></label>
                <label style={lbl}><span>紅利(D)</span><input type="number" value={form.bonus} onChange={e => setForm(f => ({ ...f, bonus: Number(e.target.value) }))} /></label>
                <label style={lbl}><span>勞保自付額</span><input type="number" value={form.laborInsurance} onChange={e => setForm(f => ({ ...f, laborInsurance: Number(e.target.value) }))} /></label>
                <label style={lbl}><span>健保自付額</span><input type="number" value={form.healthInsurance} onChange={e => setForm(f => ({ ...f, healthInsurance: Number(e.target.value) }))} /></label>
                <label style={lbl}><span>代扣獎退</span><input type="number" value={form.deduction} onChange={e => setForm(f => ({ ...f, deduction: Number(e.target.value) }))} /></label>
              </div>
              <div style={{ background: 'var(--amber-glow)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>預估實發（含全勤）</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: 'var(--amber)' }}>
                  ${calcTotal(form).toLocaleString()}
                </span>
              </div>
              {formError && <div style={{ background: 'var(--red-glow)', border: '1px solid rgba(239,68,68,0.3)', padding: '10px 14px', borderRadius: 6, color: 'var(--red)', fontSize: 13 }}>{formError}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '11px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>取消</button>
                <button onClick={handleSave} style={{ flex: 2, padding: '11px', background: 'var(--amber)', color: '#000', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  {editingId ? '儲存變更' : '建立職位'}
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
                此操作無法復原。職位將被永久刪除。
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

function SalaryItem({ label, value, color, negative }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{label}</span>
      <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13, color }}>
        {negative && value > 0 ? '-' : ''}${value.toLocaleString()}
      </span>
    </div>
  );
}

const lbl = {
  display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
  color: 'var(--text-muted)', textTransform: 'uppercase',
};
