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
          setTodayShift(shifts.find(s => s.id === shiftId) || null);
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
  const lastPunch = todayPunches[todayPunches.length - 1];
  const isClockedIn = lastPunch?.type === 'in';

  function validatePunchTime(type) {
    if (!todayShift) return { ok: false, msg: '今日未排班，無法打卡' };
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = todayShift.start.split(':').map(Number);
    const [eh, em] = todayShift.end.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    if (type === 'in') {
      if (nowMins < startMins - 15) {
        return { ok: false, msg: `距離可打卡時間還有 ${startMins - 15 - nowMins} 分鐘` };
      }
      if (nowMins > endMins) return { ok: false, msg: `已超過下班時間（${todayShift.end}）` };
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
    if (!networkStatus.allowed) { alert(networkStatus.reason || '請連接辦公室 WiFi'); return; }
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

  const { dailyRecords, totalHours, totalOvertimeHours, totalSalary } = calcSalaryFromPunches(punches, profile);
  const canPunch = networkStatus.allowed && todayShift;

  return (
    <div style={{ padding: '12px', maxWidth: 600, margin: '0 auto' }} className="fade-in">
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
                  border: `1px solid ${todayShift.color}44`,
                }}>{todayShift.id}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: todayShift.color }}>{todayShift.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{todayShift.start} → {todayShift.end}</div>
                  <div style={{ fontSize: 11, color: 'var(--amber)' }}>可提早 15 分鐘打卡</div>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>今日未排班（休假）</div>
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
            <div style={{ margin: '12px 0', display: 'flex', justifyContent: 'center' }}>
              {isClockedIn ? (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--green)' }}>
                  ● 上班中 · {lastPunch?.timestamp?.toDate ? format(lastPunch.timestamp.toDate(), 'HH:mm') : '--'}
                </span>
              ) : (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)' }}>○ 尚未打卡</span>
              )}
            </div>
            {shiftWarning && (
              <div style={{
                background: shiftWarning.includes('加班') || shiftWarning.includes('晚到') ? 'var(--amber-glow)' : 'var(--red-glow)',
                border: `1px solid ${shiftWarning.includes('加班') || shiftWarning.includes('晚到') ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}`,
                borderRadius: 8, padding: '8px 12px', marginBottom: 10,
                fontSize: 12, color: shiftWarning.includes('加班') || shiftWarning.includes('晚到') ? 'var(--amber)' : 'var(--red)',
                textAlign: 'left',
              }}>{shiftWarning}</div>
            )}
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="備註（選填）" style={{ marginBottom: 10, fontSize: 13 }} />
            <button onClick={handlePunch} disabled={punchLoading || networkStatus.checking || !canPunch} style={{
              width: '100%', padding: 13, borderRadius: 10, fontSize: 15, fontWeight: 700,
              background: !canPunch ? 'var(--bg-elevated)' : isClockedIn ? 'var(--red-glow)' : 'var(--amber)',
              color: !canPunch ? 'var(--text-muted)' : isClockedIn ? 'var(--red)' : '#000',
              border: isClockedIn && canPunch ? '1px solid rgba(239,68,68,0.4)' : 'none',
              cursor: canPunch ? 'pointer' : 'not-allowed',
            }}>
              {punchLoading ? '處理中...' : networkStatus.checking ? '偵測網路中...' : !networkStatus.allowed ? '需連接辦公室 WiFi' : !todayShift ? '今日未排班' : isClockedIn ? '⏹ 下班打卡' : '▶ 上班打卡'}
            </button>
          </div>

          {/* 本月統計 */}
          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 12 }}>本月統計</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <StatRow label="工作時數" value={fmtHours(totalHours)} />
              {totalOvertimeHours > 0 && <StatRow label="加班時數" value={fmtHours(totalOvertimeHours)} color="var(--amber)" />}
              <StatRow label="薪資類型" value={profile?.payType === 'hourly' ? `時薪 $${profile?.hourlyRate}` : '月薪制'} />
              <StatRow label="預估薪資" value={fmtMoney(totalSalary)} highlight />
            </div>
          </div>

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
                    <tr><th>日期</th><th>班別</th><th>上班</th><th>下班</th><th>工時</th><th>薪資</th></tr>
                  </thead>
                  <tbody>
                    {dailyRecords.map(r => (
                      <tr key={r.date}>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r.date}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--amber)' }}>{r.shiftId || '--'}</td>
                        <td style={{ fontFamily: 'var(--mono)', color: 'var(--green)', fontSize: 11 }}>{r.inTime || '--'}</td>
                        <td style={{ fontFamily: 'var(--mono)', color: 'var(--red)', fontSize: 11 }}>{r.outTime || '--'}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r.hours > 0 ? fmtHours(r.hours) : '--'}</td>
                        <td style={{ fontFamily: 'var(--mono)', color: 'var(--amber)', fontSize: 11 }}>{r.salary > 0 ? fmtMoney(r.salary) : '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {dailyRecords.length > 0 && (
              <div className="card" style={{ background: 'var(--amber-glow)', border: '1px solid rgba(245,158,11,0.25)', marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', marginBottom: 2 }}>{selectedMonth} 薪資估計</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{fmtHours(totalHours)}</div>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 600, color: 'var(--amber)' }}>{fmtMoney(totalSalary)}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <LeaveManager isAdmin={false} />
      )}
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
