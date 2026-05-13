// src/components/SalaryRuleManager.jsx
import React, { useState, useEffect } from 'react';
import { useAdminNav } from '../contexts/AdminNavContext';
import { doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore';
import { fetchTaiwanHolidaysForMonth } from '../utils/fetchHolidays';
import { db } from '../firebase';

const DEFAULT_RULES = {
  // 月薪制扣款
  laborInsurance: 0,
  healthInsurance: 0,
  lateGracePeriod: 0,
  lateDeductionPerMinute: 0,
  personalLeaveIncludeFullAtt: true,
  sickLeaveIncludeFullAtt: true,
  // 時薪制扣款
  hourlyLaborInsurance: 0,
  hourlyHealthInsurance: 0,
  hourlyLateGracePeriod: 0,
  hourlyLateDeductionPerMinute: 0,
  // 通用
  customItems: [],
  monthlyOTMinutes: 10,   // 月薪加班計算單位（分鐘）
  hourlyOTMinutes: 10,    // 時薪加班計算單位（分鐘）
  salaryRevealDay: 30,    // 薪資明細開放日（每月幾號）
  settlementDay: 31,      // 薪資結算日（每月幾號，0=不自動提醒）
  punchCutoffMinutes: 30,  // 上班打卡截止（班別開始後幾分鐘鎖定）
  monthlyRestDays: 8,      // 每月休假天數（影響日薪基準，30-N=工作天數）
  maxMissedPunchForFullAtt: 0, // 全勤容許忘打卡次數（0 = 完全不容許）
};

let idCounter = Date.now();
function newId() { return `item_${idCounter++}`; }

// 取得當月日曆總天數（不含假日判斷，純粹幾月有幾天）
function getTotalDays(year, month) {
  return new Date(year, month, 0).getDate(); // e.g. 4月=30, 5月=31
}

// 從行政院行事曆API取得當月資料（上班天數 + 國定假日清單）
async function fetchWorkingDays(year, month) {
  const pad = n => String(n).padStart(2, '0');
  const startDate = `${year}${pad(month)}01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}${pad(month)}${pad(lastDay)}`;
  try {
    const url = `https://data.gov.tw/api/v2/rest/datastore/TW-${year}-006-001@GOV-API-holiday-calendar?filters=date:gte:${startDate},date:lte:${endDate}&limit=50`;
    const res = await fetch(url);
    const json = await res.json();
    const records = json?.result?.records || [];
    if (records.length === 0) throw new Error('no data');
    const workDays = records.filter(r => r.isHoliday === '否').length;
    // 國定假日：放假（isHoliday=是）且非週六日 → 員工出勤應加倍計薪
    const nationalHolidays = records
      .filter(r => {
        if (r.isHoliday !== '是') return false;
        const d = r.date; // YYYYMMDD
        const dt = new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`);
        const dow = dt.getDay();
        return dow !== 0 && dow !== 6; // 非週六日
      })
      .map(r => `${r.date.slice(0,4)}-${r.date.slice(4,6)}-${r.date.slice(6,8)}`);
    return { workDays, nationalHolidays };
  } catch {
    let workDays = 0;
    const last = new Date(year, month, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow !== 0 && dow !== 6) workDays++;
    }
    return { workDays, nationalHolidays: [] };
  }
}

function HolidayPayManager() {
  const [month, setMonth] = React.useState(new Date().toISOString().slice(0, 7));
  const [holidays, setHolidays] = React.useState([]);
  const [disabled, setDisabled] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (!month) return;
    setLoading(true);
    Promise.all([
      getDoc(doc(db, 'settings', `holidays_${month}`)),
      getDoc(doc(db, 'settings', `holidayPaySettings_${month}`)),
    ]).then(([hdSnap, paySnap]) => {
      const stored = hdSnap.exists() ? (hdSnap.data().dates || []) : [];
      setHolidays(stored);
      setDisabled(paySnap.exists() ? (paySnap.data().disabledDates || []) : []);
      if (stored.length === 0) {
        fetchTaiwanHolidaysForMonth(month).then(apiDates => {
          if (apiDates.length > 0) {
            setHolidays(apiDates);
            setDoc(doc(db, 'settings', `holidays_${month}`), { month, dates: apiDates }).catch(() => {});
          }
        });
      }
    }).finally(() => setLoading(false));
  }, [month]);

  async function toggleHoliday(date) {
    const newDisabled = disabled.includes(date) ? disabled.filter(d => d !== date) : [...disabled, date];
    setDisabled(newDisabled);
    await setDoc(doc(db, 'settings', `holidayPaySettings_${month}`), { month, disabledDates: newDisabled });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function addCustom(date) {
    if (!date || holidays.includes(date)) return;
    const next = [...holidays, date].sort();
    setHolidays(next);
    await setDoc(doc(db, 'settings', `holidays_${month}`), { month, dates: next });
  }

  const enabledCount = holidays.filter(d => !disabled.includes(d)).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={muteTxt}>月份</span>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13 }} />
        {loading && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>載入中...</span>}
        {saved && <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>✓ 已儲存</span>}
      </div>
      {holidays.length === 0 && !loading && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>此月份無國定假日資料</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {holidays.map(date => {
          const on = !disabled.includes(date);
          return (
            <div key={date} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 16px', borderRadius: 10,
              background: on ? 'rgba(34,197,94,0.06)' : 'var(--bg-elevated)',
              border: `1px solid ${on ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>{on ? '🎌' : '📅'}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: on ? 'var(--green)' : 'var(--text-muted)' }}>{date}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{on ? '✓ 給予雙薪' : '✗ 不給雙薪'}</div>
                </div>
              </div>
              <button onClick={() => toggleHoliday(date)} style={{
                padding: '6px 16px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: on ? 'var(--green)' : 'var(--bg-surface)',
                color: on ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`,
              }}>{on ? '開啟' : '關閉'}</button>
            </div>
          );
        })}
      </div>
      {holidays.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          共 {holidays.length} 個假日 · {enabledCount} 個給予雙薪 · {holidays.length - enabledCount} 個不計雙薪
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>手動新增假日</span>
        <input type="date" onChange={e => { addCustom(e.target.value); e.target.value = ''; }}
          style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12 }} />
      </div>
    </div>
  );
}

export default function SalaryRuleManager() {
  const { activeTab } = useAdminNav();
  if (activeTab !== '月薪算法') return null;
  const [rules, setRules] = useState(null);
  const [positions, setPositions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState('monthly'); // 'monthly' | 'hourly'
  const [editing, setEditing] = useState({});
  const [workingDays, setWorkingDays] = useState(null);
  const [totalDays, setTotalDays] = useState(null);
  const [workingDaysLoading, setWorkingDaysLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => {
    async function load() {
      const [snap, posSnap, empSnap] = await Promise.all([
        getDoc(doc(db, 'settings', 'salaryRules')),
        getDoc(doc(db, 'settings', 'positions')),
        getDocs(collection(db, 'users')),
      ]);
      setRules(snap.exists() ? { ...DEFAULT_RULES, ...snap.data() } : { ...DEFAULT_RULES });
      setPositions(posSnap.exists() ? (posSnap.data().list || []) : []);
    }
    load();
  }, []);

  useEffect(() => {
    if (!selectedMonth) return;
    const [y, m] = selectedMonth.split('-').map(Number);
    setWorkingDaysLoading(true);
    setTotalDays(getTotalDays(y, m));
    fetchWorkingDays(y, m).then(({ workDays, nationalHolidays }) => {
      setWorkingDays(workDays);
      setWorkingDaysLoading(false);
      // 把國定假日清單存進 Firestore 供薪資計算使用
      const monthKey = `${String(y)}-${String(m).padStart(2,'0')}`;
      setDoc(doc(db, 'settings', `holidays_${monthKey}`), { month: monthKey, dates: nationalHolidays })
        .catch(err => console.error('儲存假日失敗:', err));
    });
  }, [selectedMonth]);

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
  function toggleEdit(key) { setEditing(e => ({ ...e, [key]: !e[key] })); }

  if (!rules) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>載入中...</div>;

  const [sy, sm] = selectedMonth.split('-').map(Number);
  const wd = workingDays || 30;  // 工作天數（扣假日）
  const td = totalDays || 30;   // 當月日曆總天數

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* 頂部工具列 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        {/* 分類切換 */}
        <div style={{ display: 'flex', gap: 3, background: 'var(--bg-elevated)', borderRadius: 8, padding: 4 }}>
          {[{ key: 'monthly', label: '月薪制扣款設定' }, { key: 'hourly', label: '時薪制扣款設定' }, { key: 'monthlyOT', label: '月薪薪資補償' }, { key: 'hourlyOT', label: '時薪薪資補償' }, { key: 'holidays', label: '🎌 國定假日雙薪' }].map(tab => (
            <button key={tab.key} onClick={() => setActiveSection(tab.key)} style={{
              padding: '7px 16px', borderRadius: 6, fontSize: 13, fontWeight: activeSection === tab.key ? 700 : 400,
              background: activeSection === tab.key ? 'var(--amber)' : 'transparent',
              color: activeSection === tab.key ? '#fff' : 'var(--text-secondary)',
              border: 'none', cursor: 'pointer',
            }}>{tab.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {saved && <span style={{ fontSize: 13, color: 'var(--green)' }}>✓ 已儲存</span>}
          <button onClick={handleSave} disabled={saving} style={{
            padding: '8px 20px', background: 'var(--amber)', color: '#ffffff',
            borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', border: 'none',
          }}>{saving ? '儲存中...' : '💾 儲存設定'}</button>
        </div>
      </div>

      {/* 薪資明細開放日設定（永遠顯示，不受 Tab 影響） */}
      <DeductCard title="薪資明細開放日" prefix="📅" color="var(--amber)"
        isEditing={editing.revealDay} onToggleEdit={() => toggleEdit('revealDay')}>
        {editing.revealDay ? (
          <EditRow>
            <span style={muteTxt}>每月</span>
            <NumInput value={rules.salaryRevealDay || 30} onChange={v => update('salaryRevealDay', Math.min(31, Math.max(1, v)))} width={70} />
            <span style={muteTxt}>號（含）之後員工可查看薪資明細與預估實領薪資</span>
          </EditRow>
        ) : (
          <DisplayRow>
            <span style={muteTxt}>每月</span>
            <span style={whiteVal}>{rules.salaryRevealDay || 30}</span>
            <span style={muteTxt}>號後員工可查看薪資明細</span>
          </DisplayRow>
        )}
      </DeductCard>

      {/* 打卡截止時間設定 */}
      <DeductCard title="上班打卡截止時間" prefix="⏰" color="var(--red)"
        isEditing={editing.cutoff} onToggleEdit={() => toggleEdit('cutoff')}>
        {editing.cutoff ? (
          <EditRow>
            <span style={muteTxt}>上班時間過後</span>
            <NumInput value={rules.punchCutoffMinutes ?? 30} onChange={v => update('punchCutoffMinutes', Math.max(0, v))} width={70} />
            <span style={muteTxt}>分鐘內未打卡則鎖定（0 = 不鎖定，需管理員補打）</span>
          </EditRow>
        ) : (
          <DisplayRow>
            <span style={muteTxt}>上班後</span>
            <span style={whiteVal}>{rules.punchCutoffMinutes ?? 30}</span>
            <span style={muteTxt}>分鐘內未打卡則鎖定</span>
            {(rules.punchCutoffMinutes ?? 30) === 0
              ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>（不鎖定）</span>
              : <span style={{ fontSize: 11, color: 'var(--red)' }}>⚠️ 超時需管理員補打，自動失去全勤</span>}
          </DisplayRow>
        )}
      </DeductCard>

      {/* ── 月休天數設定 ── */}
      {/* 結算日設定 */}
      <DeductCard title="薪資結算日" prefix="📅" color="var(--green)"
        isEditing={editing.settlement} onToggleEdit={() => toggleEdit('settlement')}>
        {editing.settlement ? (
          <EditRow>
            <span style={muteTxt}>每月</span>
            <NumInput value={rules.settlementDay ?? 31} onChange={v => update('settlementDay', Math.max(0, Math.min(31, v)))} width={70} />
            <span style={muteTxt}>號為薪資結算日（0 = 不自動提醒）</span>
          </EditRow>
        ) : (
          <DisplayRow>
            <span style={muteTxt}>每月</span>
            <span style={whiteVal}>{rules.settlementDay ?? 31}</span>
            <span style={muteTxt}>號 — 當天後台首頁提醒紅利填寫狀況</span>
          </DisplayRow>
        )}
      </DeductCard>

      <DeductCard title="每月休假天數" prefix="📅" color="var(--text-secondary)"
        isEditing={editing.restDays} onToggleEdit={() => toggleEdit('restDays')}>
        {editing.restDays ? (
          <EditRow>
            <span style={muteTxt}>每月休假</span>
            <NumInput value={rules.monthlyRestDays ?? 8} onChange={v => update('monthlyRestDays', Math.max(0, Math.min(20, v)))} width={70} />
            <span style={muteTxt}>天（工作天數 = 30 - {rules.monthlyRestDays ?? 8} = {30 - (rules.monthlyRestDays ?? 8)} 天）</span>
          </EditRow>
        ) : (
          <DisplayRow>
            <span style={muteTxt}>月休</span>
            <span style={whiteVal}>{rules.monthlyRestDays ?? 8}</span>
            <span style={muteTxt}>天 → 工作天數 {30 - (rules.monthlyRestDays ?? 8)} 天 → 日薪基準 ÷ {30 - (rules.monthlyRestDays ?? 8)}</span>
          </DisplayRow>
        )}
      </DeductCard>

      {/* ════ 月薪制扣款設定 ════ */}
      {activeSection === 'monthly' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 月份選擇（影響假扣款計算） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>計算月份：</span>
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ fontSize: 13, background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none' }} />
            <span style={{ fontSize: 12, color: workingDaysLoading ? 'var(--amber)' : 'var(--green)', fontFamily: 'var(--mono)' }}>
              {workingDaysLoading ? '同步行政院行事曆中...' : `📅 本月總天數：${td} 天`}
            </span>
          </div>

          {/* 1. 勞保扣款 */}
          <DeductCard
            title="勞保扣款"
            prefix="－"
            color="var(--red)"
            isEditing={editing.labor}
            onToggleEdit={() => toggleEdit('labor')}
          >
            {editing.labor ? (
              <EditRow>
                <span style={muteTxt}>每月固定扣</span>
                <NumInput value={rules.laborInsurance} onChange={v => update('laborInsurance', v)} />
                <span style={muteTxt}>元</span>
              </EditRow>
            ) : (
              <DisplayRow>
                <span style={muteTxt}>每月固定扣</span>
                <span style={whiteVal}>{rules.laborInsurance.toLocaleString()}</span>
                <span style={muteTxt}>元</span>
                <EqResult color="var(--red)">-${rules.laborInsurance.toLocaleString()}</EqResult>
              </DisplayRow>
            )}
          </DeductCard>

          {/* 2. 健保扣款 */}
          <DeductCard
            title="健保扣款"
            prefix="－"
            color="var(--red)"
            isEditing={editing.health}
            onToggleEdit={() => toggleEdit('health')}
          >
            {editing.health ? (
              <EditRow>
                <span style={muteTxt}>每月固定扣</span>
                <NumInput value={rules.healthInsurance} onChange={v => update('healthInsurance', v)} />
                <span style={muteTxt}>元</span>
              </EditRow>
            ) : (
              <DisplayRow>
                <span style={muteTxt}>每月固定扣</span>
                <span style={whiteVal}>{rules.healthInsurance.toLocaleString()}</span>
                <span style={muteTxt}>元</span>
                <EqResult color="var(--red)">-${rules.healthInsurance.toLocaleString()}</EqResult>
              </DisplayRow>
            )}
          </DeductCard>

          {/* 3. 事假扣款 */}
          <DeductCard
            title="事假扣款"
            prefix="－"
            color="var(--red)"
            isEditing={editing.personal}
            onToggleEdit={() => toggleEdit('personal')}
            subtitle="每請 1 天事假"
          >
            {editing.personal ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  扣款公式（每1天）：<br />
                  <span style={{ color: 'var(--red)' }}>（底薪 ÷ {td}天 × 1）＋（餐費 ÷ {td}天 × 1）</span>
                  <br />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={!!rules.personalLeaveIncludeFullAtt}
                      onChange={e => update('personalLeaveIncludeFullAtt', e.target.checked)}
                      style={{ width: 'auto', accentColor: 'var(--red)' }} />
                    <span>請事假當月失去全勤獎金</span>
                  </label>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  ※ 底薪與餐費依各職位設定各自計算
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                  <span style={{ color: 'var(--red)', fontWeight: 600 }}>（底薪 ÷ {td} × 1）＋（餐費 ÷ {td} × 1）</span>
                </div>
                {positions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    {positions.map(pos => {
                      const base = (pos.baseSalary || 0) / td;
                      const meal = (pos.mealAllowance || 0) / td;
                      return (
                        <div key={pos.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 10px', background: 'var(--bg-base)', borderRadius: 6 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{pos.name}</span>
                          <span style={{ fontFamily: 'var(--mono)', color: 'var(--red)', fontWeight: 600 }}>
                            -${Math.round(base + meal).toLocaleString()} / 天
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: rules.personalLeaveIncludeFullAtt ? 'var(--red)' : 'var(--text-muted)' }}>
                    {rules.personalLeaveIncludeFullAtt ? '⚠️ 請假當月失去全勤' : '✓ 不影響全勤'}
                  </span>
                </div>
              </div>
            )}
          </DeductCard>

          {/* 4. 病假扣款 */}
          <DeductCard
            title="病假扣款"
            prefix="－"
            color="var(--amber)"
            isEditing={editing.sick}
            onToggleEdit={() => toggleEdit('sick')}
            subtitle="每請 1 天病假（半薪）"
          >
            {editing.sick ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  扣款公式（每1天）：<br />
                  <span style={{ color: 'var(--amber)' }}>（底薪 ÷ {td}天 × 0.5）＋（餐費 ÷ {td}天 × 1）</span>
                  <br />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={!!rules.sickLeaveIncludeFullAtt}
                      onChange={e => update('sickLeaveIncludeFullAtt', e.target.checked)}
                      style={{ width: 'auto', accentColor: 'var(--amber)' }} />
                    <span>請病假當月失去全勤獎金</span>
                  </label>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  ※ 底薪依各職位設定各自計算；病假底薪扣半薪、餐費全扣
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                  <span style={{ color: 'var(--amber)', fontWeight: 600 }}>（底薪 ÷ {td} × 0.5）＋（餐費 ÷ {td} × 1）</span>
                </div>
                {positions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    {positions.map(pos => {
                      const base = (pos.baseSalary || 0) / td * 0.5;
                      const meal = (pos.mealAllowance || 0) / td;
                      return (
                        <div key={pos.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 10px', background: 'var(--bg-base)', borderRadius: 6 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{pos.name}</span>
                          <span style={{ fontFamily: 'var(--mono)', color: 'var(--amber)', fontWeight: 600 }}>
                            -${Math.round(base + meal).toLocaleString()} / 天
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  <span style={{ color: rules.sickLeaveIncludeFullAtt ? 'var(--amber)' : 'var(--text-muted)' }}>
                    {rules.sickLeaveIncludeFullAtt ? '⚠️ 請假當月失去全勤' : '✓ 不影響全勤'}
                  </span>
                </div>
              </div>
            )}
          </DeductCard>

          {/* 5. 遲到扣款（月薪） */}
          <DeductCard
            title="遲到扣款"
            prefix="－"
            color="var(--red)"
            isEditing={editing.late}
            onToggleEdit={() => toggleEdit('late')}
          >
            {editing.late ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <EditRow>
                  <span style={muteTxt}>寬限</span>
                  <NumInput value={rules.lateGracePeriod} onChange={v => update('lateGracePeriod', v)} width={60} />
                  <span style={muteTxt}>分鐘以內不扣（0 = 無寬限）</span>
                </EditRow>
                <EditRow>
                  <span style={muteTxt}>超過寬限後，每分鐘扣</span>
                  <NumInput value={rules.lateDeductionPerMinute} onChange={v => update('lateDeductionPerMinute', v)} width={70} />
                  <span style={muteTxt}>元（0 = 不扣）</span>
                </EditRow>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <DisplayRow>
                  <span style={muteTxt}>寬限</span>
                  <span style={whiteVal}>{rules.lateGracePeriod}</span>
                  <span style={muteTxt}>分鐘以內視為準時</span>
                  {rules.lateGracePeriod === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>（無寬限）</span>}
                </DisplayRow>
                <DisplayRow>
                  <span style={muteTxt}>每分鐘扣</span>
                  <span style={{ ...whiteVal, color: rules.lateDeductionPerMinute > 0 ? 'var(--red)' : 'var(--text-muted)' }}>{rules.lateDeductionPerMinute}</span>
                  <span style={muteTxt}>元</span>
                  {rules.lateDeductionPerMinute === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>（不扣款）</span>}
                </DisplayRow>
              </div>
            )}
          </DeductCard>

        </div>
      )}

      {/* ════ 時薪制扣款設定 ════ */}
      {activeSection === 'hourly' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 勞保 */}
          <DeductCard title="勞保扣款" prefix="－" color="var(--red)" isEditing={editing.hLabor} onToggleEdit={() => toggleEdit('hLabor')}>
            {editing.hLabor ? (
              <EditRow>
                <span style={muteTxt}>每月固定扣</span>
                <NumInput value={rules.hourlyLaborInsurance} onChange={v => update('hourlyLaborInsurance', v)} />
                <span style={muteTxt}>元</span>
              </EditRow>
            ) : (
              <DisplayRow>
                <span style={muteTxt}>每月固定扣</span>
                <span style={whiteVal}>{(rules.hourlyLaborInsurance||0).toLocaleString()}</span>
                <span style={muteTxt}>元</span>
                <EqResult color="var(--red)">-${(rules.hourlyLaborInsurance||0).toLocaleString()}</EqResult>
              </DisplayRow>
            )}
          </DeductCard>

          {/* 健保 */}
          <DeductCard title="健保扣款" prefix="－" color="var(--red)" isEditing={editing.hHealth} onToggleEdit={() => toggleEdit('hHealth')}>
            {editing.hHealth ? (
              <EditRow>
                <span style={muteTxt}>每月固定扣</span>
                <NumInput value={rules.hourlyHealthInsurance} onChange={v => update('hourlyHealthInsurance', v)} />
                <span style={muteTxt}>元</span>
              </EditRow>
            ) : (
              <DisplayRow>
                <span style={muteTxt}>每月固定扣</span>
                <span style={whiteVal}>{(rules.hourlyHealthInsurance||0).toLocaleString()}</span>
                <span style={muteTxt}>元</span>
                <EqResult color="var(--red)">-${(rules.hourlyHealthInsurance||0).toLocaleString()}</EqResult>
              </DisplayRow>
            )}
          </DeductCard>

          {/* 遲到扣款（時薪） */}
          <DeductCard title="遲到扣款" prefix="－" color="var(--red)" isEditing={editing.hLate} onToggleEdit={() => toggleEdit('hLate')}>
            {editing.hLate ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <EditRow>
                  <span style={muteTxt}>寬限</span>
                  <NumInput value={rules.hourlyLateGracePeriod||0} onChange={v => update('hourlyLateGracePeriod', v)} width={60} />
                  <span style={muteTxt}>分鐘以內不扣（0 = 無寬限）</span>
                </EditRow>
                <EditRow>
                  <span style={muteTxt}>超過寬限後，每分鐘扣</span>
                  <NumInput value={rules.hourlyLateDeductionPerMinute||0} onChange={v => update('hourlyLateDeductionPerMinute', v)} width={70} />
                  <span style={muteTxt}>元（0 = 不扣）</span>
                </EditRow>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <DisplayRow>
                  <span style={muteTxt}>寬限</span>
                  <span style={whiteVal}>{rules.hourlyLateGracePeriod||0}</span>
                  <span style={muteTxt}>分鐘以內視為準時</span>
                  {!rules.hourlyLateGracePeriod && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>（無寬限）</span>}
                </DisplayRow>
                <DisplayRow>
                  <span style={muteTxt}>每分鐘扣</span>
                  <span style={{ ...whiteVal, color: (rules.hourlyLateDeductionPerMinute||0) > 0 ? 'var(--red)' : 'var(--text-muted)' }}>{rules.hourlyLateDeductionPerMinute||0}</span>
                  <span style={muteTxt}>元</span>
                  {!(rules.hourlyLateDeductionPerMinute) && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>（不扣款）</span>}
                </DisplayRow>
              </div>
            )}
          </DeductCard>

          <div className="card" style={{ padding: '16px 20px', opacity: 0.6 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              ※ 時薪制員工無事假/病假扣款計算（依實際出勤時數計薪）
            </div>
          </div>

        </div>
      )}

      {/* ════ 月薪薪資補償 ════ */}
      {activeSection === 'monthlyOT' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 月份選擇 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>計算月份：</span>
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              style={{ fontSize: 13, background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none' }} />
            <span style={{ fontSize: 12, color: workingDaysLoading ? 'var(--amber)' : 'var(--green)', fontFamily: 'var(--mono)' }}>
              {workingDaysLoading ? '同步行政院行事曆中...' : `📅 本月總天數：${td} 天`}
            </span>
          </div>

          {/* 說明標題 */}
          <div className="card" style={{ padding: '14px 20px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--amber)', marginBottom: 6 }}>📌 8小時以上加班費計算方式</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
              時薪基準 ＝ 底薪 ÷ {td} 天（當月總天數）÷ 8 小時<br />
              1 小時加班費 ＝ 時薪基準 × 1.34<br />
              {rules.monthlyOTMinutes} 分鐘加班費 ＝ 時薪基準 × 1.34 ÷ 60 × {rules.monthlyOTMinutes}
            </div>
          </div>

          {/* 加班分鐘設定 */}
          <DeductCard title="加班計算單位" prefix="+" color="var(--amber)"
            isEditing={editing.monthlyOTMin} onToggleEdit={() => toggleEdit('monthlyOTMin')}>
            {editing.monthlyOTMin ? (
              <EditRow>
                <span style={muteTxt}>每次加班以</span>
                <NumInput value={rules.monthlyOTMinutes} onChange={v => update('monthlyOTMinutes', Math.max(1, v))} width={70} />
                <span style={muteTxt}>分鐘為計算單位</span>
              </EditRow>
            ) : (
              <DisplayRow>
                <span style={muteTxt}>每次加班以</span>
                <span style={whiteVal}>{rules.monthlyOTMinutes}</span>
                <span style={muteTxt}>分鐘為計算單位</span>
              </DisplayRow>
            )}
          </DeductCard>

          {/* 各職位加班費計算 */}
          {positions.length === 0 ? (
            <div className="card" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              請先至「職位管理」設定職位資料
            </div>
          ) : (
            positions.map(pos => {
              const baseSalary = pos.baseSalary || 0;
              const hourlyBase = baseSalary / td / 8;
              const ot1h = hourlyBase * 1.34;
              const otMin = ot1h / 60 * rules.monthlyOTMinutes;
              return (
                <div key={pos.id} className="card" style={{ padding: '18px 20px', border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ padding: '2px 10px', borderRadius: 999, background: 'rgba(245,158,11,0.12)', color: 'var(--amber)', fontSize: 12 }}>{pos.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>底薪 ${baseSalary.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* 時薪基準 */}
                    <OTRow label="時薪基準" formula={`$${baseSalary.toLocaleString()} ÷ ${td}天 ÷ 8h`} result={`$${hourlyBase.toFixed(1)} / h`} color="var(--text-secondary)" />
                    {/* 1小時加班費 */}
                    <OTRow label="1 小時加班費" formula={`時薪 × 1.34`} result={`$${Math.round(ot1h).toLocaleString()} / h`} color="var(--green)" />
                    {/* N分鐘加班費 */}
                    <OTRow label={`${rules.monthlyOTMinutes} 分鐘加班費`} formula={`時薪 × 1.34 ÷ 60 × ${rules.monthlyOTMinutes}`} result={`$${Math.round(otMin).toLocaleString()} / ${rules.monthlyOTMinutes}分`} color="var(--amber)" />
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ════ 時薪薪資補償 ════ */}
      {activeSection === 'hourlyOT' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 說明標題 */}
          <div className="card" style={{ padding: '14px 20px', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.25)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#60a5fa', marginBottom: 6 }}>📌 8小時以上加班費計算方式</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
              1 小時加班費 ＝ 個人時薪 × 1.34<br />
              {rules.hourlyOTMinutes} 分鐘加班費 ＝ 個人時薪 ÷ 60 × {rules.hourlyOTMinutes}<br />
              <span style={{color:'var(--text-muted)',fontSize:11}}>（時薪制直接用個人時薪，不需除以天數）</span>
            </div>
          </div>

          {/* 加班分鐘設定 */}
          <DeductCard title="加班計算單位" prefix="+" color="#60a5fa"
            isEditing={editing.hourlyOTMin} onToggleEdit={() => toggleEdit('hourlyOTMin')}>
            {editing.hourlyOTMin ? (
              <EditRow>
                <span style={muteTxt}>每次加班以</span>
                <NumInput value={rules.hourlyOTMinutes} onChange={v => update('hourlyOTMinutes', Math.max(1, v))} width={70} />
                <span style={muteTxt}>分鐘為計算單位</span>
              </EditRow>
            ) : (
              <DisplayRow>
                <span style={muteTxt}>每次加班以</span>
                <span style={whiteVal}>{rules.hourlyOTMinutes}</span>
                <span style={muteTxt}>分鐘為計算單位</span>
              </DisplayRow>
            )}
          </DeductCard>

          {/* 各時薪員工加班費 */}
          {positions.length === 0 ? (
            <div className="card" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              請先至「員工管理」設定時薪制員工
            </div>
          ) : (
            // 這裡用 positions 裡有 hourlyRate 的職位（或直接用員工資料）
            <div className="card" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                時薪制員工加班費依各自時薪計算，請至「員工查詢」查看個別員工
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <OTRow label="1 小時加班費" formula="個人時薪 × 1.34" result="依各員工時薪" color="var(--green)" />
                <OTRow label={`${rules.hourlyOTMinutes} 分鐘加班費`} formula={`個人時薪 ÷ 60 × ${rules.hourlyOTMinutes}`} result="依各員工時薪" color="#60a5fa" />
              </div>
            </div>
          )}

        </div>
      )}
      {activeSection === 'holidays' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>針對每個月份的國定假日個別設定是否計入雙薪，適用四周變形工時等特殊勞動條件。</div>
          <HolidayPayManager />
        </div>
      )}

    </div>
  );
}

// ── 扣款卡片元件 ──────────────────────────────────────────────
function DeductCard({ title, prefix, color, isEditing, onToggleEdit, subtitle, children }) {
  return (
    <div className="card" style={{
      padding: '16px 20px',
      border: isEditing ? `1px solid ${color}` : '1px solid var(--border)',
      transition: 'border 0.2s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color }}>{prefix}</span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          </div>
          {subtitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        <button onClick={onToggleEdit} style={{
          padding: '4px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
          background: isEditing ? color : 'var(--bg-elevated)',
          color: isEditing ? '#fff' : 'var(--text-secondary)',
          border: isEditing ? 'none' : '1px solid var(--border)',
        }}>{isEditing ? '完成' : '✏️ 編輯'}</button>
      </div>
      {children}
    </div>
  );
}

function EditRow({ children }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>{children}</div>;
}

function DisplayRow({ children }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>{children}</div>;
}

function EqResult({ children, color }) {
  return (
    <>
      <span style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 2px' }}>＝</span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: color || 'var(--amber)' }}>{children}</span>
    </>
  );
}

function NumInput({ value, onChange, width = 100 }) {
  // 文字輸入，允許空白過渡，失焦時轉回數字
  const [local, setLocal] = React.useState(String(value ?? ''));
  React.useEffect(() => { setLocal(String(value ?? '')); }, [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      value={local}
      onChange={e => {
        const v = e.target.value.replace(/[^0-9.]/g, '');
        setLocal(v);
        if (v !== '' && !isNaN(Number(v))) onChange(Number(v));
      }}
      onBlur={() => {
        const n = Number(local);
        if (local === '' || isNaN(n)) { setLocal(String(value ?? 0)); }
        else { onChange(n); setLocal(String(n)); }
      }}
      style={{ width, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 14, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontWeight: 700, textAlign: 'center', outline: 'none' }}
    />
  );
}

function OTRow({ label, formula, result, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-base)', borderRadius: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>{formula}</div>
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: color || 'var(--amber)' }}>{result}</div>
    </div>
  );
}

const muteTxt = { fontSize: 13, color: 'var(--text-muted)' };
const whiteVal = { fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' };
