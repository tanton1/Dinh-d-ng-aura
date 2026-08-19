export const getDatesForWeek = (weekOffset: number = 0) => {
  const today = new Date();
  const currentDay = today.getDay();
  const adjustedDay = currentDay === 0 ? 6 : currentDay - 1;
  const mondayDate = new Date(today);
  
  // Go to Monday of current week, then add weekOffset * 7 days
  mondayDate.setDate(today.getDate() - adjustedDay + (weekOffset * 7));
  
  const dates: Record<string, { display: string, full: string }> = {};
  const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  
  dayNames.forEach((day, index) => {
    const date = new Date(mondayDate);
    date.setDate(mondayDate.getDate() + index);
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    
    dates[day] = {
      display: date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
      full: `${year}-${month}-${d}`
    };
  });
  
  return dates;
};

export const getDatesForCurrentWeek = () => getDatesForWeek(0);

export const getWeekRange = (weekOffset: number = 0) => {
  const today = new Date();
  const currentDay = today.getDay();
  const adjustedDay = currentDay === 0 ? 6 : currentDay - 1;
  
  const start = new Date(today);
  start.setDate(today.getDate() - adjustedDay + (weekOffset * 7));
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  
  return { start, end };
};

export const getMonthRange = (monthOffset: number = 0) => {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(today.getFullYear(), today.getMonth() + monthOffset + 1, 0);
  end.setHours(23, 59, 59, 999);
  
  return { start, end };
};

export const robustParseDate = (dateStr: string | undefined | null) => {
  if (!dateStr) return new Date(NaN);
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return new Date(NaN);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export const isSameDayOrAfter = (dateStr: string | undefined | null, referenceDate: Date) => {
  if (!dateStr) return false;
  const parts = dateStr.split('T')[0].split('-');
  let d: Date;
  if (parts.length === 3) {
    const [year, month, day] = parts.map(Number);
    d = new Date(year, month - 1, day);
  } else {
    d = new Date(dateStr);
  }
  
  if (isNaN(d.getTime())) return false;
  
  const r = new Date(referenceDate);
  d.setHours(0, 0, 0, 0);
  r.setHours(0, 0, 0, 0);
  return d >= r;
};

export const formatDate = (dateStr: string | undefined | null): string => {
  if (!dateStr) return 'N/A';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts.map(Number);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      return new Date(year, month - 1, day).toLocaleDateString('vi-VN');
    }
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('vi-VN');
};
