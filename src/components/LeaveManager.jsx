// src/components/LeaveManager.jsx
// 請假系統：員工申請 → 管理員審核 → 自動調整薪資
import React, { useState, useEffect, useCallback } from 'react';
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  format,
  differenceInCalendarDays,
  parseISO,
  isWeekend,
  eachDayOfInterval,
} from 'date-fns';

const LEAVE_TYPES = [
  { id: 'annual', label: '特休', color: 'badge-green', pay: 1.0 },
  { id: 'sick', label: '病假', color: 'badge-amber', pay: 0.5 },
  { id: 'personal', label: '事假', color: 'badge-muted', pay: 0.0 },
  { id: 'official', label: '公假', color: 'badge-green', pay: 1.0 },
  { id: 'overtime_comp', label: '補休', color: 'badge-amber', pay: 1.0 },
];

const STATUS_MAP = {
  pending: { label: '待審核', cls: 'badge-amber' },
  approved: { label: '已核准', cls: 'badge-green' },
  rejected: { label: '已拒絕', cls: 'badge-red' },
};

export default function LeaveManager({ isAdmin = false }) {
  const { user, profile } = useAuth();
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [form, setForm] = useState({
    leaveType: 'annual',
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
    reason: '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // 計算工作日天數（排除週末）
  function countWorkdays(start, end) {
    if (!start || !end) return 0;
    try {
      const days = eachDayOfInterval({
        start: parseISO(start),
        end: parseISO(end),
      });
      return days.filter((d) => !isWeekend(d)).length;
    } catch {
      return 0;
    }
  }
  const workdays = countWorkdays(form.startDate, form.endDate);

  const fetchLeaves = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      let q;
      if (isAdmin) {
        q = query(collection(db, 'leaves'), orderBy('createdAt', 'desc'));
      } else {
        q = query(
          collection(db, 'leaves'),
          where('uid', '==', user.uid),
          orderBy('createdAt', 'desc')
        );
      }
      const snap = await getDocs(q);
      setLeaves(snap.docs.map((d) => ({ id: d.id, ...d.data() })));

      if (isAdmin) {
        const empSnap = await getDocs(
          query(collection(db, 'users'), where('role', '==', 'employee'))
        );
        setEmployees(empSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, [user, isAdmin]);

  useEffect(() => {
    fetchLeaves();
  }, [fetchLeaves]);

  async function handleSubmit() {
    if (!user || submitting) return;
    if (workdays <= 0) {
      alert('請選擇有效的請假日期（至少1個工作日）');
      return;
    }
    setSubmitting(true);
    try {
      const leaveTypeInfo = LEAVE_TYPES.find((t) => t.id === form.leaveType);
      await addDoc(collection(db, 'leaves'), {
        uid: user.uid,
        userName: profile?.name || '',
        leaveType: form.leaveType,
        leaveTypeLabel: leaveTypeInfo?.label || form.leaveType,
        payRate: leaveTypeInfo?.pay ?? 1,
        startDate: form.startDate,
        endDate: form.endDate,
        workdays,
        reason: form.reason.trim(),
        status: 'pending',
        createdAt: serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: '',
      });
      setShowForm(false);
      setForm({
        leaveType: 'annual',
        startDate: format(new Date(), 'yyyy-MM-dd'),
        endDate: format(new Date(), 'yyyy-MM-dd'),
        reason: '',
      });
      await fetchLeaves();
    } catch (err) {
      alert('申請失敗：' + err.message);
    }
    setSubmitting(false);
  }

  async function handleReview(leaveId, status, note = '') {
    try {
      await updateDoc(doc(db, 'leaves', leaveId), {
        status,
        reviewNote: note,
        reviewedAt: serverTimestamp(),
        reviewedBy: profile?.name || user.uid,
      });
      await fetchLeaves();
    } catch (err) {
      alert('審核失敗：' + err.message);
    }
  }

  const empMap = Object.fromEntries(employees.map((e) => [e.id, e.name]));
  const filtered =
    filterStatus === 'all'
      ? leaves
      : leaves.filter((l) => l.status === filterStatus);
  const pendingCount = leaves.filter((l) => l.status === 'pending').length;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
      className="fade-in"
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            {isAdmin ? '請假審核' : '我的假單'}
          </h2>
          {isAdmin && pendingCount > 0 && (
            <span className="badge badge-red">{pendingCount} 待審</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Filter */}
          {['all', 'pending', 'approved', 'rejected'].map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                background:
                  filterStatus === s ? 'var(--amber)' : 'var(--bg-elevated)',
                color: filterStatus === s ? '#000' : 'var(--text-secondary)',
                border: filterStatus === s ? 'none' : '1px solid var(--border)',
              }}
            >
              {s === 'all' ? '全部' : STATUS_MAP[s]?.label}
            </button>
          ))}
          {!isAdmin && (
            <button
              onClick={() => setShowForm((s) => !s)}
              style={{
                padding: '8px 16px',
                background: 'var(--amber)',
                color: '#000',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              + 申請假單
            </button>
          )}
        </div>
      </div>

      {/* Apply Form */}
      {showForm && !isAdmin && (
        <div
          className="card"
          style={{
            border: '1px solid rgba(245,158,11,0.3)',
            background: 'var(--amber-glow)',
          }}
        >
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 16,
              color: 'var(--amber)',
            }}
          >
            新增假單
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 14,
              marginBottom: 14,
            }}
          >
            <label style={lbl}>
              <span>假別</span>
              <select
                value={form.leaveType}
                onChange={(e) => set('leaveType', e.target.value)}
              >
                {LEAVE_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}（薪資 {Math.round(t.pay * 100)}%）
                  </option>
                ))}
              </select>
            </label>
            <label style={lbl}>
              <span>開始日期</span>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => set('startDate', e.target.value)}
              />
            </label>
            <label style={lbl}>
              <span>結束日期</span>
              <input
                type="date"
                value={form.endDate}
                min={form.startDate}
                onChange={(e) => set('endDate', e.target.value)}
              />
            </label>
          </div>
          <label style={{ ...lbl, marginBottom: 14 }}>
            <span>請假原因</span>
            <input
              value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
              placeholder="（選填）"
            />
          </label>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}
            >
              工作日：
              <span style={{ color: 'var(--amber)', fontWeight: 600 }}>
                {workdays} 天
              </span>
              {workdays > 0 && (
                <span style={{ marginLeft: 12 }}>
                  有薪天數：
                  {Math.round(
                    workdays *
                      (LEAVE_TYPES.find((t) => t.id === form.leaveType)?.pay ||
                        0)
                  )}{' '}
                  天
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowForm(false)}
                style={{
                  padding: '9px 16px',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || workdays <= 0}
                style={{
                  padding: '9px 18px',
                  background: 'var(--amber)',
                  color: '#000',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {submitting ? '送出中...' : '送出申請'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave List */}
      {loading ? (
        <div
          style={{
            textAlign: 'center',
            padding: 40,
            color: 'var(--text-muted)',
            fontFamily: 'var(--mono)',
            fontSize: 12,
          }}
        >
          載入中...
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="card"
          style={{
            textAlign: 'center',
            padding: 40,
            color: 'var(--text-muted)',
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
          <div style={{ fontSize: 13 }}>尚無假單紀錄</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((leave) => (
            <LeaveCard
              key={leave.id}
              leave={leave}
              isAdmin={isAdmin}
              empName={isAdmin ? empMap[leave.uid] || leave.userName : null}
              onApprove={(note) => handleReview(leave.id, 'approved', note)}
              onReject={(note) => handleReview(leave.id, 'rejected', note)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LeaveCard({ leave, isAdmin, empName, onApprove, onReject }) {
  const [reviewNote, setReviewNote] = useState('');
  const [expanded, setExpanded] = useState(leave.status === 'pending');
  const typeInfo = LEAVE_TYPES.find((t) => t.id === leave.leaveType);
  const statusInfo = STATUS_MAP[leave.status] || STATUS_MAP.pending;

  return (
    <div
      className="card"
      style={{
        padding: '16px 20px',
        border:
          leave.status === 'pending' && isAdmin
            ? '1px solid rgba(245,158,11,0.4)'
            : '1px solid var(--border)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 6,
              flexWrap: 'wrap',
            }}
          >
            {isAdmin && empName && (
              <span style={{ fontWeight: 600, fontSize: 14 }}>{empName}</span>
            )}
            <span className={`badge ${typeInfo?.color || 'badge-muted'}`}>
              {leave.leaveTypeLabel}
            </span>
            <span className={`badge ${statusInfo.cls}`}>
              {statusInfo.label}
            </span>
          </div>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 12,
              color: 'var(--text-secondary)',
              marginBottom: 4,
            }}
          >
            {leave.startDate} → {leave.endDate}
            <span style={{ marginLeft: 12, color: 'var(--amber)' }}>
              工作日 {leave.workdays} 天
            </span>
          </div>
          {leave.reason && (
            <div
              style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}
            >
              原因：{leave.reason}
            </div>
          )}
          {leave.reviewNote && (
            <div
              style={{
                fontSize: 12,
                color:
                  leave.status === 'approved' ? 'var(--green)' : 'var(--red)',
                marginTop: 4,
              }}
            >
              審核備註：{leave.reviewNote}
            </div>
          )}
        </div>

        {/* Admin actions */}
        {isAdmin && leave.status === 'pending' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              minWidth: 200,
            }}
          >
            <input
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="審核備註（選填）"
              style={{ fontSize: 12, padding: '7px 10px' }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => onApprove(reviewNote)}
                style={{
                  flex: 1,
                  padding: '7px',
                  background: 'var(--green-glow)',
                  color: 'var(--green)',
                  border: '1px solid rgba(34,197,94,0.3)',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                核准
              </button>
              <button
                onClick={() => onReject(reviewNote)}
                style={{
                  flex: 1,
                  padding: '7px',
                  background: 'var(--red-glow)',
                  color: 'var(--red)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                拒絕
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const lbl = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.07em',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
};
