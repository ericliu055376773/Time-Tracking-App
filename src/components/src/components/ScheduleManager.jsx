import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { format, addDays, startOfWeek, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';

export default function ScheduleManager() {
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [schedule, setSchedule] = useState({});
  const [weekStart, setWeekStart] = useState(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(parseISO(weekStart), i);
    return { date: format(d, 'yyyy-MM-dd'), label: format(d, 'MM/dd EEE', { locale: zhTW }) };
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const empSnap = await getDocs(collection(db, 'users'));
        const emps = empSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.role === 'employee');
        setEmployees(emps);
        const shiftSnap = await getDoc(doc(db, 'settings', 'shifts'));
        setShifts(shiftSnap.exists() ? (shiftSnap.data().list || []) : []);
        const schedSnap = await getDoc(doc(db, 'settings', 'schedule'));
        setSchedule(schedSnap.exists() ? (schedSnap.data().assignments || {}) : {});
      } catch (err) { console.error(err); }
      setLoading(false);
    }
    load();
  }, [weekStart]);

  async function setAssignment(empId, date, shiftId) {
    const key = `${empId}_${date}`;
    const newSchedule = { ...schedule };
    if (shiftId === '') { delete newSchedule[key]; } else { newSchedule[key] = shiftId; }
    setSchedule(newSchedule);
    setSaving(true);
    await setDoc(doc(db, 'settings', 'schedule'), { assignments: newSchedule });
    setSaving(false);
  }

  function getAssignment(empId, date) { return schedule[`${empId}_${date}`] || ''; }
  function getShift(shiftId) { return shifts.find(s => s.id === shiftId); }
  function prevWeek() { setWeekStart(format(addDays(parseISO(weekStart), -7), 'yyyy-MM-dd')); }
  function nextWeek() { setWeekStart(format(addDays(parseISO(weekStart), 7), 'yyyy-MM-dd')); }
  function goToday() { setWeekStart(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')); }

  const today = format(new Date(), 'yyyy-MM-dd');

  if (loading) return <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 12, padding: 20 }}>載入中...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>排班管理</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
            為每位員工指定每日班別 · 員工打卡時自動驗證
            {saving && <span style={{ color: 'var(--amber)', marginLeft: 10 }}>儲存中...</span>}
          </div
