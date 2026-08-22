import React, { useMemo } from 'react';
import { CalendarDays, Edit2, Eye, RefreshCw, UserRoundX } from 'lucide-react';
import type {
  Branch,
  Session,
  Student,
  StudentContract,
  Trainer,
} from '../../../types';
import type { PtAvailabilityDocument } from '../../../contexts/DatabaseContext';

interface StudentRosterTableProps {
  students: Student[];
  contracts: StudentContract[];
  sessions: Session[];
  trainers: Trainer[];
  branches: Branch[];
  availability: PtAvailabilityDocument[];
  canManage: boolean;
  onOpen: (studentId: string) => void;
  onEdit: (student: Student) => void;
  onArchive: (studentId: string) => void;
  onRenew: (student: Student, contract: StudentContract) => void;
}

function localDateId(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentWeekId() {
  const monday = new Date();
  const weekday = monday.getDay();
  monday.setDate(monday.getDate() - (weekday === 0 ? 6 : weekday - 1));
  monday.setHours(0, 0, 0, 0);
  return localDateId(monday);
}

function sessionHour(session: Session) {
  if (Number.isFinite(Number(session.hour))) return Number(session.hour);
  const parsed = Number(session.id.split('-')[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function usedSessionCount(contract: StudentContract, sessions: Session[]) {
  const start = new Date(`${contract.startDate}T00:00:00`).getTime();
  const end = new Date(`${contract.endDate}T23:59:59.999`).getTime();
  const ids = new Set(
    sessions
      .filter((session) => {
        if (session.studentId !== contract.studentId || session.status !== 'completed') return false;
        if (session.contractId) return session.contractId === contract.id;
        const occurredAt = new Date(`${session.date}T12:00:00`).getTime();
        return occurredAt >= start && occurredAt <= end;
      })
      .map((session) => session.id),
  );
  (contract.attendedClasses || []).forEach((id) => ids.add(id));
  return ids.size;
}

function money(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(Math.max(0, value))}đ`;
}

function compactDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

export default function StudentRosterTable({
  students,
  contracts,
  sessions,
  trainers,
  branches,
  availability,
  canManage,
  onOpen,
  onEdit,
  onArchive,
  onRenew,
}: StudentRosterTableProps) {
  const rows = useMemo(() => {
    const weekId = currentWeekId();
    const today = localDateId(new Date());

    return students.map((student) => {
      const studentContracts = contracts
        .filter((contract) => contract.studentId === student.id)
        .sort((left, right) => right.startDate.localeCompare(left.startDate));
      const contract = studentContracts.find((item) => item.status === 'active') || studentContracts[0];
      const used = contract ? usedSessionCount(contract, sessions) : 0;
      const remaining = contract ? Math.max(0, contract.totalSessions - used) : 0;
      const debt = contract
        ? Math.max(0, Number(contract.totalPrice || 0) - Number(contract.discount || 0) - Number(contract.paidAmount || 0))
        : 0;
      const trainerIds = contract?.trainerIds?.length
        ? contract.trainerIds
        : contract?.trainerId
          ? [contract.trainerId]
          : [];
      const trainerNames = trainerIds
        .map((id) => trainers.find((trainer) => trainer.id === id)?.name)
        .filter((name): name is string => Boolean(name));
      const nextSession = sessions
        .filter((session) => (
          session.studentId === student.id
          && (session.status === 'scheduled' || session.status === 'rescheduled')
          && session.date >= today
        ))
        .sort((left, right) => left.date.localeCompare(right.date) || sessionHour(left) - sessionHour(right))[0];
      const weekAvailability = availability.find((item) => item.studentId === student.id && item.weekId === weekId);
      const expiresAt = contract ? new Date(`${contract.endDate}T23:59:59.999`).getTime() : 0;
      const daysLeft = contract ? Math.ceil((expiresAt - Date.now()) / 86_400_000) : null;
      const needsRenewal = Boolean(contract && contract.status === 'active' && ((daysLeft ?? 999) <= 31 || remaining <= 5));

      return {
        student,
        contract,
        used,
        remaining,
        debt,
        trainerNames,
        branchName: branches.find((branch) => branch.id === student.branchId)?.name || 'Chưa xác định',
        nextSession,
        availability: weekAvailability,
        needsRenewal,
      };
    });
  }, [availability, branches, contracts, sessions, students, trainers]);

  return (
    <div className="student-roster" aria-label="Danh sách vận hành học viên PT">
      <table className="student-roster__table">
        <thead>
          <tr>
            <th>Học viên</th>
            <th>Cơ sở &amp; PT</th>
            <th>Hợp đồng</th>
            <th>Số buổi</th>
            <th>Buổi tiếp theo</th>
            <th>Thanh toán</th>
            <th>Lịch rảnh tuần</th>
            <th aria-label="Thao tác" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.student.id}>
              <td>
                <button type="button" className="student-roster__identity" onClick={() => onOpen(row.student.id)}>
                  <span className="student-roster__avatar">{row.student.name?.trim().charAt(0).toUpperCase() || '?'}</span>
                  <span>
                    <strong>{row.student.name || 'Chưa cập nhật tên'}</strong>
                    <small>{row.student.phone || 'Chưa có SĐT'}</small>
                    <small>{row.student.email || 'Chưa có email'}</small>
                  </span>
                </button>
              </td>
              <td>
                <strong>{row.branchName}</strong>
                <small>{row.trainerNames.length ? row.trainerNames.join(', ') : 'Chưa gán PT'}</small>
              </td>
              <td>
                <span className={`student-roster__status student-roster__status--${row.contract?.status || 'none'}`}>
                  {row.contract?.status === 'active' ? 'Đang hoạt động' : row.contract?.status === 'frozen' ? 'Đang bảo lưu' : row.contract ? 'Đã kết thúc' : 'Chưa có gói'}
                </span>
                <small>{row.contract?.packageName || 'Cần đăng ký gói tập'}</small>
              </td>
              <td>
                <strong>{row.contract ? `${row.used}/${row.contract.totalSessions}` : '—'}</strong>
                <small>{row.contract ? `Còn ${row.remaining} buổi` : 'Chưa có dữ liệu'}</small>
              </td>
              <td>
                {row.nextSession ? (
                  <>
                    <strong>{compactDate(row.nextSession.date)} · {String(sessionHour(row.nextSession)).padStart(2, '0')}:00</strong>
                    <small>{trainers.find((trainer) => trainer.id === row.nextSession?.trainerId)?.name || 'PT chưa xác định'}</small>
                  </>
                ) : <small>Chưa có lịch sắp tới</small>}
              </td>
              <td>
                <strong className={row.debt > 0 ? 'student-roster__debt' : ''}>{row.debt > 0 ? `Nợ ${money(row.debt)}` : 'Đã cân đối'}</strong>
                <small>{row.contract ? `${money(row.contract.paidAmount)} / ${money(row.contract.totalPrice - (row.contract.discount || 0))}` : 'Chưa có hợp đồng'}</small>
              </td>
              <td>
                <span className={`student-roster__availability student-roster__availability--${row.availability?.status || 'missing'}`}>
                  <CalendarDays size={14} />
                  {row.availability?.status === 'locked' ? 'Đã khóa' : row.availability?.status === 'submitted' ? 'Đã gửi' : row.availability?.status === 'draft' ? 'Đang soạn' : 'Chưa gửi'}
                </span>
                {row.availability && <small>{row.availability.slots.length} khung giờ</small>}
              </td>
              <td>
                <div className="student-roster__actions">
                  <button type="button" onClick={() => onOpen(row.student.id)} aria-label={`Mở hồ sơ ${row.student.name}`} title="Mở hồ sơ"><Eye size={17} /></button>
                  {row.needsRenewal && row.contract && canManage && (
                    <button type="button" onClick={() => onRenew(row.student, row.contract!)} aria-label={`Gia hạn cho ${row.student.name}`} title="Gia hạn"><RefreshCw size={17} /></button>
                  )}
                  <button type="button" onClick={() => onEdit(row.student)} disabled={!canManage} aria-label={`Sửa ${row.student.name}`} title="Sửa hồ sơ"><Edit2 size={17} /></button>
                  <button type="button" onClick={() => onArchive(row.student.id)} disabled={!canManage} aria-label={`Lưu trữ ${row.student.name}`} title="Lưu trữ"><UserRoundX size={17} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
