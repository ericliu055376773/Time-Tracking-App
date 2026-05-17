import React, { useState, useEffect, useCallback } from 'react';
import { useAdminNav } from '../contexts/AdminNavContext';
import {
  collection, query, getDocs, where, orderBy,
  doc, updateDoc, setDoc, getDoc, addDoc, deleteDoc, Timestamp, serverTimestamp
} from 'firebase/firestore';
import { createUserWithEmailAndPassword, updatePassword } from 'firebase/auth';
import { db, auth, firebaseConfig } from '../firebase';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { calcSalaryFromPunches, fmtMoney, fmtHours } from '../hooks/useSalaryCalc';
import { fetchTaiwanHolidaysForMonth } from '../utils/fetchHolidays';
import { getNetworkInfo, isAllowedNetwork } from '../hooks/useNetworkCheck';
import SalaryReport from './SalaryReport';
import LeaveManager from './LeaveManager';
import ShiftManager from './ShiftManager';
import ScheduleManager from './ScheduleManager';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import PositionManager from './PositionManager';
import SalaryRuleManager from './SalaryRuleManager';
import PunchSettings from './PunchSettings';
import BatchPunchGenerator from './BatchPunchGenerator';
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
  const [scheduleAssignments, setScheduleAssignments] = useState({});
  const [salaryRules, setSalaryRules] = useState({});
  const [punchSettings, setPunchSettings] = useState({});
  const [showBatchGen, setShowBatchGen] = useState(false);
  const [monthSnapshots, setMonthSnapshots] = useState({}); // empId → snapshot
  const [bonuses, setBonuses] = useState({}); // empId → amount for selected month
  const [nationalHolidays, setNationalHolidays] = useState([]); // 當月國定假日日期陣列
  const [showBonusPanel, setShowBonusPanel] = useState(false);
  const [bonusInput, setBonusInput] = useState({}); // editing state

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
      // ✅ 取得排班資料，用於全勤驗證
      const schedSnap = await getDoc(doc(db, 'settings', 'schedule'));
      setScheduleAssignments(schedSnap.exists() ? (schedSnap.data().assignments || {}) : {});
      const rulesSnap = await getDoc(doc(db, 'settings', 'salaryRules'));
      setSalaryRules(rulesSnap.exists() ? rulesSnap.data() : {});
      const punchSnap = await getDoc(doc(db, 'settings', 'punchSettings'));
      setPunchSettings(punchSnap.exists() ? punchSnap.data() : {});
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [selectedMonth]);

  // 載入當月薪資快照
  const fetchSnapshots = useCallback(async () => {
    try {
      const snap = await getDocs(query(collection(db, 'salarySnapshots'), where('month', '==', selectedMonth)));
      const map = {};
      snap.docs.forEach(d => { map[d.data().empId] = d.data(); });
      setMonthSnapshots(map);
      // 同時載入紅利
      const bSnap = await getDocs(query(collection(db, 'bonuses'), where('month', '==', selectedMonth)));
      // 載入當月國定假日 + 雙薪開關設定
      try {
        let holidays = await fetchTaiwanHolidaysForMonth(selectedMonth);
        if (holidays.length === 0) {
          const hdSnap = await getDoc(doc(db, 'settings', `holidays_${selectedMonth}`));
          holidays = hdSnap.exists() ? (hdSnap.data().dates || []) : [];
        } else {
          await setDoc(doc(db, 'settings', `holidays_${selectedMonth}`), { month: selectedMonth, dates: holidays });
        }
        // 讀取雙薪開關（停用的假日不計雙薪）
        const paySnap = await getDoc(doc(db, 'settings', `holidayPaySettings_${selectedMonth}`));
        const disabledDates = paySnap.exists() ? (paySnap.data().disabledDates || []) : [];
        const enabledHolidays = holidays.filter(d => !disabledDates.includes(d));
        setNationalHolidays(enabledHolidays);
      } catch { setNationalHolidays([]); }
      const bMap = {};
      bSnap.docs.forEach(d => { bMap[d.data().empId] = d.data().amount ?? 0; });
      setBonuses(bMap);
    } catch (err) { console.error('fetchSnapshots error:', err); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  useEffect(() => { fetchSnapshots(); }, [fetchSnapshots]);

  // 結算本月：把所有員工薪資快照儲存到 Firestore
  async function handleSettleMonth() {
    const now = new Date();
    const [sy, sm] = selectedMonth.split('-').map(Number);
    const isCurrentMonth = now.getFullYear() === sy && (now.getMonth() + 1) === sm;
    if (!isCurrentMonth) {
      if (!window.confirm(`確定重新結算 ${selectedMonth}？這會覆蓋已儲存的快照。`)) return;
    } else {
      if (!window.confirm(`確定結算 ${selectedMonth}？\n結算後薪資明細將鎖定，回查時不會因為調薪而變動。`)) return;
    }
    try {
      const posMap2 = Object.fromEntries((positions||[]).map(p => [p.id, p]));
      for (const emp of salarySummaries) {
        const pos = posMap2[emp.positionId];
        const docId = `${emp.id}_${selectedMonth}`;
        const bonusAmount = bonuses[emp.id] ?? 0;
        await setDoc(doc(db, 'salarySnapshots', docId), {
          empId: emp.id,
          empName: emp.name,
          month: selectedMonth,
          lockedAt: Timestamp.now(),
          positionName: pos?.name || '--',
          payType: emp.payType,
          baseSalary: pos?.baseSalary ?? emp.monthlySalary ?? 0,
          mealAllowance: pos?.mealAllowance ?? emp.mealAllowance ?? 0,
          hourlyRate: emp.hourlyRate || 0,
          totalHours: emp.totalHours || 0,
          totalOvertimeHours: emp.totalOvertimeHours || 0,
          netSalary: emp.netSalary || 0,
          leaveDeduction: emp.leaveDeduction || 0,
          bonus: bonusAmount,
          totalWithBonus: (emp.netSalary || 0) + bonusAmount,
          ...(emp.salaryBreakdown ? {
            attendedDays: emp.salaryBreakdown.attendedDays,
            basePay: emp.salaryBreakdown.basePay,
            mealPay: emp.salaryBreakdown.mealPay,
            personalDeduction: emp.salaryBreakdown.personalDeduction,
            sickDeduction: emp.salaryBreakdown.sickDeduction,
            overtimePay: emp.salaryBreakdown.overtimePay,
            fullAttendancePay: emp.salaryBreakdown.fullAttendancePay,
            hasFullAttendance: emp.salaryBreakdown.hasFullAttendance,
            hasLate: emp.salaryBreakdown.hasLate,
            hasLeave: emp.salaryBreakdown.hasLeave,
            hasMissedPunch: emp.salaryBreakdown.hasMissedPunch,
            workingDaysBase: emp.salaryBreakdown.workingDaysBase,
            personalLeaveDays: emp.salaryBreakdown.personalLeaveDays,
            sickLeaveDays: emp.salaryBreakdown.sickLeaveDays,
            impliedHourlyRate: emp.salaryBreakdown.impliedHourlyRate,
            totalOtMins: emp.salaryBreakdown.totalOtMins,
            totalOt1Mins: emp.salaryBreakdown.totalOt1Mins,
            totalOt2Mins: emp.salaryBreakdown.totalOt2Mins,
          } : {}),
        });
      }
      alert(`✅ ${selectedMonth} 結算完成！共 ${salarySummaries.length} 位員工薪資已鎖定。`);
      await fetchSnapshots();
    } catch (err) { alert('結算失敗：' + err.message); }
  }

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const posMap2 = Object.fromEntries((positions||[]).map(p => [p.id, p]));
  const salarySummaries = employees.map(emp => {
    const punches = allPunches.filter(p => p.uid === emp.id);
    const leaves  = allLeaves.filter(l => l.uid === emp.id && l.status === 'approved');
    const empWithPos = { ...emp, _position: posMap2[emp.positionId] || null };
    const { totalHours, totalOvertimeHours, totalSalary } = calcSalaryFromPunches(punches, empWithPos, [], scheduleAssignments, selectedMonth, punchSettings.maxMissedPunchForFullAtt ?? 0, salaryRules, nationalHolidays, punchSettings.lateGraceMinutes ?? 5);
    const pos2 = posMap2[emp.positionId];
    const baseSal = pos2?.baseSalary ?? emp.monthlySalary ?? 0;
    const mealSal = pos2?.mealAllowance ?? emp.mealAllowance ?? 0;
    const dailyRate = emp.payType === 'hourly' ? (emp.hourlyRate||0)*8 : (baseSal + mealSal)/30;
    // ✅ 月薪制：totalSalary 已包含扣款，不重複扣；時薪制依 payRate 扣
    // l.workdays ?? l.days 防止舊資料欄位不一致造成 NaN
    const leaveDeduction = emp.payType === 'hourly'
      ? leaves.reduce((s, l) => s + dailyRate * (l.workdays ?? l.days ?? 1) * (1 - (l.payRate ?? 1)), 0)
      : 0; // 月薪制扣款已在 calcSalaryFromPunches 內計算
    return { ...emp, punches, leaves, totalHours, totalOvertimeHours,
      netSalary: Math.max(0, totalSalary - leaveDeduction), leaveDeduction, punchCount: punches.length };
  });

  const totalPayroll = salarySummaries.reduce((s, e) => s + e.netSalary, 0);
  const pendingLeaves = allLeaves.filter(l => l.status === 'pending').length;
  React.useEffect(() => { setPendingLeaveCount(pendingLeaves); }, [pendingLeaves]);
  // 未填到職日的員工
  const noHiredAtEmps = employees.filter(e => !e.hiredAt);
  // 待審特休
  const pendingAnnual = allLeaves.filter(l => l.status === 'pending' && l.type === '特休').length;
  // 待審一般請假（非特休）
  const pendingOther = allLeaves.filter(l => l.status === 'pending' && l.type !== '特休').length;

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
      // 決定最終 pin：有新密碼就用新的，沒有就保留原本的
      const finalPin = (editForm.newPassword && editForm.newPassword.length >= 1)
        ? editForm.newPassword
        : editForm.pin || '';

      // ✅ Bug Fix: 驗證 PIN 必須是 10 位純數字，防止員工登入輸入框無法打出英文 PIN
      if (editForm.newPassword && editForm.newPassword.length >= 1) {
        if (!/^\d{10}$/.test(finalPin)) {
          alert('PIN 碼必須是 10 位純數字');
          return;
        }
      }

      const updateData = {
        name: editForm.name,
        positionId: editForm.positionId || '',
        payType: editForm.payType,
        hourlyRate: Number(editForm.hourlyRate),
        pin: finalPin,   // 永遠明確儲存 pin
      };

      // ✅ Bug Fix: 舊帳號遷移 — 如果 Firestore 沒有 authPassword 欄位，
      // 代表這是舊帳號（Firebase Auth 密碼 = 原始 PIN）。
      // 在 PIN 被覆蓋之前，先把舊 PIN 存進 authPassword，
      // 之後登入流程就能用 authPassword 去比對 Firebase Auth，永遠不會斷。
      if (!editForm.authPassword && editForm.pin) {
        updateData.authPassword = String(editForm.pin);
      }

      await updateDoc(doc(db, 'users', editForm.id), {
        ...updateData,
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

  // ✅ 修復已損壞的帳號（Firebase Auth 密碼與 Firestore PIN 不同步）
  // 使用次要 Firebase App 建立新 Auth 帳號，保留打卡紀錄，管理員 session 不中斷
  async function handleRepairAccount(emp) {
    if (!window.confirm(`確定修復「${emp.name}」的帳號？\n修復後此員工可用目前的 PIN（${emp.pin}）正常登入。`)) return;
    try {
      // 1. 取得或建立次要 Firebase App（避免把管理員登出）
      const secondaryApp = getApps().find(a => a.name === 'secondary')
        || initializeApp(firebaseConfig, 'secondary');
      const secondaryAuth = getAuth(secondaryApp);

      // 2. 用次要 App 建立新的 Firebase Auth 帳號
      const newEmail = `repaired_${emp.empId.toLowerCase()}_${Date.now()}@internal.timeclock`;
      const newAuthPassword = `timeclock_repaired_${emp.empId.toLowerCase()}`;
      const newCred = await createUserWithEmailAndPassword(secondaryAuth, newEmail, newAuthPassword);
      const newUid = newCred.user.uid;
      await secondaryAuth.signOut(); // 次要 App 登出，不影響主 auth

      // 3. 把 Firestore 使用者文件複製到新 UID
      const { id: _oldId, ...empData } = emp;
      await setDoc(doc(db, 'users', newUid), {
        ...empData,
        email: newEmail,
        authPassword: newAuthPassword,
      });

      // 4. 把所有打卡紀錄的 uid 更新成新 UID（保留歷史資料）
      const punchSnap = await getDocs(query(collection(db, 'punches'), where('uid', '==', emp.id)));
      const migrations = punchSnap.docs.map(d => updateDoc(doc(db, 'punches', d.id), { uid: newUid }));
      await Promise.all(migrations);

      // 5. 刪除舊的 Firestore 使用者文件（舊 Firebase Auth 帳號留著無妨，只是孤兒）
      await deleteDoc(doc(db, 'users', emp.id));

      alert(`✅ 修復完成！\n「${emp.name}」現在可以用 PIN ${emp.pin} 正常登入。\n共遷移 ${punchSnap.docs.length} 筆打卡紀錄。`);
      await fetchAll();
    } catch (err) {
      alert('修復失敗：' + err.message);
    }
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
    <div style={{ padding: '20px 24px', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }} className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>管理後台</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>薪資結算 · 請假審核 · 員工管理</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ width: 155, fontSize: 13 }} />
          <button onClick={() => setShowBatchGen(true)} style={{ padding: '9px 16px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
            🤖 模擬打卡
          </button>
          <button onClick={() => { setMakePunchForm({ uid: '', date: '', time: '', type: 'in', shiftId: '', note: '' }); setMakePunchError(''); setShowMakePunch(true); }} style={{ padding: '9px 16px', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
            🕐 補打卡
          </button>
          <button onClick={() => setShowAddModal(true)} style={{ padding: '9px 16px', background: 'var(--amber)', color: '#ffffff', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
            + 新增員工
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: (pendingLeaves > 0 || noHiredAtEmps.length > 0) ? 16 : 28 }}>
        <KpiCard label="員工人數" value={employees.length} unit="人" />
        <KpiCard label="本月打卡次數" value={allPunches.length} unit="次" color="var(--blue)" />
        <KpiCard label="待審假單" value={pendingLeaves} unit="筆" color={pendingLeaves > 0 ? 'var(--red)' : 'var(--text-muted)'} />
        <KpiCard label="本月應付薪資" value={fmtMoney(totalPayroll)} color="var(--amber)" highlight />
      </div>

      {/* 通知卡片 */}
      {(pendingLeaves > 0 || noHiredAtEmps.length > 0) && (
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 8 }}>🔔 待處理通知</div>
      )}

      {/* 待審特休 */}
      {pendingAnnual > 0 && (
        <div style={{ marginBottom: 10 }}>
          <button
            onClick={() => setActiveTab('請假審核')}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, width: '100%',
              padding: '14px 18px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.3)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(34,197,94,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(34,197,94,0.06)'}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
            }}>🌴</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 2 }}>
                有 {pendingAnnual} 筆特休申請待審核
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                點擊前往請假審核 →
              </div>
            </div>
            <div style={{
              background: 'var(--green)', color: '#fff', borderRadius: 999,
              fontSize: 13, fontWeight: 700, padding: '3px 12px', flexShrink: 0,
            }}>{pendingAnnual}</div>
          </button>
        </div>
      )}

      {/* 待審一般請假 */}
      {pendingOther > 0 && (
        <div style={{ marginBottom: 10 }}>
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
                有 {pendingOther} 筆請假單待審核
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                點擊前往請假審核 →
              </div>
            </div>
            <div style={{
              background: 'var(--red)', color: '#fff', borderRadius: 999,
              fontSize: 13, fontWeight: 700, padding: '3px 12px', flexShrink: 0,
            }}>{pendingOther}</div>
          </button>
        </div>
      )}

      {/* 未填到職日通知 */}
      {noHiredAtEmps.length > 0 && (
        <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>

          <button
            onClick={() => setActiveTab('員工管理')}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, width: '100%',
              padding: '14px 18px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.3)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(245,158,11,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(245,158,11,0.06)'}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
            }}>📅</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 2 }}>
                {noHiredAtEmps.length} 位員工尚未設定到職日
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {noHiredAtEmps.map(e => e.name).join('、')} · 點擊前往員工管理設定 →
              </div>
            </div>
            <div style={{
              background: 'var(--amber)', color: '#fff', borderRadius: 999,
              fontSize: 13, fontWeight: 700, padding: '3px 12px', flexShrink: 0,
            }}>{noHiredAtEmps.length}</div>
          </button>
        </div>
      )}

      {/* 結算日紅利提醒通知 */}
      {(() => {
        const today = new Date();
        const settlementDay = salaryRules.settlementDay ?? 31;
        if (settlementDay === 0) return null;
        if (today.getDate() < settlementDay) return null;
        const monthlyEmps = employees.filter(e => e.payType === 'monthly' || e.payType !== 'hourly');
        const missingBonus = monthlyEmps.filter(e => bonuses[e.id] == null);
        if (missingBonus.length === 0) return null;
        return (
          <div
            onClick={() => { setBonusInput(Object.fromEntries(monthlyEmps.map(e => [e.id, bonuses[e.id] ?? '']))); setShowBonusPanel(true); }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 12, cursor: 'pointer', margin: '0 0 8px 0' }}>
            <div style={{ fontSize: 24, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(245,158,11,0.15)', borderRadius: 8 }}>💰</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)' }}>今天是薪資結算日（每月 {settlementDay} 號），以下員工紅利尚未填寫</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{missingBonus.map(e => e.name).join('、')} · 點擊填寫 →</div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, background: 'var(--amber)', color: '#fff', borderRadius: 20, padding: '3px 10px' }}>{missingBonus.length}</div>
          </div>
        );
      })()}

      {/* 紅利填寫面板 */}
      {showBonusPanel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 480, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>💰 填寫紅利 — {selectedMonth}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>填寫後會自動儲存，結算時納入薪資</div>
              </div>
              <button onClick={() => setShowBonusPanel(false)} style={{ background: 'transparent', border: 'none', fontSize: 20, color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
            </div>
            {employees.filter(e => e.payType !== 'hourly').map(emp => (
              <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{emp.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{bonuses[emp.id] != null ? `已填 $${bonuses[emp.id].toLocaleString()}` : '尚未填寫'}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>$</span>
                  <input
                    type="number" min={0} placeholder="0"
                    value={bonusInput[emp.id] ?? ''}
                    onChange={e => setBonusInput(prev => ({ ...prev, [emp.id]: e.target.value }))}
                    style={{ width: 100, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, textAlign: 'right' }}
                  />
                </div>
              </div>
            ))}
            <button
              onClick={async () => {
                try {
                  for (const emp of employees.filter(e => e.payType !== 'hourly')) {
                    const amount = Number(bonusInput[emp.id] ?? 0);
                    await setDoc(doc(db, 'bonuses', `${emp.id}_${selectedMonth}`), {
                      empId: emp.id, empName: emp.name, month: selectedMonth, amount,
                    });
                  }
                  alert('✅ 紅利已儲存！');
                  setShowBonusPanel(false);
                  await fetchSnapshots();
                } catch (err) { alert('儲存失敗：' + err.message); }
              }}
              style={{ padding: '12px 24px', borderRadius: 9, fontWeight: 700, fontSize: 14, background: 'var(--amber)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >儲存所有紅利</button>
          </div>
        </div>
      )}

      <div style={{ width: '100%' }}>
        {loading && <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 12 }}>載入中...</div>}
        {!loading && (() => {
          switch(activeTab) {
            case '薪資結算': return <SalaryTab summaries={salarySummaries} month={selectedMonth} positions={positions} scheduleAssignments={scheduleAssignments} maxMissedPunch={punchSettings.maxMissedPunchForFullAtt ?? 0} salaryRules={salaryRules} monthSnapshots={monthSnapshots} onSettle={handleSettleMonth} nationalHolidays={nationalHolidays} lateGraceMinutes={punchSettings.lateGraceMinutes ?? 5} />;
            case '打卡紀錄': return <RecordsTab punches={allPunches} employees={employees} />;
            case '員工查詢': return <EmpQueryTab employees={employees} allPunches={allPunches} allLeaves={allLeaves} selectedMonth={selectedMonth} queryEmpId={queryEmpId} setQueryEmpId={setQueryEmpId} positions={positions} scheduleAssignments={scheduleAssignments} maxMissedPunch={punchSettings.maxMissedPunchForFullAtt ?? 0} salaryRules={salaryRules} fetchAll={fetchAll} nationalHolidays={nationalHolidays} lateGraceMinutes={punchSettings.lateGraceMinutes ?? 5} />;
            case '請假審核': return <LeaveManager isAdmin={true} />;
            case 'WiFi 設定': return <WifiSettings />;
            case '職位薪資': return <PositionManager />;
            case '班別設定': return <ShiftManager />;
            case '一般設定': return <SystemSettings />;
            case '打卡設定': return <PunchSettings onSaved={fetchAll} />;
            case '月薪算法': return <SalaryRuleManager />;
            case '排班管理': return <ScheduleManager />;
            case '特休天數': return <AnnualLeaveManager subTab="特休天數" />;
            case '未休補償': return <AnnualLeaveManager subTab="未休補償" />;
            case '員工管理':
            case '員工薪資': return <EmployeesTab employees={employees} editingEmp={editingEmp} editForm={editForm} onEdit={emp => { setEditingEmp(emp.id); setEditForm({ ...emp }); }} onEditChange={(k, v) => setEditForm(f => ({ ...f, [k]: v }))} onSave={handleUpdateEmployee} onCancel={() => setEditingEmp(null)} onDelete={handleDeleteEmployee} onRepair={handleRepairAccount} positions={positions} />;
            default: return null;
          }
        })()}
      </div>

      {showBatchGen && (
        <BatchPunchGenerator
          employees={employees}
          onClose={() => { setShowBatchGen(false); fetchAll(); }}
          onDone={() => fetchAll()}
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

function SalaryTab({ summaries, month, positions, scheduleAssignments, maxMissedPunch = 0, salaryRules = {}, monthSnapshots = {}, onSettle, nationalHolidays = [], lateGraceMinutes = 5 }) {
  const posMap = Object.fromEntries((positions||[]).map(p => [p.id, p]));
  const isSettled = Object.keys(monthSnapshots).length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 結算列 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 4px' }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {isSettled
            ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>🔒 {month} 已結算 — 以下為鎖定快照，不受後續調薪影響</span>
            : <span style={{ color: 'var(--text-muted)' }}>尚未結算 — 目前顯示即時計算結果</span>}
        </div>
        <button onClick={onSettle} style={{
          padding: '8px 20px', borderRadius: 8, fontWeight: 700, fontSize: 13,
          background: isSettled ? 'var(--bg-elevated)' : 'var(--amber)',
          color: isSettled ? 'var(--text-secondary)' : '#fff',
          border: isSettled ? '1px solid var(--border)' : 'none', cursor: 'pointer',
        }}>
          {isSettled ? '🔄 重新結算' : '💾 結算本月'}
        </button>
      </div>

      <div className="table-wrapper">
        <table style={{ minWidth: 800 }}>
          <thead>
            <tr><th>姓名</th><th>職位</th><th>薪資類型</th><th>費率</th><th>工時</th><th>加班</th><th>請假扣薪</th><th>實發薪資</th><th>薪資單</th></tr>
          </thead>
          <tbody>
            {summaries.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>尚無員工資料</td></tr>
            ) : summaries.map(emp => {
              const snap = monthSnapshots[emp.id];
              const netSalary = snap ? snap.netSalary : emp.netSalary;
              const totalHours = snap ? snap.totalHours : emp.totalHours;
              const totalOvertimeHours = snap ? snap.totalOvertimeHours : emp.totalOvertimeHours;
              const leaveDeduction = snap ? snap.leaveDeduction : emp.leaveDeduction;
              return (
                <tr key={emp.id} style={{ background: snap ? 'rgba(34,197,94,0.03)' : 'transparent' }}>
                  <td style={{ fontWeight: 600 }}>
                    {emp.name}
                    {snap && <span style={{ fontSize: 9, color: 'var(--green)', marginLeft: 4, fontWeight: 400 }}>🔒</span>}
                  </td>
                  <td>{emp.positionId ? (snap?.positionName || posMap[emp.positionId]?.name || '--') : '--'}</td>
                  <td><span className={`badge ${emp.payType === 'hourly' ? 'badge-amber' : 'badge-muted'}`}>{emp.payType === 'hourly' ? '時薪制' : '月薪制'}</span></td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{emp.payType === 'hourly' ? `$${emp.hourlyRate}/hr` : `$${(snap?.baseSalary ?? posMap[emp.positionId]?.baseSalary ?? emp.monthlySalary ?? 0).toLocaleString()}/mo`}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{totalHours > 0 ? fmtHours(totalHours) : '--'}</td>
                  <td style={{ fontFamily: 'var(--mono)', color: totalOvertimeHours > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>{totalOvertimeHours > 0 ? fmtHours(totalOvertimeHours) : '--'}</td>
                  <td style={{ fontFamily: 'var(--mono)', color: leaveDeduction > 0 ? 'var(--red)' : 'var(--text-muted)' }}>{leaveDeduction > 0 ? `-${fmtMoney(leaveDeduction)}` : '--'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: netSalary > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>{fmtMoney(netSalary)}</td>
                  <td><SalaryReport employee={{ ...emp, _position: posMap[emp.positionId] || null }} punches={emp.punches} leaves={emp.leaves} month={month} scheduleAssignments={scheduleAssignments} maxMissedPunch={maxMissedPunch} salaryRules={salaryRules} snapshot={snap || null} nationalHolidays={nationalHolidays} lateGraceMinutes={lateGraceMinutes} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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

function EmployeesTab({ employees, editingEmp, editForm, onEdit, onEditChange, onSave, onCancel, onDelete, onRepair, positions }) {
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
                {/* 目前 PIN + 新密碼 */}
                <div style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                    目前 PIN：<span style={{ color: 'var(--text-primary)', fontFamily: 'var(--mono)', letterSpacing: '0.12em' }}>{editForm.pin || '（未設定）'}</span>
                  </div>
                  <label style={{ ...labelStyle }}><span>更改 PIN（留空=不變）</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={10}
                      value={editForm.newPassword||''}
                      onChange={e => {
                        // ✅ Bug Fix: 只允許數字，與員工登入輸入框保持一致
                        const v = e.target.value.replace(/\D/g, '').slice(0, 10);
                        onEditChange('newPassword', v);
                      }}
                      placeholder="輸入 10 位純數字"
                    />
                    {editForm.newPassword
                      ? <span style={{ fontSize: 11, color: (editForm.newPassword.length === 10) ? 'var(--green)' : 'var(--red)', marginTop: 2 }}>
                          {editForm.newPassword.length} / 10 位{editForm.newPassword.length === 10 ? ' ✓' : '（需滿 10 位）'}
                        </span>
                      : null
                    }
                  </label>
                </div>
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
                  {/* ✅ 修復按鈕：只對沒有 authPassword 的損壞帳號顯示 */}
                  {!emp.authPassword && emp.pin && (
                    <button onClick={() => onRepair(emp)} style={{ padding: '7px 14px', background: 'rgba(245,158,11,0.15)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                      ⚠️ 修復帳號
                    </button>
                  )}
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
            <div>公共 IP：<span style={{ color: currentInfo.publicIP ? 'var(--green)' : 'var(--red)' }}>{currentInfo.publicIP || '無法取得'}</span></div>
            <div>本地 IP：<span style={{ color: currentInfo.localIP ? 'var(--amber)' : 'var(--text-muted)' }}>{currentInfo.localIP || '瀏覽器安全限制，無法取得'}</span></div>
            <div>子網路：<span style={{ color: currentInfo.localIP ? 'var(--amber)' : 'var(--text-muted)' }}>{currentInfo.localIP ? `${currentInfo.localIP.split('.').slice(0,3).join('.')}.x` : '——'}</span></div>
            {!currentInfo.localIP && currentInfo.publicIP && (
              <div style={{ marginTop: 6, color: 'var(--green)', fontSize: 11 }}>✓ 將改用公共 IP（{currentInfo.publicIP}）進行 WiFi 驗證</div>
            )}
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

// ── 全勤次數（自動從結算快照統計）──────────────────────────────
function SnapCount({ uid }) {
  const [count, setCount] = React.useState(null);
  React.useEffect(() => {
    if (!uid) { setCount(0); return; }
    getDocs(query(collection(db, 'salarySnapshots'), where('empId', '==', uid)))
      .then(s => setCount(s.docs.filter(d => d.data().hasFullAttendance === true).length))
      .catch(() => setCount(0));
  }, [uid]);
  return (
    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: (count || 0) > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>
      {count === null ? '…' : `${count} 次`}
    </div>
  );
}

// ── 員工查詢 Tab ─────────────────────────────────────────────
function EmpQueryTab({ employees, allPunches, allLeaves, selectedMonth, queryEmpId, setQueryEmpId, positions, scheduleAssignments, maxMissedPunch = 0, salaryRules = {}, fetchAll = () => {}, nationalHolidays = [], lateGraceMinutes = 5 }) {
  const posMap = Object.fromEntries((positions||[]).map(p => [p.id, p]));
  const emp = employees.find(e => e.id === queryEmpId);
  const punches = allPunches.filter(p => p.uid === queryEmpId);
  const leaves = allLeaves.filter(l => l.uid === queryEmpId && l.status === 'approved');
  const empWithPos2 = emp ? { ...emp, _position: posMap[emp.positionId] || null } : null;
  const { dailyRecords, totalHours, totalOvertimeHours, totalSalary, salaryBreakdown } = queryEmpId
    ? calcSalaryFromPunches(punches, empWithPos2, leaves, scheduleAssignments, selectedMonth, maxMissedPunch, salaryRules, nationalHolidays, lateGraceMinutes)
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
          {(() => {
            // 年資計算
            const hired = emp.hiredAt?.toDate ? emp.hiredAt.toDate() : (emp.hiredAt ? new Date(emp.hiredAt) : null);
            const now = new Date();
            const totalMonths = hired ? Math.floor((now - hired) / (1000*60*60*24*30.44)) : null;
            const years = totalMonths !== null ? Math.floor(totalMonths / 12) : null;
            const remMonths = totalMonths !== null ? totalMonths % 12 : null;
            const tenureStr = totalMonths === null ? '未設定到職日'
              : years > 0 ? `${years} 年 ${remMonths} 個月`
              : `${totalMonths} 個月`;

            // 特休計算
            const annualTotal = totalMonths !== null ? calcAnnualLeave(totalMonths) : 0;
            const usedAnnual = allLeaves
              .filter(l => l.uid === queryEmpId && l.status === 'approved' && l.type === '特休')
              .reduce((s, l) => s + (l.workdays ?? l.days ?? 1), 0);
            const remainAnnual = Math.max(0, annualTotal - usedAnnual);

            const cards = [
              { label: '出勤天數', value: `${attendedDays} 天`, color: 'var(--green)' },
              { label: '工作時數', value: fmtHours(totalHours), color: 'var(--text-primary)' },
              { label: '加班時數', value: totalOvertimeHours > 0 ? fmtHours(totalOvertimeHours) : '--', color: 'var(--amber)' },
              { label: '預估薪資', value: fmtMoney(netSalary), color: 'var(--amber)' },
            ];

            return (
              <>
                {/* 年資 + 特休卡片 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ fontSize: 28 }}>🗓️</div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>年資</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--mono)' }}>{tenureStr}</div>
                      {hired && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>到職：{hired.toISOString().slice(0,10)}</div>}
                    </div>
                  </div>
                  <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ fontSize: 28 }}>🌴</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>特休剩餘</div>
                      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: remainAnnual > 0 ? 'var(--green)' : 'var(--text-muted)' }}>
                        {annualTotal > 0 ? `${remainAnnual} 天` : '未達資格'}
                      </div>
                      {annualTotal > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                          共 {annualTotal} 天 · 已用 {usedAnnual} 天
                        </div>
                      )}
                    </div>
                  </div>
                  {/* 全勤次數 */}
                  <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ fontSize: 28 }}>🏆</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>全勤次數</div>
                      <SnapCount uid={queryEmpId} />
                      <div style={{ fontSize: 11, color: salaryBreakdown?.hasFullAttendance ? 'var(--green)' : 'var(--text-muted)', marginTop: 3 }}>
                        {salaryBreakdown?.hasFullAttendance ? '✓ 本月條件達成（月底結算後自動計入）' : '本月尚未達成'}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            );
          })()}

          {/* 薪資單列印 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
            <SalaryReport
              employee={{ ...emp, _position: posMap[emp.positionId] || null }}
              punches={allPunches.filter(p => p.uid === queryEmpId)}
              leaves={allLeaves.filter(l => l.uid === queryEmpId)}
              month={selectedMonth}
              scheduleAssignments={scheduleAssignments}
              maxMissedPunch={maxMissedPunch}
              salaryRules={salaryRules}
              nationalHolidays={nationalHolidays}
              lateGraceMinutes={lateGraceMinutes}
            />
          </div>

        </>
      )}
    </div>
  );
}

// ── 系統設定 ─────────────────────────────────────────────────
// SrRow 獨立元件（不可定義在 SystemSettings 內部，否則違反 React Hooks 規則）
function SrRow({ label, icon, fieldKey, unit, min = 0, max = 60, desc, rules, edit, setEdit, onSave }) {
  const [tmp, setTmp] = React.useState(String(rules[fieldKey] ?? ''));
  const editing = edit[fieldKey];
  React.useEffect(() => { setTmp(String(rules[fieldKey] ?? '')); }, [rules[fieldKey]]);
  return (
    <div className="card" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{icon} {label}</div>
          {desc && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>{desc}</div>}
        </div>
        <button onClick={() => setEdit(e => ({ ...e, [fieldKey]: !e[fieldKey] }))}
          style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
            background: editing ? 'var(--amber)' : 'var(--bg-elevated)',
            color: editing ? '#fff' : 'var(--text-secondary)',
            border: '1px solid var(--border)', cursor: 'pointer' }}>
          {editing ? '完成' : '✏️ 編輯'}
        </button>
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        {editing ? (
          <>
            <input type="text" inputMode="numeric" value={tmp}
              onChange={e => setTmp(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={() => { const n = Math.max(min, Math.min(max, Number(tmp))); onSave(fieldKey, n); }}
              style={{ width: 80, padding: '7px 10px', border: '1px solid var(--amber)', borderRadius: 8,
                background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, textAlign: 'center', outline: 'none' }} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{unit}</span>
          </>
        ) : (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            {rules[fieldKey] ?? '-'} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)' }}>{unit}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function SystemSettings() {
  const [appName, setAppNameState] = React.useState('TIMECLOCK');
  const [logoUrl, setLogoUrl] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const [logoSaved, setLogoSaved] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const fileRef = React.useRef(null);

  // 薪資相關設定
  const [srRules, setSrRules] = React.useState({ salaryRevealDay: 30, punchCutoffMinutes: 30, settlementDay: 31, monthlyRestDays: 8 });
  const [srSaved, setSrSaved] = React.useState(false);
  const [srEdit, setSrEdit] = React.useState({});
  const [psRules, setPsRules] = React.useState({ earlyClockInMinutes: 15, lateGraceMinutes: 5 });
  const [psEdit, setPsEdit] = React.useState({});

  React.useEffect(() => {
    Promise.all([
      getDoc(doc(db, 'settings', 'general')),
      getDoc(doc(db, 'settings', 'salaryRules')),
      getDoc(doc(db, 'settings', 'punchSettings')),
    ]).then(([gSnap, srSnap, psSnap]) => {
      if (gSnap.exists()) {
        if (gSnap.data().appName) setAppNameState(gSnap.data().appName);
        if (gSnap.data().logoUrl) setLogoUrl(gSnap.data().logoUrl);
      }
      if (srSnap.exists()) setSrRules(r => ({ ...r, ...srSnap.data() }));
      if (psSnap.exists()) setPsRules(r => ({ ...r, ...psSnap.data() }));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function saveSrRule(key, val) {
    await setDoc(doc(db, 'settings', 'salaryRules'), { [key]: val }, { merge: true });
    setSrRules(r => ({ ...r, [key]: val }));
    setSrEdit(e => ({ ...e, [key]: false }));
    setSrSaved(true);
    setTimeout(() => setSrSaved(false), 2000);
  }

  async function savePsRule(key, val) {
    await setDoc(doc(db, 'settings', 'punchSettings'), { [key]: val }, { merge: true });
    setPsRules(r => ({ ...r, [key]: val }));
    setPsEdit(e => ({ ...e, [key]: false }));
    setSrSaved(true);
    setTimeout(() => setSrSaved(false), 2000);
  }

  async function handleSave() {
    try {
      await setDoc(doc(db, 'settings', 'general'), { appName: appName.trim() || 'TIMECLOCK' }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { alert('儲存失敗：' + err.message); }
  }

  function handleLogoFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 200 * 1024) { alert('圖片請小於 200KB'); return; }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      setLogoUrl(dataUrl);
      try {
        await setDoc(doc(db, 'settings', 'general'), { logoUrl: dataUrl }, { merge: true });
        setLogoSaved(true);
        setTimeout(() => setLogoSaved(false), 3000);
      } catch (err) { alert('上傳失敗：' + err.message); }
    };
    reader.readAsDataURL(file);
  }

  async function handleRemoveLogo() {
    setLogoUrl('');
    await setDoc(doc(db, 'settings', 'general'), { logoUrl: '' }, { merge: true });
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>載入中...</div>;

  return (
    <div style={{ maxWidth: 500, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>⚙️ 系統設定</div>

      {/* 系統名稱 */}
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

      {/* 薪資相關設定 */}
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8, color: 'var(--text-secondary)' }}>薪資與打卡設定</div>
      <SrRow label="薪資明細開放日" icon="📅" fieldKey="salaryRevealDay" unit="號（含）之後員工可查看薪資明細" min={1} max={31}
        desc="員工可以在每月幾號之後查看自己的薪資明細" rules={srRules} edit={srEdit} setEdit={setSrEdit} onSave={saveSrRule} />
      <SrRow label="上班打卡截止時間" icon="⏰" fieldKey="punchCutoffMinutes" unit="分鐘（0 = 不鎖定）" min={0} max={120}
        desc="上班時間過後幾分鐘內未打卡則鎖定，需管理員補打" rules={srRules} edit={srEdit} setEdit={setSrEdit} onSave={saveSrRule} />
      <SrRow label="薪資結算日" icon="💰" fieldKey="settlementDay" unit="號（0 = 不提醒）" min={0} max={31}
        desc="每月幾號後台首頁提醒管理員填寫紅利" rules={srRules} edit={srEdit} setEdit={setSrEdit} onSave={saveSrRule} />
      <SrRow label="每月休假天數" icon="🌙" fieldKey="monthlyRestDays" unit="天" min={0} max={20}
        desc={`月休 ${srRules.monthlyRestDays ?? 8} 天 → 工作天數 ${30 - (srRules.monthlyRestDays ?? 8)} 天 → 日薪基準 ÷ ${30 - (srRules.monthlyRestDays ?? 8)}`} rules={srRules} edit={srEdit} setEdit={setSrEdit} onSave={saveSrRule} />
      {/* 打卡提前時間（讀寫 punchSettings） */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>🕐 提前打卡時間</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>員工可以在上下班時間幾分鐘前打卡</div>
          </div>
          <button onClick={() => setPsEdit(e => ({ ...e, early: !e.early }))}
            style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
              background: psEdit.early ? 'var(--amber)' : 'var(--bg-elevated)',
              color: psEdit.early ? '#fff' : 'var(--text-secondary)',
              border: '1px solid var(--border)', cursor: 'pointer' }}>
            {psEdit.early ? '完成' : '✏️ 編輯'}
          </button>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          {psEdit.early ? (
            <input type="text" inputMode="numeric"
              defaultValue={psRules.earlyClockInMinutes ?? 15}
              onBlur={e => savePsRule('earlyClockInMinutes', Math.max(0, Math.min(60, Number(e.target.value.replace(/[^0-9]/g,'')))))}
              style={{ width: 80, padding: '7px 10px', border: '1px solid var(--amber)', borderRadius: 8,
                background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, textAlign: 'center', outline: 'none' }} />
          ) : (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              {psRules.earlyClockInMinutes ?? 15} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)' }}>分鐘前可打卡</span>
            </span>
          )}
        </div>
      </div>
      {/* 遲到寬限分鐘 */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>⏱️ 遲到寬限時間</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>遲到幾分鐘以內不扣薪，0 = 遲到即扣</div>
          </div>
          <button onClick={() => setPsEdit(e => ({ ...e, grace: !e.grace }))}
            style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
              background: psEdit.grace ? 'var(--amber)' : 'var(--bg-elevated)',
              color: psEdit.grace ? '#fff' : 'var(--text-secondary)',
              border: '1px solid var(--border)', cursor: 'pointer' }}>
            {psEdit.grace ? '完成' : '✏️ 編輯'}
          </button>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          {psEdit.grace ? (
            <input type="text" inputMode="numeric"
              defaultValue={psRules.lateGraceMinutes ?? 5}
              onBlur={e => savePsRule('lateGraceMinutes', Math.max(0, Math.min(60, Number(e.target.value.replace(/[^0-9]/g,'')))))}
              style={{ width: 80, padding: '7px 10px', border: '1px solid var(--amber)', borderRadius: 8,
                background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, textAlign: 'center', outline: 'none' }} />
          ) : (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              {psRules.lateGraceMinutes ?? 5} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)' }}>分鐘內遲到不扣薪</span>
            </span>
          )}
        </div>
      </div>
      {srSaved && <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>✓ 已儲存</div>}

      {/* Logo 圖片 */}
      <div className="card" style={{ padding: '20px 24px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>登入頁 Logo 圖片</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
          上傳後取代登入頁的時鐘圖示，建議使用正方形圖片，大小不超過 200KB
        </div>

        {/* 預覽 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 16,
            border: '2px dashed var(--border)',
            background: 'var(--bg-surface)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', flexShrink: 0,
          }}>
            {logoUrl
              ? <img src={logoUrl} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: 28 }}>🏷️</span>
            }
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                padding: '8px 18px', background: 'var(--amber)', color: '#fff',
                borderRadius: 7, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
              }}
            >
              {logoUrl ? '更換圖片' : '上傳圖片'}
            </button>
            {logoUrl && (
              <button
                onClick={handleRemoveLogo}
                style={{
                  padding: '8px 18px', background: 'var(--bg-elevated)', color: 'var(--red)',
                  borderRadius: 7, fontSize: 12, fontWeight: 600,
                  border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer',
                }}
              >移除圖片</button>
            )}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleLogoFile}
        />
        {logoSaved && <div style={{ fontSize: 12, color: 'var(--green)' }}>✓ Logo 已儲存，重新整理後生效</div>}
      </div>
    </div>
  );
}
