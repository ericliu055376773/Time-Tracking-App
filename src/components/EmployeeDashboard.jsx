import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, addDoc, query, where, orderBy, getDocs,
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
        if (snap.exists() && snap.data().salaryRevealDay) {
          setSalaryRevealDay(snap.data().salaryRevealDay);
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
        return { ok: false, msg: `距離可打卡時間還有 ${startMins - 15 - nowMins} 分鐘（${shift.id}班 ${shift.start} 上班）` };
      }
      if (nowMins > endMins) return { ok: false, msg: `已超過 ${shift.id}班 下班時間（${shift.end}）` };
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
    if (!validation.ok) { setShiftWarning(validation.msg); return; }
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
  if (activePage === 'stats') {
    return <StatsPage
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
    />;
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
    <div style={{ padding: '12px', maxWidth: 600, margin: '0 auto', background: 'var(--bg-base)', minHeight: '100vh' }} className="fade-in">
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
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>薪資明細將於每月 {SALARY_REVEAL_DAY} 號開放查看</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>目前為 {todayDay} 號，還需等待 {SALARY_REVEAL_DAY - todayDay} 天</div>
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
