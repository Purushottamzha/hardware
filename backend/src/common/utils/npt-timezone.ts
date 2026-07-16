export const NEPAL_TZ_OFFSET_MIN = 345;

export function toNPT(utcDate: Date): Date {
  return new Date(utcDate.getTime() + NEPAL_TZ_OFFSET_MIN * 60_000);
}

export function getNPTDate(utcTimestampMs: number): Date {
  return new Date(utcTimestampMs + NEPAL_TZ_OFFSET_MIN * 60_000);
}

export function getMinutesSinceMidnightNPT(utcTimestampMs: number): number {
  const nptDate = getNPTDate(utcTimestampMs);
  return nptDate.getUTCHours() * 60 + nptDate.getUTCMinutes();
}

export function getNPTDateString(utcTimestampMs: number): string {
  return getNPTDate(utcTimestampMs).toISOString().split('T')[0];
}

export function isHoliday(calendarOverrides: CalendarOverride[], date: Date): CalendarOverride | undefined {
  const dateStr = date.toISOString().split('T')[0];
  return calendarOverrides.find((o) => o.date.toISOString().split('T')[0] === dateStr);
}

export interface CalendarOverride {
  id: number;
  date: Date;
  dayType: string;
  boardWindowStart: string | null;
  boardWindowEnd: string | null;
  departWindowStart: string | null;
  departWindowEnd: string | null;
}

export function getEffectiveWindows(
  overrides: CalendarOverride[],
  utcTimestampMs: number,
  defaults: { boardStart: number; boardEnd: number; departStart: number; departEnd: number }
): { boardStart: number; boardEnd: number; departStart: number; departEnd: number; dayType: string } {
  const nptDate = getNPTDate(utcTimestampMs);
  const override = isHoliday(overrides, nptDate);

  if (override) {
    const boardStart = override.boardWindowStart ? parseTimeToMinutes(override.boardWindowStart) : defaults.boardStart;
    const boardEnd = override.boardWindowEnd ? parseTimeToMinutes(override.boardWindowEnd) : defaults.boardEnd;
    const departStart = override.departWindowStart ? parseTimeToMinutes(override.departWindowStart) : defaults.departStart;
    const departEnd = override.departWindowEnd ? parseTimeToMinutes(override.departWindowEnd) : defaults.departEnd;
    return { boardStart, boardEnd, departStart, departEnd, dayType: override.dayType };
  }

  return { ...defaults, dayType: 'NORMAL' };
}

function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}