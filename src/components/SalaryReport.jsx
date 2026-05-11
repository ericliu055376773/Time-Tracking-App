以下是完整內容，直接複製貼上到 `src/hooks/useSalaryCalc.js`：

```javascript
// src/hooks/useSalaryCalc.js
// 薪資計算核心邏輯
//
// 月薪制公式：
//   每日薪資 = (底薪 ÷ 30) + (餐費 ÷ 30)，依實際出勤天數累計
//   全勤獎金 = $2000（條件：整月無遲到、無請假、無忘打卡）
//   紅利     = 月底手動另計
//
// 時薪制：依實際工時 × 時薪計算（含加班費）

import { differenceInMinutes, format, getDaysInMonth, parseISO } from 'date-fns';

/**
 * 從打卡紀錄計算每日工時與薪資
 * @param {Array}  punches  - Firestore punch documents
 * @param {Object} profile  - Firestore user profile
 * @param {Array}  leaves   - 當月請假紀錄（可選）
 */
export function calcSalaryFromPunches(punches, profile, leaves = [], scheduleAssignments = {}, month = null, maxMissedPunchForFullAtt = 0, salaryRules = {}) {
  if (!punches?.length || !profile) {
    return { dailyRecords: [], totalHours: 0, totalSalary: 0, totalOvertimeHours: 0, salaryBreakdown: null };
  }

  const byDate = {};
  punches.forEach((p) => {
    const date = p.date || format(p.timestamp?.toDate(), 'yyyy-MM-dd');
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(p);
  });

  const dailyRecords = [];
  let totalMinutes = 0;
  let totalOvertimeMinutes = 0;
  let totalSalary = 0;

  if (profile.payType === 'hourly') {
    const STANDARD_HOURS = 8;
    const OVERTIME_RATE_1 = 1.34;
    const OVERTIME_RATE_2 = 1.67;
    const baseHourlyRate = profile.hourlyRate || 0;

    Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([date, dayPunches]) => {
        const sorted = [...dayPunches].sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
        const ins = sorted.filter((p) => p.type === 'in');
        const outs = sorted.filter((p) => p.type === 'out');
        let dayMinutes = 0;
        const pairs = Math.min(ins.length, outs.length);
        for (let i = 0; i < pairs; i++) {
          const diff = differenceInMinutes(outs[i].timestamp.toDate(), ins[i].timestamp.toDate());
          if (diff > 0) dayMinutes += diff;
        }
        const isClockedIn = ins.length > outs.length;
        const dayHours = dayMinutes / 60;
        totalMinutes += dayMinutes;

        let daySalary = 0;
        let dayOvertimeMins = 0;
        if (profile.overtimeEnabled && dayHours > STANDARD_HOURS) {
          const overtimeMinutes = dayMinutes - STANDARD_HOURS * 60;
          dayOvertimeMins = overtimeMinutes;
          const ot1Mins = Math.min(overtimeMinutes, 120);
          const ot2Mins = Math.max(0, overtimeMinutes - 120);
          daySalary = STANDARD_HOURS * baseHourlyRate
            + (ot1Mins / 60) * baseHourlyRate * OVERTIME_RATE_1
            + (ot2Mins / 60) * baseHourlyRate * OVERTIME_RATE_2;
        } else {
          daySalary = dayHours * baseHourlyRate;
        }
        totalOvertimeMinutes += dayOvertimeMins;
        totalSalary += daySalary;

        dailyRecords.push({
          date, isClockedIn, pairCount: pairs,
          inTime: ins[0]?.timestamp?.toDate() ? format(ins[0].timestamp.toDate(), 'HH:mm') : null,
          outTime: outs[outs.length - 1]?.timestamp?.toDate() ? format(outs[outs.length - 1].timestamp.toDate(), 'HH:mm') : null,
          hours: dayMinutes > 0 ? dayHours : 0,
          overtimeHours: dayOvertimeMins / 60,
          salary: daySalary,
          lateMinutes: ins[0]?.lateMinutes || 0,
          shiftId: ins[0]?.shiftId || '',
          missedPunch: ins.length !== outs.length,
        });
      });

    return { dailyRecords, totalHours: totalMinutes / 60, totalOvertimeHours: totalOvertimeMinutes / 60, totalSalary, salaryBreakdown: null };
  }

  const pos = profile._position || null;
  const monthlySalary = pos?.baseSalary ?? profile.monthlySalary ?? 0;
  const mealAllowance = pos?.mealAllowance ?? profile.mealAllowance ?? 0;
  const FULL_ATTENDANCE_BONUS = 2000;
  const STANDARD_MINS = 8 * 60;
  const OT_UNIT = 10;
  const OT_RATE_1 = 1.34;
  const OT_RATE_2 = 1.67;

  const monthPrefix2 = month || (Object.keys(byDate)[0] || '').slice(0, 7);
  const daysInThisMonth = monthPrefix2
    ? getDaysInMonth(parseISO(monthPrefix2 + '-01'))
    : 30;

  const impliedHourlyRate = monthlySalary / daysInThisMonth / 8;
  const dailyBase = monthlySalary / daysInThisMonth;
  const dailyMeal = mealAllowance / daysInThisMonth;
  const workingDaysBase = daysInThisMonth;
  const monthlyRestDays = null;

  let attendedDays = 0;
  let hasLate = false;
  let missedPunchCount = 0;

  Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, dayPunches]) => {
      const sorted = [...dayPunches].sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
      const ins = sorted.filter((p) => p.type === 'in');
      const outs = sorted.filter((p) => p.type === 'out');
      const pairs = Math.min(ins.length, outs.length);
      const isClockedIn = ins.length > outs.length;

      const hasMakeup = dayPunches.some(p => p.isMakeup === true);

      if (!hasMakeup && ins.length !== outs.length && !isClockedIn) {
        missedPunchCount++;
      }

      const dayLate = hasMakeup ? 0 : ins.reduce((acc, p) => acc + (p.lateMinutes || 0), 0);
      if (dayLate > 0) hasLate = true;

      let dayMinutes = 0;
      for (let i = 0; i < pairs; i++) {
        const diff = differenceInMinutes(outs[i].timestamp.toDate(), ins[i].timestamp.toDate());
        if (diff > 0) dayMinutes += diff;
      }
      totalMinutes += dayMinutes;

      const dayBaseSalary = dailyBase + dailyMeal;

      let dayOvertimeMins = 0;
      let dayOvertimePay = 0;
      let dayOt1Mins = 0;
      let dayOt2Mins = 0;
      if (dayMinutes > STANDARD_MINS) {
        const rawOtMins = dayMinutes - STANDARD_MINS;
        const otMins = Math.floor(rawOtMins / OT_UNIT) * OT_UNIT;
        if (otMins > 0) {
          const ot1Mins = Math.min(otMins, 120);
          const ot2Mins = Math.max(0, otMins - 120);
          dayOvertimePay =
            (ot1Mins * impliedHourlyRate * OT_RATE_1) / 60 +
            (ot2Mins * impliedHourlyRate * OT_RATE_2) / 60;
          dayOvertimeMins = otMins;
          dayOt1Mins = ot1Mins;
          dayOt2Mins = ot2Mins;
        }
      }
      totalOvertimeMinutes += dayOvertimeMins;

      if (pairs > 0) {
        attendedDays++;
        totalSalary += dayOvertimePay;
      }

      dailyRecords.push({
        date, isClockedIn, pairCount: pairs,
        inTime: ins[0]?.timestamp?.toDate() ? format(ins[0].timestamp.toDate(), 'HH:mm') : null,
        outTime: outs[outs.length - 1]?.timestamp?.toDate() ? format(outs[outs.length - 1].timestamp.toDate(), 'HH:mm') : null,
        hours: dayMinutes > 0 ? dayMinutes / 60 : 0,
        overtimeHours: dayOvertimeMins / 60,
        overtimeMins: dayOvertimeMins,
        ot1Mins: dayOt1Mins,
        ot2Mins: dayOt2Mins,
        overtimePay: Math.round(dayOvertimePay),
        salary: dayBaseSalary + dayOvertimePay,
        lateMinutes: dayLate,
        shiftId: ins[0]?.shiftId || '',
        missedPunch: ins.length !== outs.length && !isClockedIn,
      });
    });

  const approvedLeaves = leaves.filter(l => l.status === 'approved');
  const hasLeave = approvedLeaves.some(l => l.type === "病假" || l.type === "事假");

  const personalLeaveDays = approvedLeaves.filter(l => l.type === '事假').length;
  const sickLeaveDays     = approvedLeaves.filter(l => l.type === '病假').length;
  const personalDeduction = Math.round((dailyBase + dailyMeal) * personalLeaveDays);
  const sickDeduction     = Math.round((dailyBase * 0.5 + dailyMeal) * sickLeaveDays);
  const leaveDeduction    = personalDeduction + sickDeduction;

  totalSalary = monthlySalary + mealAllowance - leaveDeduction + totalSalary;

  const empId = profile.id || profile.uid || '';
  const monthPrefix = month || (Object.keys(byDate)[0] || '').slice(0, 7);
  const scheduledDates = Object.keys(scheduleAssignments)
    .filter(key => key.startsWith(`${empId}_${monthPrefix}`))
    .map(key => key.replace(`${empId}_`, ''));
  const hasAbsent = scheduledDates.length === 0 || scheduledDates.some(date => {
    const dayPunches = byDate[date] || [];
    const ins = dayPunches.filter(p => p.type === 'in');
    const outs = dayPunches.filter(p => p.type === 'out');
    const pairsCount = Math.min(ins.length, outs.length);
    return pairsCount === 0;
  });

  const now = new Date();
  const [sy, sm] = monthPrefix.split('-').map(Number);
  const isCurrentMonth = !isNaN(sy) && now.getFullYear() === sy && (now.getMonth() + 1) === sm;

  const hasMissedPunch = missedPunchCount > maxMissedPunchForFullAtt;
  const hasFullAttendance = !hasLate && !hasLeave && !hasMissedPunch && !hasAbsent;
  const fullAttendancePay = hasFullAttendance ? FULL_ATTENDANCE_BONUS : 0;

  const overtimePay = Math.round(
    dailyRecords.reduce((sum, r) => sum + (r.overtimePay || 0), 0)
  );
  const totalOt1Mins = dailyRecords.reduce((sum, r) => sum + (r.ot1Mins || 0), 0);
  const totalOt2Mins = dailyRecords.reduce((sum, r) => sum + (r.ot2Mins || 0), 0);
  const totalOtMins  = dailyRecords.reduce((sum, r) => sum + (r.overtimeMins || 0), 0);

  const salaryBreakdown = {
    attendedDays,
    dailyBase,
    dailyMeal,
    workingDaysBase,
    monthlyRestDays,
    basePay: monthlySalary,
    mealPay: mealAllowance,
    personalLeaveDays,
    sickLeaveDays,
    personalDeduction,
    sickDeduction,
    leaveDeduction,
    overtimePay,
    totalOtMins,
    totalOt1Mins,
    totalOt2Mins,
    impliedHourlyRate: Math.round(impliedHourlyRate),
    fullAttendancePay,
    hasFullAttendance,
    hasLate,
    hasLeave,
    hasMissedPunch,
    missedPunchCount,
    maxMissedPunchForFullAtt,
    hasAbsent,
    isCurrentMonth,
    scheduledDays: scheduledDates.length,
    bonus: 0,
  };

  return {
    dailyRecords,
    totalHours: totalMinutes / 60,
    totalOvertimeHours: totalOvertimeMinutes / 60,
    totalSalary: totalSalary + fullAttendancePay,
    salaryBreakdown,
  };
}

export function fmtMoney(n) {
  if (n == null || isNaN(n)) return '--';
  return '$' + Math.round(n).toLocaleString('zh-TW');
}

export function fmtHours(h) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}
```
