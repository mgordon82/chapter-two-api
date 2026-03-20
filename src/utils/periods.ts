// src/utils/periods.ts

export type PeriodType = 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * Parses a date input safely for local-date workflows.
 *
 * If the input is YYYY-MM-DD, it is interpreted as a local calendar day
 * and normalized to local noon to avoid UTC date-shift issues.
 *
 * Otherwise falls back to native Date parsing.
 */
export function parseLocalDateInput(value: string): Date {
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    return new Date(year, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
  }

  return new Date(trimmed);
}

/**
 * Returns YYYY-MM-DD in local time
 */
export function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns start/end of a local day
 */
export function getDayPeriod(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  return {
    periodType: 'day' as PeriodType,
    periodKey: getLocalDateKey(date),
    periodStart: start,
    periodEnd: end
  };
}

/**
 * End of day helper
 */
function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Add days helper
 */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * 🔥 CORE RULE
 *
 * Manual edit window ends at:
 * MAX(
 *   end of next day after represented date,
 *   end of creation day
 * )
 */
export function getManualEditWindowEnd(params: {
  representedDate: Date;
  createdAt: Date;
}): Date {
  const { representedDate, createdAt } = params;

  const nextDayEnd = endOfDay(addDays(representedDate, 1));
  const createdDayEnd = endOfDay(createdAt);

  return nextDayEnd > createdDayEnd ? nextDayEnd : createdDayEnd;
}

/**
 * Determines if check-in is currently editable
 */
export function isCheckInEditable(params: {
  manualEditWindowEndsAt?: Date | null;
  status?: 'open' | 'closed' | null;
}): boolean {
  if (params.status === 'closed') return false;
  if (!params.manualEditWindowEndsAt) return true;

  return new Date() <= params.manualEditWindowEndsAt;
}
