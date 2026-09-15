/** Georgia (Asia/Tbilisi) has no DST; offset is always +04:00. */
export const TBILISI_TIME_ZONE = 'Asia/Tbilisi';
export const TBILISI_OFFSET = '+04:00';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDateOnly(value: string | null | undefined): boolean {
  return !!value && ISO_DATE_RE.test(value.trim());
}

/** Calendar Y-M-D parts in Asia/Tbilisi for an instant. */
export function tbilisiYmdParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TBILISI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
  };
}

/** Today as YYYY-MM-DD in Asia/Tbilisi. */
export function tbilisiTodayIso(): string {
  const { year, month, day } = tbilisiYmdParts();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Start of calendar day in Asia/Tbilisi, as UTC ISO (Z).
 * Always use toISOString() — raw "+04:00" breaks PostgREST query strings
 * because "+" is decoded as a space.
 */
export function tbilisiDayStartIso(dateStr: string): string {
  return new Date(`${dateStr.trim()}T00:00:00${TBILISI_OFFSET}`).toISOString();
}

/** Exclusive end = start of next Tbilisi calendar day (UTC ISO). */
export function tbilisiDayEndExclusiveIso(dateStr: string): string {
  const start = new Date(`${dateStr.trim()}T00:00:00${TBILISI_OFFSET}`);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function padIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Inclusive YYYY-MM-DD range for a calendar month in Tbilisi. */
export function tbilisiMonthDateRange(
  year: number,
  month: number,
): { from: string; to: string } {
  return {
    from: padIsoDate(year, month, 1),
    to: padIsoDate(year, month, daysInMonth(year, month)),
  };
}

/** Inclusive YYYY-MM-DD range for a calendar year. */
export function tbilisiYearDateRange(year: number): { from: string; to: string } {
  return {
    from: padIsoDate(year, 1, 1),
    to: padIsoDate(year, 12, 31),
  };
}

/** First/last day of the previous calendar month in Tbilisi. */
export function tbilisiPreviousMonthDateRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const { year, month } = tbilisiYmdParts(now);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return tbilisiMonthDateRange(prevYear, prevMonth);
}

export function tbilisiThisMonthDateRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const { year, month } = tbilisiYmdParts(now);
  return tbilisiMonthDateRange(year, month);
}

export function tbilisiThisYearDateRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  return tbilisiYearDateRange(tbilisiYmdParts(now).year);
}
