import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ADMIN_EMAIL = 'admin@test.com';
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        // ✅ 管理員：Firebase Auth email 已驗證，不依賴 Firestore 就可進後台
        if (firebaseUser.email === ADMIN_EMAIL) {
          setProfile({ id: firebaseUser.uid, role: 'admin', name: '管理員', email: ADMIN_EMAIL });
          // 背景嘗試從 Firestore 同步更完整的資料（失敗不影響登入）
          getDoc(doc(db, 'users', firebaseUser.uid))
            .then(snap => {
              if (snap.exists()) {
                setProfile({ id: snap.id, ...snap.data() });
              } else {
                setDoc(doc(db, 'users', firebaseUser.uid), {
                  name: '管理員', empId: 'ADMIN', email: ADMIN_EMAIL,
                  role: 'admin', payType: 'monthly', monthlySalary: 50000,
                  hourlyRate: 300, overtimeEnabled: false,
                }).catch(() => {});
              }
            }).catch(() => {}); // 失敗靜默，profile 已設好
        } else {
          try {
            const docRef = doc(db, 'users', firebaseUser.uid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
              setProfile({ id: docSnap.id, ...docSnap.data() });
            }
          } catch (err) {
            console.error('Failed to load profile:', err);
          }
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  async function logout() {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('登出失敗：', err);
    }
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, setProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
