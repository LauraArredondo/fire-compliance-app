import { Doc } from "../_generated/dataModel";

export const DAY = 24 * 60 * 60 * 1000;
export const SEND_HOUR_LONDON = 7;
export const MAX_SEND_ATTEMPTS = 5;
/** Backoff after attempt n (1-based): 1 min, 5 min, 30 min, 2 h. */
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export const DEFAULTS = {
  enabled: true,
  serviceLeadDays: [30, 14, 7, 0],
  certificateLeadDays: [30, 14, 7, 0],
  qualificationLeadDays: [60, 30, 7, 0],
  quoteFollowUpDays: [3, 10],
  defectFollowUpDays: { critical: 1, major: 14, minor: 30, advisory: 0 },
  overdueRepeatDays: 7,
  overdueMaxReminders: 4,
  officeEmails: [] as string[],
  weeklyDigest: false,
  /** Days after the due date to chase unpaid invoices (one reminder per stage). */
  invoiceOverdueDays: [1, 7, 14, 30],
  /** Send overdue-invoice reminders to the client as well as the office. */
  invoiceRemindClient: true,
};
export type ReminderSettings = typeof DEFAULTS;

export function settingsFor(org: Doc<"organizations">): ReminderSettings {
  const s = org.reminderSettings ?? {};
  return {
    enabled: s.enabled ?? DEFAULTS.enabled,
    serviceLeadDays: s.serviceLeadDays?.length ? s.serviceLeadDays : DEFAULTS.serviceLeadDays,
    certificateLeadDays: s.certificateLeadDays?.length ? s.certificateLeadDays : DEFAULTS.certificateLeadDays,
    qualificationLeadDays: s.qualificationLeadDays?.length ? s.qualificationLeadDays : DEFAULTS.qualificationLeadDays,
    quoteFollowUpDays: s.quoteFollowUpDays?.length ? s.quoteFollowUpDays : DEFAULTS.quoteFollowUpDays,
    defectFollowUpDays: s.defectFollowUpDays ?? DEFAULTS.defectFollowUpDays,
    overdueRepeatDays: s.overdueRepeatDays ?? DEFAULTS.overdueRepeatDays,
    overdueMaxReminders: s.overdueMaxReminders ?? DEFAULTS.overdueMaxReminders,
    officeEmails: s.officeEmails ?? DEFAULTS.officeEmails,
    weeklyDigest: s.weeklyDigest ?? DEFAULTS.weeklyDigest,
    invoiceOverdueDays: s.invoiceOverdueDays ?? DEFAULTS.invoiceOverdueDays,
    invoiceRemindClient: s.invoiceRemindClient ?? DEFAULTS.invoiceRemindClient,
  };
}

/* ---------------- Europe/London calendar helpers ---------------- */

function londonParts(ms: number) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hour: +p.hour, minute: +p.minute, weekday: p.weekday };
}

/** Milliseconds London is ahead of UTC at `ms` (0 in winter, 1h in summer). */
function londonOffset(ms: number): number {
  const p = londonParts(ms);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 3600000) * 3600000;
}

export const londonHour = (ms: number) => londonParts(ms).hour;
export const londonWeekday = (ms: number) => londonParts(ms).weekday; // "Mon", "Tue", ...
export function londonDayNumber(ms: number): number {
  const p = londonParts(ms);
  return Date.UTC(p.y, p.m - 1, p.d) / DAY;
}
export const londonDateKey = (ms: number) => new Date(londonDayNumber(ms) * DAY).toISOString().slice(0, 10);

/** Calendar days from `now` until `due` in UK time (negative = overdue). */
export const daysUntil = (due: number, now: number) => londonDayNumber(due) - londonDayNumber(now);

/** 07:00 UK time on the day `days` after `from`. */
export function londonMorning(from: number, days: number, hour = SEND_HOUR_LONDON): number {
  const day = londonDayNumber(from) + days;
  const guess = day * DAY + hour * 3600000;
  return guess - londonOffset(guess);
}

/* ---------------- Stage calculation ---------------- */

/**
 * Which reminder stage applies today: the smallest lead time that has been reached
 * (only one reminder per stage, so a schedule entering its 7-day window doesn't also get the 30 and 14),
 * or an overdue stage repeated every `repeatDays`.
 */
export function leadStage(dueAt: number, now: number, leads: number[], repeatDays: number, maxOverdue: number): string | null {
  const d = daysUntil(dueAt, now);
  if (d >= 0) {
    const sorted = [...new Set(leads.filter((x) => x >= 0))].sort((a, b) => a - b);
    const s = sorted.find((l) => d <= l);
    return s === undefined ? null : `d${s}`;
  }
  const od = -d;
  const n = repeatDays > 0 ? Math.floor((od - 1) / repeatDays) + 1 : 1;
  return n > maxOverdue ? null : `od${n}`;
}

/** Follow-up stage N days after an event (e.g. a quote being sent). */
export function followUpStage(eventAt: number, now: number, followUps: number[]): string | null {
  const since = -daysUntil(eventAt, now);
  const reached = followUps.filter((f) => f > 0 && since >= f).sort((a, b) => b - a)[0];
  return reached === undefined ? null : `f${reached}`;
}

export function describeDue(dueAt: number, now: number): { label: string; tone: "info" | "soon" | "overdue" } {
  const d = daysUntil(dueAt, now);
  if (d < 0) return { label: `Overdue by ${-d} day${d === -1 ? "" : "s"}`, tone: "overdue" };
  if (d === 0) return { label: "Due today", tone: "overdue" };
  if (d <= 7) return { label: `Due in ${d} day${d === 1 ? "" : "s"}`, tone: "soon" };
  return { label: `Due in ${d} days`, tone: "info" };
}
