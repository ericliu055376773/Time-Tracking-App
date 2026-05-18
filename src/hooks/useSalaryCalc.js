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
export function calcSalaryFromPunches(punches, profile, leaves = [], scheduleAssignments = {}, month = null, maxMissedPunchForFullAtt = 0, salaryRules = {}, nationalHolidays = [], lateGraceMinutes = 0) {
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

  // 日薪基準 = 底薪 ÷ 行政院當月總天數（5月=31天、4月=30天）
  const monthPrefix2 = month || (Object.keys(byDate)[0] || '').slice(0, 7);
  const daysInThisMonth = monthPrefix2
    ? getDaysInMonth(parseISO(monthPrefix2 + '-01'))
    : 30;

  // 月薪員工時薪 = 底薪 ÷ 當月天數 ÷ 8小時（用於加班費計算）
  const impliedHourlyRate = monthlySalary / daysInThisMonth / 8;

  // 日薪基準（用於請假扣款，依當月實際天數）
  const dailyBase = monthlySalary / daysInThisMonth;
  const dailyMeal = mealAllowance / daysInThisMonth;
  const workingDaysBase = daysInThisMonth;  // 供顯示用
  const monthlyRestDays = null;             // 不再使用

  let attendedDays = 0;
  let hasLate = false;
  let missedPunchCount = 0;  // 未補打的忘打卡次數

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

      if (!hasMakeup && ins.length !== outs.length && !isClockedIn) {
        // 未補打且有不成對的打卡 = 忘打卡未處理，計入次數
        missedPunchCount++;
      }
      // hasMakeup = 管理員已補打，視為處理完畢，不計次數

      // dayLateRaw：實際遲到分鐘（扣薪用，不受補打影響）
      const dayLateRaw = ins.reduce((acc, p) => acc + (p.lateMinutes || 0), 0);
      // dayLate：全勤判定用，補打視為準時
      const dayLate = hasMakeup ? 0 : dayLateRaw;
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
      let dayOt1Mins = 0;
      let dayOt2Mins = 0;
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
          dayOt1Mins = ot1Mins;
          dayOt2Mins = ot2Mins;
        }
      }
      totalOvertimeMinutes += dayOvertimeMins;

      // 國定假日：月薪員工有出勤則額外加一天薪水（雙薪）
      const isNationalHoliday = nationalHolidays.includes(date);
      const dayHolidayPay = (isNationalHoliday && pairs > 0) ? dailyBase : 0; // 國定假日加給只計底薪，不含餐費

      // ✅ 月薪制：有完整上下班打卡對（pairs > 0）就算出勤一天
      if (pairs > 0) {
        attendedDays++;
        totalSalary += dayOvertimePay + dayHolidayPay;
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
        salary: dayBaseSalary + dayOvertimePay + (isNationalHoliday && pairs > 0 ? dayHolidayPay : 0),
        isNationalHoliday,
        holidayPay: Math.round(isNationalHoliday && pairs > 0 ? dayHolidayPay : 0),
        lateMinutes: dayLateRaw,
        shiftId: ins[0]?.shiftId || '',
        missedPunch: ins.length !== outs.length && !isClockedIn,
      });
    });

  const approvedLeaves = leaves.filter(l => l.status === 'approved');
  // ✅ 全勤只受病假、事假影響；特休、婚假、喪假不扣全勤
  const hasLeave = approvedLeaves.some(l => l.type === "病假" || l.type === "事假");

  // ── 月薪固定全額，僅事假/病假扣款，特休不扣 ──────────────────
  const personalLeaveDays = approvedLeaves.filter(l => l.type === '事假').length;
  const sickLeaveDays     = approvedLeaves.filter(l => l.type === '病假').length;
  // 事假：底薪全扣 + 餐費全扣
  const personalDeduction = Math.round((dailyBase + dailyMeal) * personalLeaveDays);
  // 病假：底薪半扣 + 餐費全扣
  const sickDeduction     = Math.round((dailyBase * 0.5 + dailyMeal) * sickLeaveDays);
  const leaveDeduction    = personalDeduction + sickDeduction;

  // 底薪全額 + 餐費全額 - 請假扣款 + 加班費（overtime 已在 totalSalary 中累計）
  // 遲到扣薪：每分鐘工資 × 有效遲到分鐘（超過寬限才扣）
  const perMinuteRate = monthlySalary / daysInThisMonth / 8 / 60;
  const totalEffectiveLateMinutes = dailyRecords.reduce((sum, r) => {
    const effective = Math.max(0, (r.lateMinutes || 0) - lateGraceMinutes);
    return sum + effective;
  }, 0);
  const lateDeductionAmt = Math.round(totalEffectiveLateMinutes * perMinuteRate);

  totalSalary = monthlySalary + mealAllowance - leaveDeduction - lateDeductionAmt + totalSalary;

  // ✅ 排班驗證：取得本月所有排班日，檢查是否有缺勤（有排班但無打卡）
  const empId = profile.id || profile.uid || '';
  const monthPrefix = month || (Object.keys(byDate)[0] || '').slice(0, 7);
  const scheduledDates = Object.keys(scheduleAssignments)
    .filter(key => key.startsWith(`${empId}_${monthPrefix}`))
    .map(key => key.replace(`${empId}_`, ''));
  // 沒有設定排班 = 無法驗證出滿班次 = 視為缺勤，不發全勤
  const hasAbsent = scheduledDates.length === 0 || scheduledDates.some(date => {
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
    // 有排班但沒有完整的上下班打卡對 = 缺勤
    // pairs = 0 包含：完全沒打卡、只打上班沒下班（isClockedIn）
    const pairsCount = Math.min(ins.length, outs.length);
    return pairsCount === 0;
  });

  // 全勤獎金：管理員月底手動結算，條件達成即發放
  const now = new Date();
  const [sy, sm] = monthPrefix.split('-').map(Number);
  const isCurrentMonth = !isNaN(sy) && now.getFullYear() === sy && (now.getMonth() + 1) === sm;

  // 未補打的忘打卡次數超過閾值才失去全勤；有補打卡 = 0次
  const hasMissedPunch = missedPunchCount > maxMissedPunchForFullAtt;
  const hasFullAttendance = !hasLate && !hasLeave && !hasMissedPunch && !hasAbsent;
  const fullAttendancePay = hasFullAttendance ? FULL_ATTENDANCE_BONUS : 0;

  const overtimePay = Math.round(
    dailyRecords.reduce((sum, r) => sum + (r.overtimePay || 0), 0)
  );
  const holidayPay = Math.round(
    dailyRecords.reduce((sum, r) => sum + (r.holidayPay || 0), 0)
  );
  const holidayDays = dailyRecords.filter(r => r.isNationalHoliday && r.pairCount > 0).length;
  const totalOt1Mins = dailyRecords.reduce((sum, r) => sum + (r.ot1Mins || 0), 0);
  const totalOt2Mins = dailyRecords.reduce((sum, r) => sum + (r.ot2Mins || 0), 0);
  const totalOtMins  = dailyRecords.reduce((sum, r) => sum + (r.overtimeMins || 0), 0);

  const salaryBreakdown = {
    attendedDays,
    dailyBase,
    dailyMeal,
    workingDaysBase,                       // 月工作天數基準（30 - 月休天數）
    monthlyRestDays,
    basePay: monthlySalary,                // ✅ 固定全額底薪
    mealPay: mealAllowance,                // ✅ 固定全額餐費
    personalLeaveDays,                     // 事假天數
    sickLeaveDays,                         // 病假天數
    personalDeduction,                     // 事假扣款
    sickDeduction,                         // 病假扣款
    leaveDeduction,
    lateDeductionAmt,
    totalEffectiveLateMinutes,
    lateGraceMinutes,
    perMinuteRate: Math.round(perMinuteRate * 100) / 100,
    overtimePay,
    holidayPay,
    holidayDays,
    totalOtMins,
    totalOt1Mins,   // 前2h加班分鐘數
    totalOt2Mins,   // 2h後加班分鐘數
    impliedHourlyRate: Math.round(impliedHourlyRate), // 換算時薪（底薪÷工作天數÷8）
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
    totalSalary: totalSalary + fullAttendancePay,  // 含國定假日加給  // 底薪+餐費-請假扣款+加班+全勤
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
