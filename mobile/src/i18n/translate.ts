// Pure translation helpers (no React), so they can be tested with plain Node.
import { en, type TextKey } from './en';
import { ro } from './ro';

export type Language = 'en' | 'ro';
export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ro', label: 'Română' },
];

const dictionaries: Record<Language, Record<TextKey, string>> = { en, ro };

export function pickLanguage(code: string | null | undefined): Language {
  return code?.toLowerCase().startsWith('ro') ? 'ro' : 'en';
}

export function translate(language: Language, key: TextKey, vars: Record<string, string | number> = {}): string {
  const text = dictionaries[language][key] ?? en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''));
}

// Server and login errors arrive as codes ("name_taken") or English sentences.
const WEEKDAYS: Record<Language, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ro: ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă'],
};

export function errorText(language: Language, err: unknown): string {
  const raw = String((err as { message?: string })?.message ?? err ?? '');
  // schedule_clash|<weekday>|<start>|<end>|<class name>
  const clash = /schedule_clash\|(\d)\|([\d:]+)\|([\d:]+)\|(.*)$/.exec(raw);
  if (clash) {
    return translate(language, 'error.schedule_clash', {
      day: WEEKDAYS[language][Number(clash[1])], start: clash[2], end: clash[3],
      what: clash[4] ? ` (${clash[4]})` : '',
    });
  }
  const code = raw.toLowerCase();
  const known: Record<string, TextKey> = {
    name_taken: 'error.name_taken',
    organization_not_found: 'error.organization_not_found',
    already_owner: 'error.already_owner',
    owner_cannot_join: 'error.owner_cannot_join',
    super_admin_cannot_join: 'error.super_admin_cannot_join',
    default_owner_cannot_self_delete: 'error.default_owner_cannot_self_delete',
    slot_unavailable: 'error.slot_unavailable',
    already_booked: 'error.already_booked',
    organization_unavailable: 'error.organization_unavailable',
    payment_pending: 'error.payment_pending',
    booking_not_pending: 'error.booking_changed',
    rule_has_bookings: 'error.rule_has_bookings',
    capacity_below_booked: 'error.capacity_below_booked',
    slot_has_bookings: 'error.slot_has_bookings',
    booking_not_active: 'error.booking_changed',
    'invalid login credentials': 'error.invalid_credentials',
    'email not confirmed': 'error.email_not_confirmed',
    'user already registered': 'error.user_already_exists',
    'network request failed': 'error.network',
    'failed to fetch': 'error.network',
  };
  for (const [needle, key] of Object.entries(known)) {
    if (code.includes(needle)) return translate(language, key);
  }
  return translate(language, 'common.error');
}
