import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, addDoc, deleteDoc, query, where, orderBy, getDocs,
  serverTimestamp, Timestamp, doc, getDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { calcSalaryFromPunches, fmtMoney, fmtHours } from '../hooks/useSalaryCalc';
import { getNetworkInfo, isAllowedNetwork } from '../hooks/useNetworkCheck';
import LeaveManager from './LeaveManager';
import { format, startOfMonth, endOfMonth, parseISO, isToday } from 'date-fns';
import { useNav } from '../contexts/NavContext';
import { zhTW } from 'date-fns/locale';

const TABS = ['打卡', '請假'];

export default function EmployeeDashboard() {
  const { user, profile } = useAuth();
  const navCtx = useNav();
  const activePage = navCtx?.activePage || 'punch';
  const setActivePage = navCtx?.setActivePage || (() => {});
  const [now, setNow] = useState(new Date());
  const [punches, setPunches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [punchLoading, setPunchLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [note, setNote] = useState('');
  const [activeTab, setActiveTab] = useState('打卡');
  const [networkInfo, setNetworkInfo] = useState({ publicIP: null, localIP: null });
  const [networkStatus, setNetworkStatus] = useState({ checking: true, allowed: false, reason: '', matchedNetwork: '' });
  const [todayShifts, setTodayShifts] = useState({ shift1: null, shift2: null });
  const [shiftWarning, setShiftWarning] = useState('');
  const [salaryRevealDay, setSalaryRevealDay] = useState(30);
  const [punchCutoffMinutes, setPunchCutoffMinutes] = useState(30);
  const [confirmPunch, setConfirmPunch] = useState(null); // { type, label, time, lateMin, validation }

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    async function checkNetwork() {
      setNetworkStatus(s => ({ ...s, checking: true }));
      try {
        const info = await getNetworkInfo();
        setNetworkInfo(info);
        const settingDoc = await getDoc(doc(db, 'settings', 'wifi'));
        const allowedNetworks = settingDoc.exists() ? (settingDoc.data().networks || []) : [];
        const result = isAllowedNetwork(info.publicIP, info.localIP, allowedNetworks);
        setNetworkStatus({ checking: false, ...result });
      } catch {
        setNetworkStatus({ checking: false, allowed: false, reason: '網路偵測失敗，請重試' });
      }
    }
    checkNetwork();
  }, []);

  useEffect(() => {
    async function loadSalarySettings() {
      try {
        const snap = await getDoc(doc(db, 'settings', 'salaryRules'));
        if (snap.exists()) {
          if (snap.data().salaryRevealDay) setSalaryRevealDay(snap.data().salaryRevealDay);
          if (snap.data().punchCutoffMinutes !== undefined) setPunchCutoffMinutes(snap.data().punchCutoffMinutes);
        }
      } catch {}
    }
    loadSalarySettings();
  }, []);

  useEffect(() => {
    async function loadShifts() {
      if (!user) return;
      try {
        const today = format(new Date(), 'yyyy-MM-dd');
        const schedSnap = await getDoc(doc(db, 'settings', 'schedule'));
        const assignments = schedSnap.exists() ? (schedSnap.data().assignments || {}) : {};
        const val = assignments[`${user.uid}_${today}`];
        const shiftSnap = await getDoc(doc(db, 'settings', 'shifts'));
        const shifts = shiftSnap.exists() ? (shiftSnap.data().list || []) : [];

        if (!val) {
          setTodayShifts({ shift1: null, shift2: null });
        } else if (typeof val === 'string') {
          setTodayShifts({ shift1: shifts.find(s => s.id === val) || null, shift2: null });
        } else {
          setTodayShifts({
            shift1: val.shift1 ? (shifts.find(s => s.id === val.shift1) || null) : null,
            shift2: val.shift2 ? (shifts.find(s => s.id === val.shift2) || null) : null,
          });
        }
      } catch (err) { console.error(err); }
    }
    loadShifts();
  }, [user]);

  const fetchPunches = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const start = Timestamp.fromDate(startOfMonth(parseISO(selectedMonth + '-01')));
      const end = Timestamp.fromDate(endOfMonth(parseISO(selectedMonth + '-01')));
      const q = query(
        collection(db, 'punches'),
        where('uid', '==', user.uid),
        where('timestamp', '>=', start),
        where('timestamp', '<=', end),
        orderBy('timestamp', 'asc')
      );
      const snap = await getDocs(q);
      setPunches(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [user, selectedMonth]);

  useEffect(() => { fetchPunches(); }, [fetchPunches]);

  const todayPunches = punches.filter(p => isToday(p.timestamp?.toDate?.() || new Date(0)));

  // 雙頭班打卡狀態判斷
  // 打卡順序：
  //   只早班：in1(早) → out1(早)
  //   只晚班：in1(晚) → out1(晚)
  //   早+晚：in1(早) → out1(早) → in2(晚) → out2(晚)
  function getPunchState() {
    const inCount = todayPunches.filter(p => p.type === 'in').length;
    const outCount = todayPunches.filter(p => p.type === 'out').length;
    const { shift1, shift2 } = todayShifts;
    const hasBoth = shift1 && shift2;

    // 只排晚班（沒有早班）
    if (!shift1 && shift2) {
      if (inCount === 0) return { nextType: 'in',  currentShift: shift2, label: '晚班上班打卡', session: 1 };
      if (inCount === 1 && outCount === 0) return { nextType: 'out', currentShift: shift2, label: '晚班下班打卡', session: 1 };
      return { nextType: null, currentShift: null, label: '今日打卡完成', session: 0 };
    }

    // 只排早班（沒有晚班）或雙頭班
    if (inCount === 0) return { nextType: 'in',  currentShift: shift1, label: '早班上班打卡', session: 1 };
    if (inCount === 1 && outCount === 0) return { nextType: 'out', currentShift: shift1, label: '早班下班打卡', session: 1 };
    if (inCount === 1 && outCount === 1 && hasBoth) return { nextType: 'in',  currentShift: shift2, label: '晚班上班打卡', session: 2 };
    if (inCount === 2 && outCount === 1 && hasBoth) return { nextType: 'out', currentShift: shift2, label: '晚班下班打卡', session: 2 };
    return { nextType: null, currentShift: null, label: '今日打卡完成', session: 0 };
  }

  const punchState = getPunchState();
  const isClockedIn = todayPunches.length > 0 && todayPunches[todayPunches.length - 1].type === 'in';

  function validatePunchTime(type, shift) {
    if (!shift) return { ok: false, msg: '今日未排班，無法打卡' };
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = shift.start.split(':').map(Number);
    const [eh, em] = shift.end.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;

    if (type === 'in') {
      if (nowMins < startMins - 15) {
        return { ok: false, msg: `距離可打卡時間還有 ${startMins - 15 - nowMins} 分鐘（${shift.name || shift.id}班 ${shift.start} 上班）` };
      }
      if (nowMins > endMins) return { ok: false, msg: `已超過 ${shift.name || shift.id}班 下班時間（${shift.end}），如需補打請聯繫管理員` };
      // 方案三：打卡截止時間鎖定
      const cutoff = punchCutoffMinutes ?? 30;
      if (cutoff > 0 && nowMins > startMins + cutoff) {
        const lateMin = nowMins - startMins;
        return { ok: false, msg: `打卡時間已截止（上班後 ${cutoff} 分鐘鎖定）
遲到 ${lateMin} 分鐘，請聯繫管理員補打卡，當月失去全勤獎金`, locked: true };
      }
      const lateMin = Math.max(0, nowMins - startMins);
      return { ok: true, msg: lateMin > 0 ? `⚠️ 遲到 ${lateMin} 分鐘` : '', shiftId: shift.id, lateMinutes: lateMin };
    } else {
      const overMins = Math.max(0, nowMins - endMins);
      const otUnits = Math.floor(overMins / 15);
      const otMins = otUnits * 15;
      return { ok: true, msg: otMins > 0 ? `加班 ${otMins} 分鐘（${otUnits} 個單位）` : '', shiftId: shift.id, overtimeMinutes: otMins };
    }
  }

  // 按下打卡按鈕 → 先跳確認 Modal
  function handlePunch() {
    if (!user || punchLoading) return;
    if (!networkStatus.allowed) { alert(networkStatus.reason || '請連接辦公室 WiFi'); return; }
    if (!punchState.nextType) { alert('今日打卡已完成！'); return; }
    if (!punchState.currentShift) { setShiftWarning('今日未排班，無法打卡'); return; }

    const validation = validatePunchTime(punchState.nextType, punchState.currentShift);
    if (!validation.ok) {
      setShiftWarning(validation.msg);
      return;
    }
    setShiftWarning('');

    // 計算距離上班時間（供 Modal 顯示）
    const lastIn = todayPunches.filter(p => p.type === 'in').slice(-1)[0];
    let workedMinutes = null;
    if (punchState.nextType === 'out' && lastIn?.timestamp?.toDate) {
      const diff = Math.floor((now - lastIn.timestamp.toDate()) / 60000);
      workedMinutes = diff;
    }

    setConfirmPunch({
      type: punchState.nextType,
      label: punchState.label,
      time: format(now, 'HH:mm'),
      lateMin: validation.lateMinutes || 0,
      overMin: validation.overtimeMinutes || 0,
      workedMinutes,
      validation,
    });
  }

  // 確認後才真的打卡
  async function doConfirmPunch() {
    if (!confirmPunch) return;
    const { type, validation } = confirmPunch;
    setConfirmPunch(null);
    setPunchLoading(true);
    try {
      await addDoc(collection(db, 'punches'), {
        uid: user.uid, userName: profile?.name || '',
        type,
        timestamp: serverTimestamp(),
        date: format(now, 'yyyy-MM-dd'),
        note: note.trim(),
        shiftId: validation.shiftId || '',
        session: punchState.session,
        lateMinutes: validation.lateMinutes || 0,
        overtimeMinutes: validation.overtimeMinutes || 0,
        networkName: networkStatus.matchedNetwork || '',
        publicIP: networkInfo.publicIP || '',
      });
      setNote('');
      if (validation.msg) setShiftWarning(validation.msg);
      await fetchPunches();
    } catch (err) { alert('打卡失敗：' + err.message); }
    setPunchLoading(false);
  }

  const { dailyRecords, totalHours, totalOvertimeHours, totalSalary, salaryBreakdown } = calcSalaryFromPunches(punches, profile);
  const canPunch = networkStatus.allowed && (todayShifts.shift1 || todayShifts.shift2) && punchState.nextType;

  // ── 本月統計頁面 ────────────────────────────────────────────
  // ── 特休頁面 ────────────────────────────────────────────────
  if (activePage === 'annual') {
    return <EmpAnnualPage profile={profile} user={user} />;
  }

  // ── 請假頁面 ────────────────────────────────────────────────
  if (activePage === 'leave') {
    return <EmpLeavePage profile={profile} user={user} />;
  }

  if (activePage === 'stats') {
    return <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}><StatsPage
      profile={profile}
      punches={punches}
      loading={loading}
      selectedMonth={selectedMonth}
      setSelectedMonth={setSelectedMonth}
      dailyRecords={dailyRecords}
      totalHours={totalHours}
      totalOvertimeHours={totalOvertimeHours}
      totalSalary={totalSalary}
      salaryBreakdown={salaryBreakdown}
      salaryRevealDay={salaryRevealDay}
    /></div>;
  }

  // ── 打卡介面 ─────────────────────────────────────────────────
  return (
    <div style={{ padding: '12px', maxWidth: 600, margin: '0 auto' }} className="fade-in">
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>打卡介面</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>歡迎回來，<strong>{profile?.name}</strong></p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* 今日班別 */}
          <div className="card" style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10 }}>今日班別</div>
            {!todayShifts.shift1 && !todayShifts.shift2 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>今日未排班（休假）</div>
            ) : (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[{ label: '早班', shift: todayShifts.shift1 }, { label: '晚班', shift: todayShifts.shift2 }].map(({ label, shift }) =>
                  shift ? (
                    <div key={label} style={{
                      display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 140,
                      padding: '10px 14px', borderRadius: 10,
                      background: shift.color + '11', border: `1px solid ${shift.color}44`,
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)',
                        background: shift.color + '22', color: shift.color, border: `1px solid ${shift.color}44`,
                      }}>{shift.id}</div>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: shift.color }}>{shift.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{shift.start} → {shift.end}</div>
                      </div>
                    </div>
                  ) : null
                )}
              </div>
            )}
          </div>

          {/* WiFi 狀態 */}
          <div className="card" style={{
            padding: '10px 14px',
            border: networkStatus.checking ? '1px solid var(--border)' : networkStatus.allowed ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(239,68,68,0.35)',
            background: networkStatus.checking ? 'var(--bg-card)' : networkStatus.allowed ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: networkStatus.checking ? 'var(--text-muted)' : networkStatus.allowed ? 'var(--green)' : 'var(--red)' }}>
              {networkStatus.checking ? '📡 偵測網路中...' : networkStatus.allowed ? `✓ WiFi 驗證通過 · ${networkStatus.matchedNetwork}` : '✗ WiFi 驗證失敗'}
            </div>
            {!networkStatus.allowed && !networkStatus.checking && (
              <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{networkStatus.reason}</div>
            )}
          </div>

          {/* 時鐘 + 打卡 */}
          <div className="card" style={{ textAlign: 'center', padding: '20px 16px' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 42, fontWeight: 300, letterSpacing: '0.04em', lineHeight: 1, marginBottom: 6 }}>
              {format(now, 'HH:mm:ss')}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
              {format(now, 'yyyy年MM月dd日 EEEE', { locale: zhTW })}
            </div>

            {/* 今日打卡進度 */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '14px 0', flexWrap: 'wrap' }}>
              {(
                // 只排晚班：只顯示晚班兩步驟
                !todayShifts.shift1 && todayShifts.shift2
                  ? [{ label: '晚班上班', idx: 0 }, { label: '晚班下班', idx: 1 }]
                  // 只早班或雙頭班
                  : [
                      { label: '早班上班', idx: 0 },
                      { label: '早班下班', idx: 1 },
                      ...(todayShifts.shift2 ? [{ label: '晚班上班', idx: 2 }, { label: '晚班下班', idx: 3 }] : []),
                    ]
              ).map(({ label, idx }) => {
                const done = todayPunches.length > idx;
                const current = todayPunches.length === idx;
                return (
                  <div key={idx} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                      background: done ? 'var(--green)' : current ? 'var(--amber)' : 'var(--bg-elevated)',
                      color: done || current ? '#000' : 'var(--text-muted)',
                      border: current ? '2px solid var(--amber)' : '1px solid var(--border)',
                    }}>{done ? '✓' : idx + 1}</div>
                    <div style={{ fontSize: 9, color: done ? 'var(--green)' : current ? 'var(--amber)' : 'var(--text-muted)' }}>{label}</div>
                  </div>
                );
              })}
            </div>

            {shiftWarning && (
              <div style={{
                background: shiftWarning.includes('加班') || shiftWarning.includes('遲到') ? 'var(--amber-glow)' : 'var(--red-glow)',
                border: `1px solid ${shiftWarning.includes('加班') || shiftWarning.includes('遲到') ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}`,
                borderRadius: 8, padding: '8px 12px', marginBottom: 10,
                fontSize: 12, color: shiftWarning.includes('加班') || shiftWarning.includes('遲到') ? 'var(--amber)' : 'var(--red)',
                textAlign: 'left',
              }}>{shiftWarning}</div>
            )}

            <input value={note} onChange={e => setNote(e.target.value)} placeholder="備註（選填）" style={{ marginBottom: 10, fontSize: 13 }} />
            <button onClick={handlePunch} disabled={punchLoading || networkStatus.checking || !canPunch} style={{
              width: '100%', padding: 13, borderRadius: 10, fontSize: 15, fontWeight: 700,
              background: !canPunch ? 'var(--bg-elevated)' : punchState.nextType === 'out' ? 'var(--red-glow)' : 'var(--amber)',
              color: !canPunch ? 'var(--text-muted)' : punchState.nextType === 'out' ? 'var(--red)' : '#000',
              border: punchState.nextType === 'out' && canPunch ? '1px solid rgba(239,68,68,0.4)' : 'none',
              cursor: canPunch ? 'pointer' : 'not-allowed',
            }}>
              {punchLoading ? '處理中...' :
               networkStatus.checking ? '偵測網路中...' :
               !networkStatus.allowed ? '需連接辦公室 WiFi' :
               !todayShifts.shift1 && !todayShifts.shift2 ? '今日未排班' :
               !punchState.nextType ? '今日打卡完成 ✓' :
               punchState.nextType === 'in' ? `▶ ${punchState.label}` : `⏹ ${punchState.label}`}
            </button>
          </div>

          {/* 確認打卡 Modal */}
          {confirmPunch && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
              backdropFilter: 'blur(4px)',
            }}>
              <div style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 16, padding: '28px 24px', maxWidth: 340, width: '90%',
                boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
              }} className="fade-in">
                {/* 圖示 */}
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  <div style={{
                    width: 60, height: 60, borderRadius: '50%', margin: '0 auto 12px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26,
                    background: confirmPunch.type === 'in' ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                    border: `2px solid ${confirmPunch.type === 'in' ? 'var(--amber)' : 'var(--red)'}`,
                  }}>
                    {confirmPunch.type === 'in' ? '▶' : '⏹'}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
                    確認{confirmPunch.label}？
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 300, color: confirmPunch.type === 'in' ? 'var(--amber)' : 'var(--red)' }}>
                    {confirmPunch.time}
                  </div>
                </div>

                {/* 資訊 */}
                <div style={{ background: 'var(--bg-base)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
                  {confirmPunch.type === 'in' && confirmPunch.lateMin > 0 && (
                    <div style={{ color: 'var(--amber)', marginBottom: 4 }}>⚠️ 遲到 {confirmPunch.lateMin} 分鐘</div>
                  )}
                  {confirmPunch.type === 'in' && confirmPunch.lateMin === 0 && (
                    <div style={{ color: 'var(--green)', marginBottom: 4 }}>✓ 準時上班</div>
                  )}
                  {confirmPunch.type === 'out' && confirmPunch.workedMinutes !== null && (
                    <div style={{ color: 'var(--text-secondary)' }}>
                      本次工作時間：{Math.floor(confirmPunch.workedMinutes / 60)}h {confirmPunch.workedMinutes % 60}m
                      {confirmPunch.workedMinutes < 60 && (
                        <div style={{ color: 'var(--amber)', marginTop: 4 }}>⚠️ 工作時間不足 1 小時，請確認是否誤按</div>
                      )}
                    </div>
                  )}
                  {confirmPunch.overMin > 0 && (
                    <div style={{ color: 'var(--amber)', marginTop: 4 }}>加班 {confirmPunch.overMin} 分鐘</div>
                  )}
                </div>

                {/* 按鈕 */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => setConfirmPunch(null)}
                    style={{
                      flex: 1, padding: 12, borderRadius: 10, fontSize: 14, fontWeight: 600,
                      background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                      border: '1px solid var(--border)', cursor: 'pointer',
                    }}>
                    取消
                  </button>
                  <button
                    onClick={doConfirmPunch}
                    style={{
                      flex: 2, padding: 12, borderRadius: 10, fontSize: 14, fontWeight: 700,
                      background: confirmPunch.type === 'in' ? 'var(--amber)' : 'var(--red-glow)',
                      color: confirmPunch.type === 'in' ? '#000' : 'var(--red)',
                      border: confirmPunch.type === 'out' ? '1px solid rgba(239,68,68,0.4)' : 'none',
                      cursor: 'pointer',
                    }}>
                    確認{confirmPunch.label}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 打卡紀錄 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600 }}>打卡紀錄</h2>
              <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ width: 150, fontSize: 12 }} />
            </div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12 }}>載入中...</div>
            ) : dailyRecords.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>本月尚無打卡紀錄</div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr><th>日期</th><th>班</th><th>上班</th><th>下班</th><th>狀態</th><th>工時</th></tr>
                  </thead>
                  <tbody>
                    {dailyRecords.map(r => (
                      <tr key={r.date}>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r.date}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--amber)' }}>{r.shiftId || '--'}</td>
                        <td style={{ fontFamily: 'var(--mono)', color: 'var(--green)', fontSize: 11 }}>{r.inTime || '--'}</td>
                        <td style={{ fontFamily: 'var(--mono)', color: 'var(--red)', fontSize: 11 }}>{r.outTime || '--'}</td>
                        <td style={{ fontSize: 10 }}>
                          {r.lateMinutes > 0
                            ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>遲到 {r.lateMinutes}分</span>
                            : r.inTime
                            ? <span style={{ color: 'var(--green)' }}>準時</span>
                            : '--'}
                          {r.overtimeHours > 0 && <span style={{ color: 'var(--amber)', marginLeft: 4 }}>+加班</span>}
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r.hours > 0 ? fmtHours(r.hours) : '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, highlight, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: color || (highlight ? 'var(--amber)' : 'var(--text-primary)') }}>
        {value}
      </span>
    </div>
  );
}

