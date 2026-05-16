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
        try {
          const docRef = doc(db, 'users', firebaseUser.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            setProfile({ id: docSnap.id, ...docSnap.data() });
          } else if (firebaseUser.email === ADMIN_EMAIL) {
            // 管理員帳號存在於 Auth 但 Firestore 資料遺失，自動補建
            const adminData = {
              name: '管理員', empId: 'ADMIN', email: ADMIN_EMAIL,
              role: 'admin', payType: 'monthly', monthlySalary: 50000,
              hourlyRate: 300, overtimeEnabled: false,
            };
            await setDoc(docRef, adminData);
            setProfile({ id: docSnap.id, ...adminData });
          }
        } catch (err) {
          console.error('Failed to load profile:', err);
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
