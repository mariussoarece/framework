// Predefined themes the owner can choose (home_settings.theme_key).
export type Theme = {
  key: string;
  name: string;
  background: string;
  surface: string;      // cards on top of the background
  text: string;
  muted: string;
  primary: string;      // default button color
  onPrimary: string;
  border: string;
};

export const THEMES: Theme[] = [
  { key: 'calm', name: 'Calm', background: '#F4F1EA', surface: 'rgba(255,255,255,0.88)', text: '#2E2A24',
    muted: '#6F675C', primary: '#4F7D6B', onPrimary: '#FFFFFF', border: '#DDD6C8' },
  { key: 'forest', name: 'Forest', background: '#1F3A2E', surface: 'rgba(23,43,34,0.85)', text: '#EEF3EE',
    muted: '#B5C7BA', primary: '#8BC79A', onPrimary: '#10261A', border: '#3C5C4C' },
  { key: 'ocean', name: 'Ocean', background: '#E7F1F7', surface: 'rgba(255,255,255,0.9)', text: '#16324A',
    muted: '#557189', primary: '#1F6FA8', onPrimary: '#FFFFFF', border: '#C6DAE7' },
  { key: 'sunset', name: 'Sunset', background: '#FBEDE4', surface: 'rgba(255,255,255,0.88)', text: '#3D2219',
    muted: '#8A5D4D', primary: '#D9643A', onPrimary: '#FFFFFF', border: '#F0D2C2' },
  { key: 'dojo', name: 'Dojo', background: '#141414', surface: 'rgba(30,30,30,0.9)', text: '#F5F5F5',
    muted: '#A8A8A8', primary: '#C62828', onPrimary: '#FFFFFF', border: '#333333' },
  { key: 'minimal', name: 'Minimal', background: '#FFFFFF', surface: 'rgba(247,247,247,0.95)', text: '#111111',
    muted: '#666666', primary: '#111111', onPrimary: '#FFFFFF', border: '#E5E5E5' },
];

export const DEFAULT_THEME = THEMES[0];

export function themeFor(key: string | null | undefined): Theme {
  return THEMES.find((t) => t.key === key) ?? DEFAULT_THEME;
}

// Button icons the owner can pick (stored as these keys) -> Ionicons names.
export const ICONS: Record<string, string> = {
  calendar: 'calendar-outline',
  dumbbell: 'barbell-outline',
  star: 'star-outline',
  heart: 'heart-outline',
  leaf: 'leaf-outline',
  body: 'body-outline',
  fitness: 'fitness-outline',
  time: 'time-outline',
  water: 'water-outline',
  flame: 'flame-outline',
};

export const iconFor = (key: string) => ICONS[key] ?? ICONS.star;

// Dark background? (decides light or dark pickers)
export function isDarkTheme(t: Theme): boolean {
  const hex = t.background.replace('#', '');
  if (hex.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}