// ── 本月統計頁面元件 ─────────────────────────────────────────
function StatsPage({ profile, loading, selectedMonth, setSelectedMonth, dailyRecords, totalHours, totalOvertimeHours, totalSalary, salaryBreakdown, salaryRevealDay }) {
  const attendedDays = dailyRecords.filter(r => r.inTime).length;
  const revealDay = salaryRevealDay || 30;
  const today = new Date();
  const todayDay = today.getDate();
  const currentMonth = format(today, 'yyyy-MM');
  const isCurrentMonth = selectedMonth === currentMonth;
  // 薪資明細是否可見：查歷史月份 或 當月已到開放日
  const salaryVisible = !isCurrentMonth || todayDay >= revealDay;

  return (
    <div style={{ padding: '12px', maxWidth: 600, margin: '0 auto', background: 'var(--bg-base)', minHeight: '100vh', color: 'var(--text-primary)' }} className="fade-in">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>本月統計</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{profile?.name}</p>
      </div>

      {/* 月份選擇 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ width: 150, fontSize: 12 }} />
      </div>

      {/* 出勤概覽 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
        {[
          { label: '出勤天數', value: `${attendedDays} 天`, color: 'var(--green)' },
          { label: '工作時數', value: fmtHours(totalHours), color: 'var(--text-primary)' },
          ...(totalOvertimeHours > 0 ? [{ label: '加班時數', value: fmtHours(totalOvertimeHours), color: 'var(--amber)' }] : []),
          { label: '薪資類型', value: profile?.payType === 'hourly' ? `時薪 $${profile?.hourlyRate}` : '月薪制', color: 'var(--text-primary)' },
        ].map(item => (
          <div key={item.label} className="card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 6 }}>{item.label}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 600, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* 月薪制：薪資明細（月底才開放） */}
      {profile?.payType === 'monthly' && salaryBreakdown && salaryVisible && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 14 }}>薪資明細</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              { label: '底薪', sub: `$${(profile?.monthlySalary||0).toLocaleString()} ÷ 30 × ${salaryBreakdown.attendedDays} 天`, value: fmtMoney(salaryBreakdown.basePay), color: 'var(--text-primary)' },
              { label: '餐費', sub: `$${(profile?.mealAllowance||0).toLocaleString()} ÷ 30 × ${salaryBreakdown.attendedDays} 天`, value: fmtMoney(salaryBreakdown.mealPay), color: 'var(--text-primary)' },
              {
                label: `全勤獎金 ${salaryBreakdown.hasFullAttendance ? '✓' : '✗'}`,
                sub: salaryBreakdown.hasFullAttendance ? '達成全勤條件' : [salaryBreakdown.hasLate && '有遲到', salaryBreakdown.hasLeave && '有請假', salaryBreakdown.hasMissedPunch && '有忘打卡'].filter(Boolean).join('、'),
                value: fmtMoney(salaryBreakdown.fullAttendancePay),
                color: salaryBreakdown.hasFullAttendance ? 'var(--green)' : 'var(--text-muted)',
                dim: !salaryBreakdown.hasFullAttendance,
              },
              { label: '紅利', sub: '月底另行計算', value: '—', color: 'var(--text-muted)', dim: true },
            ].map((item, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 0', borderBottom: '1px solid var(--border)',
                opacity: item.dim ? 0.5 : 1,
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{item.label}</div>
                  {item.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.sub}</div>}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 實領薪資（月底才開放） */}
      {salaryVisible ? (
        <div className="card" style={{ background: 'var(--amber-glow)', border: '1px solid rgba(245,158,11,0.25)', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', marginBottom: 2 }}>預估實領薪資</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{selectedMonth}（不含紅利）</div>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 700, color: 'var(--amber)' }}>{fmtMoney(totalSalary)}</div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 14, border: '1px solid var(--border)', textAlign: 'center', padding: '18px 16px' }}>
          <div style={{ fontSize: 20, marginBottom: 8 }}>🔒</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>薪資明細將於每月 {revealDay} 號開放查看</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>目前為 {todayDay} 號，還需等待 {revealDay - todayDay} 天</div>
        </div>
      )}

      {/* 每日打卡明細 */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10 }}>每日出勤明細</div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12 }}>載入中...</div>
        ) : dailyRecords.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>本月尚無打卡紀錄</div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr><th>日期</th><th>班</th><th>上班</th><th>下班</th><th>狀態</th><th>工時</th></tr>
              </thead>
              <tbody>
                {dailyRecords.map(r => (
                  <tr key={r.date}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r.date}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--amber)' }}>{r.shiftId || '--'}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--green)', fontSize: 11 }}>{r.inTime || '--'}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--red)', fontSize: 11 }}>{r.outTime || '--'}</td>
                    <td style={{ fontSize: 10 }}>
                      {r.lateMinutes > 0
                        ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>遲到 {r.lateMinutes}分</span>
                        : r.inTime
                        ? <span style={{ color: 'var(--green)' }}>準時</span>
                        : '--'}
                      {r.overtimeHours > 0 && <span style={{ color: 'var(--amber)', marginLeft: 4 }}>+加班</span>}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r.hours > 0 ? fmtHours(r.hours) : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 計算特休天數 ─────────────────────────────────────────────
