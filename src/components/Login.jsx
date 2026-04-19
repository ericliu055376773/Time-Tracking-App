import React, { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';

const ADMIN_EMAIL = 'admin@test.com';
const ADMIN_PASSWORD = 'admin123456';

export default function Login() {
  const [mode, setMode] = useState('login');
  const [empId, setEmpId] = useState('');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [payType, setPayType] = useState('hourly');
  const [hourlyRate, setHourlyRate] = useState(180);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [logoClickCount, setLogoClickCount] = useState(0);

  function reset() { setError(''); setSuccess(''); }

  async function handleLogoClick() {
    const next = logoClickCount + 1;
    setLogoClickCount(next);
    if (next >= 5) {
      setLogoClickCount(0);
      await quickAdminLogin();
    }
  }

  async function quickAdminLogin() {
    reset(); setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    } catch (e) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
        const cred = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
        await setDoc(doc(db, 'users', cred.user.uid), {
          name: '管理員', empId: 'ADMIN', email: ADMIN_EMAIL,
          role: 'admin', payType: 'monthly', monthlySalary: 50000,
          hourlyRate: 300, overtimeEnabled: false,
          createdAt: serverTimestamp(),
        });
      }
    }
    setLoading(false);
  }

  async function handleEmployeeLogin(e) {
    e.preventDefault();
    if (pin.length !== 10) { setError('PIN 碼必須是 10 位數字'); return; }
    reset(); setLoading(true);
    try {
      const q = query(collection(db, 'users'), where('empId', '==', empId.trim()));
      const snap = await getDocs(q);
      if (snap.empty) { setError('查無此員工編號'); setLoading(false); return; }
      await signInWithEmailAndPassword(auth, snap.docs[0].data().email, pin);
    } catch (err) {
      const msgs = { 'auth/invalid-credential': '員工編號或 PIN 碼錯誤', 'auth/too-many-requests': '嘗試次數過多' };
      setError(msgs[err.code] || '登入失敗：' + err.message);
    }
    setLoading(false);
  }

  async function handleEmployeeRegister(e) {
    e.preventDefault();
    if (!name.trim()) { setError('請輸入姓名'); return; }
    if (!/^\d{10}$/.test(pin)) { setError('PIN 碼必須是 10 位數字'); return; }
    reset(); setLoading(true);
    try {
      // 用姓名產生唯一 empId
      const timestamp = Date.now().toString().slice(-6);
      const generatedEmpId = `EMP${timestamp}`;
      const email = `${generatedEmpId.toLowerCase()}@internal.timeclock`;
      const cred = await createUserWithEmailAndPassword(auth, email, pin);
      await setDoc(doc(db, 'users', cred.user.uid), {
        name: name.trim(),
        empId: generatedEmpId,
        email,
        role: 'employee',
        payType,
        hourlyRate: Number(hourlyRate),
        monthlySalary: 30000,
        overtimeEnabled: false,
        createdAt: serverTimestamp(),
      });
      setSuccess('註冊成功！正在登入...');
    } catch (err) {
      const msgs = { 'auth/email-already-in-use': '此帳號已被使用' };
      setError(msgs[err.code] || '註冊失敗：' + err.message);
    }
    setLoading(false);
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)',
    }}>
      <div style={{ width: '100%', maxWidth: 420, padding: '0 20px' }}>

        {/* Logo */}
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <div onClick={handleLogoClick} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 64, height: 64, background: 'var(--amber-glow)',
            border: `1px solid ${logoClickCount > 0 ? 'var(--amber)' : 'rgba(245,158,11,0.4)'}`,
            borderRadius: 16, marginBottom: 16, cursor: 'pointer', transition: 'all 0.15s',
            transform: logoClickCount > 0 ? 'scale(0.95)' : 'scale(1)',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="1.8">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.08em' }}>
            TIMECLOCK
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)', letterSpacing: '0.06em', marginTop: 4 }}>
            打卡薪資管理系統
          </p>
          {logoClickCount > 0 && logoClickCount < 5 && (
            <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 8, fontFamily: 'var(--mono)' }}>
              {'● '.repeat(logoClickCount)}{'○ '.repeat(5 - logoClickCount)}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* 登入 / 註冊 切換 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, background: 'var(--bg-elevated)', borderRadius: 8, padding: 4 }}>
            {[['login', '員工登入'], ['register', '員工註冊']].map(([key, label]) => (
              <button key={key} type="button" onClick={() => { setMode(key); reset(); }}
                style={{
                  padding: '8px 0', borderRadius: 6, fontSize: 13, fontWeight: 500,
                  background: mode === key ? 'var(--amber)' : 'transparent',
                  color: mode === key ? '#000' : 'var(--text-muted)',
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* 員工登入 */}
          {mode === 'login' && (
            <form onSubmit={handleEmployeeLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={lbl}>
                <span>員工編號</span>
                <input value={empId} onChange={e => setEmpId(e.target.value)} placeholder="例如：EMP123456" required />
              </label>
              <label style={lbl}>
                <span>10 位 PIN 碼</span>
                <input type="password" inputMode="numeric" maxLength={10}
                  value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="輸入 10 位數字" required />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{pin.length} / 10 位</span>
              </label>
              {error && <div style={errStyle}>{error}</div>}
              <button type="submit" disabled={loading || pin.length !== 10} style={btnStyle}>
                {loading ? '登入中...' : '打卡登入'}
              </button>
            </form>
          )}

          {/* 員工註冊 — 只需姓名 + PIN */}
          {mode === 'register' && (
            <form onSubmit={handleEmployeeRegister} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={lbl}>
                <span>姓名</span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="輸入姓名" required />
              </label>
              <label style={lbl}>
                <span>10 位 PIN 碼（之後登入用）</span>
                <input type="password" inputMode="numeric" maxLength={10}
                  value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="設定 10 位數字" required />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{pin.length} / 10 位</span>
              </label>
              <label style={lbl}>
                <span>薪資類型</span>
                <select value={payType} onChange={e => setPayType(e.target.value)}>
                  <option value="hourly">時薪制</option>
                  <option value="monthly">月薪制</option>
                </select>
              </label>
              {payType === 'hourly' && (
                <label style={lbl}>
                  <span>時薪（元）</span>
                  <input type="number" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} min={0} />
                </label>
              )}
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                📌 員工編號將由系統自動產生，註冊後請記下編號用於登入
              </div>
              {error && <div style={errStyle}>{error}</div>}
              {success && <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, padding: '10px 14px', color: 'var(--green)', fontSize: 13 }}>{success}</div>}
              <button type="submit" disabled={loading || pin.length !== 10} style={btnStyle}>
                {loading ? '處理中...' : '建立帳號'}
              </button>
            </form>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
          管理員入口：點擊上方時鐘圖示 5 下
        </div>
      </div>
    </div>
  );
}

const lbl = {
  display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
  letterSpacing: '0.06em', textTransform: 'uppercase',
};
const errStyle = {
  background: 'var(--red-glow)', border: '1px solid rgba(239,68,68,0.3)',
  borderRadius: 6, padding: '10px 14px', color: 'var(--red)', fontSize: 13,
};
const btnStyle = {
  padding: '12px', borderRadius: 8, fontSize: 14, fontWeight: 600,
  background: 'var(--amber)', color: '#000', letterSpacing: '0.05em',
  cursor: 'pointer', border: 'none',
};
