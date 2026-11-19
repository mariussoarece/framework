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

// "Thursday, 20 November"
export function dayLabel(key: string, language: Language): string {
  return new Intl.DateTimeFormat(locale(language), { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${key}T12:00:00Z`));
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
