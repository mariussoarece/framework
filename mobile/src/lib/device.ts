// A short description of this phone, put in the emails about sign-ups and password resets
// ("someone tried to create an account with your email, from an iPhone · iOS 18.1").
// Nothing else is sent: no location, no identifiers.
import { Platform } from 'react-native';
import Constants from 'expo-constants';

export type DeviceInfo = { model: string; os: string; osVersion: string; appVersion: string };

export function deviceInfo(): DeviceInfo {
  const c = (Platform.constants ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
  const appVersion = str((Constants as unknown as { expoConfig?: { version?: string } }).expoConfig?.version);
  if (Platform.OS === 'ios') {
    const ipad = c.interfaceIdiom === 'pad';
    return { model: ipad ? 'iPad' : 'iPhone', os: 'iOS', osVersion: str(c.osVersion ?? Platform.Version), appVersion };
  }
  if (Platform.OS === 'android') {
    const brand = str(c.Brand || c.Manufacturer);
    const model = str(c.Model);
    return {
      model: [brand && brand[0].toUpperCase() + brand.slice(1), model].filter(Boolean).join(' ') || 'Android',
      os: 'Android', osVersion: str(c.Release), appVersion,
    };
  }
  return { model: Platform.OS, os: Platform.OS, osVersion: str(Platform.Version), appVersion };
}
