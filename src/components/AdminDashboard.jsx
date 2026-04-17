import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, query, getDocs, where, orderBy,
  doc, updateDoc, setDoc, getDoc, Timestamp, serverTimestamp
} from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { db, auth } from '../firebase';
import { calcSalaryFromPunches, fmtMoney, fmtHours } from '../hooks/useSalaryCalc';
import { getNetworkInfo, isAllowedNetwork } from '../hooks/useNetworkCheck';
import SalaryReport from './SalaryReport';
import LeaveManager from './LeaveManager';
import ShiftManager from './ShiftManager';
import ScheduleManager from './ScheduleManager';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';

const TABS = ['薪資計算', '打卡紀錄', '請假審核', '員工管理', 'WiFi 設定', '班別設定', '排班管理'];

const EMPTY_ADD = {
  name: '', empId: '', pin: '', email: '',
  role: 'employee', payType: 'hourly',
  hourlyRate: 180, monthlySalary: 30000, overtimeEnabled: false,
};

export default function AdminDashboard() {
  const [employees, setEmployees] = useState([]);
  const [allPunches, setAllPunches] = useState([]);
  const [allLeaves, setAllLeaves] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('薪資計算');
  const [editingEmp, setEditingEmp] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const empSnap = await getDocs(collection(db, 'users'));
      const emps = empSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.role === 'employee');
      setEmployees(emps);
      const start = Timestamp.fromDate(startOfMonth(parseISO(selectedMonth + '-01')));
      const end   = Timestamp.fromDate(endOfMonth(parseISO(selectedMonth + '-01')));
      const pSnap = await getDocs(query(
        collection(db, 'punches'),
        where('timestamp', '>=', start),
        where('timestamp', '<=', end),
        orderBy('timestamp', 'asc')
      ));
      setAllPunches(pSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      const lSnap = await getDocs(query(collection(db, 'leaves'), orderBy('createdAt', 'desc')));
      setAllLeaves(lSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [selectedMonth]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const salarySummaries = employees.map(emp => {
    const punches = allPunches.filter(p => p.uid === emp.id);
    const leaves  = allLeaves.filter(l => l.uid === emp.id && l.status === 'approved');
    const { totalHours, totalOvertimeHours, totalSalary } = calcSalaryFromPunches(punches, emp);
    const dailyRate = emp.payType === 'hourly' ? (emp.hourlyRate||0)*8 : (emp.monthlySalary||0)/30;
    const leaveDeduction = leaves.reduce((s,l) => s + dailyRate*l.workdays*(1-(l.payRate??1)), 0);
    return { ...emp, punches, leaves, totalHours, totalOvertimeHours,
      netSalary: Math.max(0, totalSalary - leaveDeduction), leaveDeduction, punchCount: punches.length };
  });

  const totalPayroll = salarySummaries.reduce((s, e) => s + e.netSalary, 0);
  const pendingLeaves = allLeaves.filter(l => l.status === 'pending').length;

  async function handleAddEmployee() {
    setAddError('');
    if (!addForm.name.trim()) return setAddError('請輸入姓名');
    if (!addForm.empId.trim()) return setAddError('請輸入員工編號');
    if (addForm.role === 'employee') {
      if (!/^\d{10}$/.test(addForm.pin)) return setAddError('PIN 碼必須是 10 位數字');
    } else {
      if (!addForm.email.trim()) return setAddError('請輸入管理員 Email');
      if (addForm.pin.length < 6) return setAddError('密碼至少 6 碼');
    }
    setAddLoading(true);
    try {
      const email = addForm.role === 'employee'
        ? `${addForm.empId.trim().toLowerCase()}@internal.timeclock`
        : addForm.email.trim();
      const cred = await createUserWithEmailAndPassword(auth, email, addForm.pin);
      await setDoc(doc(db, 'users', cred.user.uid), {
        name: addForm.name.trim(), empId: addForm.empId.trim(), email,
        role: addForm.role, payType: addForm.payType,
        hourlyRate: Number(addForm.hourlyRate), monthlySalary: Number(addForm.monthlySalary),
        overtimeEnabled: addForm.overtimeEnabled, createdAt: serverTimestamp(),
      });
      setShowAddModal(false);
      setAddForm(EMPTY_ADD);
      await fetchAll();
    } catch (err) {
      const msgs = { 'auth/email-already-in-use': '此員工編號已被使用', 'auth/weak-password': 'PIN 碼至少需要 6 碼' };
      setAddError(msgs[err.code] || err.message);
    }
    setAddLoading(false);
  }

  async function handleUpdateEmployee() {
    try {
      await updateDoc(doc(db, 'users', editForm.id), {
        name: editForm.name, empId: editForm.empId || '',
        payType: editForm.payType, hourlyRate: Number(editForm.hourlyRate),
        monthlySalary: Number(editForm.monthlySalary), overtimeEnabled: !!editForm.overtimeEnabled,
      });
      setEditingEmp(null);
      await fetchAll();
    } catch (err) { alert('更新失敗：' + err.message); }
  }

  return (
    <div style={{ padding: '32px 40px' }} className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>管理後台</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>薪資計算 · 請假審核 · 員工管理</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ width: 155, fontSize: 13 }} />
          <button onClick={() => setShowAddModal(true)} style={{ padding: '9px 16px', background: 'var(--amber)', color: '#000', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
            + 新增員工
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        <KpiCard label="員工人數" value={employees.length} unit="人" />
        <KpiCard label="本月打卡次數" value={allPunches.length} unit="次" color="var(--blue)" />
        <KpiCard label="待審假單" value={pendingLeaves} unit="筆" color={pendingLeaves > 0 ? 'var(--red)' : 'var(--text-muted)'} />
        <KpiCard label="本月應付薪資" value={fmtMoney(totalPayroll)} color="var(--amber)" highlight />
      </div>

      <div style={{ display: 'flex', gap: 3, marginBottom: 20, background: 'var(--bg-elevated)', borderRadius: 8, padding: 4, width: 'fit-content', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
            background: activeTab === t ? 'var(--amber)' : 'transparent',
            color: activeTab === t ? '#000' : 'var(--text-secondary)',
            position: 'relative',
          }}>
            {t}
            {t === '請假審核' && pendingLeaves > 0 && (
              <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%', background: 'var(--red)' }} />
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>載入中...</div>
      ) : activeTab === '薪資計算' ? (
        <SalaryTab summaries={salarySummaries} month={selectedMonth} />
      ) : activeTab === '打卡紀錄' ? (
        <RecordsTab punches={allPunches} employees={employees} />
      ) : activeTab === '請假審核' ? (
        <LeaveManager isAdmin={true} />
      ) : activeTab === 'WiFi 設定' ? (
        <WifiSettings />
      ) : activeTab === '班別設定' ? (
        <ShiftManager />
      ) : activeTab === '排班管理' ? (
        <ScheduleManager />
      ) : (
        <EmployeesTab
          employees={employees}
          editingEmp={editingEmp} editForm={editForm}
          onEdit={emp => { setEditingEmp(emp.id); setEditForm({ ...emp }); }}
          onEditChange={(k, v) => setEditForm(f => ({ ...f, [k]: v }))}
          onSave={handleUpdateEmployee}
          onCancel={() => setEditingEmp(null)}
        />
      )}

      {showAddModal && (
        <Modal title="新增員工" onClose={() => { setShowAddModal(false); setAddError(''); setAddForm(EMPTY_ADD); }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={labelStyle}>
              <span>角色</span>
              <select value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))}>
                <option value="employee">員工（用編號 + 10位PIN登入）</option>
                <option value="admin">管理員（用 Email + 密碼登入）</option>
              </select>
            </label>
            <label style={labelStyle}>
              <span>姓名</span>
              <input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} placeholder="例如：林小明" />
            </label>
            <label style={labelStyle}>
              <span>員工編號</span>
              <input value={addForm.empId} onChange={e => setAddForm(f => ({ ...f, empId: e.target.value }))} placeholder="例如：E001" />
            </label>
            {addForm.role === 'employee' ? (
              <label style={labelStyle}>
                <span>10 位 PIN 碼（員工登入用）</span>
                <input type="password" inputMode="numeric" maxLength={10}
                  value={addForm.pin}
                  onChange={e => setAddForm(f => ({ ...f, pin: e.target.value.replace(/\D/g,'').slice(0,10) }))}
                  placeholder="輸入 10 位數字" />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{addForm.pin.length} / 10 位</span>
              </label>
            ) : (
              <>
                <label style={labelStyle}>
                  <span>Email</span>
                  <input type="email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} placeholder="admin@example.com" />
                </label>
                <label style={labelStyle}>
                  <span>密碼（至少 6 碼）</span>
                  <input type="password" value={addForm.pin} onChange={e => setAddForm(f => ({ ...f, pin: e.target.value }))} placeholder="••••••••" />
                </label>
              </>
            )}
            <label style={labelStyle}>
              <span>薪資類型</span>
              <select value={addForm.payType} onChange={e => setAddForm(f => ({ ...f, payType: e.target.value }))}>
                <option value="hourly">時薪制</option>
                <option value="monthly">月薪制</option>
              </select>
            </label>
            {addForm.payType === 'hourly'
              ? <label style={labelStyle}><span>時薪（元）</span><input type="number" value={addForm.hourlyRate} onChange={e => setAddForm(f => ({ ...f, hourlyRate: e.target.value }))} /></label>
              : <label style={labelStyle}><span>月薪（元）</span><input type="number" value={addForm.monthlySalary} onChange={e => setAddForm(f => ({ ...f, monthlySalary: e.target.value }))} /></label>
            }
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={addForm.overtimeEnabled} onChange={e => setAddForm(f => ({ ...f, overtimeEnabled: e.target.checked }))} style={{ width: 'auto' }} />
              <span style={{ fontSize: 13 }}>啟用加班費（勞基法：前2h×1.34，之後×1.67）</span>
            </label>
            {addError && (
              <div style={{ background: 'var(--red-glow)', border: '1px solid rgba(239,68,68,0.3)', padding: '10px 14px', borderRadius: 6, color: 'var(--red)', fontSize: 13 }}>
                {addError}
              </div>
            )}
            <button onClick={handleAddEmployee} disabled={addLoading} style={{ padding: 12, background: 'var(--amber)', color: '#000', borderRadius: 8, fontWeight: 700, fontSize: 14 }}>
              {addLoading ? '建立中...' : '建立帳號'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SalaryTab({ summaries, month }) {
  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr><th>員工編號</th><th>姓名</th><th>薪資類型</th><th>費率</th><th>工時</th><th>加班</th><th>請假扣薪</th><th>實發薪資</th><th>薪資單</th></tr>
        </thead>
        <tbody>
          {summaries.length === 0 ? (
            <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>尚無員工資料</td></tr>
          ) : summaries.map(emp => (
            <tr key={emp.id}>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{emp.empId || '--'}</td>
              <td style={{ fontWeight: 500 }}>{emp.name}</td>
              <td><span className={`badge ${emp.payType === 'hourly' ? 'badge-amber' : 'badge-muted'}`}>{emp.payType === 'hourly' ? '時薪制' : '月薪制'}</span></td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{emp.payType === 'hourly' ? `$${emp.hourlyRate}/hr` : `$${(emp.monthlySalary||0).toLocaleString()}/mo`}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{emp.totalHours > 0 ? fmtHours(emp.totalHours) : <span style={{ color: 'var(--text-muted)' }}>0h</span>}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: emp.totalOvertimeHours > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>{emp.totalOvertimeHours > 0 ? fmtHours(emp.totalOvertimeHours) : '--'}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: emp.leaveDeduction > 0 ? 'var(--red)' : 'var(--text-muted)' }}>{emp.leaveDeduction > 0 ? `-${fmtMoney(emp.leaveDeduction)}` : '--'}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, color: emp.netSalary > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>{fmtMoney(emp.netSalary)}</td>
              <td><SalaryReport employee={emp} punches={emp.punches} leaves={emp.leaves} month={month} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordsTab({ punches, employees }) {
  const empMap = Object.fromEntries(employees.map(e => [e.id, e.name]));
  return (
    <div className="table-wrapper">
      <table>
        <thead><tr><th>員工</th><th>類型</th><th>時間</th><th>備註</th></tr></thead>
        <tbody>
          {[...punches].sort((a,b) => b.timestamp?.toMillis() - a.timestamp?.toMillis()).map(p => (
            <tr key={p.id}>
              <td style={{ fontWeight: 500 }}>{empMap[p.uid] || p.userName}</td>
              <td><span className={`badge ${p.type === 'in' ? 'badge-green' : 'badge-red'}`}>{p.type === 'in' ? '▶ 上班' : '⏹ 下班'}</span></td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{p.timestamp?.toDate() ? format(p.timestamp.toDate(), 'MM/dd HH:mm:ss') : '--'}</td>
              <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{p.note || '--'}</td>
            </tr>
          ))}
          {punches.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>本月無打卡紀錄</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function EmployeesTab({ employees, editingEmp, editForm, onEdit, onEditChange, onSave, onCancel }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {employees.length === 0 && <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無員工，點右上角「新增員工」開始建立</div>}
      {employees.map(emp => (
        <div key={emp.id} className="card" style={{ padding: '16px 20px' }}>
          {editingEmp === emp.id ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ ...labelStyle, flex: '1 1 130px' }}><span>姓名</span><input value={editForm.name||''} onChange={e => onEditChange('name', e.target.value)} /></label>
              <label style={{ ...labelStyle, flex: '1 1 110px' }}><span>員工編號</span><input value={editForm.empId||''} onChange={e => onEditChange('empId', e.target.value)} /></label>
              <label style={{ ...labelStyle, flex: '1 1 110px' }}><span>薪資類型</span>
                <select value={editForm.payType||'hourly'} onChange={e => onEditChange('payType', e.target.value)}>
                  <option value="hourly">時薪制</option><option value="monthly">月薪制</option>
                </select>
              </label>
              {editForm.payType === 'hourly'
                ? <label style={{ ...labelStyle, flex: '1 1 100px' }}><span>時薪</span><input type="number" value={editForm.hourlyRate||0} onChange={e => onEditChange('hourlyRate', e.target.value)} /></label>
                : <label style={{ ...labelStyle, flex: '1 1 120px' }}><span>月薪</span><input type="number" value={editForm.monthlySalary||0} onChange={e => onEditChange('monthlySalary', e.target.value)} /></label>
              }
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingBottom: 1 }}>
                <input type="checkbox" checked={!!editForm.overtimeEnabled} onChange={e => onEditChange('overtimeEnabled', e.target.checked)} style={{ width: 'auto' }} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>加班費</span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onSave} style={{ padding: '9px 16px', background: 'var(--green)', color: '#000', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>儲存</button>
                <button onClick={onCancel} style={{ padding: '9px 16px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>取消</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--amber-glow)', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 16, color: 'var(--amber)' }}>
                  {emp.name?.[0]?.toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {emp.name}
                    {emp.overtimeEnabled && <span className="badge badge-amber" style={{ fontSize: 10 }}>加班費</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>編號：{emp.empId || '未設定'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--amber)' }}>{emp.payType === 'hourly' ? `$${emp.hourlyRate}/hr` : `$${(emp.monthlySalary||0).toLocaleString()}/mo`}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{emp.payType === 'hourly' ? '時薪制' : '月薪制'}</div>
                </div>
                <button onClick={() => onEdit(emp)} style={{ padding: '7px 14px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}>編輯</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function WifiSettings() {
  const [networks, setNetworks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [newName, setNewName] = useState('');
  const [currentInfo, setCurrentInfo] = useState(null);

  useEffect(() => {
    async function load() {
      const snap = await getDoc(doc(db, 'settings', 'wifi'));
      if (snap.exists()) setNetworks(snap.data().networks || []);
      setLoading(false);
    }
    load();
  }, []);

  async function detectCurrent() {
    setDetecting(true);
    const info = await getNetworkInfo();
    setCurrentInfo(info);
    setDetecting(false);
  }

  async function addNetwork() {
    if (!newName.trim() || !currentInfo) return;
    const newNet = {
      name: newName.trim(),
      publicIP: currentInfo.publicIP || '',
      localSubnet: currentInfo.localIP ? currentInfo.localIP.split('.').slice(0,3).join('.') : '',
      addedAt: new Date().toISOString(),
    };
    const updated = [...networks, newNet];
    await setDoc(doc(db, 'settings', 'wifi'), { networks: updated });
    setNetworks(updated);
    setNewName('');
    setCurrentInfo(null);
  }

  async function removeNetwork(i) {
    const updated = networks.filter((_, idx) => idx !== i);
    await setDoc(doc(db, 'settings', 'wifi'), { networks: updated });
    setNetworks(updated);
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>新增允許打卡的 WiFi</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
          請在辦公室連上 WiFi 後，點「偵測目前網路」，再填入名稱儲存。
        </div>
        <button onClick={detectCurrent} disabled={detecting} style={{
          width: '100%', padding: '10px', borderRadius: 8, marginBottom: 14,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>
          {detecting ? '偵測中...' : '📡 偵測目前網路'}
        </button>
        {currentInfo && (
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 14px', marginBottom: 14, fontSize: 12, lineHeight: 1.8, fontFamily: 'var(--mono)' }}>
            <div>公共 IP：<span style={{ color: 'var(--amber)' }}>{currentInfo.publicIP || '無法取得'}</span></div>
            <div>本地 IP：<span style={{ color: 'var(--amber)' }}>{currentInfo.localIP || '無法取得'}</span></div>
            <div>子網路：<span style={{ color: 'var(--amber)' }}>{currentInfo.localIP ? currentInfo.localIP.split('.').slice(0,3).join('.')+'.x' : '無法取得'}</span></div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="WiFi 名稱（例如：辦公室）" style={{ flex: 1, fontSize: 13 }} />
          <button onClick={addNetwork} disabled={!newName.trim() || !currentInfo} style={{
            padding: '0 18px', background: 'var(--amber)', color: '#000',
            border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>新增</button>
        </div>
      </div>
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>已允許的 WiFi 網路</div>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>載入中...</div>
        ) : networks.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>
            尚未設定任何允許的 WiFi，員工將無法打卡
          </div>
        ) : networks.map((n, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: i < networks.length-1 ? '1px solid var(--border)' : 'none' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{n.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: 3 }}>
                IP：{n.publicIP || '--'} · 子網路：{n.localSubnet ? n.localSubnet+'.x' : '--'}
              </div>
            </div>
            <button onClick={() => removeNetwork(i)} style={{
              padding: '6px 12px', background: 'var(--red-glow)', border: '1px solid rgba(239,68,68,0.3)',
              color: 'var(--red)', borderRadius: 6, fontSize: 12, cursor: 'pointer',
            }}>刪除</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiCard({ label, value, unit, color, highlight }) {
  return (
    <div className="card" style={highlight ? { background: 'var(--amber-glow)', border: '1px solid rgba(245,158,11,0.25)' } : {}}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</span>
        {unit && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card fade-in" style={{ width: '100%', maxWidth: 460, margin: 20, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '4px 9px', borderRadius: 6 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const labelStyle = {
  display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', color: 'var(--text-muted)', textTransform: 'uppercase',
};
