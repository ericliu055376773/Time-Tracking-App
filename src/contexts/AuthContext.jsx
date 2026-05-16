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
        if (firebaseUser.email === ADMIN_EMAIL) {
          // ✅ 先確保 Firestore 管理員文件存在（isAdmin() 需要這份文件）
          const adminRef = doc(db, 'users', firebaseUser.uid);
          const adminData = {
            name: '管理員', empId: 'ADMIN', email: ADMIN_EMAIL,
            role: 'admin', payType: 'monthly', monthlySalary: 50000,
            hourlyRate: 300, overtimeEnabled: false,
          };
          try {
            const snap = await getDoc(adminRef);
            if (!snap.exists()) {
              // 文件不存在，建立它（allow create: if request.auth != null）
              await setDoc(adminRef, adminData);
              setProfile({ id: firebaseUser.uid, ...adminData });
            } else {
              setProfile({ id: snap.id, ...snap.data() });
            }
          } catch (err) {
            console.error('Admin Firestore sync failed:', err);
            // Firestore 失敗仍允許進後台，但 isAdmin() 查詢可能受限
            setProfile({ id: firebaseUser.uid, ...adminData });
          }
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
