// src/components/SalaryRuleManager.jsx
// 月薪制薪資算法編輯介面
// Firestore: settings/salaryRules

import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const DEFAULT_RULES = {
  fullAttendanceBonus: 2000,
  fullAttendanceConditions: {
    noLate: true,
    noLeave: true,
    noMissedPunch: true,
  },
  lateDeductionPerMinute: 0,   // 0 = 不扣款
  customItems: [],              // { id, name, type:'allowance'|'deduction', amount, per:'month'|'day'|'minute', note }
};

let idCounter = Date.now();
function newId() { return `item_${idCounter++}`; }

export default function SalaryRuleManager() {
  const [rules, setRules] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingItem, setEditingItem] = useState(null); // 正在編輯的自訂項目
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', type: 'allowance', amount: '', per: 'month', note: '' });
  const [formError, setFormError] = useState('');

  useEffect(() => {
    async function load() {
      const snap = await getDoc(doc(db, 'settings', 'salaryRules'));
      setRules(snap.exists() ? { ...DEFAULT_RULES, ...snap.data() } : { ...DEFAULT_RULES });
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await setDoc(doc(db, 'settings', 'salaryRules'), rules);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert('儲存失敗：' + err.message);
    }
    setSaving(false);
  }

  function updateRule(key, val) {
    setRules(r => ({ ...r, [key]: val }));
  }

  function updateCondition(key, val) {
    setRules(r => ({ ...r, fullAttendanceConditions: { ...r.fullAttendanceConditions, [key]: val } }));
  }

  function handleAddItem() {
    setFormError('');
    if (!newItem.name.trim()) return setFormError('請輸入項目名稱');
    if (!newItem.amount || Number(newItem.amount) <= 0) return setFormError('請輸入有效金額');
    const item = { ...newItem, id: newId(), amount: Number(newItem.amount) };
    setRules(r => ({ ...r, customItems: [...r.customItems, item] }));
    setNewItem({ name: '', type: 'allowance', amount: '', per: 'month', note: '' });
    setShowAddForm(false);
  }

  function handleDeleteItem(id) {
    setRules(r => ({ ...r, customItems: r.customItems.filter(i => i.id !== id) }));
  }

  function handleSaveEdit() {
    setFormError('');
    if (!editingItem.name.trim()) return setFormError('請輸入項目名稱');
    if (!editingItem.amount || Number(editingItem.amount) <= 0) return setFormError('請輸入有效金額');
    setRules(r => ({ ...r, customItems: r.customItems.map(i => i.id === editingItem.id ? { ...editingItem, amount: Number(editingItem.amount) } : i) }));
    setEditingItem(null);
  }

  const perLabel = { month: '每月固定', day: '每出勤日', minute: '每分鐘（遲到用）' };

  if (!rules) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>載入中...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* 儲存按鈕 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
        {saved && <span style={{ fontSize: 13, color: 'var(--green)' }}>✓ 已儲存</span>}
        <button onClick={handleSave} disabled={saving} style={{
          padding: '9px 24px', background: 'var(--amber)', color: '#000',
          borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: 'none',
        }}>
          {saving ? '儲存中...' : '💾 儲存設定'}
        </button>
      </div>

      {/* 全勤獎金 */}
      <div className="card" style={{ padding: '20px 24px' }}>
        <SectionTitle>全勤獎金</SectionTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <label style={labelStyle}>
            <span>獎金金額（元）</span>
            <input type="number" min="0" value={rules.fullAttendanceBonus}
              onChange={e => updateRule('fullAttendanceBonus', Number(e.target.value))}
              style={inputStyle} />
          </label>
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', marginBottom: 10 }}>全勤達標條件（勾選代表「違反此條件則不給全勤」）</div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {[
            { key: 'noLate', label: '不能遲到' },
            { key: 'noLeave', label: '不能請假（事/病假）' },
            { key: 'noMissedPunch', label: '不能忘打卡' },
          ].map(({ key, label }) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox"
                checked={!!rules.fullAttendanceConditions?.[key]}
                onChange={e => updateCondition(key, e.target.checked)}
                style={{ width: 'auto', accentColor: 'var(--amber)' }} />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* 遲到扣款 */}
      <div className="card" style={{ padding: '20px 24px' }}>
        <SectionTitle>遲到扣款</SectionTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <label style={labelStyle}>
            <span>每分鐘扣款（元，0 = 不扣）</span>
            <input type="number" min="0" value={rules.lateDeductionPerMinute}
              onChange={e => updateRule('lateDeductionPerMinute', Number(e.target.value))}
              style={inputStyle} />
          </label>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 18 }}>
            例：設定 10 → 遲到 30 分鐘扣 $300
          </div>
        </div>
      </div>

      {/* 自訂加扣項目 */}
      <div className="card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <SectionTitle style={{ marginBottom: 0 }}>自訂加扣項目</SectionTitle>
          <button onClick={() => { setShowAddForm(true); setFormError(''); setNewItem({ name: '', type: 'allowance', amount: '', per: 'month', note: '' }); }}
            style={{ padding: '7px 16px', background: 'var(--amber)', color: '#000', borderRadius: 7, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' }}>
            + 新增項目
          </button>
        </div>

        {/* 新增表單 */}
        {showAddForm && (
          <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)', marginBottom: 12 }}>新增項目</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={labelStyle}>
                <span>項目名稱</span>
                <input value={newItem.name} onChange={e => setNewItem(f => ({ ...f, name: e.target.value }))} placeholder="例：交通補貼" style={inputStyle} />
              </label>
              <label style={labelStyle}>
                <span>類型</span>
                <select value={newItem.type} onChange={e => setNewItem(f => ({ ...f, type: e.target.value }))} style={inputStyle}>
                  <option value="allowance">＋ 加項（補貼/津貼）</option>
                  <option value="deduction">－ 扣項（扣款）</option>
                </select>
              </label>
              <label style={labelStyle}>
                <span>金額（元）</span>
                <input type="number" min="0" value={newItem.amount} onChange={e => setNewItem(f => ({ ...f, amount: e.target.value }))} placeholder="0" style={{ ...inputStyle, width: 90 }} />
              </label>
              <label style={labelStyle}>
                <span>計算方式</span>
                <select value={newItem.per} onChange={e => setNewItem(f => ({ ...f, per: e.target.value }))} style={inputStyle}>
                  <option value="month">每月固定</option>
                  <option value="day">每出勤日</option>
                </select>
              </label>
              <label style={labelStyle}>
                <span>備註（選填）</span>
                <input value={newItem.note} onChange={e => setNewItem(f => ({ ...f, note: e.target.value }))} placeholder="說明" style={inputStyle} />
              </label>
            </div>
            {formError && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{formError}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={handleAddItem} style={{ padding: '8px 18px', background: 'var(--green)', color: '#000', borderRadius: 7, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' }}>確認新增</button>
              <button onClick={() => setShowAddForm(false)} style={{ padding: '8px 16px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}>取消</button>
            </div>
          </div>
        )}

        {/* 項目列表 */}
        {rules.customItems.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>尚無自訂項目，點「新增項目」開始設定</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.customItems.map(item => (
              <div key={item.id}>
                {editingItem?.id === item.id ? (
                  // 編輯模式
                  <div style={{ background: 'var(--bg-base)', border: '1px solid var(--amber)', borderRadius: 10, padding: 14 }}>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <label style={labelStyle}>
                        <span>項目名稱</span>
                        <input value={editingItem.name} onChange={e => setEditingItem(f => ({ ...f, name: e.target.value }))} style={inputStyle} />
                      </label>
                      <label style={labelStyle}>
                        <span>類型</span>
                        <select value={editingItem.type} onChange={e => setEditingItem(f => ({ ...f, type: e.target.value }))} style={inputStyle}>
                          <option value="allowance">＋ 加項</option>
                          <option value="deduction">－ 扣項</option>
                        </select>
                      </label>
                      <label style={labelStyle}>
                        <span>金額（元）</span>
                        <input type="number" min="0" value={editingItem.amount} onChange={e => setEditingItem(f => ({ ...f, amount: e.target.value }))} style={{ ...inputStyle, width: 90 }} />
                      </label>
                      <label style={labelStyle}>
                        <span>計算方式</span>
                        <select value={editingItem.per} onChange={e => setEditingItem(f => ({ ...f, per: e.target.value }))} style={inputStyle}>
                          <option value="month">每月固定</option>
                          <option value="day">每出勤日</option>
                        </select>
                      </label>
                      <label style={labelStyle}>
                        <span>備註</span>
                        <input value={editingItem.note||''} onChange={e => setEditingItem(f => ({ ...f, note: e.target.value }))} style={inputStyle} />
                      </label>
                    </div>
                    {formError && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{formError}</div>}
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button onClick={handleSaveEdit} style={{ padding: '7px 16px', background: 'var(--green)', color: '#000', borderRadius: 7, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer' }}>儲存</button>
                      <button onClick={() => setEditingItem(null)} style={{ padding: '7px 14px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}>取消</button>
                    </div>
                  </div>
                ) : (
                  // 顯示模式
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-base)', borderRadius: 10, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{
                        padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                        background: item.type === 'allowance' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                        color: item.type === 'allowance' ? 'var(--green)' : 'var(--red)',
                      }}>
                        {item.type === 'allowance' ? '＋ 加項' : '－ 扣項'}
                      </span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{item.name}</div>
                        {item.note && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.note}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, color: item.type === 'allowance' ? 'var(--green)' : 'var(--red)' }}>
                          {item.type === 'allowance' ? '+' : '-'}${item.amount.toLocaleString()}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{perLabel[item.per]}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => { setEditingItem({ ...item }); setFormError(''); }} style={{ padding: '6px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>編輯</button>
                        <button onClick={() => handleDeleteItem(item.id)} style={{ padding: '6px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, fontSize: 12, color: 'var(--red)', cursor: 'pointer' }}>刪除</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 公式預覽 */}
      <div className="card" style={{ padding: '20px 24px', border: '1px solid rgba(245,158,11,0.3)', background: 'var(--amber-glow)' }}>
        <SectionTitle>月薪制公式預覽</SectionTitle>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 2 }}>
          <div>實領薪資 =</div>
          <div style={{ paddingLeft: 20 }}>
            <div>（底薪 ÷ 30 + 餐費 ÷ 30）× 出勤天數</div>
            {rules.fullAttendanceBonus > 0 && (
              <div style={{ color: 'var(--green)' }}>＋ 全勤獎金 ${rules.fullAttendanceBonus.toLocaleString()}（條件：{[
                rules.fullAttendanceConditions?.noLate && '無遲到',
                rules.fullAttendanceConditions?.noLeave && '無請假',
                rules.fullAttendanceConditions?.noMissedPunch && '無忘打卡',
              ].filter(Boolean).join('、') || '無條件'}）</div>
            )}
            {rules.lateDeductionPerMinute > 0 && (
              <div style={{ color: 'var(--red)' }}>－ 遲到分鐘數 × ${rules.lateDeductionPerMinute}</div>
            )}
            {rules.customItems.map(item => (
              <div key={item.id} style={{ color: item.type === 'allowance' ? 'var(--green)' : 'var(--red)' }}>
                {item.type === 'allowance' ? '＋' : '－'} {item.name}：${item.amount.toLocaleString()} / {perLabel[item.per]}
              </div>
            ))}
            <div style={{ color: 'var(--text-muted)' }}>＋ 紅利（月底另計）</div>
          </div>
        </div>
      </div>

    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
      {children}
    </div>
  );
}

const labelStyle = {
  display: 'flex', flexDirection: 'column', gap: 5,
  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
  letterSpacing: '0.07em', textTransform: 'uppercase',
};

const inputStyle = {
  padding: '8px 12px', border: '1px solid var(--border)',
  borderRadius: 7, fontSize: 13, background: 'var(--bg-base)',
  color: 'var(--text-primary)', outline: 'none', minWidth: 120,
};
