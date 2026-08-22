import React, { useState, useEffect, useMemo } from "react";
import {
  Student,
  Trainer,
  Schedule,
  Warning,
  UserProfile,
  DAYS,
  StudentContract,
  Session,
  ScheduleEntry,
  Branch,
} from "../../types";
import { generateSchedule, calculateWarnings } from "../../utils/scheduler";
import StudentForm from "../admin/pt/StudentForm";
import StudentList from "./StudentList";
import PTSchedule from "./PTSchedule";
import { WorkScheduleMatrix } from "./WorkScheduleMatrix";
import {
  Calendar,
  Users,
  UserPlus,
  CheckCircle2,
  Package,
  User as UserIcon,
  Phone,
  Mail,
  MapPin,
  CheckCircle,
  ChevronRight,
  CreditCard,
  Clock,
  XCircle,
  RotateCcw,
  Edit2,
  Search,
  Info,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { User } from "firebase/auth";
import { doc, setDoc, onSnapshot, updateDoc, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  getDatesForCurrentWeek,
  getDatesForWeek,
  getWeekRange,
  getMonthRange,
  isSameDayOrAfter,
} from "../../utils/dateUtils";
import { useDatabase } from "../../contexts/DatabaseContext";
import DebugInfo from "./DebugInfo";
import type { AccessContext } from "../../identity/access";
import { resolveLegacyPtScheduleWorkspace } from "../../domain/pt/access";
import {
  publishPtSchedule,
  validatePtScheduleDraft,
  listPtScheduleVersions,
  restorePtScheduleVersionToDraft,
  type PtSchedulePublishResult,
  type PtScheduleVersionListResult,
  type PtScheduleVersionSummary,
  asPtSchedulePublishError,
  ptScheduleConflictLabel,
} from "../../services/ptSchedulePublishService";

interface Props {
  user?: User | null;
  profile?: UserProfile | null;
  accessContext?: AccessContext | null;
  backendMode?: "demo" | "firebase";
  onNavigate?: (screen: string) => void;
}

export default function SchedulerWrapper({ user, profile, accessContext, backendMode = "firebase" }: Props) {
  const getCalculatedUsedSessions = (contract: any, allSessions: Session[]) => {
    if (!contract) return 0;
    const contractSessions = allSessions.filter(s => {
      if (s.studentId !== contract.studentId) return false;
      if (s.status !== 'completed') return false; 
      if (s.contractId) return s.contractId === contract.id;
      const sDate = new Date(s.date).getTime();
      const startDate = new Date(contract.startDate).getTime();
      const endDate = new Date(contract.endDate).getTime() + 86400000 - 1;
      return sDate >= startDate && sDate <= endDate;
    });
    const uniqueClassIds = new Set(contractSessions.map(s => s.id));
    const currentAttendedClasses = contract.attendedClasses || [];
    currentAttendedClasses.forEach((id: string) => uniqueClassIds.add(id));
    return uniqueClassIds.size;
  };

  const {
    students,
    trainers,
    branches,
    contracts,
    sessions,
    schedules,
    ptAvailability,
    scheduleConfig,
    addStudent,
    updateStudent,
    updateScheduleData,
    updateScheduleSlot,
    updateScheduleSlots,
    updateSessionOverrides,
    updateBulkSessionOverrides,
  } = useDatabase();

  const [debugData, setDebugData] = useState<any>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [activeSubTab, setActiveSubTab] = useState<"schedule" | "students">(
    "schedule",
  );
  const [studentTab, setStudentTab] = useState<
    "overview" | "schedule" | "profile"
  >("overview");
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [studentSessionFilter, setStudentSessionFilter] = useState<
    "all" | "this_week" | "upcoming" | "history"
  >("upcoming");
  const [schedulingBranchId, setSchedulingBranchId] = useState<string>("");
  const [showBulkAdjustMenu, setShowBulkAdjustMenu] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [publishPreview, setPublishPreview] = useState<PtSchedulePublishResult | null>(null);
  const [publishBusy, setPublishBusy] = useState<"validate" | "publish" | null>(null);
  const [publishError, setPublishError] = useState<{ message: string; conflicts: string[] } | null>(null);
  const [versionHistory, setVersionHistory] = useState<PtScheduleVersionListResult | null>(null);
  const [versionHistoryBusy, setVersionHistoryBusy] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<PtScheduleVersionSummary | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);

  const workspaceMode = resolveLegacyPtScheduleWorkspace(profile, accessContext, backendMode);
  const isAdmin = workspaceMode === "admin";
  const isTrainer = workspaceMode === "trainer";

  useEffect(() => {
    if (students && trainers && contracts && sessions && schedules) {
      setIsLoaded(true);
    }
  }, [students, trainers, contracts, sessions, schedules]);

  const weekId = useMemo(() => {
    const dates = getDatesForWeek(weekOffset);
    return `schedule_${dates["T2"].full}`;
  }, [weekOffset]);

  const activeScheduleConfig = useMemo(() => {
    const dates = getDatesForWeek(weekOffset);
    return {
      ...scheduleConfig,
      workingDays: scheduleConfig.workingDays.filter((day) => {
        const dateStr = dates[day].full;
        return !(scheduleConfig.holidays || []).includes(dateStr);
      }),
    };
  }, [scheduleConfig, weekOffset]);

  const scheduleData = schedules[weekId] || {
    schedule: {},
    warnings: [],
    overriddenSessions: {},
  };
  const schedule = scheduleData.schedule || {};
  const overriddenSessions = scheduleData.overriddenSessions || {};
  const draftRevision = Number(scheduleData.draftRevision || 0);
  const publishedVersion = schedulingBranchId
    ? Number(scheduleData.publishedVersions?.[schedulingBranchId] || 0)
    : 0;
  const publishedRevision = schedulingBranchId
    ? Number(scheduleData.publishedRevisions?.[schedulingBranchId] ?? -1)
    : -1;
  const targetAvailabilityWeekId = getDatesForWeek(weekOffset)["T2"].full;
  const studentsForTargetWeek = useMemo(() => {
    const weekly = new Map(
      ptAvailability
        .filter((item) => item.weekId === targetAvailabilityWeekId)
        .map((item) => [item.studentId, item]),
    );
    return students.map((student) => {
      const availability = weekly.get(student.id);
      if (!availability) return student;
      return {
        ...student,
        availableSlots: availability.slots,
        isScheduleConfirmed: availability.status === "submitted" || availability.status === "locked",
      };
    });
  }, [ptAvailability, students, targetAvailabilityWeekId]);

  useEffect(() => {
    setPublishPreview(null);
    setPublishError(null);
    setVersionHistory(null);
    setRestoreCandidate(null);
  }, [weekId, schedulingBranchId, draftRevision]);

  const handleValidatePublish = async () => {
    if (!schedulingBranchId) {
      setPublishError({ message: "Hãy chọn một cơ sở cụ thể trước khi kiểm tra lịch.", conflicts: [] });
      return;
    }
    setPublishBusy("validate");
    setPublishError(null);
    try {
      const targetWeek = getDatesForWeek(weekOffset)["T2"].full;
      const preview = await validatePtScheduleDraft({
        weekId: targetWeek,
        branchId: schedulingBranchId,
        expectedDraftRevision: draftRevision,
      });
      setPublishPreview(preview);
    } catch (error) {
      const normalized = asPtSchedulePublishError(error);
      setPublishError({ message: normalized.message, conflicts: normalized.conflicts });
    } finally {
      setPublishBusy(null);
    }
  };

  const handlePublishSchedule = async () => {
    if (!schedulingBranchId || !publishPreview) return;
    setPublishBusy("publish");
    setPublishError(null);
    try {
      const targetWeek = getDatesForWeek(weekOffset)["T2"].full;
      const result = await publishPtSchedule({
        weekId: targetWeek,
        branchId: schedulingBranchId,
        expectedDraftRevision: publishPreview.draftRevision,
      });
      setPublishPreview(null);
      setDebugData({
        success: true,
        message: result.unchanged
          ? `Lịch cơ sở đã ở phiên bản v${result.version}.`
          : `Đã publish lịch v${result.version} an toàn.`,
        publishDiff: result.diff,
      });
    } catch (error) {
      const normalized = asPtSchedulePublishError(error);
      setPublishError({ message: normalized.message, conflicts: normalized.conflicts });
      if (normalized.issueCode === "REVISION_CONFLICT") setPublishPreview(null);
    } finally {
      setPublishBusy(null);
    }
  };

  const handleOpenVersionHistory = async () => {
    if (!schedulingBranchId) {
      setPublishError({ message: "Hãy chọn một cơ sở cụ thể để xem lịch sử.", conflicts: [] });
      return;
    }
    setVersionHistoryBusy(true);
    setPublishError(null);
    try {
      const targetWeek = getDatesForWeek(weekOffset)["T2"].full;
      setVersionHistory(await listPtScheduleVersions({ weekId: targetWeek, branchId: schedulingBranchId }));
    } catch (error) {
      const normalized = asPtSchedulePublishError(error);
      setPublishError({ message: normalized.message, conflicts: normalized.conflicts });
    } finally {
      setVersionHistoryBusy(false);
    }
  };

  const handleRestoreVersion = async () => {
    if (!schedulingBranchId || !restoreCandidate || !versionHistory) return;
    setRestoreBusy(true);
    setPublishError(null);
    try {
      const targetWeek = getDatesForWeek(weekOffset)["T2"].full;
      const result = await restorePtScheduleVersionToDraft({
        weekId: targetWeek,
        branchId: schedulingBranchId,
        version: restoreCandidate.version,
        expectedDraftRevision: versionHistory.currentDraftRevision,
      });
      setRestoreCandidate(null);
      setVersionHistory(null);
      setDebugData({
        success: true,
        message: `Đã sao chép lịch v${result.version} thành draft r${result.draftRevision}. Hãy kiểm tra lại trước khi publish.`,
      });
    } catch (error) {
      const normalized = asPtSchedulePublishError(error);
      setPublishError({ message: normalized.message, conflicts: normalized.conflicts });
      if (normalized.issueCode === "REVISION_CONFLICT") {
        setRestoreCandidate(null);
        setVersionHistory(null);
      }
    } finally {
      setRestoreBusy(false);
    }
  };

  const studentContracts = useMemo(() => {
    const map = new Map<string, StudentContract>();
    const { start: targetDate } = getWeekRange(weekOffset);
    const now = new Date(targetDate);
    now.setHours(0, 0, 0, 0); // Start of target week

    // Sort contracts by start date descending to ensure we get the latest
    const sortedContracts = [...contracts].sort(
      (a, b) =>
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );

    sortedContracts.forEach((c) => {
      if (c.status === "active" && !map.has(c.studentId)) {
        let startDate = new Date(c.startDate || 0);
        if (isNaN(startDate.getTime())) startDate = new Date(0);

        const endOfTargetWeek = new Date(now);
        endOfTargetWeek.setDate(now.getDate() + 6);
        endOfTargetWeek.setHours(23, 59, 59, 999);

        let endDate = new Date(c.endDate || (now.getTime() + 1000 * 3600 * 24 * 365));
        if (isNaN(endDate.getTime())) endDate = new Date(now.getTime() + 1000 * 3600 * 24 * 365);
        
        endDate.setHours(23, 59, 59, 999);
        const timeDiff = endDate.getTime() - now.getTime();
        const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));

        const totalSess = c.totalSessions !== undefined ? c.totalSessions : 999;
        
        // Count scheduled sessions for this contract
        const scheduledSessions = sessions.filter(s => {
          if (s.studentId !== c.studentId) return false;
          if (s.status !== 'scheduled' && s.status !== 'rescheduled') return false;
          if (s.contractId) return s.contractId === c.id;
          const sDate = new Date(s.date).getTime();
          const contractStart = new Date(c.startDate).getTime();
          const contractEnd = new Date(c.endDate).getTime() + 86400000 - 1;
          return sDate >= contractStart && sDate <= contractEnd;
        }).length;
        
        const sessionsLeft = totalSess - (getCalculatedUsedSessions(c, sessions) || 0) - scheduledSessions;

        if (
          daysLeft >= 0 &&
          sessionsLeft > 0 &&
          startDate.getTime() <= endOfTargetWeek.getTime()
        ) {
          map.set(c.studentId, c);
        }
      }
    });
    
    return map;
  }, [contracts, sessions, weekOffset]);

  const warnings = useMemo(() => {
    if (!isLoaded) return [];
    // Only calculate for students with active contracts
    const activeStudents = studentsForTargetWeek.filter((s) => studentContracts.has(s.id));
    return calculateWarnings(
      activeStudents,
      trainers,
      schedule,
      activeScheduleConfig,
      overriddenSessions,
    );
  }, [
    isLoaded,
    studentsForTargetWeek,
    trainers,
    schedule,
    studentContracts,
    activeScheduleConfig,
    overriddenSessions,
  ]);

  const handleBulkAdjustSessions = (adjustment: number) => {
    const activeStudents = studentsForTargetWeek.filter((s) => studentContracts.has(s.id));
    const newOverrides = { ...overriddenSessions };
    let totalAdjusted = 0;

    activeStudents.forEach((student) => {
      const current =
        overriddenSessions[student.id] !== undefined
          ? overriddenSessions[student.id]
          : student.sessionsPerWeek;
      const newValue = Math.max(0, current + adjustment);
      if (newValue !== student.sessionsPerWeek) {
        newOverrides[student.id] = newValue;
      } else {
        delete newOverrides[student.id]; // Reset to default if matches
      }
      totalAdjusted++;
    });

    if (totalAdjusted > 0) {
      updateBulkSessionOverrides(weekId, newOverrides);
    }
  };

  const handleCopyPreviousWeek = () => {
    if (
      !confirm(
        "Bạn có chắc chắn muốn copy lịch từ tuần trước sang tuần này không? Lịch hiện tại (nếu có) sẽ bị ghi đè.",
      )
    )
      return;

    const prevDates = getDatesForWeek(weekOffset - 1);
    const prevWeekId = `schedule_${prevDates["T2"].full}`;
    const prevSchedule = schedules[prevWeekId]?.schedule;

    if (!prevSchedule || Object.keys(prevSchedule).length === 0) {
      alert("Tuần trước không có dữ liệu lịch để copy.");
      return;
    }

    const activeStudentIds = new Set(
      students.filter((s) => studentContracts.has(s.id)).map((s) => s.id),
    );
    const activeTrainerIds = new Set(trainers.map((t) => t.id));
    const copiedSchedule: Schedule = {};

    for (const [slotId, entries] of Object.entries(prevSchedule) as [
      string,
      ScheduleEntry[],
    ][]) {
      copiedSchedule[slotId] = entries
        .map((e) => ({ ...e }))
        .filter(
          (e) =>
            (activeStudentIds.has(e.studentId) || e.type === "off") &&
            activeTrainerIds.has(e.trainerId),
        );
    }

    const activeStudents = studentsForTargetWeek.filter((s) => studentContracts.has(s.id));
    const warnings = calculateWarnings(
      activeStudents,
      trainers,
      copiedSchedule,
      activeScheduleConfig,
      overriddenSessions,
    );
    updateScheduleData(weekId, copiedSchedule, warnings);
  };

  const filteredStudents = studentsForTargetWeek.filter(
    (s) =>
      (selectedBranchId === "all" ||
        (selectedBranchId === "none"
          ? !s.branchId
          : s.branchId === selectedBranchId)) &&
      (!searchTerm || (s.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.phone?.includes(searchTerm))) &&
      (s.status !== "inactive" || studentContracts.has(s.id))
  );

  const filteredWarnings = (warnings || []).filter((w) =>
    filteredStudents.some((s) => s.id === w.studentId),
  );

  const handleResetSchedule = () => {
    const confirmMessage = schedulingBranchId 
      ? `Bạn có chắc chắn muốn xóa toàn bộ lịch của cơ sở đã chọn không? Các ca đã khóa thủ công của cơ sở này cũng sẽ bị xóa.`
      : "Bạn có chắc chắn muốn xóa toàn bộ lịch đã xếp không? Các ca đã khóa thủ công cũng sẽ bị xóa.";
      
    if (!confirm(confirmMessage)) {
      return;
    }
    
    const preservedSchedule: Schedule = {};
    for (const day of activeScheduleConfig.workingDays) {
      for (const hour of activeScheduleConfig.workingHours) {
        const slotId = `${day}-${hour}`;
        preservedSchedule[slotId] = (schedule[slotId] || []).filter((e) => {
          if (!schedulingBranchId) return false; // remove all if no specific branch
          if (e.type === "off" || e.studentId === "OFF") return true; // keep off slots
          
          const student = students.find((s) => s.id === e.studentId);
          const contract = student
            ? contracts.find((ct) => ct.studentId === student.id && ct.status === "active")
            : undefined;
          const assignedBranchId = contract?.branchId || student?.branchId;
          
          return assignedBranchId !== schedulingBranchId;
        });
      }
    }
    
    const activeStudents = studentsForTargetWeek.filter((s) => studentContracts.has(s.id));
    const newWarnings = calculateWarnings(
      activeStudents,
      trainers,
      preservedSchedule,
      activeScheduleConfig,
      overriddenSessions,
    );
    
    updateScheduleData(weekId, preservedSchedule, newWarnings);
  };

  const handleGenerate = () => {
    // 1. Filter students to schedule based on branch
    const branchStudents = schedulingBranchId
      ? studentsForTargetWeek.filter((s) => {
          const c = contracts.find(
            (ct) => ct.studentId === s.id && ct.status === "active",
          );
          return (c?.branchId || s.branchId) === schedulingBranchId;
        })
      : studentsForTargetWeek;

    const activeStudentList = branchStudents.filter((s) =>
      studentContracts.has(s.id),
    );
    const unconfirmedStudents = activeStudentList.filter(
      (s) => !s.isScheduleConfirmed,
    );
    if (unconfirmedStudents.length > 0) {
      if (
        !confirm(
          `Có ${unconfirmedStudents.length} học viên đang active chưa chốt lịch rảnh trong tập dữ liệu này. Bạn có chắc chắn muốn chạy xếp lịch không?`,
        )
      ) {
        return;
      }
    }
    // Only preserve locked, 'off', and OTHER branches' entries
    const preservedSchedule: Schedule = {};
    for (const day of activeScheduleConfig.workingDays) {
      for (const hour of activeScheduleConfig.workingHours) {
        const slotId = `${day}-${hour}`;
        preservedSchedule[slotId] = (schedule[slotId] || []).filter((e) => {
          if (e.isLocked || e.type === "off") return true;

          if (schedulingBranchId) {
            const student = students.find((s) => s.id === e.studentId);
            const contract = student
              ? contracts.find(
                  (c) => c.studentId === student.id && c.status === "active",
                )
              : null;
            const entryBranchId =
              contract?.branchId ||
              student?.branchId ||
              trainers.find((t) => t.id === e.trainerId)?.branchId;

            // If the entry belongs to a DIFFERENT branch, keep it
            if (entryBranchId && entryBranchId !== schedulingBranchId)
              return true;
          }

          return false;
        });
      }
    }

    const { start: targetDate } = getWeekRange(weekOffset);
    const result = generateSchedule(
      activeStudentList,
      trainers,
      contracts,
      sessions,
      activeScheduleConfig,
      preservedSchedule,
      overriddenSessions,
      targetDate,
    );

    // Check if any slots were effectively generated
    let generatedCount = 0;
    Object.values(result.schedule).forEach((entries) => {
      generatedCount += entries.filter(
        (e) => e.type !== "off" && e.studentId !== "OFF",
      ).length;
    });
    let previousCount = 0;
    Object.values(preservedSchedule).forEach((entries) => {
      previousCount += entries.filter(
        (e) => e.type !== "off" && e.studentId !== "OFF",
      ).length;
    });

    if (generatedCount === previousCount) {
      setDebugData({
        message:
          "Hệ thống không thể xếp thêm được lịch nào. Hãy xem log ở bên dưới màn hình.",
        activeStudentsLength: activeStudentList.length,
        branchStudentsLength: branchStudents.length,
        debugSteps: result.debugSteps,
      });
      const debugLogs = result.debugSteps?.length ? `\nChi tiết Log (vài dòng đầu):\n${result.debugSteps.slice(0, 15).join('\n')}` : '';
      alert(
        `Chưa có thay đổi nào được tạo ra (hoặc không còn chỗ để xếp).\n- Số HV có HĐ active hợp lệ: ${activeStudentList.length}/${branchStudents.length}\n${debugLogs}`,
      );
    } else {
      setDebugData({ success: true, generatedCount, previousCount, debugSteps: result.debugSteps });
      updateScheduleData(weekId, result.schedule, result.warnings).then(() => {
        alert("Xếp lịch thành công!");
      }).catch(err => {
        alert("Lỗi lưu lịch: " + err.message);
        console.error(err);
      });
    }
  };

  const currentUserStudent = students.find(
    (s) =>
      s.id === user?.uid ||
      (user?.email && s.email === user.email) ||
      (user?.phoneNumber && s.phone === user.phoneNumber),
  );

  const visibleClasses = React.useMemo(() => {
    if (!currentUserStudent) return [];

    let range: { start: Date; end: Date } | null = null;
    let currentWeekOffset = 0;

    if (studentSessionFilter === "upcoming") {
      range = {
        start: new Date(),
        end: new Date(new Date().getTime() + 365 * 24 * 60 * 60 * 1000),
      };
    } else if (studentSessionFilter === "history") {
      range = { start: new Date(0), end: new Date() };
    }

    // For upcoming and history, we only show actual sessions
    const now = new Date();
    return sessions
      .filter((s) => {
        if (s.studentId !== currentUserStudent.id) return false;
        const status = String(s.status);
        if (studentSessionFilter === "this_week") {
          const range = getWeekRange(0);
          const d = new Date(s.date);
          return d >= range.start && d <= range.end;
        }
        if (studentSessionFilter === "upcoming")
          return isSameDayOrAfter(s.date, now) && ["scheduled", "rescheduled"].includes(status);
        if (studentSessionFilter === "history")
          return [
            "completed",
            "cancelled",
            "canceled_by_student",
            "student_cancelled",
            "trainer_cancelled",
          ].includes(status);
        return true;
      })
      .map((s) => {
        const [legacyDay, legacyHour] = s.id.split("-");
        const sessionDateKey = s.date.slice(0, 10);
        const localSessionDate = new Date(`${sessionDateKey}T00:00:00`);
        const dayOfWeek = localSessionDate.getDay();
        const day = Number.isNaN(dayOfWeek)
          ? legacyDay
          : dayOfWeek === 0
            ? "CN"
            : `T${dayOfWeek + 1}`;
        const sessionHour = Number.isInteger(s.hour)
          ? Number(s.hour)
          : parseInt(legacyHour);
        const trainer = trainers.find((t) => t.id === s.trainerId);
        const activeContract = contracts.find(
          (c) => c.studentId === currentUserStudent.id && c.status === "active",
        );
        const dateObj = new Date(s.date);

        return {
          day,
          hour: sessionHour,
          trainerName: trainer?.name || "Unknown",
          contractId: activeContract?.id,
          dateDisplay:
            s.date && !isNaN(dateObj.getTime())
              ? dateObj.toLocaleDateString("vi-VN", {
                  day: "2-digit",
                  month: "2-digit",
                })
              : "N/A",
          fullDate: s.date || "",
          legacyClassId: `${legacyDay}-${legacyHour}-${s.date}`,
          sessionId: s.id,
          status: String(s.status),
        };
      })
      .sort(
        (a, b) =>
          (new Date(b.fullDate).getTime() || 0) -
          (new Date(a.fullDate).getTime() || 0),
      );
  }, [currentUserStudent, studentSessionFilter, trainers, contracts, sessions]);

  if (!isLoaded) {
    return <div className="p-6 text-white">Đang tải dữ liệu...</div>;
  }

  if (workspaceMode === "forbidden") {
    return (
      <section
        role="alert"
        style={{
          margin: "clamp(12px, 3vw, 28px)",
          padding: "clamp(20px, 4vw, 32px)",
          border: "1px solid rgba(246, 47, 130, 0.2)",
          borderRadius: 24,
          background: "linear-gradient(135deg, rgba(246,47,130,.08), rgba(255,135,81,.12))",
          color: "#251a27",
        }}
      >
        <strong style={{ display: "block", fontSize: 20, marginBottom: 8 }}>Không thể mở dữ liệu lịch legacy</strong>
        <span style={{ lineHeight: 1.55 }}>
          Trang này chỉ dành cho quản trị vận hành đã được xác minh. PT và học viên sử dụng lịch cá nhân được lọc qua API an toàn.
        </span>
      </section>
    );
  }

  if (isAdmin) {
    const targetWeekDates = getDatesForWeek(weekOffset);
    return (
      <div className="p-6 space-y-6 pb-24">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black text-white uppercase tracking-wider">
              Xếp Lịch Tập
            </h1>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex bg-zinc-900 p-1 rounded-xl border border-zinc-800">
                <button
                  onClick={() => setWeekOffset(0)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                    weekOffset === 0
                      ? "bg-pink-500 text-white shadow-[0_0_10px_rgba(255,0,127,0.3)]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Tuần này
                </button>
                <button
                  onClick={() => setWeekOffset(1)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                    weekOffset === 1
                      ? "bg-pink-500 text-white shadow-[0_0_10px_rgba(255,0,127,0.3)]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Tuần sau
                </button>
              </div>

              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => setWeekOffset((prev) => Math.max(0, prev - 1))}
                  className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors"
                  title="Tuần trước"
                >
                  <ChevronRight className="w-5 h-5 rotate-180" />
                </button>
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-2">
                  {weekOffset > 1 ? `Tuần +${weekOffset}` : ""}
                  <span className="ml-1 opacity-50">
                    ({targetWeekDates["T2"].display} -{" "}
                    {targetWeekDates["T7"].display})
                  </span>
                </span>
                <button
                  onClick={() => setWeekOffset((prev) => prev + 1)}
                  className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors"
                  title="Tuần sau"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex gap-2 scheduler-action-row">
            <select
              value={schedulingBranchId}
              onChange={(e) => setSchedulingBranchId(e.target.value)}
              className="bg-zinc-800 text-white px-3 py-2 text-sm rounded-xl font-medium border border-zinc-700 focus:outline-none focus:border-pink-500 max-w-[120px] md:max-w-[150px]"
            >
              <option value="">Tất cả cơ sở</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleResetSchedule}
              className="bg-zinc-800 text-zinc-300 px-4 py-2 text-sm rounded-xl font-bold hover:bg-zinc-700 hover:text-white transition-all flex items-center gap-2 border border-zinc-700"
            >
              <RotateCcw className="w-4 h-4" /> Reset Lịch
            </button>
            <button
              onClick={handleGenerate}
              className="bg-pink-600 text-white px-4 py-2 text-sm rounded-xl font-bold hover:bg-pink-500 transition-all flex items-center gap-2"
            >
              <Calendar className="w-4 h-4" /> Xếp Lịch
            </button>
            <button
              type="button"
              disabled={!schedulingBranchId || versionHistoryBusy || publishBusy !== null}
              onClick={handleOpenVersionHistory}
              title={!schedulingBranchId ? "Chọn một cơ sở cụ thể để xem lịch sử." : "Xem các phiên bản đã publish."}
              className="schedule-history-trigger px-4 py-2 text-sm rounded-xl font-bold flex items-center gap-2 disabled:cursor-not-allowed"
            >
              <Clock className="w-4 h-4" />
              {versionHistoryBusy ? "Đang tải…" : "Lịch sử"}
            </button>
            <button
              type="button"
              disabled={!schedulingBranchId || publishBusy !== null}
              onClick={handleValidatePublish}
              title={!schedulingBranchId ? "Chọn một cơ sở cụ thể để publish." : "Kiểm tra xung đột và xem trước thay đổi."}
              className="schedule-publish-trigger px-4 py-2 text-sm rounded-xl font-bold flex items-center gap-2 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-4 h-4" />
              {publishBusy === "validate" ? "Đang kiểm tra…" : "Kiểm tra & Publish"}
            </button>
          </div>
        </div>

        <div className="schedule-publish-state" aria-live="polite">
          <span>Draft r{draftRevision}</span>
          <span>{schedulingBranchId ? `Published v${publishedVersion}` : "Chưa chọn cơ sở"}</span>
          {schedulingBranchId && publishedRevision === draftRevision && <strong>Đã đồng bộ</strong>}
          {schedulingBranchId && publishedRevision !== draftRevision && <strong>Có thay đổi chưa publish</strong>}
        </div>
        {publishError && (
          <div className="schedule-publish-error" role="alert">
            <strong>{publishError.message}</strong>
            {publishError.conflicts.length > 0 && (
              <ul>{publishError.conflicts.map((item) => <li key={item}>{ptScheduleConflictLabel(item)}</li>)}</ul>
            )}
          </div>
        )}

        {publishPreview && (
          <div className="schedule-publish-backdrop" role="presentation">
            <section className="schedule-publish-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-publish-title">
              <div className="schedule-publish-dialog__accent" />
              <p className="schedule-publish-dialog__eyebrow">AURA PT · KIỂM TRA LỊCH</p>
              <h2 id="schedule-publish-title">Publish lịch cơ sở?</h2>
              <p>
                Hệ thống đã kiểm tra hợp đồng, lịch rảnh, sức chứa PT, trùng ngày và bảo vệ các buổi đã hoàn thành.
              </p>
              <div className="schedule-publish-diff">
                <div><strong>{publishPreview.diff.create}</strong><span>Tạo mới</span></div>
                <div><strong>{publishPreview.diff.update}</strong><span>Điều chỉnh</span></div>
                <div><strong>{publishPreview.diff.cancel}</strong><span>Hủy lịch</span></div>
                <div><strong>{publishPreview.diff.unchanged}</strong><span>Giữ nguyên</span></div>
              </div>
              {publishPreview.warnings.length > 0 && (
                <div className="schedule-publish-warning">
                  {publishPreview.warnings.map((warning) => <span key={warning}>{ptScheduleConflictLabel(warning)}</span>)}
                </div>
              )}
              <div className="schedule-publish-dialog__actions">
                <button type="button" onClick={() => setPublishPreview(null)} disabled={publishBusy !== null}>Quay lại chỉnh</button>
                <button type="button" onClick={handlePublishSchedule} disabled={publishBusy !== null}>
                  {publishBusy === "publish" ? "Đang publish…" : `Publish phiên bản v${publishPreview.version}`}
                </button>
              </div>
            </section>
          </div>
        )}

        {versionHistory && (
          <div className="schedule-publish-backdrop" role="presentation">
            <section className="schedule-publish-dialog schedule-version-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-version-title">
              <div className="schedule-publish-dialog__accent" />
              <p className="schedule-publish-dialog__eyebrow">AURA PT · LỊCH SỬ PHIÊN BẢN</p>
              <h2 id="schedule-version-title">Lịch đã publish</h2>
              <p>Khôi phục chỉ tạo một draft mới. Session hiện hành và phiên bản đã publish không bị sửa hoặc xóa.</p>
              {versionHistory.versions.length === 0 ? (
                <div className="schedule-version-empty">Chi nhánh này chưa có phiên bản publish.</div>
              ) : (
                <div className="schedule-version-list">
                  {versionHistory.versions.map((version) => (
                    <article key={version.version} className={version.version === versionHistory.currentVersion ? "is-current" : ""}>
                      <div>
                        <strong>Phiên bản v{version.version}</strong>
                        <span>{version.entryCount} buổi · nguồn draft r{version.sourceDraftRevision}</span>
                        <small>{version.publishedAt ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(version.publishedAt)) : "Chưa có thời gian"}</small>
                      </div>
                      <button type="button" onClick={() => setRestoreCandidate(version)} disabled={restoreBusy}>
                        <RotateCcw className="w-4 h-4" /> Khôi phục draft
                      </button>
                    </article>
                  ))}
                </div>
              )}
              <div className="schedule-publish-dialog__actions schedule-version-dialog__actions">
                <button type="button" onClick={() => setVersionHistory(null)} disabled={restoreBusy}>Đóng</button>
              </div>
            </section>
          </div>
        )}

        {restoreCandidate && versionHistory && (
          <div className="schedule-publish-backdrop schedule-restore-confirm" role="presentation">
            <section className="schedule-publish-dialog" role="alertdialog" aria-modal="true" aria-labelledby="schedule-restore-title">
              <div className="schedule-publish-dialog__accent" />
              <p className="schedule-publish-dialog__eyebrow">XÁC NHẬN KHÔI PHỤC AN TOÀN</p>
              <h2 id="schedule-restore-title">Dùng lịch v{restoreCandidate.version} làm draft?</h2>
              <p>Draft hiện tại sẽ được thay bằng nội dung phiên bản này cho đúng chi nhánh. Bạn vẫn phải kiểm tra và publish lại để áp dụng vào lịch tập.</p>
              <div className="schedule-publish-dialog__actions">
                <button type="button" onClick={() => setRestoreCandidate(null)} disabled={restoreBusy}>Quay lại</button>
                <button type="button" onClick={handleRestoreVersion} disabled={restoreBusy}>
                  {restoreBusy ? "Đang khôi phục…" : `Tạo draft từ v${restoreCandidate.version}`}
                </button>
              </div>
            </section>
          </div>
        )}



        {/* Sub-tabs */}
        <div className="flex p-1 bg-zinc-900 rounded-xl border border-zinc-800 mb-6">
          {[
            { id: "schedule", label: "Lịch PT", icon: Calendar },
            { id: "students", label: "Học viên", icon: Users },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeSubTab === tab.id
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {activeSubTab === "students" && (
            <div className="space-y-8">
              {editingStudent && (
                <StudentForm
                  onSave={(s) => {
                    updateStudent(s.id, {
                      availableSlots: s.availableSlots,
                      sessionsPerWeek: s.sessionsPerWeek,
                    });
                    setEditingStudent(null);
                  }}
                  initialData={editingStudent}
                  onCancelEdit={() => setEditingStudent(null)}
                  isAvailabilityOnly={true}
                  scheduleConfig={activeScheduleConfig}
                  isAdmin={isAdmin}
                />
              )}

              <div className="mb-4 flex gap-4">
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 text-zinc-300 px-4 py-2 rounded-xl focus:outline-none focus:border-pink-500"
                >
                  <option value="all">Tất cả chi nhánh</option>
                  <option value="none">Chưa xác định</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Tìm kiếm tên hoặc SĐT..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 text-zinc-300 px-4 py-2 rounded-xl focus:outline-none focus:border-pink-500 flex-grow"
                />
              </div>

              <StudentList
                students={filteredStudents}
                schedule={schedule}
                warnings={filteredWarnings}
                branches={branches}
                contracts={contracts}
                trainers={trainers}
                activeStudentIds={new Set(studentContracts.keys())}
                overriddenSessions={overriddenSessions}
                onUpdateSessionOverride={(studentId, sessions) => {
                  updateSessionOverrides(weekId, studentId, sessions);
                }}
                onEdit={setEditingStudent}
                onToggleConfirm={(id) => {
                  const student = students.find((s) => s.id === id);
                  if (student) {
                    updateStudent(id, {
                      isScheduleConfirmed: !student.isScheduleConfirmed,
                    });
                  }
                }}
                onToggleLockSchedule={(id) => {
                  updateScheduleSlots(weekId, (currentSchedule) => {
                    let isCurrentlyLocked = false;

                    // Check if currently locked
                    Object.keys(currentSchedule).forEach((slotId) => {
                      currentSchedule[slotId].forEach((e) => {
                        if (e.studentId === id && e.isLocked) {
                          isCurrentlyLocked = true;
                        }
                      });
                    });

                    // Toggle lock for all entries of this student
                    const updatedSlots: { [slotId: string]: ScheduleEntry[] } =
                      {};
                    Object.keys(currentSchedule).forEach((slotId) => {
                      const hasStudent = currentSchedule[slotId].some(
                        (e) => e.studentId === id,
                      );
                      if (hasStudent) {
                        updatedSlots[slotId] = currentSchedule[slotId].map(
                          (e) =>
                            e.studentId === id
                              ? { ...e, isLocked: !isCurrentlyLocked }
                              : e,
                        );
                      }
                    });

                    return updatedSlots;
                  });
                }}
              />
            </div>
          )}

          {activeSubTab === "schedule" && (
            <PTSchedule
              schedule={schedule}
              students={studentsForTargetWeek}
              trainers={trainers}
              contracts={contracts}
              weekOffset={weekOffset}
              selectedBranchId={schedulingBranchId}
              scheduleConfig={activeScheduleConfig}
              onUpdateSlot={(slotId, updater) => {
                updateScheduleSlot(weekId, slotId, updater);
              }}
            />
          )}
        </div>
      </div>
    );
  }

  if (isTrainer) {
    const targetWeekDates = getDatesForWeek(weekOffset);
    const currentTrainer = trainers.find(
      (t) =>
        t.id === user?.uid ||
        (user?.email && t.email?.toLowerCase() === user.email.toLowerCase()) ||
        (user?.phoneNumber && t.phone === user.phoneNumber),
    );
    const actualTrainerId = currentTrainer?.id || user?.uid;

    const trainerStudents = (students || []).filter((s) => s.status !== "inactive" || studentContracts.has(s.id));

    const filteredTrainerStudents = trainerStudents.filter(
      (s) =>
        (selectedBranchId === "all" ||
          (selectedBranchId === "none"
            ? !s.branchId
            : s.branchId === selectedBranchId)) &&
        (!searchTerm || (s.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.phone?.includes(searchTerm))),
    );

    const trainerWarnings = (warnings || []).filter((w) =>
      filteredTrainerStudents.some((s) => s.id === w.studentId),
    );

    return (
      <div className="p-6 space-y-8 pb-24">
        {!currentTrainer && (
          <div className="bg-yellow-500/10 border border-yellow-500/50 text-yellow-500 p-4 rounded-xl flex items-start gap-3">
            <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Chưa liên kết hồ sơ PT</p>
              <p className="text-sm mt-1">
                Tài khoản của bạn ({user?.email || user?.phoneNumber}) chưa được
                liên kết với hồ sơ PT nào trong hệ thống. Vui lòng liên hệ Admin
                để cập nhật email/SĐT của bạn vào danh sách nhân sự PT.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black text-white uppercase tracking-wider">
              Lịch Của Tôi
            </h1>
            {currentTrainer && (
              <p className="text-zinc-400 mt-1">
                HLV:{" "}
                <span className="text-pink-500 font-medium">
                  {currentTrainer.name}
                </span>
              </p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <div className="flex bg-zinc-900 p-1 rounded-xl border border-zinc-800">
                <button
                  onClick={() => setWeekOffset(0)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                    weekOffset === 0
                      ? "bg-pink-500 text-white shadow-[0_0_10px_rgba(255,0,127,0.3)]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Tuần này
                </button>
                <button
                  onClick={() => setWeekOffset(1)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                    weekOffset === 1
                      ? "bg-pink-500 text-white shadow-[0_0_10px_rgba(255,0,127,0.3)]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Tuần sau
                </button>
              </div>

              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => setWeekOffset((prev) => Math.max(0, prev - 1))}
                  className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors"
                  title="Tuần trước"
                >
                  <ChevronRight className="w-5 h-5 rotate-180" />
                </button>
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-2">
                  {weekOffset > 1 ? `Tuần +${weekOffset}` : ""}
                  <span className="ml-1 opacity-50">
                    ({targetWeekDates["T2"].display} -{" "}
                    {targetWeekDates["T7"].display})
                  </span>
                </span>
                <button
                  onClick={() => setWeekOffset((prev) => prev + 1)}
                  className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors"
                  title="Tuần sau"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex p-1 bg-zinc-900 rounded-xl border border-zinc-800 mb-6">
          {[
            { id: "schedule", label: "Lịch PT", icon: Calendar },
            { id: "students", label: "Học viên", icon: Users },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeSubTab === tab.id
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {activeSubTab === "students" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Tìm theo tên hoặc SĐT..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 pl-10 pr-4 text-white placeholder:text-zinc-500 focus:outline-none focus:border-pink-500 transition-colors"
                />
              </div>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-pink-500 transition-colors"
              >
                <option value="all">Tất cả chi nhánh</option>
                <option value="none">Chưa xếp chi nhánh</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <StudentList
              students={filteredTrainerStudents}
              schedule={schedule}
              warnings={trainerWarnings}
              branches={branches}
              contracts={contracts}
              trainers={trainers}
              activeStudentIds={new Set(studentContracts.keys())}
              overriddenSessions={overriddenSessions}
              onUpdateSessionOverride={(studentId, sessions) => {
                updateSessionOverrides(weekId, studentId, sessions);
              }}
              onEdit={setEditingStudent}
              onToggleConfirm={(id) => {
                const student = students.find((s) => s.id === id);
                if (student) {
                  updateStudent(id, {
                    isScheduleConfirmed: !student.isScheduleConfirmed,
                  });
                }
              }}
              onToggleLockSchedule={(id) => {
                updateScheduleSlots(weekId, (currentSchedule) => {
                  let isCurrentlyLocked = false;

                  // Check if currently locked
                  Object.keys(currentSchedule).forEach((slotId) => {
                    currentSchedule[slotId].forEach((e) => {
                      if (e.studentId === id && e.isLocked) {
                        isCurrentlyLocked = true;
                      }
                    });
                  });

                  const newLockedState = !isCurrentlyLocked;
                  const updates: Record<string, ScheduleEntry[]> = {};

                  Object.keys(currentSchedule).forEach((slotId) => {
                    const entries = currentSchedule[slotId];
                    if (entries.some((e) => e.studentId === id)) {
                      updates[slotId] = entries.map((e) =>
                        e.studentId === id
                          ? { ...e, isLocked: newLockedState }
                          : e,
                      );
                    }
                  });

                  return updates;
                });
              }}
            />
          </div>
        )}

        {activeSubTab === "schedule" && (
          <PTSchedule
            schedule={schedule}
            students={students}
            trainers={trainers}
            contracts={contracts}
            currentTrainerId={actualTrainerId}
            selectedBranchId={profile?.branchId || "all"}
            weekOffset={weekOffset}
            scheduleConfig={activeScheduleConfig}
          />
        )}
      </div>
    );
  }

  // USER VIEW
  const handleUserSaveStudent = (s: Student) => {
    if (!user) return;

    if (!currentUserStudent) {
      const newStudent = {
        ...s,
        id: user.uid,
        name: profile?.name || s.name,
        isScheduleConfirmed: true,
        status: "active" as const,
      };
      addStudent(newStudent);
    } else {
      updateStudent(currentUserStudent.id, {
        availableSlots: s.availableSlots,
        sessionsPerWeek: s.sessionsPerWeek,
        isScheduleConfirmed: true,
      });
    }
  };

  const handleToggleConfirm = () => {
    if (!user || !currentUserStudent) return;
    updateStudent(currentUserStudent.id, {
      isScheduleConfirmed: !currentUserStudent.isScheduleConfirmed,
    });
  };

  // The available session lifecycle callables are staff-authorized. Until a
  // learner-scoped callable exists, do not fall back to direct Firestore writes.
  const studentSessionActionUnavailable =
    "Tạm thời chưa thể đổi lịch, báo nghỉ hoặc xác nhận buổi tập tại đây. Vui lòng liên hệ quản trị viên để được xử lý và giữ đầy đủ lịch sử buổi tập.";

  const myContracts = contracts.filter(
    (c) => c.studentId === currentUserStudent?.id,
  );

  return (
    <div className="p-2 md:p-6 space-y-6 pb-24 w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-black text-white uppercase tracking-wider">
          Lịch Tập Của Tôi
        </h1>
      </div>

      {!currentUserStudent ? (
        <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 shadow-xl">
          <h2 className="text-xl font-bold text-pink-500 mb-4">
            Đăng ký lịch tập
          </h2>
          <p className="text-zinc-400 mb-6">
            Vui lòng điền thông tin để Admin xếp lịch cho bạn.
          </p>
          <StudentForm
            onSave={handleUserSaveStudent}
            initialData={{
              id: user?.uid || "",
              name: profile?.displayName || profile?.name || "",
              sessionsPerWeek: (currentUserStudent as Student | undefined)?.sessionsPerWeek || 3,
              availableSlots: [],
            }}
            scheduleConfig={activeScheduleConfig}
            isAdmin={isAdmin}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Sliding Tabs */}
          <div className="flex p-1 bg-zinc-900/80 backdrop-blur-md rounded-2xl border border-zinc-800/80 sticky top-4 z-40 shadow-xl">
            {[
              { id: "overview", label: "Tổng quan", icon: Package },
              { id: "schedule", label: "Lịch tập", icon: Calendar },
              { id: "profile", label: "Hồ sơ", icon: UserIcon },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStudentTab(tab.id as any)}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all duration-300 relative ${
                  studentTab === tab.id
                    ? "text-white"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {studentTab === tab.id && (
                  <motion.div
                    layoutId="studentTabIndicator"
                    className="absolute inset-0 bg-zinc-800 rounded-xl shadow-md border border-zinc-700/50"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  <tab.icon
                    className={`w-4 h-4 ${studentTab === tab.id ? "text-pink-500" : ""}`}
                  />
                  <span>{tab.label}</span>
                </span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {studentTab === "overview" && (
              <motion.div
                key="overview"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                {/* Active Contracts */}
                <div className="bg-zinc-900 p-6 rounded-3xl border border-zinc-800 shadow-xl relative overflow-hidden">
                  <div className="absolute -top-20 -right-20 w-64 h-64 bg-pink-500/5 rounded-full blur-3xl pointer-events-none"></div>

                  <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2 relative z-10">
                    <Package className="w-5 h-5 text-pink-500" />
                    Gói tập của tôi
                  </h2>

                  {myContracts.length > 0 ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 relative z-10">
                      {myContracts.map((contract) => (
                        <div
                          key={contract.id}
                          className="bg-zinc-950/80 backdrop-blur-sm p-5 rounded-2xl border border-zinc-800/80 hover:border-pink-500/30 transition-colors group"
                        >
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <h3 className="text-lg font-bold text-white group-hover:text-pink-400 transition-colors">
                                {contract.packageName}
                              </h3>
                              <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {contract.startDate &&
                                !isNaN(new Date(contract.startDate).getTime())
                                  ? new Date(
                                      contract.startDate,
                                    ).toLocaleDateString("vi-VN")
                                  : "N/A"}{" "}
                                -{" "}
                                {contract.endDate &&
                                !isNaN(new Date(contract.endDate).getTime())
                                  ? new Date(
                                      contract.endDate,
                                    ).toLocaleDateString("vi-VN")
                                  : "N/A"}
                              </p>
                            </div>
                            <span
                              className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                                contract.status === "active"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]"
                                  : contract.status === "expired"
                                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                                    : "bg-zinc-800/50 text-zinc-400 border-zinc-700/50"
                              }`}
                            >
                              {contract.status === "active"
                                ? "Đang tập"
                                : contract.status === "expired"
                                  ? "Hết hạn"
                                  : "Đã hủy"}
                            </span>
                          </div>

                          <div className="mt-5 pt-5 border-t border-zinc-800/50">
                            <div className="flex justify-between text-sm mb-2">
                              <span className="text-zinc-400 font-medium">
                                Tiến độ
                              </span>
                              <span className="text-white font-bold">
                                {getCalculatedUsedSessions(contract, sessions)} /{" "}
                                {contract.totalSessions}{" "}
                                <span className="text-zinc-500 font-normal">
                                  buổi
                                </span>
                              </span>
                            </div>
                            <div className="w-full bg-zinc-900 rounded-full h-3 overflow-hidden border border-zinc-800">
                              <div
                                className="bg-gradient-to-r from-pink-600 to-pink-400 h-full rounded-full transition-all duration-1000 ease-out relative"
                                style={{
                                  width: `${Math.min(100, (getCalculatedUsedSessions(contract, sessions) / contract.totalSessions) * 100)}%`,
                                }}
                              >
                                <div className="absolute inset-0 bg-white/20 w-full h-full animate-pulse"></div>
                              </div>
                            </div>
                          </div>

                          {/* Debt / Installments Info */}
                          {contract.installments &&
                            contract.installments.length > 0 && (
                              <div className="mt-5 pt-5 border-t border-zinc-800/50">
                                <div className="flex items-center gap-2 mb-3">
                                  <CreditCard className="w-4 h-4 text-amber-500" />
                                  <span className="text-sm font-bold text-zinc-300">
                                    Lịch thanh toán trả góp
                                  </span>
                                </div>
                                <div className="space-y-2">
                                  {contract.installments.map((inst, idx) => (
                                    <div
                                      key={`inst-${idx}-${inst.date}`}
                                      className="flex justify-between items-center text-sm p-2 rounded-lg bg-zinc-900/50 border border-zinc-800/50"
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="text-zinc-500 text-xs w-12">
                                          Kỳ {idx + 1}
                                        </span>
                                        <span className="text-zinc-300 font-medium">
                                          {inst.date &&
                                          !isNaN(new Date(inst.date).getTime())
                                            ? new Date(
                                                inst.date,
                                              ).toLocaleDateString("vi-VN")
                                            : "N/A"}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <span className="font-bold text-white">
                                          {inst.amount.toLocaleString("vi-VN")}đ
                                        </span>
                                        {inst.status === "paid" ? (
                                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                        ) : (
                                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-zinc-500 bg-zinc-950/50 rounded-2xl border border-zinc-800/50 border-dashed relative z-10">
                      <Package className="w-12 h-12 mx-auto mb-4 opacity-20" />
                      <p className="text-lg font-medium text-zinc-400">
                        Bạn chưa đăng ký gói tập nào
                      </p>
                      <p className="text-sm mt-1">
                        Vui lòng liên hệ Admin hoặc PT để được tư vấn.
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {studentTab === "schedule" && (
              <motion.div
                key="schedule"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                <div className="bg-zinc-900 p-6 rounded-3xl border border-zinc-800 shadow-xl">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-pink-500" />
                      Lịch tập luyện
                    </h2>
                  </div>

                  {/* Filter Selector */}
                  <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide">
                    {[
                      { id: "this_week", label: "Tuần này" },
                      { id: "upcoming", label: "Sắp tới" },
                      { id: "history", label: "Lịch sử" },
                    ].map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setStudentSessionFilter(f.id as any)}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider whitespace-nowrap transition-all border ${
                          studentSessionFilter === f.id
                            ? "bg-pink-500 text-white border-pink-500 shadow-[0_0_10px_rgba(255,0,127,0.3)]"
                            : "bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {visibleClasses.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      <p className="col-span-full rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                        {studentSessionActionUnavailable}
                      </p>
                      {visibleClasses.map((cls, idx) => {
                        const activeContract = contracts.find(
                          (c) => c.id === cls.contractId,
                        );
                        const isAttended =
                          activeContract?.attendedClasses?.includes(cls.sessionId) ||
                          activeContract?.attendedClasses?.includes(cls.legacyClassId);

                        return (
                          <div
                            key={`cls-${cls.sessionId || idx}`}
                            className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-zinc-950 p-4 rounded-2xl border border-zinc-800 hover:border-zinc-700 transition-colors gap-4"
                          >
                            <div className="flex items-center gap-4">
                              <div className="w-14 h-14 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex flex-col items-center justify-center text-pink-500 shadow-inner">
                                <span className="text-xs font-bold uppercase">
                                  {cls.day}
                                </span>
                                <span className="text-lg font-black leading-none mt-0.5">
                                  {cls.hour}h
                                </span>
                              </div>
                              <div>
                                <p className="text-white font-bold text-lg">
                                  Buổi tập PT
                                </p>
                                <p className="text-sm text-zinc-400 flex items-center gap-1 mt-0.5">
                                  <UserIcon className="w-3 h-3" /> HLV:{" "}
                                  {cls.trainerName}
                                </p>
                                <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                                  <Calendar className="w-3 h-3" /> Ngày:{" "}
                                  {cls.dateDisplay}
                                </p>
                              </div>
                            </div>

                            {cls.status === "cancelled" || cls.status === "trainer_cancelled" ? (
                              <div className="w-full sm:w-auto bg-red-500/10 text-red-500 border border-red-500/30 px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 shadow-[0_0_10px_rgba(239,68,68,0.1)]">
                                <XCircle className="w-4 h-4" />
                                Đã hủy
                              </div>
                            ) : cls.status === "canceled_by_student" || cls.status === "student_cancelled" ? (
                              <div className="w-full sm:w-auto bg-orange-500/10 text-orange-500 border border-orange-500/30 px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 shadow-[0_0_10px_rgba(249,115,22,0.1)]">
                                <XCircle className="w-4 h-4" />
                                Đã báo nghỉ
                              </div>
                            ) : isAttended ? (
                              <div className="w-full sm:w-auto bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                                <CheckCircle className="w-4 h-4" />
                                Đã xác nhận
                              </div>
                            ) : cls.status === "completed" ? (
                              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                                <button
                                  type="button"
                                  disabled
                                  title={studentSessionActionUnavailable}
                                  className="w-full sm:w-auto bg-pink-500/10 text-pink-500 border border-pink-500/30 px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 opacity-50 cursor-not-allowed"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                  Xác nhận đã tập
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                                <button
                                  type="button"
                                  disabled
                                  title={studentSessionActionUnavailable}
                                  className="w-full sm:w-auto bg-blue-500/10 text-blue-500 border border-blue-500/30 px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 opacity-50 cursor-not-allowed"
                                >
                                  <Edit2 className="w-4 h-4" />
                                  Đổi lịch
                                </button>
                                <button
                                  type="button"
                                  disabled
                                  title={studentSessionActionUnavailable}
                                  className="w-full sm:w-auto bg-orange-500/10 text-orange-500 border border-orange-500/30 px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 opacity-50 cursor-not-allowed"
                                >
                                  <XCircle className="w-4 h-4" />
                                  Báo nghỉ
                                </button>
                                <button
                                  type="button"
                                  disabled
                                  title={studentSessionActionUnavailable}
                                  className="w-full sm:w-auto bg-pink-500/10 text-pink-500 border border-pink-500/30 px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 opacity-50 cursor-not-allowed"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                  Xác nhận đã tập
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-zinc-500 bg-zinc-950/50 rounded-2xl border border-zinc-800/50 border-dashed">
                      <Calendar className="w-12 h-12 mx-auto mb-4 opacity-20" />
                      <p className="text-lg font-medium text-zinc-400">
                        Chưa có lịch tập nào được xếp
                      </p>
                      <p className="text-sm mt-1">
                        Admin đang sắp xếp lịch cho bạn, vui lòng quay lại sau.
                      </p>
                    </div>
                  )}
                </div>

                {/* Schedule Registration Info */}
                <div className="bg-zinc-900 p-4 md:p-6 rounded-3xl border border-zinc-800 shadow-xl overflow-hidden">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-lg font-bold text-white">
                      Lịch rảnh đã đăng ký
                    </h2>
                    <button
                      onClick={() => setEditingStudent(currentUserStudent)}
                      className="text-sm font-medium text-pink-400 hover:text-pink-300 bg-pink-500/10 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Chỉnh sửa
                    </button>
                  </div>

                  {editingStudent?.id === currentUserStudent.id ||
                  !currentUserStudent.isScheduleConfirmed ? (
                    <div className="mt-4">
                      <StudentForm
                        onSave={(s) => {
                          handleUserSaveStudent(s);
                          setEditingStudent(null);
                        }}
                        initialData={currentUserStudent}
                        onCancelEdit={
                          currentUserStudent.isScheduleConfirmed
                            ? () => setEditingStudent(null)
                            : undefined
                        }
                        scheduleConfig={activeScheduleConfig}
                        isAdmin={isAdmin}
                      />
                    </div>
                  ) : (
                    <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-800">
                      <div className="flex items-center gap-3 mb-5 text-emerald-400 bg-emerald-500/10 p-4 rounded-xl border border-emerald-500/20">
                        <CheckCircle2 className="w-6 h-6 shrink-0" />
                        <div>
                          <p className="font-bold">
                            Đã chốt lịch rảnh tuần này
                          </p>
                          <p className="text-xs text-emerald-500/80 mt-0.5">
                            Yêu cầu của bạn đã được ghi nhận để Admin xếp lịch.
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-5">
                        <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800/50">
                          <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold mb-1">
                            Số buổi muốn tập
                          </p>
                          <p className="text-2xl font-black text-white">
                            {currentUserStudent.sessionsPerWeek}{" "}
                            <span className="text-sm font-medium text-zinc-500">
                              buổi/tuần
                            </span>
                          </p>
                        </div>
                        <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800/50">
                          <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold mb-1">
                            Khung giờ rảnh
                          </p>
                          <p className="text-2xl font-black text-white">
                            {currentUserStudent.availableSlots?.length || 0}{" "}
                            <span className="text-sm font-medium text-zinc-500">
                              khung giờ
                            </span>
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={handleToggleConfirm}
                        className="w-full text-sm font-medium text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 py-3 rounded-xl transition-colors border border-zinc-800"
                      >
                        Hủy chốt để sửa lại lịch rảnh
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {studentTab === "profile" && (
              <motion.div
                key="profile"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                <div className="bg-zinc-900 p-6 rounded-3xl border border-zinc-800 shadow-xl">
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-2xl font-black text-white shadow-lg">
                      {currentUserStudent.name?.charAt(0).toUpperCase() || "?"}
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-white">
                        {currentUserStudent.name}
                      </h2>
                      <p className="text-zinc-400 flex items-center gap-1 mt-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {currentUserStudent.branchId
                          ? branches?.find(b => b.id === currentUserStudent.branchId)?.name || ("Cơ sở " + currentUserStudent.branchId)
                          : "Chưa cập nhật cơ sở"}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800 flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center text-zinc-400">
                        <Phone className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold">
                          Số điện thoại
                        </p>
                        <p className="text-white font-medium mt-0.5">
                          {currentUserStudent.phone || "Chưa cập nhật"}
                        </p>
                      </div>
                    </div>

                    <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800 flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center text-zinc-400">
                        <Mail className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold">
                          Email
                        </p>
                        <p className="text-white font-medium mt-0.5">
                          {currentUserStudent.email || "Chưa cập nhật"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

    </div>
  );
}
