import {
  Student,
  Trainer,
  Schedule,
  Warning,
  SchedulerResult,
  StudentContract,
  ScheduleConfig,
} from "../types";

function getDayIndex(day: string, config: ScheduleConfig): number {
  return config.workingDays.indexOf(day as any);
}

const MAX_STUDENTS_PER_PT = 2;

export function getStudentSessionsPerWeek(
  student: Student,
  config: ScheduleConfig,
  overriddenSessions?: Record<string, number>,
): number {
  if (overriddenSessions && overriddenSessions[student.id] !== undefined) {
    return overriddenSessions[student.id];
  }
  return Number(student.sessionsPerWeek) || 0;
}

function getSessionsLeft(contract: StudentContract, allSessions: import("../types").Session[]): number {
  const totalSess = contract.totalSessions !== undefined ? contract.totalSessions : 999;
  
  // Base completed/used sessions
  let used = contract.usedSessions || 0;
  
  // Add scheduled sessions
  const scheduledCount = allSessions.filter(s => {
    if (s.studentId !== contract.studentId) return false;
    if (s.status !== 'scheduled') return false;
    const sDate = new Date(s.date).getTime();
    const startDate = new Date(contract.startDate).getTime();
    const endDate = new Date(contract.endDate).getTime() + (86400000 * 60);
    return sDate >= startDate && sDate <= endDate;
  }).length;
  
  return totalSess - used - scheduledCount;
}

