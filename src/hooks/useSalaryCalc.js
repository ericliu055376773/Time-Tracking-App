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
export function calcSalaryFromPunches(punches, profile, leaves = [], scheduleAssignments = {}, month = null) {
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
  const STANDARD_MINS = 8 * 60;        // 480 分鐘標準工時
  const OT_UNIT = 10;                   // 每 10 分鐘為一個加班單位
  const OT_RATE_1 = 1.34;              // 加班前 2h 倍率
  const OT_RATE_2 = 1.67;              // 加班 2h 後倍率
  // 月薪員工時薪 = 底薪 ÷ 30天 ÷ 8小時
  const impliedHourlyRate = monthlySalary / 30 / 8;

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

      // ✅ 補打卡豁免：當天有任何一筆 isMakeup 補打卡，視為管理員已確認，
      // 清除遲到紀錄且不算忘打卡，員工仍可獲得全勤獎金
      const hasMakeup = dayPunches.some(p => p.isMakeup === true);

      if (!hasMakeup && ins.length !== outs.length && !isClockedIn) hasMissedPunch = true;

      const dayLate = hasMakeup
        ? 0  // 補打卡日：遲到歸零
        : ins.reduce((acc, p) => acc + (p.lateMinutes || 0), 0);
      if (dayLate > 0) hasLate = true;

      let dayMinutes = 0;
      for (let i = 0; i < pairs; i++) {
        const diff = differenceInMinutes(outs[i].timestamp.toDate(), ins[i].timestamp.toDate());
        if (diff > 0) dayMinutes += diff;
      }
      totalMinutes += dayMinutes;

      const dayBaseSalary = dailyBase + dailyMeal;

      // 加班計算：超過 8 小時的部分，以 10 分鐘為單位
      let dayOvertimeMins = 0;
      let dayOvertimePay = 0;
      if (dayMinutes > STANDARD_MINS) {
        const rawOtMins = dayMinutes - STANDARD_MINS;
        // 無條件捨去至 10 分鐘單位
        const otMins = Math.floor(rawOtMins / OT_UNIT) * OT_UNIT;
        if (otMins > 0) {
          const ot1Mins = Math.min(otMins, 120);           // 前 2h
          const ot2Mins = Math.max(0, otMins - 120);       // 2h 後
          dayOvertimePay =
            (ot1Mins * impliedHourlyRate * OT_RATE_1) / 60 +
            (ot2Mins * impliedHourlyRate * OT_RATE_2) / 60;
          dayOvertimeMins = otMins;
        }
      }
      totalOvertimeMinutes += dayOvertimeMins;

      // ✅ 只有實際有工作時間（或仍在打卡中）的日期才算出勤
      if (ins.length > 0 && (dayMinutes > 0 || isClockedIn)) {
        attendedDays++;
        totalSalary += dayBaseSalary + dayOvertimePay;
      }

      dailyRecords.push({
        date, isClockedIn, pairCount: pairs,
        inTime: ins[0]?.timestamp?.toDate() ? format(ins[0].timestamp.toDate(), 'HH:mm') : null,
        outTime: outs[outs.length - 1]?.timestamp?.toDate() ? format(outs[outs.length - 1].timestamp.toDate(), 'HH:mm') : null,
        hours: dayMinutes > 0 ? dayMinutes / 60 : 0,
        overtimeHours: dayOvertimeMins / 60,
        overtimePay: Math.round(dayOvertimePay),
        salary: dayBaseSalary + dayOvertimePay,
        lateMinutes: dayLate,
        shiftId: ins[0]?.shiftId || '',
        missedPunch: ins.length !== outs.length && !isClockedIn,
      });
    });

  const approvedLeaves = leaves.filter(l => l.status === 'approved');
  // ✅ 全勤只受病假、事假影響；特休、婚假、喪假不扣全勤
  const hasLeave = approvedLeaves.some(l => l.type === "病假" || l.type === "事假");

  // ✅ 排班驗證：取得本月所有排班日，檢查是否有缺勤（有排班但無打卡）
  const empId = profile.id || profile.uid || '';
  const monthPrefix = month || (Object.keys(byDate)[0] || '').slice(0, 7);
  const scheduledDates = Object.keys(scheduleAssignments)
    .filter(key => key.startsWith(`${empId}_${monthPrefix}`))
    .map(key => key.replace(`${empId}_`, ''));
  const hasAbsent = scheduledDates.some(date => {
    const dayPunches = byDate[date] || [];
    const ins = dayPunches.filter(p => p.type === 'in');
    const outs = dayPunches.filter(p => p.type === 'out');
    const pairs = Math.min(ins.length, outs.length);
    const isClockedIn = ins.length > outs.length;
    let dayMinutes = 0;
    for (let i = 0; i < pairs; i++) {
      const diff = differenceInMinutes(outs[i].timestamp.toDate(), ins[i].timestamp.toDate());
      if (diff > 0) dayMinutes += diff;
    }
    // 有排班但沒有有效打卡 = 缺勤
    return ins.length === 0 || (!isClockedIn && dayMinutes === 0);
  });

  // 全勤獎金：管理員月底手動結算，條件達成即發放
  const now = new Date();
  const [sy, sm] = monthPrefix.split('-').map(Number);
  const isCurrentMonth = !isNaN(sy) && now.getFullYear() === sy && (now.getMonth() + 1) === sm;

  const hasFullAttendance = !hasLate && !hasLeave && !hasMissedPunch && !hasAbsent;
  const fullAttendancePay = hasFullAttendance ? FULL_ATTENDANCE_BONUS : 0;

  const overtimePay = Math.round(
    dailyRecords.reduce((sum, r) => sum + (r.overtimePay || 0), 0)
  );

  const salaryBreakdown = {
    attendedDays,
    dailyBase,
    dailyMeal,
    basePay: Math.round(dailyBase * attendedDays),
    mealPay: Math.round(dailyMeal * attendedDays),
    overtimePay,                          // 月薪加班費
    impliedHourlyRate: Math.round(impliedHourlyRate), // 換算時薪（底薪÷30÷8）
    fullAttendancePay,
    hasFullAttendance,
    hasLate,
    hasLeave,
    hasMissedPunch,
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
  return '$' + Math.round(n).toLocaleString('zh-TW');
}

export function fmtHours(h) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}
