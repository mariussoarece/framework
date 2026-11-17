// Set in mobile/.env (see .env.example). EXPO_PUBLIC_ values are built into the app.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
export const ANON_KEY = process.env.EXPO_PUBLIC_ANON_KEY ?? '';

if (!API_URL || !ANON_KEY) {
  console.warn('EXPO_PUBLIC_API_URL / EXPO_PUBLIC_ANON_KEY are not set (mobile/.env)');
}