export function generateSchedule(
  students: Student[],
  trainers: Trainer[],
  contracts: StudentContract[],
  allSessions: import("../types").Session[],
  config: ScheduleConfig,
  existingSchedule?: Schedule,
  overriddenSessions?: Record<string, number>,
  targetDate: Date = new Date(),
): SchedulerResult {
  const schedule: Schedule = {};
  const warnings: Warning[] = [];
  const debugSteps: string[] = [];

  if (trainers.length === 0) return { schedule, warnings, debugSteps };

  // Initialize schedule
  for (const day of config.workingDays) {
    for (const hour of config.workingHours) {
      schedule[`${day}-${hour}`] = [];
    }
  }

  const studentNeeds: Record<string, number> = {};
  const studentScheduledDays: Record<string, Set<string>> = {};
  const studentScheduledSlots: Record<string, string[]> = {};

  for (const s of students) {
    const sessions = getStudentSessionsPerWeek(s, config, overriddenSessions);
    studentNeeds[s.id] = sessions;
    studentScheduledDays[s.id] = new Set();
    studentScheduledSlots[s.id] = [];
  }

  // Pre-fill all entries from existing schedule
  if (existingSchedule) {
    for (const day of config.workingDays) {
      for (const hour of config.workingHours) {
        const slotId = `${day}-${hour}`;
        const existingEntries = existingSchedule[slotId] || [];
        for (const entry of existingEntries) {
          schedule[slotId].push(entry);

          // Update student tracking
          if (
            entry.studentId !== "OFF" &&
            studentNeeds[entry.studentId] !== undefined
          ) {
            studentNeeds[entry.studentId]--;
            studentScheduledDays[entry.studentId].add(day);
            studentScheduledSlots[entry.studentId].push(slotId);
          }
        }
      }
    }
  }

  // Map students to their active contracts
  const studentContracts = new Map<string, StudentContract[]>();
  const now = new Date(targetDate);
  now.setHours(0, 0, 0, 0); // Start of target week

  const endOfTargetWeek = new Date(now);
  endOfTargetWeek.setDate(now.getDate() + 6);
  endOfTargetWeek.setHours(23, 59, 59, 999);

  // Group active contracts by student ID
  const studentActiveContractsMap = new Map<string, StudentContract[]>();
  contracts.forEach((c) => {
    if (c.status === "active") {
      const existing = studentActiveContractsMap.get(c.studentId) || [];
      studentActiveContractsMap.set(c.studentId, [...existing, c]);
    }
  });

  studentActiveContractsMap.forEach((userContracts, studentId) => {
    // Sort contracts by start date ascending (chronological order)
    const sortedUserContracts = [...userContracts].sort(
      (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );

    sortedUserContracts.forEach((c) => {
      let startDate = new Date(c.startDate || 0);
      if (isNaN(startDate.getTime())) startDate = new Date(0);

      let endDate = new Date(c.endDate || (now.getTime() + 1000 * 3600 * 24 * 365));
      if (isNaN(endDate.getTime())) endDate = new Date(now.getTime() + 1000 * 3600 * 24 * 365);
      
      endDate.setHours(23, 59, 59, 999);
      const timeDiff = endDate.getTime() - now.getTime();
      const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));

      // Fallback for old data where totalSessions might be undefined
      const totalSess = c.totalSessions !== undefined ? c.totalSessions : 999;
      const sessionsLeft = getSessionsLeft(c, allSessions);

      let isStartValid = startDate.getTime() <= endOfTargetWeek.getTime();

      // Option 1: If startDate is in the future, but all prior contracts for this student are exhausted or expired,
      // auto-advance this continuation contract so it becomes effective immediately!
      if (!isStartValid && sessionsLeft > 0 && daysLeft >= 0) {
        const priorContracts = sortedUserContracts.filter(
          other => other.id !== c.id && new Date(other.startDate).getTime() < startDate.getTime()
        );

        const hasUnexhaustedPriorContract = priorContracts.some(other => {
          const otherLeft = getSessionsLeft(other, allSessions);
          const otherEndDate = new Date(other.endDate || 0);
          otherEndDate.setHours(23, 59, 59, 999);
          return otherLeft > 0 && otherEndDate.getTime() >= now.getTime();
        });

        if (!hasUnexhaustedPriorContract) {
          isStartValid = true;
          debugSteps.push(
            `Kích hoạt sớm HĐ ${c.packageName || c.id} cho học viên ${studentId} do các HĐ cũ đã hết buổi/hết hạn.`
          );
        }
      }

      if (
        daysLeft >= 0 &&
        sessionsLeft > 0 &&
        isStartValid
      ) {
        const existing = studentContracts.get(c.studentId) || [];
        studentContracts.set(c.studentId, [...existing, c]);
      } else {
        const reason = [];
        if (daysLeft < 0) reason.push(`Hết hạn (còn ${daysLeft} ngày)`);
        if (sessionsLeft <= 0) reason.push(`Hết buổi (còn ${sessionsLeft} buổi)`);
        if (!isStartValid) reason.push(`Chưa tới ngày học (Start: ${startDate.toLocaleDateString()})`);
        
        debugSteps.push(
          `Bỏ qua HĐ của ${c.studentId}: ${reason.join(', ')}`,
        );
      }
    });
  });

  // Only schedule students with active contracts
  // If they have an active contract, they should be scheduled even if their profile status was manually set to 'inactive'
  const activeStudents = students.filter(
    (s) => studentContracts.has(s.id)
  );

  if (activeStudents.length === 0) {
    debugSteps.push(`Lỗi: Không tìm thấy học viên nào có hợp đồng khả dụng trong tuần này để xếp lịch.`);
  }

  // Sort students by least available slots first
  const sortedStudents = [...activeStudents].sort((a, b) => {
    const aLen = Array.isArray(a.availableSlots) ? a.availableSlots.length : 0;
    const bLen = Array.isArray(b.availableSlots) ? b.availableSlots.length : 0;
    return aLen - bLen;
  });

  // We iterate student by student. For each student, we try to fulfill their needs
  // by assigning them to their trainers in the order of priority defined in their contract.
  for (const student of sortedStudents) {
    if (studentNeeds[student.id] > 0) {
      const studentActiveContracts = studentContracts.get(student.id) || [];
      const sBranchId = studentActiveContracts[0]?.branchId || student.branchId || "";
      
      // Determine the ordered list of trainers for this student based on the active contract
      const latestContract = studentActiveContracts[0];
      let orderedTrainerIds: string[] = [];
      
      if (latestContract) {
        if (latestContract.trainerIds && latestContract.trainerIds.length > 0) {
          orderedTrainerIds = [...latestContract.trainerIds];
        } else if (latestContract.trainerId) {
          orderedTrainerIds = [latestContract.trainerId];
        }
      }

      // If no trainer is assigned in contract, they can be scheduled with any trainer in the same branch
      let trainersToTry: Trainer[] = [];
      if (orderedTrainerIds.length > 0) {
        trainersToTry = orderedTrainerIds
          .map(id => trainers.find(t => t.id === id))
          .filter((t): t is Trainer => t !== undefined);
      } else {
        trainersToTry = [...trainers].sort((a, b) => (a.priority || 999) - (b.priority || 999));
      }

      for (let i = 0; i < trainersToTry.length; i++) {
        const trainer = trainersToTry[i];
        const tBranchId = trainer.branchId || "";
        
        // If trainer is not floating, and their branch doesn't match student's branch, skip.
        // But if they are explicitly assigned in orderedTrainerIds, we might still allow it, 
        // but typically branches should match.
        if (tBranchId !== "" && sBranchId !== "" && tBranchId !== sBranchId) {
          debugSteps.push(
            `Bỏ qua Trainer ${trainer.name} (cơ sở ${tBranchId}) cho Student ${student.name} (cơ sở ${sBranchId}) do khác cơ sở.`,
          );
          continue;
        }

        const isPT2AndBeyond = i > 0; // True if this is PT Phụ 1, PT Phụ 2...

        scheduleStudentWithTrainer(
          student,
          trainer,
          isPT2AndBeyond,
          schedule,
          studentNeeds,
          studentScheduledDays,
          studentScheduledSlots,
          config,
          debugSteps,
        );

        if (studentNeeds[student.id] <= 0) {
          break; // Fully scheduled
        }
      }
    }
  }

  return {
    schedule,
    warnings: calculateWarnings(
      activeStudents,
      trainers,
      schedule,
      config,
      overriddenSessions,
    ),
    debugSteps,
  };
}

