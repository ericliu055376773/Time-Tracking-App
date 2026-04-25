import React, { useState, useEffect, useCallback } from 'react';
import { useAdminNav } from '../contexts/AdminNavContext';
import {
  collection, query, getDocs, where, orderBy,
  doc, updateDoc, setDoc, getDoc, addDoc, deleteDoc, Timestamp, serverTimestamp
} from 'firebase/firestore';
import { createUserWithEmailAndPassword, updatePassword } from 'firebase/auth';
import { db, auth } from '../firebase';
import { calcSalaryFromPunches, fmtMoney, fmtHours } from '../hooks/useSalaryCalc';
import { getNetworkInfo, isAllowedNetwork } from '../hooks/useNetworkCheck';
import SalaryReport from './SalaryReport';
import LeaveManager from './LeaveManager';
import ShiftManager from './ShiftManager';
import ScheduleManager from './ScheduleManager';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import PositionManager from './PositionManager';
import SalaryRuleManager from './SalaryRuleManager';
import AnnualLeaveManager from './AnnualLeaveManager';
const EMPTY_ADD = {
  name: '', positionId: '', pin: '', email: '',
  role: 'employee', payType: 'hourly',
  hourlyRate: 180, monthlySalary: 30000, mealAllowance: 0, overtimeEnabled: false,
};

