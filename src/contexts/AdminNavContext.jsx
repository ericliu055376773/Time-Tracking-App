// src/contexts/AdminNavContext.jsx
import React, { createContext, useContext, useState } from 'react';

const AdminNavContext = createContext({ activeTab: '薪資結算', setActiveTab: () => {}, pendingLeaveCount: 0, setPendingLeaveCount: () => {} });

export function AdminNavProvider({ children }) {
  const [activeTab, setActiveTab] = useState('薪資結算');
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);
  return (
    <AdminNavContext.Provider value={{ activeTab, setActiveTab, pendingLeaveCount, setPendingLeaveCount }}>
      {children}
    </AdminNavContext.Provider>
  );
}

export function useAdminNav() {
  return useContext(AdminNavContext);
}