export function calculateWarnings(
  students: Student[],
  trainers: Trainer[],
  schedule: Schedule,
  config: ScheduleConfig,
  overriddenSessions?: Record<string, number>,
): Warning[] {
  const warnings: Warning[] = [];
  const studentScheduledSlots: Record<string, string[]> = {};

  for (const s of students) {
    studentScheduledSlots[s.id] = [];
  }

  for (const day of config.workingDays) {
    for (const hour of config.workingHours) {
      const slotId = `${day}-${hour}`;
      const entries = schedule[slotId] || [];
      for (const entry of entries) {
        if (
          entry.studentId !== "OFF" &&
          studentScheduledSlots[entry.studentId]
        ) {
          studentScheduledSlots[entry.studentId].push(slotId);
        }
      }
    }
  }

  for (const student of students) {
    const slots = studentScheduledSlots[student.id] || [];
    const scheduled = slots.length;
    const requested = getStudentSessionsPerWeek(
      student,
      config,
      overriddenSessions,
    );

    const dayCounts: Record<string, number> = {};
    const slotCounts: Record<string, number> = {};

    slots.forEach((slot) => {
      const day = slot.split("-")[0];
      dayCounts[day] = (dayCounts[day] || 0) + 1;
      slotCounts[slot] = (slotCounts[slot] || 0) + 1;
    });

    const multipleSessionsDays = Object.keys(dayCounts).filter(
      (day) => dayCounts[day] > 1,
    );
    const overlappingSlots = Object.keys(slotCounts).filter(
      (slot) => slotCounts[slot] > 1,
    );

    if (scheduled < requested) {
      const suggestions = getSuggestions(
        student,
        schedule,
        trainers,
        studentScheduledSlots[student.id],
        config,
      );
      const warningObj: Warning = {
        studentId: student.id,
        scheduled,
        requested,
        suggestions,
      };
      if (multipleSessionsDays.length > 0) warningObj.multipleSessionsDays = multipleSessionsDays;
      if (overlappingSlots.length > 0) warningObj.overlappingSlots = overlappingSlots;
      warnings.push(warningObj);
    } else if (
      scheduled > requested ||
      multipleSessionsDays.length > 0 ||
      overlappingSlots.length > 0
    ) {
      const warningObj: Warning = {
        studentId: student.id,
        scheduled,
        requested,
        suggestions: [],
      };
      if (multipleSessionsDays.length > 0) warningObj.multipleSessionsDays = multipleSessionsDays;
      if (overlappingSlots.length > 0) warningObj.overlappingSlots = overlappingSlots;
      warnings.push(warningObj);
    }
  }

  return warnings;
}

