// Scheduling helpers: times, prices, days. Pure (no React), tested in test/logic.test.mjs.
import type { Language } from '../i18n/translate';

const locale = (l: Language) => (l === 'ro' ? 'ro-RO' : 'en-GB');

// "9", "9:5", "09:30", "9.30" -> "09:30"; invalid -> null
export function parseTime(text: string): string | null {
  const m = /^(\d{1,2})(?:[:.](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Database "09:30:00" -> "09:30"
export const shortTime = (t: string) => t.slice(0, 5);

export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// "30", "30,50", "30.5" -> 3000, 3050, 3050; invalid -> null
export function parseMoney(text: string): number | null {
  const m = /^(\d{1,5})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

export function formatMoney(cents: number, currency: string, language: Language): string {
  return new Intl.NumberFormat(locale(language), { style: 'currency', currency, minimumFractionDigits: cents % 100 ? 2 : 0 })
    .format(cents / 100);
}

// "2026-12-24" (a real date) -> true
export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

// Calendar date of an instant in a time zone, as YYYY-MM-DD.
export function dayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso));
}

export function clock(iso: string, timeZone: string, language: Language): string {
  return new Intl.DateTimeFormat(locale(language), { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(iso));
}

// "Thursday, 20 November"; from next year on the year is added: "Monday, 4 January 2027"
export function dayLabel(key: string, language: Language, currentYear: number = new Date().getFullYear()): string {
  const withYear = Number(key.slice(0, 4)) !== currentYear;
  return new Intl.DateTimeFormat(locale(language), {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' as const } : {}),
  }).format(new Date(`${key}T12:00:00Z`));
}

// 0 = Sunday ... 6 = Saturday (as in the database)
export function weekdayName(weekday: number, language: Language): string {
  // 2023-01-01 was a Sunday
  return new Intl.DateTimeFormat(locale(language), { timeZone: 'UTC', weekday: 'long' })
    .format(new Date(Date.UTC(2023, 0, 1 + weekday, 12)));
}

// Monday first, as people in Romania expect.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export type Slot = { starts_at: string; ends_at: string; remaining: number; price_cents: number; currency: string };

export function groupByDay<T extends { starts_at: string }>(items: T[], timeZone: string): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const it of items) {
    const day = dayKey(it.starts_at, timeZone);
    const last = out.at(-1);
    if (last && last.day === day) last.items.push(it);
    else out.push({ day, items: [it] });
  }
  return out;
}

// Today in the organization's time zone, YYYY-MM-DD.
export const today = (timeZone: string) => dayKey(new Date().toISOString(), timeZone);

// YYYY-MM-DD + n days
export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Monday of the week containing the given day.
export function weekStart(key: string): string {
  const dow = new Date(`${key}T12:00:00Z`).getUTCDay();
  return addDays(key, -((dow + 6) % 7));
}

// Last day for "repeat for N weeks" starting on `from` (N >= 1).
export const untilForWeeks = (from: string, weeks: number) => addDays(from, weeks * 7 - 1);

// Number of weeks an entry covers (rounded up), for showing it again in the form.
export function weeksBetween(from: string, until: string): number {
  const days = Math.round((Date.parse(`${until}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;
  return Math.max(1, Math.ceil(days / 7));
}

// "HH:MM" + minutes -> "HH:MM" (same day only; null if it passes midnight)
export function addMinutes(hhmm: string, minutes: number): string | null {
  const total = minutesOf(hhmm) + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// The part of a week (Monday `week`) that is not in the past: from today or Monday, to Sunday.
export function bookableRange(week: string, todayKey: string): { from: string; days: number } {
  const end = addDays(week, 6);
  const from = todayKey > week ? todayKey : week;
  if (from > end) return { from: end, days: 0 };
  const days = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;
  return { from, days };
}

// Choices offered by the timetable form.
export const SESSION_LENGTHS = [10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 420, 480, 540, 600];
export const DEFAULT_LENGTH = 60;
export const MAX_LENGTH = 600;   // 10 hours (the database allows the same)

// "45 min", "60 min (1 h)", "90 min (1 h 30)"
export function lengthLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${minutes} min (${h} h${m ? ` ${m}` : ''})`;
}
export const MAX_ATTENDANTS = 100;
export const MAX_WEEKS = 52;
export const range1 = (max: number) => Array.from({ length: max }, (_, i) => i + 1);
