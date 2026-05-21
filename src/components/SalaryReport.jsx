// src/components/SalaryReport.jsx
// 薪資單：管理員可為任一員工產生指定月份薪資單，並列印/匯出
import React, { useState, useRef, useEffect } from 'react';
import { fetchTaiwanHolidaysForMonth } from '../utils/fetchHolidays';
import {
  calcSalaryFromPunches,
  fmtMoney,
  fmtHours,
} from '../hooks/useSalaryCalc';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';

export default function SalaryReport({
  employee,
  punches,
  leaves = [],
  month,
  scheduleAssignments = {},
  maxMissedPunch = 0,
  salaryRules = {},
  snapshot = null,
  nationalHolidays = [],  // 父層傳入，若為空則自動抓
  lateGraceMinutes = 5,
}) {
  // 若父層沒有傳假日資料，SalaryReport 自行根據 month 呼叫 API
  const [selfHolidays, setSelfHolidays] = useState(null);
  useEffect(() => {
    if (!month || (nationalHolidays && nationalHolidays.length > 0)) return;
    fetchTaiwanHolidaysForMonth(month).then(setSelfHolidays).catch(() => setSelfHolidays([]));
  }, [month, nationalHolidays]);
  // 優先用父層傳入，沒有則用自己抓的
  const effectiveHolidays = (nationalHolidays && nationalHolidays.length > 0) ? nationalHolidays : (selfHolidays || []);
  const printRef = useRef(null);
  const [showReport, setShowReport] = useState(false);

  if (!employee || !month) return null;

  // ── 快照模式：讀取已結算資料，唯讀 ──────────────────────────
  if (snapshot && !showReport) {
    return (
      <button onClick={() => setShowReport(true)} style={{
        padding: '6px 14px', background: 'rgba(34,197,94,0.12)',
        color: 'var(--green)', border: '1px solid rgba(34,197,94,0.35)',
        borderRadius: 6, fontSize: 12, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
      }}>
        🔒 薪資單
      </button>
    );
  }

  // 注入職位資料供薪資計算使用
  const empForCalc = employee._position
    ? { ...employee, monthlySalary: employee._position.baseSalary, mealAllowance: employee._position.mealAllowance }
    : employee;

  // ✅ 包在 try-catch：計算失敗時仍顯示按鈕，不讓整個元件崩潰
  let calcResult = { dailyRecords: [], totalHours: 0, totalOvertimeHours: 0, totalSalary: 0, salaryBreakdown: null };
  let calcError = null;
  try {
    calcResult = calcSalaryFromPunches(punches, empForCalc, leaves, scheduleAssignments, month, maxMissedPunch, salaryRules, effectiveHolidays, lateGraceMinutes);
  } catch (err) {
    calcError = err.message;
    console.error('SalaryReport calcError:', err);
  }
  const { dailyRecords, totalHours, totalOvertimeHours, totalSalary, salaryBreakdown } = calcResult;

  // 計算請假扣薪（時薪制才扣，月薪制已在計算中處理）
  const approvedLeaves = leaves.filter(
    (l) => l.status === 'approved' && l.uid === employee.id
  );
  const leaveDeductions = employee.payType === 'hourly'
    ? approvedLeaves.reduce((sum, l) => {
        const dailyRate = (employee.hourlyRate || 0) * 8;
        return sum + dailyRate * l.workdays * (1 - (l.payRate ?? 1));
      }, 0)
    : 0;

  const netSalary = Math.max(0, totalSalary - leaveDeductions);
  const workdays = dailyRecords.filter((r) => r.hours > 0 || r.isClockedIn).length;

  // 如果計算出錯，仍顯示按鈕，點開後顯示錯誤訊息
  if (!showReport) {
    return (
      <button
        onClick={() => setShowReport(true)}
        style={{
          padding: '6px 14px',
          background: 'var(--bg-elevated)',
          color: calcError ? 'var(--red)' : 'var(--text-secondary)',
          border: `1px solid ${calcError ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
          borderRadius: 6, fontSize: 12, fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        {calcError ? '⚠ 薪資單' : '薪資單'}
      </button>
    );
  }

  function handlePrint() {
    const content = printRef.current?.innerHTML;
    if (!content) return;
    // 使用 iframe 避免彈出視窗攔截
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:800px;height:1200px;border:none;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html lang="zh-TW"><head>
      <meta charset="UTF-8">
      <title>薪資單 ${employee.name} ${month}</title>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=IBM+Plex+Sans+TC:wght@300;400;500;600&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'IBM Plex Sans TC', sans-serif; background: #fff; color: #111; padding: 32px; font-size: 13px; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
        th { text-align: left; font-size: 10px; font-weight: 600; color: #888; border-bottom: 2px solid #ddd; padding: 6px 10px; letter-spacing: 0.06em; text-transform: uppercase; }
        td { padding: 7px 10px; font-size: 12px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
        h1 { font-size: 22px; font-weight: 700; margin-bottom: 2px; }
        h2 { font-size: 13px; font-weight: 600; margin: 20px 0 10px; letter-spacing: 0.04em; text-transform: uppercase; color: #555; }
        .label { font-size: 11px; color: #888; }
        .amount { font-family: 'IBM Plex Mono', monospace; font-weight: 600; }
        .total { font-size: 22px; font-weight: 700; font-family: 'IBM Plex Mono', monospace; }
        .deduction { color: #e53e3e; }
        .dimmed { color: #aaa; }
        @page { size: A4; margin: 16mm; }
        @media print { body { padding: 0; } }
      </style>
    </head><body>${content}</body></html>`);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    }, 800);
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(6px)',
      }}
      onClick={(e) => e.target === e.currentTarget && setShowReport(false)}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          width: '100%',
          maxWidth: 680,
          maxHeight: '90vh',
          overflowY: 'auto',
          margin: '60px 20px 20px',
          marginTop: 20,
        }}
        className="fade-in"
      >
        {/* Modal Controls */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 24px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 15 }}>薪資單預覽</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handlePrint}
              style={{
                padding: '7px 16px',
                background: 'var(--amber)',
                color: '#ffffff',
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <PrintIcon /> 列印 / 儲存 PDF
            </button>
            <button
              onClick={() => setShowReport(false)}
              style={{
                padding: '7px 12px',
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 7,
                fontSize: 13,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Report content */}
        <div ref={printRef} style={{ padding: 32 }}>
          {/* Slip header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 28,
              paddingBottom: 20,
              borderBottom: '2px solid var(--border)',
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  letterSpacing: '0.1em',
                  marginBottom: 6,
                }}
              >
                SALARY STATEMENT
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>
                {employee.name}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--mono)',
                }}
              >
                {employee.email}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 22,
                  fontWeight: 300,
                  color: 'var(--amber)',
                }}
              >
                {month}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--mono)',
                  marginTop: 4,
                }}
              >
                {format(new Date(), 'yyyy/MM/dd', { locale: zhTW })} 製發
              </div>
            </div>
          </div>

          {/* Summary row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              marginBottom: 24,
            }}
          >
            {[
              { label: '出勤天數', value: `${workdays} 天` },
              { label: '工作時數', value: fmtHours(totalHours) },
              { label: '加班時數', value: fmtHours(totalOvertimeHours) },
              {
                label: '請假天數',
                value: (() => {
                  const total = approvedLeaves.reduce((s, l) => s + (l.workdays ?? l.days ?? 1), 0);
                  return total > 0 ? `${total} 天` : '無';
                })(),
              },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '12px 14px',
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                    letterSpacing: '0.06em',
                    marginBottom: 6,
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 16,
                    fontWeight: 500,
                  }}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          {/* Daily breakdown */}
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: 'var(--text-muted)',
                marginBottom: 10,
              }}
            >
              每日明細
            </div>
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>上班</th>
                  <th>下班</th>
                  <th>工時</th>
                  <th>加班</th>
                  <th style={{ textAlign: 'right' }}>薪資</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // 計算本月哪些日期有請假（用字串格式避免時區問題）
                  const leaveMap = {};
                  if (leaves && month) {
                    const pad = n => String(n).padStart(2, '0');
                    // Firestore Timestamp → YYYY-MM-DD 字串（用本地時間）
                    const toYMD = v => {
                      if (!v) return null;
                      const d = v?.toDate ? v.toDate() : (v instanceof Date ? v : new Date(v));
                      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
                    };
                    leaves.forEach(lv => {
                      if (lv.status === 'rejected') return;
                      // 相容 BatchPunchGenerator（type 中文）和 LeaveManager（leaveType 英文）
                      const lType =
                        lv.type === 'personal' || lv.leaveType === 'personal' ? '事假'
                        : lv.type === 'sick'     || lv.leaveType === 'sick'     ? '病假'
                        : lv.type === 'annual'   || lv.leaveType === 'annual'   ? '特休'
                        : lv.type === 'official' || lv.leaveType === 'official' ? '公假'
                        : lv.type === 'overtime_comp' || lv.leaveType === 'overtime_comp' ? '補休'
                        : ['事假','病假','特休','公假','補休'].includes(lv.type) ? lv.type
                        : '請假';
                      try {
                        // Bot 用 date 欄位（字串），一般假單用 startDate/endDate（Timestamp）
                        let startYMD, endYMD;
                        if (lv.date && typeof lv.date === 'string') {
                          // Bot 格式：date = "2026-05-06"
                          startYMD = lv.date;
                          endYMD = lv.date;
                        } else {
                          // 一般假單格式：startDate/endDate = Timestamp
                          startYMD = toYMD(lv.startDate);
                          endYMD = toYMD(lv.endDate || lv.startDate);
                        }
                        if (!startYMD) return;
                        const cur = new Date(startYMD + 'T00:00:00');
                        const fin = new Date((endYMD || startYMD) + 'T00:00:00');
                        while (cur <= fin) {
                          const dw = cur.getDay();
                          if (dw !== 0 && dw !== 6) {
                            const key = `${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`;
                            if (key.startsWith(month)) leaveMap[key] = lType;
                          }
                          cur.setDate(cur.getDate() + 1);
                        }
                      } catch(e) { console.warn('leaveMap error', lv, e); }
                    });
                    console.log('[SalaryReport] leaveMap:', leaveMap);
                  }
                  // 合併出勤日期和請假日期
                  const leaveOnlyDates = Object.keys(leaveMap).filter(d => !dailyRecords.find(r => r.date === d)).sort();
                  const allRows = [
                    ...dailyRecords.map(r => ({ ...r, leaveLabel: leaveMap[r.date] })),
                    ...leaveOnlyDates.map(d => ({ date: d, inTime: null, outTime: null, hours: 0, overtimeHours: 0, salary: 0, isLeaveOnly: true, leaveLabel: leaveMap[d] })),
                  ].sort((a, b) => a.date.localeCompare(b.date));
                  return allRows.map((r) => (
                  <tr key={r.date} style={{ background: r.isLeaveOnly ? 'rgba(99,102,241,0.05)' : 'transparent' }}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {r.date}
                    </td>
                    <td
                      className="mono"
                      style={{ fontSize: 12, color: r.isLeaveOnly ? 'var(--text-muted)' : 'var(--green)' }}
                    >
                      {r.isLeaveOnly ? (
                        <span style={{ color: 'var(--indigo,#6366f1)', fontWeight: 600, fontSize: 11 }}>
                          {r.leaveLabel}
                        </span>
                      ) : r.inTime || '--'}
                    </td>
                    <td
                      className="mono"
                      style={{ fontSize: 12, color: 'var(--red)' }}
                    >
                      {r.outTime || '--'}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {r.hours > 0 ? fmtHours(r.hours) : '--'}
                    </td>
                    <td
                      className="mono"
                      style={{
                        fontSize: 12,
                        color:
                          r.overtimeHours > 0
                            ? 'var(--amber)'
                            : 'var(--text-muted)',
                      }}
                    >
                      {r.overtimeHours > 0 ? fmtHours(r.overtimeHours) : '--'}
                    </td>
                    <td
                      className="mono"
                      style={{ fontSize: 12, textAlign: 'right' }}
                    >
                      {r.salary > 0 ? fmtMoney(r.salary) : '--'}
                      {r.isNationalHoliday && r.pairCount > 0 && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>🎌 國定假日</span>
                      )}
                      {r.leaveLabel && !r.isLeaveOnly && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: '#6366f1', fontWeight: 600 }}>📋 {r.leaveLabel}</span>
                      )}
                    </td>
                  </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>

          {/* Salary calculation */}
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: 'var(--bg-elevated)',
                padding: '10px 16px',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: 'var(--text-muted)',
              }}
            >
              薪資結算
            </div>
            <div style={{ padding: '16px' }}>
              {employee.payType === 'monthly' && salaryBreakdown ? (
                // ── 月薪制明細 ──────────────────────────────
                <>
                  {[
                    { label: '底薪', sub: `$${(employee._position?.baseSalary ?? employee.monthlySalary ?? 0).toLocaleString()}（全額）`, amount: salaryBreakdown.basePay, isDeduction: false },
                    { label: '餐費', sub: `$${(employee._position?.mealAllowance ?? employee.mealAllowance ?? 0).toLocaleString()}（全額）`, amount: salaryBreakdown.mealPay, isDeduction: false },
                    ...(salaryBreakdown.personalDeduction > 0 ? [{ label: `事假扣款（${salaryBreakdown.personalLeaveDays}天）`, sub: `（底薪 $${(employee._position?.baseSalary ?? employee.monthlySalary ?? 0).toLocaleString()} + 餐費 $${(employee._position?.mealAllowance ?? employee.mealAllowance ?? 0).toLocaleString()}）÷ ${salaryBreakdown.workingDaysBase} 天 × ${salaryBreakdown.personalLeaveDays} 天`, amount: -salaryBreakdown.personalDeduction, isDeduction: true }] : []),
                    ...(salaryBreakdown.sickDeduction > 0 ? [{ label: `病假扣款（${salaryBreakdown.sickLeaveDays}天）`, sub: `底薪 ÷ ${salaryBreakdown.workingDaysBase} × 0.5（半薪）+ 餐費 ÷ ${salaryBreakdown.workingDaysBase}（全扣），共 ${salaryBreakdown.sickLeaveDays} 天`, amount: -salaryBreakdown.sickDeduction, isDeduction: true }] : []),
                    ...(salaryBreakdown.lateDeductionAmt > 0 ? [{ label: `遲到扣薪（有效遲到 ${salaryBreakdown.totalEffectiveLateMinutes} 分鐘）`, sub: `每分鐘工資 = 底薪 $${(employee._position?.baseSalary ?? employee.monthlySalary ?? 0).toLocaleString()} ÷ ${salaryBreakdown.workingDaysBase}天 ÷ 8h ÷ 60min = $${salaryBreakdown.perMinuteRate?.toFixed(2)}/min × 有效遲到 ${salaryBreakdown.totalEffectiveLateMinutes} 分（寬限 ${salaryBreakdown.lateGraceMinutes} 分鐘）`, amount: -salaryBreakdown.lateDeductionAmt, isDeduction: true }] : []),
                    ...(salaryBreakdown.holidayPay > 0 ? [{ label: `國定假日加給（${salaryBreakdown.holidayDays}天）`, sub: `底薪 $${(employee._position?.baseSalary ?? employee.monthlySalary ?? 0).toLocaleString()} ÷ ${salaryBreakdown.workingDaysBase} × ${salaryBreakdown.holidayDays} 天`, amount: salaryBreakdown.holidayPay, isDeduction: false }] : []),
                    ...(salaryBreakdown.overtimePay > 0 ? [{ label: '加班費', sub: (() => {
                      const { impliedHourlyRate: hr, totalOt1Mins: m1 = 0, totalOt2Mins: m2 = 0, totalOtMins: tm = 0 } = salaryBreakdown;
                      const parts = [];
                      if (m1 > 0) parts.push(`×1.34段：${m1}分 × $${hr} ÷ 60 × 1.34 = $${Math.round(m1 * hr * 1.34 / 60)}`);
                      if (m2 > 0) parts.push(`×1.67段：${m2}分 × $${hr} ÷ 60 × 1.67 = $${Math.round(m2 * hr * 1.67 / 60)}`);
                      return `換算時薪 $${hr}/hr（底薪 ÷ 當月天數${salaryBreakdown.workingDaysBase}天 ÷ 8h）｜總加班 ${tm} 分鐘｜${parts.join('｜')}`;
                    })(), amount: salaryBreakdown.overtimePay, isDeduction: false }] : []),
                    (() => {
                      const bd = salaryBreakdown;
                      const violations = [
                        bd.hasLate        && `本月有遲到`,
                        bd.hasLeave       && `有請假（病假/事假）`,
                        bd.hasMissedPunch && `有忘打卡未補打`,
                        bd.hasAbsent      && `有未完整出勤（忘打卡或缺勤）`,
                      ].filter(Boolean).join('、');
                      const fullLabel = `全勤獎金 ${salaryBreakdown.hasFullAttendance ? '✓' : '✗'}`;
                      const fullSub = salaryBreakdown.hasFullAttendance ? '達成全勤條件' : `未達標：${violations}`;
                      return { label: fullLabel, sub: fullSub, amount: salaryBreakdown.fullAttendancePay, isDeduction: false, dim: !salaryBreakdown.hasFullAttendance };
                    })(),
                    { label: '紅利', sub: '月底另行計算', amount: 0, isDeduction: false, dim: true },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', opacity: item.dim && item.amount === 0 ? 0.45 : 1 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{item.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>{item.sub}</div>
                      </div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: item.dim && item.amount === 0 ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                        {item.amount === 0 && item.dim ? '—' : fmtMoney(item.amount)}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                // ── 時薪制明細 ──────────────────────────────
                <>
                  {[
                    { label: '時薪', sub: `$${employee.hourlyRate}/hr × ${totalHours.toFixed(1)}h`, amount: totalSalary, isDeduction: false },
                    ...(leaveDeductions > 0 ? [{ label: '請假扣薪', sub: `${approvedLeaves.length} 筆假單`, amount: -leaveDeductions, isDeduction: true }] : []),
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{item.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>{item.sub}</div>
                      </div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: item.isDeduction ? 'var(--red)' : 'var(--text-primary)' }}>
                        {item.isDeduction ? '-' : ''}{fmtMoney(Math.abs(item.amount))}
                      </div>
                    </div>
                  ))}
                </>
              )}
              {/* 假的 item.value 用於保持原有架構，不影響後面的 net total */}
              {false && [{label:'',value:'',amount:0}].map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {item.label}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--mono)',
                        marginTop: 2,
                      }}
                    >
                      {item.value}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 14,
                      color: item.isDeduction
                        ? 'var(--red)'
                        : 'var(--text-primary)',
                    }}
                  >
                    {item.isDeduction ? '-' : ''}
                    {fmtMoney(Math.abs(item.amount))}
                  </div>
                </div>
              ))}

              {/* Net total */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 0 4px',
                  marginTop: 6,
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700 }}>實發薪資</div>
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 24,
                    fontWeight: 600,
                    color: 'var(--amber)',
                  }}
                >
                  {fmtMoney(netSalary)}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              marginTop: 24,
              paddingTop: 16,
              borderTop: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--text-muted)',
              fontFamily: 'var(--mono)',
            }}
          >
            <span>此薪資單由系統自動計算</span>
            <span>TimeClock Salary System</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const PrintIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);
