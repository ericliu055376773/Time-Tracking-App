// src/hooks/useSalaryCalc.js
// 薪資計算核心邏輯（含加班費）
// 加班規則（依台灣勞基法）：
//   前2小時：1.34倍；第3小時起：1.67倍
//   每日超過8小時開始算加班

import { differenceInMinutes, format } from 'date-fns';

/**
 * 從打卡紀錄計算每日工時與薪資
 * @param {Array}  punches  - Firestore punch documents (含 timestamp, type, date)
 * @param {Object} profile  - Firestore user profile (payType, hourlyRate, monthlySalary, overtimeEnabled)
 * @returns {{ dailyRecords, totalHours, totalSalary, totalOvertimeHours }}
 */
export function calcSalaryFromPunches(punches, profile) {
  if (!punches?.length || !profile) {
    return {
      dailyRecords: [],
      totalHours: 0,
      totalSalary: 0,
      totalOvertimeHours: 0,
    };
  }

  // 依日期分組
  const byDate = {};
  punches.forEach((p) => {
    const date = p.date || format(p.timestamp?.toDate(), 'yyyy-MM-dd');
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(p);
  });

  const STANDARD_HOURS = 8;
  const OVERTIME_RATE_1 = 1.34; // 加班前2小時
  const OVERTIME_RATE_2 = 1.67; // 加班第3小時起

  // 計算時薪基準
  const baseHourlyRate =
    profile.payType === 'hourly'
      ? profile.hourlyRate || 0
      : (profile.monthlySalary || 0) / 160;

  const dailyRecords = [];
  let totalMinutes = 0;
  let totalOvertimeMinutes = 0;
  let totalSalary = 0;

  Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, dayPunches]) => {
      const sorted = [...dayPunches].sort(
        (a, b) =>
          (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0)
      );
      const ins = sorted.filter((p) => p.type === 'in');
      const outs = sorted.filter((p) => p.type === 'out');

      // 配對上下班，計算實際工作分鐘
      let dayMinutes = 0;
      const pairs = Math.min(ins.length, outs.length);
      for (let i = 0; i < pairs; i++) {
        const diff = differenceInMinutes(
          outs[i].timestamp.toDate(),
          ins[i].timestamp.toDate()
        );
        if (diff > 0) dayMinutes += diff;
      }

      // 目前仍在上班中（最後一筆是 in，無對應 out）
      const isClockedIn = ins.length > outs.length;

      const dayHours = dayMinutes / 60;
      totalMinutes += dayMinutes;

      // ── 加班費計算 ─────────────────────────────
      let daySalary = 0;
      let dayOvertimeMins = 0;

      if (profile.overtimeEnabled && dayHours > STANDARD_HOURS) {
        const standardSalary = STANDARD_HOURS * baseHourlyRate;
        const overtimeMinutes = dayMinutes - STANDARD_HOURS * 60;
        dayOvertimeMins = overtimeMinutes;

        const ot1Mins = Math.min(overtimeMinutes, 120); // 前2小時
        const ot2Mins = Math.max(0, overtimeMinutes - 120); // 第3小時起

        const ot1Salary = (ot1Mins / 60) * baseHourlyRate * OVERTIME_RATE_1;
        const ot2Salary = (ot2Mins / 60) * baseHourlyRate * OVERTIME_RATE_2;

        daySalary = standardSalary + ot1Salary + ot2Salary;
      } else {
        daySalary = dayHours * baseHourlyRate;
      }

      totalOvertimeMinutes += dayOvertimeMins;
      totalSalary += daySalary;

      dailyRecords.push({
        date,
        inTime: ins[0]?.timestamp?.toDate()
          ? format(ins[0].timestamp.toDate(), 'HH:mm')
          : null,
        outTime: outs[outs.length - 1]?.timestamp?.toDate()
          ? format(outs[outs.length - 1].timestamp.toDate(), 'HH:mm')
          : null,
        hours: dayMinutes > 0 ? dayHours : 0,
        overtimeHours: dayOvertimeMins / 60,
        salary: daySalary,
        isClockedIn,
        pairCount: pairs,
      });
    });

  // 月薪制：以 160 小時為全勤基準上限
  if (profile.payType === 'monthly' && !profile.overtimeEnabled) {
    const cappedHours = Math.min(totalMinutes / 60, 160);
    totalSalary = (cappedHours / 160) * (profile.monthlySalary || 0);
  }

  return {
    dailyRecords,
    totalHours: totalMinutes / 60,
    totalOvertimeHours: totalOvertimeMinutes / 60,
    totalSalary,
  };
}
/**
 * 格式化貨幣
 */
export function fmtMoney(n) {
  return '$' + Math.round(n).toLocaleString('zh-TW');
}

/**
 * 格式化小時數
 */
export function fmtHours(h) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}
