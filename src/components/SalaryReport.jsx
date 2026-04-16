// src/components/SalaryReport.jsx
// 薪資單：管理員可為任一員工產生指定月份薪資單，並列印/匯出
import React, { useState, useRef } from 'react';
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
}) {
  const printRef = useRef(null);
  const [showReport, setShowReport] = useState(false);

  if (!employee || !month) return null;

  const { dailyRecords, totalHours, totalOvertimeHours, totalSalary } =
    calcSalaryFromPunches(punches, employee);

  // 計算請假扣薪
  const approvedLeaves = leaves.filter(
    (l) => l.status === 'approved' && l.uid === employee.id
  );
  const leaveDeductions = approvedLeaves.reduce((sum, l) => {
    const dailyRate =
      employee.payType === 'hourly'
        ? (employee.hourlyRate || 0) * 8
        : (employee.monthlySalary || 0) / 30;
    return sum + dailyRate * l.workdays * (1 - (l.payRate ?? 1));
  }, 0);

  const netSalary = Math.max(0, totalSalary - leaveDeductions);
  const workdays = dailyRecords.filter(
    (r) => r.hours > 0 || r.isClockedIn
  ).length;

  function handlePrint() {
    const content = printRef.current?.innerHTML;
    if (!content) return;
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html lang="zh-TW"><head>
      <meta charset="UTF-8">
      <title>薪資單 ${employee.name} ${month}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=IBM+Plex+Sans+TC:wght@300;400;500;600&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'IBM Plex Sans TC', sans-serif; background: #fff; color: #111; padding: 40px; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 11px; font-weight: 600; color: #666; border-bottom: 1px solid #ddd; padding: 8px 12px; letter-spacing: 0.06em; text-transform: uppercase; }
        td { padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #f0f0f0; }
        @media print {
          body { padding: 20px; }
          button { display: none !important; }
        }
      </style>
    </head><body>${content}</body></html>`);
    w.document.close();
    setTimeout(() => {
      w.print();
    }, 500);
  }

  if (!showReport) {
    return (
      <button
        onClick={() => setShowReport(true)}
        style={{
          padding: '6px 14px',
          background: 'var(--bg-elevated)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <PrintIcon /> 薪資單
      </button>
    );
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
          margin: 20,
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
                color: '#000',
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
                value: `${approvedLeaves.reduce(
                  (s, l) => s + l.workdays,
                  0
                )} 天`,
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
                {dailyRecords.map((r) => (
                  <tr key={r.date}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {r.date}
                    </td>
                    <td
                      className="mono"
                      style={{ fontSize: 12, color: 'var(--green)' }}
                    >
                      {r.inTime || '--'}
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
                    </td>
                  </tr>
                ))}
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
              {[
                {
                  label: `基本${
                    employee.payType === 'hourly' ? '時薪' : '月薪'
                  }`,
                  value:
                    employee.payType === 'hourly'
                      ? `$${employee.hourlyRate}/hr × ${totalHours.toFixed(1)}h`
                      : `月薪制 × ${(
                          (Math.min(totalHours, 160) / 160) *
                          100
                        ).toFixed(0)}%`,
                  amount: totalSalary,
                },
                ...(leaveDeductions > 0
                  ? [
                      {
                        label: '請假扣薪',
                        value: `${approvedLeaves.length} 筆假單`,
                        amount: -leaveDeductions,
                        isDeduction: true,
                      },
                    ]
                  : []),
              ].map((item, i) => (
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