export default function AdminDashboard() {
  const [employees, setEmployees] = useState([]);
  const [allPunches, setAllPunches] = useState([]);
  const [allLeaves, setAllLeaves] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [loading, setLoading] = useState(false);
  const { activeTab, setActiveTab, setPendingLeaveCount } = useAdminNav();
  const [queryEmpId, setQueryEmpId] = useState('');
  const [editingEmp, setEditingEmp] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const [positions, setPositions] = useState([]);
  const [showMakePunch, setShowMakePunch] = useState(false);
  const [makePunchForm, setMakePunchForm] = useState({ uid: '', date: '', time: '', type: 'in', shiftId: '', note: '' });
  const [makePunchLoading, setMakePunchLoading] = useState(false);
  const [makePunchError, setMakePunchError] = useState('');

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
      const posSnap = await getDoc(doc(db, 'settings', 'positions'));
      setPositions(posSnap.exists() ? (posSnap.data().list || []) : []);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [selectedMonth]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const posMap2 = Object.fromEntries((positions||[]).map(p => [p.id, p]));
  const salarySummaries = employees.map(emp => {
    const punches = allPunches.filter(p => p.uid === emp.id);
    const leaves  = allLeaves.filter(l => l.uid === emp.id && l.status === 'approved');
    const empWithPos = { ...emp, _position: posMap2[emp.positionId] || null };
    const { totalHours, totalOvertimeHours, totalSalary } = calcSalaryFromPunches(punches, empWithPos);
    const pos2 = posMap2[emp.positionId];
    const baseSal = pos2?.baseSalary ?? emp.monthlySalary ?? 0;
    const mealSal = pos2?.mealAllowance ?? emp.mealAllowance ?? 0;
    const dailyRate = emp.payType === 'hourly' ? (emp.hourlyRate||0)*8 : (baseSal + mealSal)/30;
    const leaveDeduction = leaves.reduce((s,l) => s + dailyRate*l.workdays*(1-(l.payRate??1)), 0);
    return { ...emp, punches, leaves, totalHours, totalOvertimeHours,
      netSalary: Math.max(0, totalSalary - leaveDeduction), leaveDeduction, punchCount: punches.length };
  });

  const totalPayroll = salarySummaries.reduce((s, e) => s + e.netSalary, 0);
  const pendingLeaves = allLeaves.filter(l => l.status === 'pending').length;
  React.useEffect(() => { setPendingLeaveCount(pendingLeaves); }, [pendingLeaves]);

  async function handleAddEmployee() {
    setAddError('');
    if (!addForm.name.trim()) return setAddError('請輸入姓名');
    if (addForm.role === 'employee') {
      if (!/^\d{10}$/.test(addForm.pin)) return setAddError('PIN 碼必須是 10 位數字');
    } else {
      if (!addForm.email.trim()) return setAddError('請輸入管理員 Email');
      if (addForm.pin.length < 6) return setAddError('密碼至少 6 碼');
    }
    setAddLoading(true);
    try {
      const slug = addForm.name.trim().toLowerCase().replace(/\s+/g,'') + Date.now();
      const email = addForm.role === 'employee'
        ? `${slug}@internal.timeclock`
        : addForm.email.trim();
      // Firebase Auth 密碼用固定格式，登入驗證靠 Firestore pin
      const authPassword = `timeclock_${slug}`;
      const cred = await createUserWithEmailAndPassword(auth, email, authPassword);
      await setDoc(doc(db, 'users', cred.user.uid), {
        name: addForm.name.trim(), email,
        pin: addForm.pin,
        authPassword,
        role: addForm.role, payType: addForm.payType,
        positionId: addForm.positionId || '',
        hourlyRate: Number(addForm.hourlyRate), monthlySalary: Number(addForm.monthlySalary), mealAllowance: Number(addForm.mealAllowance||0),
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
        name: editForm.name,
        positionId: editForm.positionId || '',
        payType: editForm.payType, hourlyRate: Number(editForm.hourlyRate),
        hiredAt: (() => {
          if (!editForm.hiredAt) return null;
          try {
            const d = typeof editForm.hiredAt === 'string'
              ? new Date(editForm.hiredAt + 'T00:00:00')
              : editForm.hiredAt?.toDate?.() || null;
            return d && !isNaN(d.getTime()) ? Timestamp.fromDate(d) : null;
          } catch { return null; }
        })(),
      });
      // 修改密碼
      if (editForm.newPassword && editForm.newPassword.length >= 1) {
        // 直接更新 Firestore 的 pin 欄位（登入時用此欄位查詢）
        await updateDoc(doc(db, 'users', editForm.id), { pin: editForm.newPassword });
      }
      setEditingEmp(null);
      await fetchAll();
    } catch (err) { alert('更新失敗：' + err.message); }
  }

  async function handleDeleteEmployee(empId) {
    try {
      await deleteDoc(doc(db, 'users', empId));
      // 同時刪除該員工的打卡紀錄
      const punchSnap = await getDocs(query(collection(db, 'punches'), where('uid', '==', empId)));
      const delPunches = punchSnap.docs.map(d => deleteDoc(doc(db, 'punches', d.id)));
      await Promise.all(delPunches);
      await fetchAll();
    } catch (err) { alert('刪除失敗：' + err.message); }
  }

  async function handleMakePunch() {
    setMakePunchError('');
    const { uid, date, time, type, shiftId, note } = makePunchForm;
    if (!uid) return setMakePunchError('請選擇員工');
    if (!date) return setMakePunchError('請選擇日期');
    if (!time) return setMakePunchError('請輸入時間');
    setMakePunchLoading(true);
    try {
      const emp = employees.find(e => e.id === uid);
      const dt = new Date(`${date}T${time}:00`);
      await addDoc(collection(db, 'punches'), {
        uid,
        userName: emp?.name || '',
        type,
        timestamp: Timestamp.fromDate(dt),
        date,
        note: note.trim() || '管理員補打卡',
        shiftId: shiftId.trim(),
        session: 1,
        lateMinutes: 0,
        overtimeMinutes: 0,
        networkName: '管理員補打',
        publicIP: '',
        isMakeup: true,
      });
      setShowMakePunch(false);
      setMakePunchForm({ uid: '', date: '', time: '', type: 'in', shiftId: '', note: '' });
      await fetchAll();
    } catch (err) {
      setMakePunchError('補打失敗：' + err.message);
    }
    setMakePunchLoading(false);
  }

  return (
    <div style={{ padding: '32px 40px' }} className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>管理後台</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>薪資結算 · 請假審核 · 員工管理</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ width: 155, fontSize: 13 }} />
          <button onClick={() => { setMakePunchForm({ uid: '', date: '', time: '', type: 'in', shiftId: '', note: '' }); setMakePunchError(''); setShowMakePunch(true); }} style={{ padding: '9px 16px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
            🕐 補打卡
          </button>
          <button onClick={() => setShowAddModal(true)} style={{ padding: '9px 16px', background: 'var(--amber)', color: '#ffffff', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
            + 新增員工
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: pendingLeaves > 0 ? 16 : 28 }}>
        <KpiCard label="員工人數" value={employees.length} unit="人" />
        <KpiCard label="本月打卡次數" value={allPunches.length} unit="次" color="var(--blue)" />
        <KpiCard label="待審假單" value={pendingLeaves} unit="筆" color={pendingLeaves > 0 ? 'var(--red)' : 'var(--text-muted)'} />
        <KpiCard label="本月應付薪資" value={fmtMoney(totalPayroll)} color="var(--amber)" highlight />
      </div>

      {/* 通知卡片 */}
      {pendingLeaves > 0 && (
        <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 2 }}>🔔 待處理通知</div>
          <button
            onClick={() => setActiveTab('請假審核')}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, width: '100%',
              padding: '14px 18px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.06)'}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
            }}>📋</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 2 }}>
                有 {pendingLeaves} 筆請假單待審核
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                點擊前往請假審核 →
              </div>
            </div>
            <div style={{
              background: 'var(--red)', color: '#fff', borderRadius: 999,
              fontSize: 13, fontWeight: 700, padding: '3px 12px', flexShrink: 0,
            }}>{pendingLeaves}</div>
          </button>
        </div>
      )}



      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>載入中...</div>
      ) : activeTab === '薪資結算' ? (
        <SalaryTab summaries={salarySummaries} month={selectedMonth} positions={positions} />
      ) : activeTab === '打卡紀錄' ? (
        <RecordsTab punches={allPunches} employees={employees} />
      ) : activeTab === '員工查詢' ? (
        <EmpQueryTab employees={employees} allPunches={allPunches} allLeaves={allLeaves} selectedMonth={selectedMonth} queryEmpId={queryEmpId} setQueryEmpId={setQueryEmpId} positions={positions} />
      ) : activeTab === '請假審核' ? (
        <LeaveManager isAdmin={true} />
) : activeTab === 'WiFi 設定' ? (
  <WifiSettings />
) : activeTab === '職位薪資' ? (
  <PositionManager />
) : activeTab === '班別設定' ? (
  <ShiftManager />
      ) : activeTab === '系統設定' ? (
        <SystemSettings />
      ) : activeTab === '月薪算法' ? (
        <SalaryRuleManager />
      ) : activeTab === '排班管理' ? (
        <ScheduleManager />
      ) : activeTab === '特休天數' ? (
        <AnnualLeaveManager subTab="特休天數" />
      ) : activeTab === '未休補償' ? (
        <AnnualLeaveManager subTab="未休補償" />
      ) : (
        <EmployeesTab
          employees={employees}
          editingEmp={editingEmp} editForm={editForm}
          onEdit={emp => { setEditingEmp(emp.id); setEditForm({ ...emp }); }}
          onEditChange={(k, v) => setEditForm(f => ({ ...f, [k]: v }))}
          onSave={handleUpdateEmployee}
          onCancel={() => setEditingEmp(null)}
          onDelete={handleDeleteEmployee}
          positions={positions}
        />
      )}

      {showMakePunch && (
        <Modal title="🕐 補打卡" onClose={() => setShowMakePunch(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={labelStyle}>
              <span>員工</span>
              <select value={makePunchForm.uid} onChange={e => setMakePunchForm(f => ({ ...f, uid: e.target.value }))}>
                <option value="">— 請選擇員工 —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <label style={labelStyle}>
              <span>打卡類型</span>
              <select value={makePunchForm.type} onChange={e => setMakePunchForm(f => ({ ...f, type: e.target.value }))}>
                <option value="in">▶ 上班打卡</option>
                <option value="out">⏹ 下班打卡</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 12 }}>
              <label style={{ ...labelStyle, flex: 1 }}>
                <span>日期</span>
                <input type="date" value={makePunchForm.date} onChange={e => setMakePunchForm(f => ({ ...f, date: e.target.value }))} />
              </label>
              <label style={{ ...labelStyle, flex: 1 }}>
                <span>時間</span>
                <input type="time" value={makePunchForm.time} onChange={e => setMakePunchForm(f => ({ ...f, time: e.target.value }))} />
              </label>
            </div>
            <label style={labelStyle}>
              <span>班別代號（選填，例如：F）</span>
              <input value={makePunchForm.shiftId} onChange={e => setMakePunchForm(f => ({ ...f, shiftId: e.target.value }))} placeholder="例如：F、A、Z" />
            </label>
            <label style={labelStyle}>
              <span>備註</span>
              <input value={makePunchForm.note} onChange={e => setMakePunchForm(f => ({ ...f, note: e.target.value }))} placeholder="例如：忘記打卡，管理員補登" />
            </label>
            {makePunchError && (
              <div style={{ background: 'var(--red-glow)', border: '1px solid rgba(239,68,68,0.3)', padding: '10px 14px', borderRadius: 6, color: 'var(--red)', fontSize: 13 }}>
                {makePunchError}
              </div>
            )}
            <button onClick={handleMakePunch} disabled={makePunchLoading} style={{ padding: 12, background: 'var(--amber)', color: '#ffffff', borderRadius: 8, fontWeight: 700, fontSize: 14 }}>
              {makePunchLoading ? '補打中...' : '確認補打卡'}
            </button>
          </div>
        </Modal>
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
              <span>職位</span>
              <select value={addForm.positionId||''} onChange={e => setAddForm(f => ({ ...f, positionId: e.target.value }))}>
                <option value="">— 未設定 —</option>
                {positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
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
              : <><label style={labelStyle}><span>月薪（元）</span><input type="number" value={addForm.monthlySalary} onChange={e => setAddForm(f => ({ ...f, monthlySalary: e.target.value }))} /></label><label style={labelStyle}><span>月餐費（元）</span><input type="number" value={addForm.mealAllowance||0} onChange={e => setAddForm(f => ({ ...f, mealAllowance: e.target.value }))} /></label></>
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
            <button onClick={handleAddEmployee} disabled={addLoading} style={{ padding: 12, background: 'var(--amber)', color: '#ffffff', borderRadius: 8, fontWeight: 700, fontSize: 14 }}>
              {addLoading ? '建立中...' : '建立帳號'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SalaryTab({ summaries, month, positions }) {
  const posMap = Object.fromEntries((positions||[]).map(p => [p.id, p]));
  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr><th>姓名</th><th>職位</th><th>薪資類型</th><th>費率</th><th>工時</th><th>加班</th><th>請假扣薪</th><th>實發薪資</th><th>薪資單</th></tr>
        </thead>
        <tbody>
          {summaries.length === 0 ? (
            <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>尚無員工資料</td></tr>
          ) : summaries.map(emp => (
            <tr key={emp.id}>
              <td style={{ fontWeight: 500 }}>{emp.name}</td>
              <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{emp.positionId ? (posMap[emp.positionId]?.name || '--') : '--'}</td>
              <td><span className={`badge ${emp.payType === 'hourly' ? 'badge-amber' : 'badge-muted'}`}>{emp.payType === 'hourly' ? '時薪制' : '月薪制'}</span></td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{emp.payType === 'hourly' ? `$${emp.hourlyRate}/hr` : `$${(posMap[emp.positionId]?.baseSalary ?? emp.monthlySalary ?? 0).toLocaleString()}/mo`}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{emp.totalHours > 0 ? fmtHours(emp.totalHours) : <span style={{ color: 'var(--text-muted)' }}>0h</span>}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: emp.totalOvertimeHours > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>{emp.totalOvertimeHours > 0 ? fmtHours(emp.totalOvertimeHours) : '--'}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: emp.leaveDeduction > 0 ? 'var(--red)' : 'var(--text-muted)' }}>{emp.leaveDeduction > 0 ? `-${fmtMoney(emp.leaveDeduction)}` : '--'}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, color: emp.netSalary > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>{fmtMoney(emp.netSalary)}</td>
              <td><SalaryReport employee={{ ...emp, _position: posMap[emp.positionId] || null }} punches={emp.punches} leaves={emp.leaves} month={month} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordsTab({ punches, employees }) {
  const [filterUid, setFilterUid] = React.useState('');
  const [schedule, setSchedule] = React.useState({});
  const [shifts, setShifts] = React.useState([]);

  React.useEffect(() => {
    async function loadSchedule() {
      try {
        const [schedSnap, shiftSnap] = await Promise.all([
          getDoc(doc(db, 'settings', 'schedule')),
          getDoc(doc(db, 'settings', 'shifts')),
        ]);
        setSchedule(schedSnap.exists() ? schedSnap.data().assignments || {} : {});
        setShifts(shiftSnap.exists() ? shiftSnap.data().list || [] : []);
      } catch {}
    }
    loadSchedule();
  }, []);

  const empMap = Object.fromEntries(employees.map(e => [e.id, e.name]));
  const filtered = filterUid ? punches.filter(p => p.uid === filterUid) : punches;
  const sorted = [...filtered].sort((a,b) => b.timestamp?.toMillis() - a.timestamp?.toMillis());

  // 方案二：計算未打卡員工（過去7天有排班但無打卡）
  const missedPunches = React.useMemo(() => {
    const results = [];
    const today = new Date();
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = format(d, 'yyyy-MM-dd');
      employees.forEach(emp => {
        const key = `${emp.id}_${dateStr}`;
        const assignment = schedule[key];
        if (!assignment) return;
        const hasShift = (typeof assignment === 'string' && assignment) ||
          (assignment.shift1 || assignment.shift2);
        if (!hasShift) return;
        const hasPunch = punches.some(p => p.uid === emp.id && p.date === dateStr);
        if (!hasPunch) {
          results.push({ empId: emp.id, empName: emp.name, date: dateStr, assignment });
        }
      });
    }
    return results;
  }, [employees, schedule, punches]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* 方案二：未打卡警示 */}
      {missedPunches.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '14px 18px' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--red)', marginBottom: 10 }}>
            ⚠️ 近7天有排班但未打卡（共 {missedPunches.length} 筆）
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {missedPunches.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '6px 10px', background: 'var(--bg-base)', borderRadius: 6 }}>
                <span style={{ fontWeight: 600 }}>{m.empName}</span>
                <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{m.date}</span>
                <span style={{ color: 'var(--red)', fontSize: 11 }}>未打卡・失去全勤</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 員工篩選 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>篩選員工：</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => setFilterUid('')} style={{
            padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: filterUid === '' ? 700 : 400,
            background: filterUid === '' ? 'var(--amber)' : 'var(--bg-elevated)',
            color: filterUid === '' ? '#fff' : 'var(--text-secondary)',
            border: filterUid === '' ? 'none' : '1px solid var(--border)', cursor: 'pointer',
          }}>全部員工</button>
          {employees.map(e => (
            <button key={e.id} onClick={() => setFilterUid(e.id)} style={{
              padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: filterUid === e.id ? 700 : 400,
              background: filterUid === e.id ? 'var(--amber)' : 'var(--bg-elevated)',
              color: filterUid === e.id ? '#fff' : 'var(--text-secondary)',
              border: filterUid === e.id ? 'none' : '1px solid var(--border)', cursor: 'pointer',
            }}>{e.name}</button>
          ))}
        </div>
        {filterUid && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            共 {sorted.length} 筆
          </span>
        )}
      </div>

      <div className="table-wrapper">
        <table>
          <thead><tr><th>員工</th><th>類型</th><th>時間</th><th>狀態</th><th>備註</th></tr></thead>
          <tbody>
            {sorted.map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 500 }}>{empMap[p.uid] || p.userName}</td>
                <td><span className={`badge ${p.type === 'in' ? 'badge-green' : 'badge-red'}`}>{p.type === 'in' ? '▶ 上班' : '⏹ 下班'}</span></td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{p.timestamp?.toDate() ? format(p.timestamp.toDate(), 'MM/dd HH:mm:ss') : '--'}</td>
                <td style={{ fontSize: 12 }}>
                  {p.type === 'in' && p.lateMinutes > 0
                    ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>遲到 {p.lateMinutes} 分鐘</span>
                    : p.type === 'in'
                    ? <span style={{ color: 'var(--green)' }}>準時</span>
                    : p.overtimeMinutes > 0
                    ? <span style={{ color: 'var(--amber)' }}>加班 {p.overtimeMinutes} 分鐘</span>
                    : '--'}
                  {p.isMakeup && <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 4 }}>補打</span>}
                </td>
                <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{p.note || '--'}</td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>本月無打卡紀錄</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function calcAnnualLeave(months) {
  if (months < 6) return 0;
  if (months < 12) return 3;
  if (months < 24) return 7;
  if (months < 36) return 10;
  if (months < 60) return 14;
  if (months < 120) return 15;
  return Math.min(15 + Math.floor(months / 12) - 10, 30);
}

