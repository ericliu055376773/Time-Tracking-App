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
import { zhTW } from 'date-fns/locale';

const TABS = ['打卡', '請假'];

export default function EmployeeDashboard() {
  const { user, profile } = useAuth();
  const [now, setNow] = useState(new Date());
  const [punches, setPunches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [punchLoading, setPunchLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [note, setNote] = useState('');
  const [activeTab, setActiveTab] = useState('打卡');
  const [networkInfo, setNetworkInfo] = useState({ publicIP: null, localIP: null });
  const [networkStatus, setNetworkStatus] = useState({ checking: true, allowed: false, reason: '', matchedNetwork: '' });
  const [todayShift, setTodayShift] = useState(null);
  const [shiftWarning, setShiftWarning] = useState('');

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
    async function loadShift() {
      if (!user) return;
      try {
        const today = format(new Date(), 'yyyy-MM-dd');
        const schedSnap = await getDoc(doc(db, 'settings', 'schedule'));
        const assignments = schedSnap.exists() ? (schedSnap.data().assignments || {}) : {};
        const shiftId = assignments[`${user.uid}_${today}`];
        if (shiftId) {
          const shiftSnap = await getDoc(doc(db, 'settings', 'shifts'));
          const shifts = shiftSnap.exists() ? (shiftSnap.data().list || []) : [];
          const shift = shifts.find(s => s.id === shiftId);
          setTodayShift(shift || null);
        } else {
          setTodayShift(null);
        }
      } catch (err) { console.error(err); }
    }
    loadShift();
  }, [user]);

  const fetchPunches = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const start = Timestamp.fromDate(startOfMonth(parseISO(selectedMonth + '-01')));
      const end   = Timestamp.fromDate(endOfMonth(parseISO(selectedMonth + '-01')));
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
  const lastPunch    = todayPunches[todayPunches.length - 1];
  const isClockedIn  = lastPunch?.type === 'in';

  function validatePunchTime(type) {
    if (!todayShift) return { ok: false, msg: '今日未排班，無法打卡' };
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = todayShift.start.split(':').map(Number);
    const [eh, em] = todayShift.end.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    if (type === 'in') {
      if (nowMins < startMins - 15) {
        const diff = startMins - 15 - nowMins;
        return { ok: false, msg: `距離可打卡時間還有 ${diff} 分鐘（${todayShift.start} 上班，提早 15 分鐘可打卡）` };
      }
      if (nowMins > endMins) return { ok: false, msg: `已超過下班時間（${todayShift.end}），無法打上班卡` };
      const lateMin = Math.max(0, nowMins - startMins);
      return { ok: true, msg: lateMin > 0 ? `晚到 ${lateMin} 分鐘` : '', shiftId: todayShift.id };
    } else {
      const overMins = Math.max(0, nowMins - endMins);
      const otUnits = Math.floor(overMins / 15);
      const otMins = otUnits * 15;
      return { ok: true, msg: otMins > 0 ? `加班 ${otMins} 分鐘（${otUnits} 個單位）` : '', shiftId: todayShift.id, overtimeMinutes: otMins };
    }
  }

  async function handlePunch() {
    if (!user || punchLoading) return;
    if (!networkStatus.allowed) { alert(networkStatus.reason || '請連接辦公室 WiFi 才能打卡'); return; }
    const type = isClockedIn ? 'out' : 'in';
    const validation = validatePunchTime(type);
    if (!validation.ok) { setShiftWarning(validation.msg); return; }
    setShiftWarning('');
    setPunchLoading(true);
    try {
      await addDoc(collection(db, 'punches'), {
        uid: user.uid, userName: profile?.name || '',
        type, timestamp: serverTimestamp(),
        date: format(now, 'yyyy-MM-dd'), note: note.trim(),
        shiftId: validation.shiftId || '',
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

  const { dailyRecords, totalHours, totalOvertimeHours, totalSalary } =
    calcSalaryFromPunches(punches, profile);

  const canPunch = networkStatus.allowed && todayShift;

  return (
    <div style={{ padding: '12px', maxWidth: 960, margin: '0 auto' }} className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>員工介面</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>歡迎回來，<strong>{profile?.name}</strong></p>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-elevated)', borderRadius: 8, padding: 4 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              padding: '7px 18px', borderRadius: 6, fontSize: 13, fontWeight: 500,
              background: activeTab === t ? 'var(--amber)' : 'transparent',
              color: activeTab === t ? '#000' : 'var(--text-secondary)',
            }}>{t}</button>
          ))}
        </div>
      </div>

      {activeTab === '打卡' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* 今日班別 */}
          <div className="card" style={{
            padding: '12px 16px',
            border: todayShift ? `1px solid ${todayShift.color}44` : '1px solid var(--border)',
            background: todayShift ? todayShift.color + '11' : 'var(--bg-card)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8 }}>今日班別</div>
            {todayShift ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)',
                  background: todayShift.color + '22', color: todayShift.color,
                  border: `1px solid ${todayShift.color}44`, flexShrink: 0,
                }}>{todayShift.id}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: todayShift.color }}>{todayShift.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
                    {todayShift.start} → {todayShift.end}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 2 }}>可提早 15 分鐘打卡</div>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>今日未排班（休假）</div>
            )}
          </div>

          {/* WiFi 狀態 */}
          <div className="card" style={{
            padding: '10px 14px',
            border: networkStatus.checking ? '1px solid var(--border)' :
                    networkStatus.allowed ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(239,68,68,0.35)',
            background: networkStatus.checking ? 'var(--bg-card)' :
                        networkStatus.allowed ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: networkStatus.checking ? 'var(--text-muted)' : networkStatus.allowed ? 'var(--green)' : 'var(--red)' }}>
                {networkStatus.checking ? '📡 偵測網路中...' : networkStatus.allowed ? `✓ WiFi 驗證通過 · ${networkStatus.matchedNetwork}` : '✗ WiFi 驗證失敗'}
              </span>
            </div>
            {!networkStatus.allowed && !networkStatus.checking && (
              <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{networkStatus.reason}</div>
            )}
          </div>

          {/* 時鐘 + 打卡 */}
          <div className="card" style={{ te
