// src/hooks/useSalaryCalc.js
// 薪資計算核心邏輯
//
// 月薪制公式：
//   每日薪資 = (底薪 ÷ 30) + (餐費 ÷ 30)，依實際出勤天數累計
//   全勤獎金 = $2000（條件：整月無遲到、無請假、無忘打卡）
//   紅利     = 月底手動另計
//
// 時薪制：依實際工時 × 時薪計算（含加班費）

import { differenceInMinutes, format } from 'date-fns';

/**
 * 從打卡紀錄計算每日工時與薪資
 * @param {Array}  punches  - Firestore punch documents
 * @param {Object} profile  - Firestore user profile
 * @param {Array}  leaves   - 當月請假紀錄（可選）
 */
export function calcSalaryFromPunches(punches, profile, leaves = []) {
  if (!punches?.length || !profile) {
    return { dailyRecords: [], totalHours: 0, totalSalary: 0, totalOvertimeHours: 0, salaryBreakdown: null };
  }

  // 依日期分組
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

  // ── 時薪制 ──────────────────────────────────────────────────
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

  // ── 月薪制 ──────────────────────────────────────────────────
  const monthlySalary = profile.monthlySalary || 0;
  const mealAllowance = profile.mealAllowance || 0;  // 月餐費總額
  const FULL_ATTENDANCE_BONUS = 2000;

  const dailyBase = monthlySalary / 30;
  const dailyMeal = mealAllowance / 30;

  let attendedDays = 0;
  let hasLate = false;
  let hasMissedPunch = false;

  Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, dayPunches]) => {
      const sorted = [...dayPunches].sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
      const ins = sorted.filter((p) => p.type === 'in');
      const outs = sorted.filter((p) => p.type === 'out');
      const pairs = Math.min(ins.length, outs.length);
      const isClockedIn = ins.length > outs.length;

      // 忘打卡：有上班卡但沒下班卡（且不是目前進行中）
      if (ins.length > outs.length && !isClockedIn) hasMissedPunch = true;
      if (ins.length !== outs.length && !isClockedIn) hasMissedPunch = true;

      // 遲到判斷
      const dayLate = ins.reduce((acc, p) => acc + (p.lateMinutes || 0), 0);
      if (dayLate > 0) hasLate = true;

      // 計算實際工時（供顯示用）
      let dayMinutes = 0;
      for (let i = 0; i < pairs; i++) {
        const diff = differenceInMinutes(outs[i].timestamp.toDate(), ins[i].timestamp.toDate());
        if (diff > 0) dayMinutes += diff;
      }
      totalMinutes += dayMinutes;

      // 有出勤（有上班卡）才算出勤天數
      if (ins.length > 0) attendedDays++;

      const dayBaseSalary = dailyBase + dailyMeal;
      totalSalary += dayBaseSalary;

      dailyRecords.push({
        date, isClockedIn, pairCount: pairs,
        inTime: ins[0]?.timestamp?.toDate() ? format(ins[0].timestamp.toDate(), 'HH:mm') : null,
        outTime: outs[outs.length - 1]?.timestamp?.toDate() ? format(outs[outs.length - 1].timestamp.toDate(), 'HH:mm') : null,
        hours: dayMinutes > 0 ? dayMinutes / 60 : 0,
        overtimeHours: 0,
        salary: dayBaseSalary,
        lateMinutes: dayLate,
        shiftId: ins[0]?.shiftId || '',
        missedPunch: ins.length !== outs.length && !isClockedIn,
      });
    });

  // 全勤判定
  const approvedLeaves = leaves.filter(l => l.status === 'approved');
  const hasLeave = approvedLeaves.length > 0;
  const hasFullAttendance = !hasLate && !hasLeave && !hasMissedPunch;
  const fullAttendancePay = hasFullAttendance ? FULL_ATTENDANCE_BONUS : 0;

  // 薪資明細（供薪資單顯示）
  const salaryBreakdown = {
    attendedDays,
    dailyBase,
    dailyMeal,
    basePay: Math.round(dailyBase * attendedDays),       // 底薪部分
    mealPay: Math.round(dailyMeal * attendedDays),        // 餐費部分
    fullAttendancePay,                                     // 全勤獎金
    hasFullAttendance,
    hasLate,
    hasLeave,
    hasMissedPunch,
    bonus: 0,                                             // 紅利（月底手動填）
  };

  return {
    dailyRecords,
    totalHours: totalMinutes / 60,
    totalOvertimeHours: 0,
    totalSalary: totalSalary + fullAttendancePay,
    salaryBreakdown,
  };
}

export function fmtMoney(n) {
  return '$' + Math.round(n).toLocaleString('zh-TW');
}

export function fmtHours(h) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}
