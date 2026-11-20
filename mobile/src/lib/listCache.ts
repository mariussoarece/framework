// Remembers the last lists shown (sections, a section's workouts) while the app is open,
// so going back to a screen shows them at once; fresh data replaces them a moment later.
const store = new Map<string, unknown>();

export function cached<T>(key: string): T | null {
  return (store.get(key) as T | undefined) ?? null;
}

export function remember<T>(key: string, value: T): T {
  store.set(key, value);
  return value;
}

export function forgetAll(): void {
  store.clear();
}
