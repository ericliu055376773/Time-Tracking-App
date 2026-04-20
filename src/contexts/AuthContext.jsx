// src/contexts/NavContext.jsx
// 供員工頁面控制側邊欄導航用
import React, { createContext, useContext, useState } from 'react';

const NavContext = createContext(null);

export function NavProvider({ children }) {
  const [activePage, setActivePage] = useState('punch'); // 'punch' | 'stats'
  return (
    <NavContext.Provider value={{ activePage, setActivePage }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNav() {
  return useContext(NavContext);
}
