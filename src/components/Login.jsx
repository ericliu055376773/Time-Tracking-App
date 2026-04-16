import React, { useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../firebase';

const QUICK_ACCOUNTS = [
  { label: '管理員', email: 'admin@test.com', password: 'admin123456' },
  { label: '員工 E001', empId: 'E001', pin: '1234567890' },
];

export default function Login() {
  const [tab, setTab] = useState('employee');
  const [mode, setMode] = useState('login');
  const [empId, setEmpId] = useState('');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [payType, setPayType] = useState('hourly');
  const [hourlyRate, setHourlyRate] = useState(180);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPw, setAdminPw] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  function reset() {
    setError('');
    setSuccess('');
  }

  // 快速登入（測試用）- 不存在就自動建立
  async function quickLogin(account) {
    reset();
    setLoading(true);
    try {
      if (account.empId) {
        const q = query(
          collection(db, 'users'),
          where('empId', '==', account.empId)
        );
        const snap = await getDocs(q);
        if (snap.empty) {
          setError(`找不到 ${account.empId}，請先註冊`);
          setLoading(false);
          return;
        }
        await signInWithEmailAndPassword(
          auth,
          snap.docs[0].data().email,
          account.pin
        );
      } else {
        try {
          await signInWithEmailAndPassword(
            auth,
            account.email,
            account.password
          );
        } catch (e) {
          if (
            e.code === 'auth/user-not-found' ||
            e.code === 'auth/invalid-credential'
          ) {
            const cred = await createUserWithEmailAndPassword(
              auth,
              account.email,
              account.password
            );
            await setDoc(doc(db, 'users', cred.user.uid), {
              name: '管理員',
              empId: 'ADMIN',
              email: account.email,
              role: 'admin',
              payType: 'monthly',
              monthlySalary: 50000,
              hourlyRate: 300,
              overtimeEnabled: false,
              createdAt: serverTimestamp(),
            });
          } else {
            throw e;
          }
        }
      }
    } catch (err) {
      setError('快速登入失敗：' + err.message);
    }
    setLoading(false);
  }

  // 員工登入
  async function handleEmployeeLogin(e) {
    e.preventDefault();
    if (pin.length !== 10) {
      setError('PIN 碼必須是 10 位數字');
      return;
    }
    reset();
    setLoading(true);
    try {
      const q = query(
        collection(db, 'users'),
        where('empId', '==', empId.trim())
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setError('查無此員工編號');
        setLoading(false);
        return;
      }
      const email = snap.docs[0].data().email;
      await signInWithEmailAndPassword(auth, email, pin);
    } catch (err) {
      const msgs = {
        'auth/invalid-credential': '員工編號或 PIN 碼錯誤',
        'auth/too-many-requests': '嘗試次數過多，請稍後再試',
      };
      setError(msgs[err.code] || '登入失敗：' + err.message);
    }
    setLoading(false);
  }

  // 員工自行註冊
  async function handleEmployeeRegister(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError('請輸入姓名');
      return;
    }
    if (!empId.trim()) {
      setError('請輸入員工編號');
      return;
    }
    if (!/^\d{10}$/.test(pin)) {
      setError('PIN 碼必須是 10 位數字');
      return;
    }
    reset();
    setLoading(true);
    try {
      const existing = await getDocs(
        query(collection(db, 'users'), where('empId', '==', empId.trim()))
      );
      if (!existing.empty) {
        setError('此員工編號已被使用');
        setLoading(false);
        return;
      }
      const email = `${empId.trim().toLowerCase()}@internal.timeclock`;
      const cred = await createUserWithEmailAndPassword(auth, email, pin);
      await setDoc(doc(db, 'users', cred.user.uid), {
        name: name.trim(),
        empId: empId.trim(),
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
      const msgs = { 'auth/email-already-in-use': '此員工編號已被使用' };
      setError(msgs[err.code] || '註冊失敗：' + err.message);
    }
    setLoading(false);
  }

  // 管理員登入
  async function handleAdminLogin(e) {
    e.preventDefault();
    reset();
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, adminEmail, adminPw);
    } catch (err) {
      const msgs = {
        'auth/invalid-credential': '帳號或密碼錯誤',
        'auth/user-not-found': '查無此帳號',
      };
      setError(msgs[err.code] || '登入失敗：' + err.message);
    }
    setLoading(false);
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        backgroundImage:
          'radial-gradient(ellipse at 20% 50%, rgba(245,158,11,0.04) 0%, transparent 60%)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 440, padding: '0 20px' }}>
        {/* Logo */}
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 52,
              height: 52,
              background: 'var(--amber-glow)',
              border: '1px solid rgba(245,158,11,0.4)',
              borderRadius: 12,
              marginBottom: 16,
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--amber)"
              strokeWidth="1.8"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h1
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 20,
              fontWeight: 500,
              color: 'var(--text-primary)',
              letterSpacing: '0.08em',
            }}
          >
            TIMECLOCK
          </h1>
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              fontFamily: 'var(--mono)',
              letterSpacing: '0.06em',
              marginTop: 4,
            }}
          >
            打卡薪資管理系統
          </p>
        </div>

        {/* 快速登入（測試用） */}
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: 'var(--text-muted)',
              marginBottom: 8,
              textAlign: 'center',
            }}
          >
            ⚡ 快速登入（測試用）
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {QUICK_ACCOUNTS.map((acc, i) => (
              <button
                key={i}
                onClick={() => quickLogin(acc)}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  background: i === 0 ? 'var(--amber)' : 'var(--bg-elevated)',
                  color: i === 0 ? '#000' : 'var(--text-secondary)',
                  border: i === 0 ? 'none' : '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                {loading ? '...' : acc.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="card"
          style={{
            padding: 28,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {/* 員工 / 管理員 tab */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              background: 'var(--bg-elevated)',
              borderRadius: 8,
              padding: 4,
            }}
          >
            {[
              ['employee', '員工打卡'],
              ['admin', '管理員'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab(key);
                  setMode('login');
                  reset();
                }}
                style={{
                  padding: '8px 0',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  background: tab === key ? 'var(--amber)' : 'transparent',
                  color: tab === key ? '#000' : 'var(--text-muted)',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 員工：登入 / 註冊 切換 */}
          {tab === 'employee' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6,
                background: 'var(--bg-elevated)',
                borderRadius: 8,
                padding: 4,
              }}
            >
              {[
                ['login', '登入'],
                ['register', '註冊'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setMode(key);
                    reset();
                  }}
                  style={{
                    padding: '7px 0',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    background: mode === key ? 'var(--bg-card)' : 'transparent',
                    color:
                      mode === key
                        ? 'var(--text-primary)'
                        : 'var(--text-muted)',
                    border:
                      mode === key
                        ? '1px solid var(--border)'
                        : '1px solid transparent',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* 員工登入 */}
          {tab === 'employee' && mode === 'login' && (
            <form
              onSubmit={handleEmployeeLogin}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <label style={lbl}>
                <span>員工編號</span>
                <input
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value)}
                  placeholder="例如：E001"
                  required
                />
              </label>
              <label style={lbl}>
                <span>10 位 PIN 碼</span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={10}
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, '').slice(0, 10))
                  }
                  placeholder="輸入 10 位數字"
                  required
                />
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    marginTop: 3,
                  }}
                >
                  {pin.length} / 10 位
                </span>
              </label>
              {error && <div style={errStyle}>{error}</div>}
              <button
                type="submit"
                disabled={loading || pin.length !== 10}
                style={btnStyle}
              >
                {loading ? '登入中...' : '打卡登入'}
              </button>
            </form>
          )}

          {/* 員工註冊 */}
          {tab === 'employee' && mode === 'register' && (
            <form
              onSubmit={handleEmployeeRegister}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <label style={lbl}>
                <span>姓名</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="輸入姓名"
                  required
                />
              </label>
              <label style={lbl}>
                <span>員工編號</span>
                <input
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value)}
                  placeholder="例如：E001"
                  required
                />
              </label>
              <label style={lbl}>
                <span>10 位 PIN 碼（之後登入用）</span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={10}
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, '').slice(0, 10))
                  }
                  placeholder="設定 10 位數字"
                  required
                />
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    marginTop: 3,
                  }}
                >
                  {pin.length} / 10 位
                </span>
              </label>
              <label style={lbl}>
                <span>薪資類型</span>
                <select
                  value={payType}
                  onChange={(e) => setPayType(e.target.value)}
                >
                  <option value="hourly">時薪制</option>
                  <option value="monthly">月薪制</option>
                </select>
              </label>
              {payType === 'hourly' && (
                <label style={lbl}>
                  <span>時薪（元）</span>
                  <input
                    type="number"
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    min={0}
                  />
                </label>
              )}
              {error && <div style={errStyle}>{error}</div>}
              {success && (
                <div
                  style={{
                    background: 'var(--green-glow)',
                    border: '1px solid rgba(34,197,94,0.3)',
                    borderRadius: 6,
                    padding: '10px 14px',
                    color: 'var(--green)',
                    fontSize: 13,
                  }}
                >
                  {success}
                </div>
              )}
              <button
                type="submit"
                disabled={loading || pin.length !== 10}
                style={btnStyle}
              >
                {loading ? '處理中...' : '建立帳號'}
              </button>
            </form>
          )}

          {/* 管理員登入 */}
          {tab === 'admin' && (
            <form
              onSubmit={handleAdminLogin}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <label style={lbl}>
                <span>管理員 Email</span>
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                />
              </label>
              <label style={lbl}>
                <span>密碼</span>
                <input
                  type="password"
                  value={adminPw}
                  onChange={(e) => setAdminPw(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </label>
              {error && <div style={errStyle}>{error}</div>}
              <button type="submit" disabled={loading} style={btnStyle}>
                {loading ? '登入中...' : '管理員登入'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const lbl = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};
const errStyle = {
  background: 'var(--red-glow)',
  border: '1px solid rgba(239,68,68,0.3)',
  borderRadius: 6,
  padding: '10px 14px',
  color: 'var(--red)',
  fontSize: 13,
};
const btnStyle = {
  padding: '12px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  background: 'var(--amber)',
  color: '#000',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  border: 'none',
};