function scheduleStudentWithTrainer(
  student: Student,
  trainer: Trainer,
  isPT2AndBeyond: boolean,
  schedule: Schedule,
  studentNeeds: Record<string, number>,
  studentScheduledDays: Record<string, Set<string>>,
  studentScheduledSlots: Record<string, string[]>,
  config: ScheduleConfig,
  debugSteps?: string[],
) {
  let needed = studentNeeds[student.id];
  if (needed <= 0 || isNaN(needed)) {
    debugSteps?.push(`Bỏ qua phân bổ thêm cho HV ${student.name} vì số buổi cần học trong tuần = ${needed}`);
    return;
  }

  const scheduledDays = studentScheduledDays[student.id];
  const scheduledSlots = studentScheduledSlots[student.id];

  // Find available slots for THIS specific trainer
  const slotsByDay: Record<string, string[]> = {};
  const availableSlotsArray = Array.isArray(student.availableSlots)
    ? student.availableSlots
    : [];
  for (const slot of availableSlotsArray) {
    const [day, hourStr] = slot.split("-");
    const hour = parseInt(hourStr, 10);

    if (!config.workingDays.includes(day as any)) continue;

    // Rule: Max 1 session per day per student
    if (scheduledDays.has(day)) continue;

    // Constraint: Trainer's designated available slots
    if (trainer.availableSlots && trainer.availableSlots.length > 0) {
      if (!trainer.availableSlots.includes(slot)) {
        continue; // PT is "off" or not available in this slot
      }
    }

    // Check if this trainer has capacity in this slot
    const trainerEntries = (schedule[slot] || []).filter(
      (e) => e.trainerId === trainer.id,
    );
    const isOff = trainerEntries.some(
      (e) => e.type === "off" || e.studentId === "OFF",
    );
    if (!isOff && trainerEntries.length < MAX_STUDENTS_PER_PT) {
      if (!slotsByDay[day]) slotsByDay[day] = [];
      slotsByDay[day].push(slot);
    }
  }

  const availableDays = Object.keys(slotsByDay).sort(
    (a, b) => getDayIndex(a, config) - getDayIndex(b, config),
  );
  if (availableDays.length === 0) {
    debugSteps?.push(
      `Học viên ${student.name} + Trainer ${trainer.name}: Học viên chưa thiết lập lịch rảnh trong form, hoặc lịch rảnh trùng ngày nghỉ.`,
    );
    return;
  }

  const findDayCombinations = (days: string[], k: number): string[][] => {
    const result: string[][] = [];
    const f = (start: number, current: string[]) => {
      if (current.length === k) {
        result.push([...current]);
        return;
      }
      for (let i = start; i < days.length; i++) {
        f(i + 1, [...current, days[i]]);
      }
    };
    f(0, []);
    return result;
  };

  // Generate all possible slot combinations for a given day combination
  const getSlotCombinations = (dayCombo: string[]): string[][] => {
    if (dayCombo.length === 0) return [[]];
    const firstDay = dayCombo[0];
    const restDays = dayCombo.slice(1);
    const restCombos = getSlotCombinations(restDays);
    const result: string[][] = [];
    for (const slot of slotsByDay[firstDay]) {
      for (const restCombo of restCombos) {
        result.push([slot, ...restCombo]);
      }
    }
    return result;
  };

  let bestSlotCombination: string[] = [];
  let bestCombinationScore = -999999;

  // Try to find the best combination of slots to fulfill the remaining needed sessions
  for (let k = Math.min(needed, availableDays.length); k > 0; k--) {
    const dayCombos = findDayCombinations(availableDays, k);

    for (const dayCombo of dayCombos) {
      // Calculate day gap violations
      const allDays = [...Array.from(scheduledDays), ...dayCombo].sort(
        (d1, d2) => getDayIndex(d1, config) - getDayIndex(d2, config),
      );

      let consecutiveCount = 1;
      let maxConsecutive = 1;
      let twoConsecutiveCount = 0;

      for (let i = 1; i < allDays.length; i++) {
        const diff =
          getDayIndex(allDays[i], config) - getDayIndex(allDays[i - 1], config);
        if (diff === 1) {
          consecutiveCount++;
          if (consecutiveCount === 2) twoConsecutiveCount++;
        } else if (diff > 1) {
          consecutiveCount = 1;
        }
        if (consecutiveCount > maxConsecutive) {
          maxConsecutive = consecutiveCount;
        }
      }

      const slotCombos = getSlotCombinations(dayCombo);

      for (const slotCombo of slotCombos) {
        let comboScore = 0;

        // Penalize 3 consecutive days heavily
        if (maxConsecutive >= 3) {
          comboScore -= 5000;
        }
        // Slight penalty for 2 consecutive days (so spaced is preferred, but easily overridden by trainer convenience)
        comboScore -= twoConsecutiveCount * 150;

        for (const slot of slotCombo) {
          const [day, hourStr] = slot.split("-");
          const hour = parseInt(hourStr, 10);
          const hourIndex = config.workingHours.indexOf(hour);

          const count = (schedule[slot] || []).filter(
            (e) => e.trainerId === trainer.id,
          ).length;
          if (count === 1) comboScore += 200; // Prioritize pairing students (filling a slot to 2/2)

          // Contiguous shift logic for the trainer
          let hasClassesToday = false;
          for (let i = 0; i < config.workingHours.length; i++) {
            if (i === hourIndex) continue;
            const h = config.workingHours[i];
            const isTeaching = schedule[`${day}-${h}`]?.some(
              (e) => e.trainerId === trainer.id,
            );
            if (isTeaching) {
              hasClassesToday = true;
              const diff = Math.abs(i - hourIndex);
              if (diff === 1)
                comboScore += 100; // Contiguous shift (liền mạch)
              else if (diff === 2)
                comboScore -= 50; // 1 shift gap (nghỉ 1 ca)
              else if (diff === 3)
                comboScore -= 20; // 2 shift gap (nghỉ 2 ca)
              else comboScore -= 5;
            }
          }
          if (!hasClassesToday) comboScore += 10; // First class of the day is better than creating a gap
        }

        if (comboScore > bestCombinationScore) {
          bestCombinationScore = comboScore;
          bestSlotCombination = slotCombo;
        }
      }
    }

    if (bestSlotCombination.length > 0) {
      break;
    }
  }

  if (bestSlotCombination.length > 0) {
    for (const slot of bestSlotCombination) {
      const day = slot.split("-")[0];
      schedule[slot].push({
        studentId: student.id,
        trainerId: trainer.id,
        type: "training",
      });
      scheduledDays.add(day);
      scheduledSlots.push(slot);
      needed--;
    }
    studentNeeds[student.id] = needed;
    debugSteps?.push(
      `Xếp thành công: HV ${student.name} + PT ${trainer.name} -> ${bestSlotCombination.join(", ")}`,
    );
  } else {
    debugSteps?.push(
      `Thất bại: HV ${student.name} + PT ${trainer.name}: Lịch rảnh rải rác hoặc không thoả mãn điều kiện xếp ${needed} buổi.`,
    );
  }
}