function EmployeesTab({ employees, editingEmp, editForm, onEdit, onEditChange, onSave, onCancel, onDelete, positions }) {
  const [deleteConfirm, setDeleteConfirm] = React.useState(null);
  const posMap = Object.fromEntries((positions||[]).map(p => [p.id, p]));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {employees.length === 0 && <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>尚無員工，點右上角「新增員工」開始建立</div>}
      {employees.map(emp => {
        const empPos = posMap[emp.positionId];
        // 計算年資和特休
        const hired = emp.hiredAt?.toDate ? emp.hiredAt.toDate() : null;
        const months = hired ? Math.floor((Date.now() - hired.getTime()) / (1000*60*60*24*30.44)) : null;
        const annualDays = months !== null ? calcAnnualLeave(months) : null;
        // 編輯時 hiredAt 格式
        const hiredStr = editForm.hiredAt
          ? (typeof editForm.hiredAt === 'string' ? editForm.hiredAt : editForm.hiredAt?.toDate?.().toISOString().slice(0,10))
          : '';

        return (
          <div key={emp.id} className="card" style={{ padding: '16px 20px' }}>
            {editingEmp === emp.id ? (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {/* 姓名 */}
                <label style={{ ...labelStyle, flex: '1 1 130px' }}><span>姓名</span>
                  <input value={editForm.name||''} onChange={e => onEditChange('name', e.target.value)} />
                </label>
                {/* 新密碼 */}
                <label style={{ ...labelStyle, flex: '1 1 160px' }}><span>新密碼（10位數字或英文）</span>
                  <input type="text" maxLength={10} value={editForm.newPassword||''} onChange={e => { const v = e.target.value.split('').filter(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')).join('').slice(0,10); onEditChange('newPassword', v); }} placeholder="輸入最多10碼" />
                </label>
                {/* 職位 */}
                <label style={{ ...labelStyle, flex: '1 1 150px' }}><span>職位</span>
                  <select value={editForm.positionId||''} onChange={e => onEditChange('positionId', e.target.value)}>
                    <option value="">— 未設定 —</option>
                    {(positions||[]).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                {/* 薪資類型 */}
                <label style={{ ...labelStyle, flex: '1 1 110px' }}><span>薪資類型</span>
                  <select value={editForm.payType||'hourly'} onChange={e => onEditChange('payType', e.target.value)}>
                    <option value="hourly">時薪制</option>
                    <option value="monthly">月薪制</option>
                  </select>
                </label>
                {/* 時薪（時薪制才顯示） */}
                {editForm.payType === 'hourly' && (
                  <label style={{ ...labelStyle, flex: '1 1 100px' }}><span>時薪（元）</span>
                    <input type="number" value={editForm.hourlyRate||0} onChange={e => onEditChange('hourlyRate', e.target.value)} />
                  </label>
                )}
                {/* 月薪制：顯示職位薪資（唯讀） */}
                {editForm.payType === 'monthly' && (
                  <div style={{ flex: '1 1 200px', padding: '8px 12px', background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
                    <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontSize: 11, fontWeight: 700 }}>薪資（依職位自動同步）</div>
                    {posMap[editForm.positionId] ? (
                      <>
                        <div>底薪：<span style={{ color: 'var(--amber)' }}>${(posMap[editForm.positionId].baseSalary||0).toLocaleString()}</span></div>
                        <div>餐費：<span style={{ color: 'var(--amber)' }}>${(posMap[editForm.positionId].mealAllowance||0).toLocaleString()}</span></div>
                        <div>全勤：<span style={{ color: 'var(--green)' }}>${(posMap[editForm.positionId].fullAttendanceBonus||0).toLocaleString()}</span></div>
                      </>
                    ) : <div style={{ color: 'var(--text-muted)' }}>請先選擇職位</div>}
                  </div>
                )}
                {/* 到職日 */}
                <label style={{ ...labelStyle, flex: '1 1 150px' }}><span>到職日</span>
                  <input type="date" value={hiredStr} onChange={e => onEditChange('hiredAt', e.target.value)} />
                </label>
                {/* 儲存/取消 */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={onSave} style={{ padding: '9px 16px', background: 'var(--green)', color: '#ffffff', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>儲存</button>
                  <button onClick={onCancel} style={{ padding: '9px 16px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>取消</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: empPos ? empPos.color+'22' : 'var(--amber-glow)', border: `1px solid ${empPos ? empPos.color+'44' : 'rgba(245,158,11,0.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 16, color: empPos ? empPos.color : 'var(--amber)' }}>
                    {emp.name?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{emp.name}</div>
                    <div style={{ fontSize: 11, color: empPos ? empPos.color : 'var(--text-muted)', marginTop: 1 }}>
                      {empPos ? empPos.name : '未設定職位'} · {emp.payType === 'hourly' ? `時薪 $${emp.hourlyRate}/hr` : '月薪制'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                      {hired ? `到職：${hired.toLocaleDateString('zh-TW')}` : '未設定到職日'}
                      {annualDays !== null && <span style={{ marginLeft: 8, color: 'var(--green)' }}>🌴 特休 {annualDays} 天</span>}
                    </div>
                    {emp.pin && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, fontFamily: 'var(--mono)' }}>
                        PIN：<span style={{ color: 'var(--text-primary)', letterSpacing: '0.1em', fontFamily: 'var(--mono)' }}>{emp.pin}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {empPos && emp.payType === 'monthly' && (
                    <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
                      <div>底薪 <span style={{ color: 'var(--amber)', fontFamily: 'var(--mono)' }}>${(empPos.baseSalary||0).toLocaleString()}</span></div>
                      <div>餐費 <span style={{ color: 'var(--amber)', fontFamily: 'var(--mono)' }}>${(empPos.mealAllowance||0).toLocaleString()}</span></div>
                    </div>
                  )}
                  <button onClick={() => onEdit(emp)} style={{ padding: '7px 14px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}>編輯</button>
                  <button onClick={() => setDeleteConfirm(emp)} style={{ padding: '7px 14px', background: 'var(--red-glow)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, fontSize: 12 }}>刪除</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {/* 刪除確認 Modal */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="card fade-in" style={{ width: '90%', maxWidth: 360, padding: 28 }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: 12, background: 'var(--red-glow)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 22 }}>🗑</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>確認刪除員工？</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                「<span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{deleteConfirm.name}</span>」的帳號將被永久刪除，此操作無法復原。
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: '11px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>取消</button>
              <button onClick={() => { onDelete(deleteConfirm.id); setDeleteConfirm(null); }} style={{ flex: 1, padding: '11px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>確認刪除</button>
            </div>
          </div>
        </div>
      )}
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
            <div>子網路：<span style={{ color: 'var(--amber)' }}>{currentInfo.localIP ? `${currentInfo.localIP.split('.').slice(0,3).join('.')}.x` : '無法取得'}</span></div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="WiFi 名稱（例如：辦公室）" style={{ flex: 1, fontSize: 13 }} />
          <button onClick={addNetwork} disabled={!newName.trim() || !currentInfo} style={{
            padding: '0 18px', background: 'var(--amber)', color: '#ffffff',
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
                IP：{n.publicIP || '--'} · 子網路：{n.localSubnet ? `${n.localSubnet}.x` : '--'}
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

// ── 員工查詢 Tab ─────────────────────────────────────────────
function EmpQueryTab({ employees, allPunches, allLeaves, selectedMonth, queryEmpId, setQueryEmpId, positions }) {
  const posMap = Object.fromEntries((positions||[]).map(p => [p.id, p]));
  const emp = employees.find(e => e.id === queryEmpId);
  const punches = allPunches.filter(p => p.uid === queryEmpId);
  const leaves = allLeaves.filter(l => l.uid === queryEmpId && l.status === 'approved');
  const empWithPos2 = emp ? { ...emp, _position: posMap[emp.positionId] || null } : null;
  const { dailyRecords, totalHours, totalOvertimeHours, totalSalary, salaryBreakdown } = queryEmpId
    ? calcSalaryFromPunches(punches, empWithPos2, leaves)
    : { dailyRecords: [], totalHours: 0, totalOvertimeHours: 0, totalSalary: 0, salaryBreakdown: null };

  const leaveDeduction = emp?.payType === 'hourly'
    ? leaves.reduce((s,l) => s + (emp.hourlyRate||0)*8*l.workdays*(1-(l.payRate??1)), 0)
    : 0;
  const netSalary = Math.max(0, totalSalary - leaveDeduction);
  const attendedDays = dailyRecords.filter(r => r.inTime).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 選擇員工 */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, letterSpacing: '0.08em' }}>選擇員工</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {employees.map(e => {
            const pos = posMap[e.positionId];
            const active = queryEmpId === e.id;
            return (
              <button key={e.id} onClick={() => setQueryEmpId(e.id)} style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: active ? 600 : 400,
                background: active ? 'var(--amber)' : 'var(--bg-elevated)',
                color: active ? '#fff' : 'var(--text-secondary)',
                border: active ? 'none' : '1px solid var(--border)', cursor: 'pointer',
              }}>
                {e.name}
                {pos && <span style={{ fontSize: 10, marginLeft: 6, opacity: 0.7 }}>({pos.name})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {!emp ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>請選擇員工查看詳情</div>
      ) : (
        <>
          {/* 出勤概覽 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { label: '出勤天數', value: `${attendedDays} 天`, color: 'var(--green)' },
              { label: '工作時數', value: fmtHours(totalHours), color: 'var(--text-primary)' },
              { label: '加班時數', value: totalOvertimeHours > 0 ? fmtHours(totalOvertimeHours) : '--', color: 'var(--amber)' },
              { label: '預估薪資', value: fmtMoney(netSalary), color: 'var(--amber)' },
            ].map(item => (
              <div key={item.label} className="card" style={{ padding: '14px 16px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 6 }}>{item.label}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 600, color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* 薪資計算方式 */}
          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 14, letterSpacing: '0.08em' }}>薪資計算方式</div>
            {emp.payType === 'monthly' && salaryBreakdown ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {[
                  { label: '底薪', sub: `$${(emp.monthlySalary||0).toLocaleString()} ÷ 30 × ${salaryBreakdown.attendedDays} 天`, value: fmtMoney(salaryBreakdown.basePay) },
                  { label: '餐費', sub: `$${(emp.mealAllowance||0).toLocaleString()} ÷ 30 × ${salaryBreakdown.attendedDays} 天`, value: fmtMoney(salaryBreakdown.mealPay) },
                  { label: `全勤獎金 ${salaryBreakdown.hasFullAttendance ? '✓' : '✗'}`, sub: salaryBreakdown.hasFullAttendance ? '達成全勤條件' : [salaryBreakdown.hasLate&&'有遲到', salaryBreakdown.hasLeave&&'有請假', salaryBreakdown.hasMissedPunch&&'有忘打卡'].filter(Boolean).join('、'), value: fmtMoney(salaryBreakdown.fullAttendancePay), dim: !salaryBreakdown.hasFullAttendance },
                  { label: '紅利', sub: '月底另行計算', value: '—', dim: true },
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', opacity: item.dim && item.value === '—' ? 0.45 : 1 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{item.label}</div>
                      {item.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.sub}</div>}
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600 }}>{item.value}</div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0 0' }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>實領薪資（不含紅利）</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: 'var(--amber)' }}>{fmtMoney(netSalary)}</div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                時薪制：${emp.hourlyRate}/hr × {totalHours.toFixed(1)}h = <strong style={{ color: 'var(--amber)' }}>{fmtMoney(netSalary)}</strong>
              </div>
            )}
          </div>

          {/* 打卡紀錄 */}
          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 14, letterSpacing: '0.08em' }}>打卡紀錄 — {selectedMonth}</div>
            {dailyRecords.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>本月尚無打卡紀錄</div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>日期</th><th>班別</th><th>上班</th><th>下班</th><th>狀態</th><th>工時</th></tr></thead>
                  <tbody>
                    {dailyRecords.map(r => (
                      <tr key={r.date}>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{r.date}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--amber)', fontWeight: 700 }}>{r.shiftId || '--'}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--green)' }}>{r.inTime || '--'}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--red)' }}>{r.outTime || '--'}</td>
                        <td style={{ fontSize: 11 }}>
                          {r.lateMinutes > 0
                            ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>遲到 {r.lateMinutes}分</span>
                            : r.inTime ? <span style={{ color: 'var(--green)' }}>準時</span> : '--'}
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{r.hours > 0 ? fmtHours(r.hours) : '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── 系統設定 ─────────────────────────────────────────────────
function SystemSettings() {
  const [appName, setAppNameState] = React.useState('TIMECLOCK');
  const [saved, setSaved] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    getDoc(doc(db, 'settings', 'general')).then(snap => {
      if (snap.exists() && snap.data().appName) setAppNameState(snap.data().appName);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    try {
      await setDoc(doc(db, 'settings', 'general'), { appName: appName.trim() || 'TIMECLOCK' }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { alert('儲存失敗：' + err.message); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>載入中...</div>;

  return (
    <div style={{ maxWidth: 500 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>⚙️ 系統設定</div>

      <div className="card" style={{ padding: '20px 24px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>系統名稱</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
          顯示在登入頁和側邊導航欄頂部
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            value={appName}
            onChange={e => setAppNameState(e.target.value)}
            placeholder="TIMECLOCK"
            maxLength={20}
            style={{
              flex: 1, padding: '10px 14px',
              border: '1px solid var(--border)', borderRadius: 8,
              fontSize: 15, fontWeight: 700, letterSpacing: '0.08em',
              background: 'var(--bg-surface)', color: 'var(--text-primary)', outline: 'none',
            }}
          />
          <button onClick={handleSave} style={{
            padding: '10px 20px', background: 'var(--amber)', color: '#fff',
            borderRadius: 8, fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer',
          }}>儲存</button>
        </div>
        {saved && <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 8 }}>✓ 已儲存，重新整理後生效</div>}
      </div>
    </div>
  );
}
