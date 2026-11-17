// Workout numbers as short text ("3 × 10 reps", "Rest 1 min 30 s"). Pure, tested in test/logic.test.mjs.
import { translate, type Language } from '../i18n/translate';

export function duration(language: Language, seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m && s) return translate(language, 'format.minSec', { m, s });
  if (m) return translate(language, 'format.min', { n: m });
  return translate(language, 'format.sec', { n: s });
}

export type WorkoutNumbers = {
  sets: number | null;
  reps: number | null;
  duration_seconds: number | null;
  rest_seconds: number | null;
};

export function workoutSummary(language: Language, w: WorkoutNumbers): string {
  const sets = w.sets ?? 1;
  if (w.reps) return translate(language, 'format.reps', { sets, reps: w.reps });
  if (w.duration_seconds) return translate(language, 'format.time', { sets, time: duration(language, w.duration_seconds) });
  return '';
}

export function restText(language: Language, w: WorkoutNumbers): string {
  return w.rest_seconds ? translate(language, 'format.rest', { time: duration(language, w.rest_seconds) }) : '';
}

// "12" -> 12; "", "0", "-3", "2.5", "abc" -> null
export function positiveInt(text: string, allowZero = false): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n > 0 || (allowZero && n === 0) ? n : null;
}
