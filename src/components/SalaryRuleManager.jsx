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
  baseSalaryNote: '',
  mealNote: '',
  customItems: [],
};

let idCounter = Date.now();
function newId() { return `item_${idCounter++}`; }

export default function SalaryRuleManager() {
  const [rules, setRules] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // 各卡片編輯狀態
  const [editing, setEditing] = useState({ base: false, meal: false, fullAtt: false, late: false });
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
  function toggleEdit(key) { setEditing(e => ({ ...e, [key]: !e[key] })); }

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

      {/* ── 底薪 ── */}
      <RuleCard
        title="底薪"
        color="var(--text-primary)"
        isEditing={editing.base}
        onToggleEdit={() => toggleEdit('base')}
      >
        {editing.base ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={labelTxt}>底薪</span>
            <input value={rules.baseSalaryNote || ''} onChange={e => update('baseSalaryNote', e.target.value)}
              placeholder="例：依員工各別設定" style={{ ...editInput, width: 200 }} />
            <span style={labelTxt}>元 ÷</span>
            <input type="number" value={rules.baseSalaryDivisor} onChange={e => update('baseSalaryDivisor', Number(e.target.value))}
              style={{ ...editInput, width: 70, textAlign: 'center' }} />
            <span style={labelTxt}>天 × 出勤天數</span>
          </div>
        ) : (
          <div style={displayRow}>
            <span style={rowLabel}>底薪</span>
            <span style={rowMuted}>{rules.baseSalaryNote || '依員工各別設定'}</span>
            <span style={rowMuted}>元 ÷</span>
            <span style={rowVal}>{rules.baseSalaryDivisor}</span>
            <span style={rowMuted}>天 × 出勤天數</span>
          </div>
        )}
      </RuleCard>

      {/* ── 餐費 ── */}
      <RuleCard
        title="＋ 餐費"
        color="var(--text-primary)"
        isEditing={editing.meal}
        onToggleEdit={() => toggleEdit('meal')}
      >
        {editing.meal ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={labelTxt}>＋ 餐費</span>
            <input value={rules.mealNote || ''} onChange={e => update('mealNote', e.target.value)}
              placeholder="例：依員工各別設定" style={{ ...editInput, width: 200 }} />
            <span style={labelTxt}>元 ÷</span>
            <input type="number" value={rules.mealAllowanceDivisor} onChange={e => update('mealAllowanceDivisor', Number(e.target.value))}
              style={{ ...editInput, width: 70, textAlign: 'center' }} />
            <span style={labelTxt}>天 × 出勤天數</span>
          </div>
        ) : (
          <div style={displayRow}>
            <span style={{ ...rowLabel, color: 'var(--text-primary)' }}>＋ 餐費</span>
            <span style={rowMuted}>{rules.mealNote || '依員工各別設定'}</span>
            <span style={rowMuted}>元 ÷</span>
            <span style={rowVal}>{rules.mealAllowanceDivisor}</span>
            <span style={rowMuted}>天 × 出勤天數</span>
          </div>
        )}
      </RuleCard>

      {/* ── 全勤獎金 ── */}
      <RuleCard
        title="＋ 全勤獎金"
        color="var(--green)"
        isEditing={editing.fullAtt}
        onToggleEdit={() => toggleEdit('fullAtt')}
      >
        {editing.fullAtt ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ ...labelTxt, color: 'var(--green)' }}>＋ 全勤獎金</span>
            <input type="number" value={rules.fullAttendanceBonus} onChange={e => update('fullAttendanceBonus', Number(e.target.value))}
              style={{ ...editInput, width: 90, textAlign: 'center' }} />
            <span style={labelTxt}>元（達標條件：）</span>
            <div style={{ display: 'flex', gap: 14 }}>
              {[{ key: 'noLate', label: '無遲到' }, { key: 'noLeave', label: '無請假' }, { key: 'noMissedPunch', label: '無忘打卡' }].map(({ key, label }) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={!!rules.fullAttendanceConditions?.[key]}
                    onChange={e => updateCond(key, e.target.checked)}
                    style={{ width: 'auto', accentColor: 'var(--green)' }} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div style={displayRow}>
            <span style={{ ...rowLabel, color: 'var(--green)' }}>＋ 全勤獎金</span>
            <span style={{ ...rowVal, color: 'var(--green)' }}>${rules.fullAttendanceBonus.toLocaleString()}</span>
            <span style={rowMuted}>元（條件：{[
              rules.fullAttendanceConditions?.noLate && '無遲到',
              rules.fullAttendanceConditions?.noLeave && '無請假',
              rules.fullAttendanceConditions?.noMissedPunch && '無忘打卡',
            ].filter(Boolean).join('、') || '無'}）</span>
          </div>
        )}
      </RuleCard>

      {/* ── 遲到扣款 ── */}
      <RuleCard
        title="－ 遲到扣款"
        color="var(--red)"
        isEditing={editing.late}
        onToggleEdit={() => toggleEdit('late')}
      >
        {editing.late ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ ...labelTxt, color: 'var(--red)' }}>－ 遲到扣款</span>
            <input type="number" value={rules.lateDeductionPerMinute} onChange={e => update('lateDeductionPerMinute', Number(e.target.value))}
              style={{ ...editInput, width: 80, textAlign: 'center' }} />
            <span style={labelTxt}>元 × 遲到分鐘數（0 = 不扣）</span>
          </div>
        ) : (
          <div style={displayRow}>
            <span style={{ ...rowLabel, color: 'var(--red)' }}>－ 遲到扣款</span>
            <span style={{ ...rowVal, color: 'var(--red)' }}>{rules.lateDeductionPerMinute}</span>
            <span style={rowMuted}>元 × 遲到分鐘數{rules.lateDeductionPerMinute === 0 ? '（不扣款）' : ''}</span>
          </div>
        )}
      </RuleCard>

      {/* ── 自訂加扣項目 ── */}
      {rules.customItems.map(item => (
        <RuleCard
          key={item.id}
          title={`${item.type === 'allowance' ? '＋' : '－'} ${item.name}`}
          color={item.type === 'allowance' ? 'var(--green)' : 'var(--red)'}
          isEditing={editingItem?.id === item.id}
          onToggleEdit={() => {
            if (editingItem?.id === item.id) { setEditingItem(null); }
            else { setEditingItem({ ...item }); setFormError(''); }
          }}
          onDelete={() => setRules(r => ({ ...r, customItems: r.customItems.filter(i => i.id !== item.id) }))}
        >
          {editingItem?.id === item.id ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <FieldLabel label="名稱"><input value={editingItem.name} onChange={e => setEditingItem(f => ({ ...f, name: e.target.value }))} style={editInput} /></FieldLabel>
              <FieldLabel label="類型">
                <select value={editingItem.type} onChange={e => setEditingItem(f => ({ ...f, type: e.target.value }))} style={editInput}>
                  <option value="allowance">＋ 加項</option>
                  <option value="deduction">－ 扣項</option>
                </select>
              </FieldLabel>
              <FieldLabel label="金額">
                <input type="number" value={editingItem.amount} onChange={e => setEditingItem(f => ({ ...f, amount: e.target.value }))} style={{ ...editInput, width: 90 }} />
              </FieldLabel>
              <FieldLabel label="計算">
                <select value={editingItem.per} onChange={e => setEditingItem(f => ({ ...f, per: e.target.value }))} style={editInput}>
                  <option value="month">每月固定</option>
                  <option value="day">每出勤日</option>
                </select>
              </FieldLabel>
              <FieldLabel label="備註"><input value={editingItem.note||''} onChange={e => setEditingItem(f => ({ ...f, note: e.target.value }))} style={editInput} /></FieldLabel>
              <button onClick={handleSaveEdit} style={btnGreen}>儲存</button>
            </div>
          ) : (
            <div style={displayRow}>
              <span style={{ ...rowLabel, color: item.type === 'allowance' ? 'var(--green)' : 'var(--red)' }}>
                {item.type === 'allowance' ? '＋' : '－'} {item.name}
              </span>
              <span style={{ ...rowVal, color: item.type === 'allowance' ? 'var(--green)' : 'var(--red)' }}>
                ${item.amount.toLocaleString()}
              </span>
              <span style={rowMuted}>{perLabel[item.per]}</span>
              {item.note && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>（{item.note}）</span>}
            </div>
          )}
          {formError && editingItem?.id === item.id && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{formError}</div>}
        </RuleCard>
      ))}

      {/* ── 紅利（固定顯示） ── */}
      <div className="card" style={{ padding: '14px 20px', opacity: 0.5 }}>
        <div style={displayRow}>
          <span style={rowLabel}>＋ 紅利</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>月底另行計算</span>
        </div>
      </div>

      {/* ── 實領薪資 + 新增按鈕 ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 4px' }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>＝ 實領薪資</span>
        <button onClick={() => { setShowAddForm(true); setFormError(''); }}
          style={{ padding: '8px 18px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}>
          ＋ 新增加扣項目
        </button>
      </div>

      {/* 新增表單 */}
      {showAddForm && (
        <div className="card" style={{ padding: '20px 24px', border: '1px solid var(--amber)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginBottom: 14 }}>新增加扣項目</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <FieldLabel label="項目名稱"><input value={newItem.name} onChange={e => setNewItem(f => ({ ...f, name: e.target.value }))} placeholder="例：交通補貼" style={editInput} /></FieldLabel>
            <FieldLabel label="類型">
              <select value={newItem.type} onChange={e => setNewItem(f => ({ ...f, type: e.target.value }))} style={editInput}>
                <option value="allowance">＋ 加項（補貼）</option>
                <option value="deduction">－ 扣項（扣款）</option>
              </select>
            </FieldLabel>
            <FieldLabel label="金額（元）"><input type="number" min="0" value={newItem.amount} onChange={e => setNewItem(f => ({ ...f, amount: e.target.value }))} placeholder="0" style={{ ...editInput, width: 90 }} /></FieldLabel>
            <FieldLabel label="計算方式">
              <select value={newItem.per} onChange={e => setNewItem(f => ({ ...f, per: e.target.value }))} style={editInput}>
                <option value="month">每月固定</option>
                <option value="day">每出勤日</option>
              </select>
            </FieldLabel>
            <FieldLabel label="備註"><input value={newItem.note} onChange={e => setNewItem(f => ({ ...f, note: e.target.value }))} placeholder="說明" style={editInput} /></FieldLabel>
          </div>
          {formError && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{formError}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={handleAddItem} style={btnGreen}>確認新增</button>
            <button onClick={() => setShowAddForm(false)} style={btnCancel}>取消</button>
          </div>
        </div>
      )}

      {/* 編輯項目 Modal */}
      {editingItem && !rules.customItems.find(i => i.id === editingItem.id) === false && null}

    </div>
  );
}

// ── 卡片外框（含右上角編輯按鈕） ────────────────────────────
function RuleCard({ title, color, isEditing, onToggleEdit, onDelete, children }) {
  return (
    <div className="card" style={{
      padding: '14px 20px',
      border: isEditing ? `1px solid ${color}` : '1px solid var(--border)',
      transition: 'border 0.2s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>{children}</div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={onToggleEdit} style={{
            padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: isEditing ? color : 'var(--bg-elevated)',
            color: isEditing ? '#000' : 'var(--text-secondary)',
            border: isEditing ? 'none' : '1px solid var(--border)',
          }}>
            {isEditing ? '完成' : '✏️ 編輯'}
          </button>
          {onDelete && (
            <button onClick={onDelete} style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              background: 'rgba(239,68,68,0.1)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)',
            }}>刪除</button>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
      <span>{label}</span>{children}
    </label>
  );
}

const editInput = {
  padding: '7px 12px', border: '1px solid var(--border)',
  borderRadius: 7, fontSize: 13, background: 'var(--bg-base)',
  color: 'var(--text-primary)', outline: 'none', minWidth: 100,
};
const displayRow = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' };
const rowLabel = { fontWeight: 700, fontSize: 14, minWidth: 90 };
const rowVal = { fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700 };
const rowMuted = { fontSize: 13, color: 'var(--text-muted)' };
const labelTxt = { fontSize: 13, color: 'var(--text-muted)' };
const btnGreen = { padding: '8px 18px', background: 'var(--green)', color: '#000', borderRadius: 7, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' };
const btnCancel = { padding: '8px 16px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, cursor: 'pointer' };