function getSuggestions(
  student: Student,
  schedule: Schedule,
  trainers: Trainer[],
  scheduledSlots: string[],
  config: ScheduleConfig,
): string[] {
  const suggestions: string[] = [];
  const scoredSlots: { slot: string; score: number }[] = [];

  for (const day of config.workingDays) {
    for (const hour of config.workingHours) {
      const slot = `${day}-${hour}`;
      if (scheduledSlots.includes(slot)) continue;

      let capacity = 0;
      let hasHalfFullPT = false;
      let currentStudents = 0;

      for (let i = 0; i < trainers.length; i++) {
        const t = trainers[i];

        const trainerEntries = (schedule[slot] || []).filter(
          (e) => e.trainerId === t.id,
        );
        const isOff = trainerEntries.some(
          (e) => e.type === "off" || e.studentId === "OFF",
        );
        if (isOff) continue;

        capacity += MAX_STUDENTS_PER_PT;
        const count = trainerEntries.length;
        currentStudents += count;
        if (count === 1) hasHalfFullPT = true;
      }

      if (currentStudents < capacity) {
        let score = 0;
        if (currentStudents > 0) {
          score += 10;
          if (hasHalfFullPT) score += 5;
        } else {
          score += 1;
        }
        scoredSlots.push({ slot, score });
      }
    }
  }

  scoredSlots.sort((a, b) => b.score - a.score);
  suggestions.push(...scoredSlots.slice(0, 6).map((s) => s.slot));
  return suggestions;
}

export function getActiveContract(studentId: string, contracts: StudentContract[]): StudentContract | undefined {
  const studentContracts = contracts
    .filter(c => c.studentId === studentId && (c.status === 'active' || c.status === 'frozen'))
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  
  if (studentContracts.length === 0) return undefined;

  // Find the first contract that still has sessions remaining
  const activeUnexhausted = studentContracts.find(c => {
    const total = c.totalSessions !== undefined ? c.totalSessions : 999;
    const used = c.usedSessions || 0;
    return total - used > 0;
  });

  // If all are unexhausted/exhausted, return activeUnexhausted or the latest contract
  return activeUnexhausted || studentContracts[studentContracts.length - 1];
}