function calcAnnualLeaveDays(months) {
  if (months < 6) return 0;
  if (months < 12) return 3;
  if (months < 24) return 7;
  if (months < 36) return 10;
  if (months < 60) return 14;
  if (months < 120) return 15;
  return Math.min(15 + Math.floor(months / 12) - 10, 30);
}

// ── 員工特休頁面 ─────────────────────────────────────────────
function EmpAnnualPage({ profile, user }) {
  const [usedLeaves, setUsedLeaves] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user) return;
    async function load() {
      try {
        const snap = await getDocs(query(
          collection(db, 'leaves'),
          where('uid', '==', user.uid),
          where('type', '==', '特休'),
          where('status', '!=', 'rejected'),
          orderBy('status'),
          orderBy('startDate', 'desc')
        ));
        setUsedLeaves(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch {}
      setLoading(false);
    }
    load();
  }, [user]);

  const hired = profile?.hiredAt?.toDate ? profile.hiredAt.toDate() : null;
  const months = hired ? Math.floor((Date.now() - hired.getTime()) / (1000 * 60 * 60 * 24 * 30.44)) : null;
  const totalDays = months !== null ? calcAnnualLeaveDays(months) : null;
  const usedDays = usedLeaves.filter(l => l.status === 'approved').reduce((s, l) => s + (l.workdays || 1), 0);
  const remainDays = totalDays !== null ? Math.max(0, totalDays - usedDays) : null;

  return (
    <div style={{ padding: '20px 16px', maxWidth: 600, margin: '0 auto', background: 'var(--bg-base)', minHeight: '100vh' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>特休</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{profile?.name}</p>
      </div>

      {/* 特休概覽 */}
      {totalDays !== null ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
          {[
            { label: '今年特休', val: totalDays, color: 'var(--amber)' },
            { label: '已使用', val: usedDays, color: 'var(--red)' },
            { label: '剩餘可休', val: remainDays, color: 'var(--green)' },
          ].map(({ label, val, color }) => (
            <div key={label} className="card" style={{ padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--mono)', color }}>{val}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ padding: 20, marginBottom: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
          請至管理員設定到職日以計算特休天數
        </div>
      )}

      {/* 已使用特休明細 */}
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>特休使用紀錄</div>
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>載入中...</div>
      ) : usedLeaves.length === 0 ? (
        <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>尚未請過特休</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {usedLeaves.map(l => (
            <div key={l.id} className="card" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{l.startDate} {l.endDate && l.endDate !== l.startDate ? `～ ${l.endDate}` : ''}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{l.workdays || 1} 天{l.reason ? `・${l.reason}` : ''}</div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                background: l.status === 'approved' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                color: l.status === 'approved' ? 'var(--green)' : 'var(--amber)',
                border: `1px solid ${l.status === 'approved' ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
              }}>
                {l.status === 'approved' ? '✓ 通過' : '⏳ 待審核'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 員工請假頁面 ─────────────────────────────────────────────
const LEAVE_TYPES = ['特休', '事假', '病假', '婚假', '喪假', '其他'];

function EmpLeavePage({ profile, user }) {
  const [leaves, setLeaves] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showForm, setShowForm] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [form, setForm] = React.useState({ type: '特休', startDate: '', endDate: '', reason: '' });
  const [formError, setFormError] = React.useState('');

  async function loadLeaves() {
    if (!user) return;
    try {
      const snap = await getDocs(query(
        collection(db, 'leaves'),
        where('uid', '==', user.uid),
        orderBy('createdAt', 'desc')
      ));
      setLeaves(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch {}
    setLoading(false);
  }

  React.useEffect(() => { loadLeaves(); }, [user]);

  async function handleSubmit() {
    setFormError('');
    if (!form.startDate) return setFormError('請選擇開始日期');
    if (!form.endDate) return setFormError('請選擇結束日期');
    if (form.endDate < form.startDate) return setFormError('結束日期不可早於開始日期');

    // 計算工作天數（簡單版：日曆天數）
    const start = new Date(form.startDate);
    const end = new Date(form.endDate);
    const days = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'leaves'), {
        uid: user.uid,
        userName: profile?.name || '',
        type: form.type,
        startDate: form.startDate,
        endDate: form.endDate,
        workdays: days,
        reason: form.reason.trim(),
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      setForm({ type: '特休', startDate: '', endDate: '', reason: '' });
      setShowForm(false);
      await loadLeaves();
    } catch (err) {
      setFormError('送出失敗：' + err.message);
    }
    setSubmitting(false);
  }

  const statusLabel = { pending: '⏳ 待審核', approved: '✓ 通過', rejected: '✗ 拒絕' };
  const statusColor = { pending: 'var(--amber)', approved: 'var(--green)', rejected: 'var(--red)' };

  return (
    <div style={{ padding: '20px 16px', maxWidth: 600, margin: '0 auto', background: 'var(--bg-base)', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>請假</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{profile?.name}</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setFormError(''); }} style={{
          padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
          background: showForm ? 'var(--bg-elevated)' : 'var(--amber)',
          color: showForm ? 'var(--text-secondary)' : '#000',
          border: showForm ? '1px solid var(--border)' : 'none', cursor: 'pointer',
        }}>
          {showForm ? '取消' : '＋ 申請請假'}
        </button>
      </div>

      {/* 請假申請表單 */}
      {showForm && (
        <div className="card" style={{ padding: '20px', marginBottom: 20, border: '1px solid var(--amber)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginBottom: 16 }}>申請請假單</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={fldStyle}>
              <span>假別</span>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={inputStyle}>
                {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={fldStyle}>
                <span>開始日期</span>
                <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value, endDate: e.target.value }))} style={inputStyle} />
              </label>
              <label style={fldStyle}>
                <span>結束日期</span>
                <input type="date" value={form.endDate} min={form.startDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} style={inputStyle} />
              </label>
            </div>
            {form.startDate && form.endDate && (
              <div style={{ fontSize: 12, color: 'var(--amber)', padding: '8px 12px', background: 'var(--amber-glow)', borderRadius: 8 }}>
                共 {Math.round((new Date(form.endDate) - new Date(form.startDate)) / (1000 * 60 * 60 * 24)) + 1} 天
              </div>
            )}
            <label style={fldStyle}>
              <span>事由（選填）</span>
              <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="請輸入請假事由" style={inputStyle} />
            </label>
            {formError && <div style={{ color: 'var(--red)', fontSize: 12 }}>{formError}</div>}
            <button onClick={handleSubmit} disabled={submitting} style={{
              padding: '12px', borderRadius: 8, background: 'var(--amber)', color: '#000',
              fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer',
            }}>
              {submitting ? '送出中...' : '送出請假單'}
            </button>
          </div>
        </div>
      )}

      {/* 請假紀錄 */}
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>請假紀錄</div>
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>載入中...</div>
      ) : leaves.length === 0 ? (
        <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>尚無請假紀錄</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {leaves.map(l => (
            <div key={l.id} className="card" style={{
              padding: '14px 16px',
              borderLeft: `3px solid ${statusColor[l.status] || 'var(--border)'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{l.type}</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{l.startDate}{l.endDate !== l.startDate ? ` ～ ${l.endDate}` : ''}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {l.workdays} 天{l.reason ? `・${l.reason}` : ''}
                  </div>
                  {l.rejectReason && (
                    <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>拒絕原因：{l.rejectReason}</div>
                  )}
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
                  color: statusColor[l.status], border: `1px solid ${statusColor[l.status]}44`,
                  background: statusColor[l.status] + '11', flexShrink: 0,
                }}>
                  {statusLabel[l.status] || l.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const fldStyle = {
  display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em',
};
const inputStyle = {
  padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 13, background: 'var(--bg-base)', color: 'var(--text-primary)', outline: 'none',
};

