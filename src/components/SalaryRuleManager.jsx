// src/components/SalaryRuleManager.jsx
import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const DEFAULT_RULES = {
  fullAttendanceBonus: 2000,
  fullAttendanceConditions: { noLate: true, noLeave: true, noMissedPunch: true },
  lateDeductionPerMinute: 0,
  baseSalaryDivisor: 30,
  mealAllowanceDivisor: 30,
  customItems: [],
};

let idCounter = Date.now();
function newId() { return `item_${idCounter++}`; }

export default function SalaryRuleManager() {
  const [rules, setRules] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', type: 'allowance', amount: '', per: 'month', note: '' });
  const [editingItem, setEditingItem] = useState(null);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    async function load() {
      const snap = await getDoc(doc(db, 'settings', 'salaryRules'));
      setRules(snap.exists() ? { ...DEFAULT_RULES, ...snap.data() } : { ...DEFAULT_RULES });
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true); setSaved(false);
    try {
      await setDoc(doc(db, 'settings', 'salaryRules'), rules);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { alert('儲存失敗：' + err.message); }
    setSaving(false);
  }

  function update(key, val) { setRules(r => ({ ...r, [key]: val })); }
  function updateCond(key, val) { setRules(r => ({ ...r, fullAttendanceConditions: { ...r.fullAttendanceConditions, [key]: val } })); }

  function handleAddItem() {
    setFormError('');
    if (!newItem.name.trim()) return setFormError('請輸入項目名稱');
    if (!newItem.amount || Number(newItem.amount) <= 0) return setFormError('請輸入有效金額');
    setRules(r => ({ ...r, customItems: [...r.customItems, { ...newItem, id: newId(), amount: Number(newItem.amount) }] }));
    setNewItem({ name: '', type: 'allowance', amount: '', per: 'month', note: '' });
    setShowAddForm(false);
  }

  function handleSaveEdit() {
    setFormError('');
    if (!editingItem.name.trim()) return setFormError('請輸入項目名稱');
    if (!editingItem.amount || Number(editingItem.amount) <= 0) return setFormError('請輸入有效金額');
    setRules(r => ({ ...r, customItems: r.customItems.map(i => i.id === editingItem.id ? { ...editingItem, amount: Number(editingItem.amount) } : i) }));
    setEditingItem(null);
  }

  if (!rules) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>載入中...</div>;

  const perLabel = { month: '每月固定', day: '每出勤日' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* 儲存按鈕 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
        {saved && <span style={{ fontSize: 13, color: 'var(--green)' }}>✓ 已儲存</span>}
        <button onClick={handleSave} disabled={saving} style={{
          padding: '9px 24px', background: 'var(--amber)', color: '#000',
          borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: 'none',
        }}>{saving ? '儲存中...' : '💾 儲存設定'}</button>
      </div>

      {/* ── 月薪制公式（可直接編輯） ── */}
      <div className="card" style={{ padding: '24px 28px', border: '1px solid rgba(245,158,11,0.3)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginBottom: 20, letterSpacing: '0.06em' }}>
          📐 月薪制公式設定
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* 底薪 */}
          <FormulaRow color="var(--text-primary)">
            <span>底薪</span>
            <InlineInput value={rules.baseSalaryNote || ''} onChange={v => update('baseSalaryNote', v)} placeholder="例：依員工設定" width={160} note />
            <span style={{ color: 'var(--text-muted)' }}>元 ÷</span>
            <InlineInput value={rules.baseSalaryDivisor} onChange={v => update('baseSalaryDivisor', Number(v))} type="number" width={60} />
            <span style={{ color: 'var(--text-muted)' }}>天 × 出勤天數</span>
          </FormulaRow>

          {/* 餐費 */}
          <FormulaRow color="var(--text-primary)">
            <span>＋ 餐費</span>
            <InlineInput value={rules.mealNote || ''} onChange={v => update('mealNote', v)} placeholder="例：依員工設定" width={160} note />
            <span style={{ color: 'var(--text-muted)' }}>元 ÷</span>
            <InlineInput value={rules.mealAllowanceDivisor} onChange={v => update('mealAllowanceDivisor', Number(v))} type="number" width={60} />
            <span style={{ color: 'var(--text-muted)' }}>天 × 出勤天數</span>
          </FormulaRow>

          {/* 全勤獎金 */}
          <FormulaRow color="var(--green)">
            <span>＋ 全勤獎金</span>
            <InlineInput value={rules.fullAttendanceBonus} onChange={v => update('fullAttendanceBonus', Number(v))} type="number" width={90} />
            <span style={{ color: 'var(--text-muted)' }}>元（條件：</span>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {[
                { key: 'noLate', label: '無遲到' },
                { key: 'noLeave', label: '無請假' },
                { key: 'noMissedPunch', label: '無忘打卡' },
              ].map(({ key, label }) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13, color: rules.fullAttendanceConditions?.[key] ? 'var(--green)' : 'var(--text-muted)' }}>
                  <input type="checkbox" checked={!!rules.fullAttendanceConditions?.[key]}
                    onChange={e => updateCond(key, e.target.checked)}
                    style={{ width: 'auto', accentColor: 'var(--green)' }} />
                  {label}
                </label>
              ))}
            </div>
            <span style={{ color: 'var(--text-muted)' }}>）</span>
          </FormulaRow>

          {/* 遲到扣款 */}
          <FormulaRow color="var(--red)">
            <span>－ 遲到扣款</span>
            <InlineInput value={rules.lateDeductionPerMinute} onChange={v => update('lateDeductionPerMinute', Number(v))} type="number" width={70} />
            <span style={{ color: 'var(--text-muted)' }}>元 × 遲到分鐘數</span>
            {rules.lateDeductionPerMinute === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>（0 = 不扣）</span>}
          </FormulaRow>

          {/* 自訂項目 */}
          {rules.customItems.map(item => (
            <FormulaRow key={item.id} color={item.type === 'allowance' ? 'var(--green)' : 'var(--red)'}>
              <span>{item.type === 'allowance' ? '＋' : '－'} {item.name}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600 }}>${item.amount.toLocaleString()}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>（{perLabel[item.per]}）</span>
              <button onClick={() => { setEditingItem({ ...item }); setFormError(''); }}
                style={{ fontSize: 11, padding: '3px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', cursor: 'pointer' }}>編輯</button>
              <button onClick={() => setRules(r => ({ ...r, customItems: r.customItems.filter(i => i.id !== item.id) }))}
                style={{ fontSize: 11, padding: '3px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 5, color: 'var(--red)', cursor: 'pointer' }}>刪除</button>
            </FormulaRow>
          ))}

          {/* 紅利 */}
          <FormulaRow color="var(--text-muted)">
            <span>＋ 紅利</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>月底另行計算</span>
          </FormulaRow>

        </div>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>＝ 實領薪資</span>
          <button onClick={() => { setShowAddForm(true); setFormError(''); }}
            style={{ padding: '7px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}>
            ＋ 新增加扣項目
          </button>
        </div>
      </div>

      {/* 新增項目表單 */}
      {showAddForm && (
        <div className="card" style={{ padding: '20px 24px', border: '1px solid var(--amber)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginBottom: 14 }}>新增加扣項目</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <FieldLabel label="項目名稱"><input value={newItem.name} onChange={e => setNewItem(f => ({ ...f, name: e.target.value }))} placeholder="例：交通補貼" style={fieldInput} /></FieldLabel>
            <FieldLabel label="類型">
              <select value={newItem.type} onChange={e => setNewItem(f => ({ ...f, type: e.target.value }))} style={fieldInput}>
                <option value="allowance">＋ 加項（補貼）</option>
                <option value="deduction">－ 扣項（扣款）</option>
              </select>
            </FieldLabel>
            <FieldLabel label="金額（元）"><input type="number" min="0" value={newItem.amount} onChange={e => setNewItem(f => ({ ...f, amount: e.target.value }))} placeholder="0" style={{ ...fieldInput, width: 90 }} /></FieldLabel>
            <FieldLabel label="計算方式">
              <select value={newItem.per} onChange={e => setNewItem(f => ({ ...f, per: e.target.value }))} style={fieldInput}>
                <option value="month">每月固定</option>
                <option value="day">每出勤日</option>
              </select>
            </FieldLabel>
            <FieldLabel label="備註"><input value={newItem.note} onChange={e => setNewItem(f => ({ ...f, note: e.target.value }))} placeholder="說明" style={fieldInput} /></FieldLabel>
          </div>
          {formError && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{formError}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={handleAddItem} style={{ padding: '8px 18px', background: 'var(--green)', color: '#000', borderRadius: 7, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' }}>確認新增</button>
            <button onClick={() => setShowAddForm(false)} style={{ padding: '8px 16px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}>取消</button>
          </div>
        </div>
      )}

      {/* 編輯項目 Modal */}
      {editingItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ padding: '24px 28px', width: '90%', maxWidth: 500 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>編輯項目</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FieldLabel label="項目名稱"><input value={editingItem.name} onChange={e => setEditingItem(f => ({ ...f, name: e.target.value }))} style={fieldInput} /></FieldLabel>
              <FieldLabel label="類型">
                <select value={editingItem.type} onChange={e => setEditingItem(f => ({ ...f, type: e.target.value }))} style={fieldInput}>
                  <option value="allowance">＋ 加項</option>
                  <option value="deduction">－ 扣項</option>
                </select>
              </FieldLabel>
              <FieldLabel label="金額（元）"><input type="number" min="0" value={editingItem.amount} onChange={e => setEditingItem(f => ({ ...f, amount: e.target.value }))} style={fieldInput} /></FieldLabel>
              <FieldLabel label="計算方式">
                <select value={editingItem.per} onChange={e => setEditingItem(f => ({ ...f, per: e.target.value }))} style={fieldInput}>
                  <option value="month">每月固定</option>
                  <option value="day">每出勤日</option>
                </select>
              </FieldLabel>
              <FieldLabel label="備註"><input value={editingItem.note||''} onChange={e => setEditingItem(f => ({ ...f, note: e.target.value }))} style={fieldInput} /></FieldLabel>
            </div>
            {formError && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{formError}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={handleSaveEdit} style={{ padding: '8px 18px', background: 'var(--green)', color: '#000', borderRadius: 7, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' }}>儲存</button>
              <button onClick={() => setEditingItem(null)} style={{ padding: '8px 16px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}>取消</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── 輔助元件 ─────────────────────────────────────────────────
function FormulaRow({ children, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
      <span style={{ fontWeight: 600, fontSize: 14, color: color || 'var(--text-primary)', minWidth: 80 }}>{children[0]}</span>
      {children.slice(1)}
    </div>
  );
}

function InlineInput({ value, onChange, type = 'text', width = 100, placeholder = '', note }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width, padding: '4px 10px',
        border: 'none',
        borderBottom: `2px solid ${note ? 'rgba(255,255,255,0.15)' : 'var(--amber)'}`,
        background: 'transparent',
        color: note ? 'var(--text-muted)' : 'var(--text-primary)',
        fontFamily: note ? 'inherit' : 'var(--mono)',
        fontSize: note ? 12 : 15,
        fontWeight: note ? 400 : 700,
        outline: 'none',
        textAlign: note ? 'left' : 'center',
      }}
    />
  );
}

function FieldLabel({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const fieldInput = {
  padding: '8px 12px', border: '1px solid var(--border)',
  borderRadius: 7, fontSize: 13, background: 'var(--bg-base)',
  color: 'var(--text-primary)', outline: 'none', minWidth: 120,
};
