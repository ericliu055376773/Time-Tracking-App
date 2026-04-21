// src/contexts/AdminNavContext.jsx
import React, { createContext, useContext, useState } from 'react';

const AdminNavContext = createContext({ activeTab: '薪資結算', setActiveTab: () => {} });

export function AdminNavProvider({ children }) {
  const [activeTab, setActiveTab] = useState('薪資結算');
  return (
    <AdminNavContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </AdminNavContext.Provider>
  );
}

export function useAdminNav() {
  return useContext(AdminNavContext);
}
