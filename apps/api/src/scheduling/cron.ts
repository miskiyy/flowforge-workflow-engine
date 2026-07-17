/**
 * A minimal standard 5-field cron matcher (minute hour day-of-month month
 * day-of-week), evaluated in UTC. No dependency — CLAUDE.md's "avoid
 * unnecessary dependencies": the subset needed here (a bare star, exact
 * values, comma lists, and star-slash-step) covers realistic scheduling
 * ("every 5 minutes", "daily at 09:00", "hourly") without pulling in a full
 * cron-expression library for a 5-day MVP. Day-of-month and day-of-week are
 * OR'd together when both are restricted, matching standard cron semantics
 * (e.g. "run on the 1st of the month OR every Monday").
 */

interface FieldRange {
  min: number;
  max: number;
}

const FIELDS: readonly FieldRange[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // day of week (0 = Sunday)
];

function parseField(field: string, { min, max }: FieldRange): Set<number> | null {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const stepMatch = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!stepMatch) return null;
    const [, base, stepStr] = stepMatch;
    const step = stepStr !== undefined ? Number(stepStr) : 1;
    if (step < 1) return null;

    let rangeStart = min;
    let rangeEnd = max;
    if (base !== '*') {
      const rangeMatch = /^(\d+)(?:-(\d+))?$/.exec(base!);
      if (!rangeMatch) return null;
      rangeStart = Number(rangeMatch[1]);
      rangeEnd = rangeMatch[2] !== undefined ? Number(rangeMatch[2]) : rangeStart;
    }
    if (rangeStart < min || rangeEnd > max || rangeStart > rangeEnd) return null;

    for (let v = rangeStart; v <= rangeEnd; v += step) values.add(v);
  }

  return values;
}

export interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** Cron's OR-not-AND quirk: when both day fields are restricted (not "*"), either match is sufficient. */
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
}

export function parseCronExpression(expression: string): ParsedCron | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteStr, hourStr, domStr, monthStr, dowStr] = parts as [string, string, string, string, string];
  const minute = parseField(minuteStr, FIELDS[0]!);
  const hour = parseField(hourStr, FIELDS[1]!);
  const dayOfMonth = parseField(domStr, FIELDS[2]!);
  const month = parseField(monthStr, FIELDS[3]!);
  const dayOfWeek = parseField(dowStr, FIELDS[4]!);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;

  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    dayOfMonthRestricted: domStr !== '*',
    dayOfWeekRestricted: dowStr !== '*',
  };
}

export function isValidCronExpression(expression: string): boolean {
  return parseCronExpression(expression) !== null;
}

/** All comparisons are UTC — a single-timezone MVP, per this project's existing "no per-tenant config" posture elsewhere. */
export function matchesCron(expression: string, date: Date): boolean {
  const parsed = parseCronExpression(expression);
  if (!parsed) return false;

  if (!parsed.minute.has(date.getUTCMinutes())) return false;
  if (!parsed.hour.has(date.getUTCHours())) return false;
  if (!parsed.month.has(date.getUTCMonth() + 1)) return false;

  const domMatch = parsed.dayOfMonth.has(date.getUTCDate());
  const dowMatch = parsed.dayOfWeek.has(date.getUTCDay());
  if (parsed.dayOfMonthRestricted && parsed.dayOfWeekRestricted) return domMatch || dowMatch;
  return domMatch && dowMatch;
}

/** The current-minute idempotency key (Task.md:102) — a cron scheduler tick that re-evaluates the same minute reuses this exact string. */
export function minuteBucketKey(date: Date): string {
  const bucketed = new Date(Math.floor(date.getTime() / 60_000) * 60_000);
  return `cron:${bucketed.toISOString()}`;
}
