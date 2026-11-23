// Push notifications (booking approved, new booking request, picture approved, ...).
// The server sends them straight to Apple (APNs) and Google (FCM), so the app registers the
// phone's own push token. That only exists in a real build (development build or store app):
// in Expo Go everything here quietly does nothing.
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router } from 'expo-router';
import { supabase } from './supabase';

type Notifications = typeof import('expo-notifications');

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// loaded only outside Expo Go (on Android, Expo Go no longer supports push at all)
function lib(): Notifications | null {
  if (inExpoGo || Platform.OS === 'web') return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-notifications') as Notifications;
}

let currentToken: string | null = null;

export type PushResult = 'registered' | 'denied' | 'unavailable' | 'failed';

// Asks for permission (once; later calls just check) and sends the token to the server.
export async function registerForPush(): Promise<PushResult> {
  const N = lib();
  if (!N) return 'unavailable';
  try {
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: N.AndroidImportance.HIGH,
      });
    }
    let { status } = await N.getPermissionsAsync();
    if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
    if (status !== 'granted') return 'denied';

    const token = await N.getDevicePushTokenAsync();
    await saveToken(String(token.data));
    return 'registered';
  } catch {
    return 'failed';   // e.g. simulator, or push not set up in this build
  }
}

async function saveToken(token: string): Promise<void> {
  const { error } = await supabase.rpc('register_device', {
    p_token: token,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  if (error) throw error;
  currentToken = token;
}

// Before signing out: this phone should stop getting the previous person's notifications.
export async function unregisterPush(): Promise<void> {
  if (!currentToken) return;
  await supabase.from('devices').delete().eq('push_token', currentToken);
  currentToken = null;
}

// Where a tapped notification leads.
export function routeFor(data: Record<string, unknown> | undefined): string | null {
  switch (data?.type) {
    case 'booking': return '/schedule';
    case 'media': return '/home';
    case 'report': return '/admin';
    default: return null;
  }
}

// Show notifications while the app is open, follow taps, and keep the token up to date.
// Returns a function that stops listening.
export function startPushListeners(): () => void {
  const N = lib();
  if (!N) return () => {};
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
    }),
  });
  const open = (response: { notification: { request: { content: { data?: Record<string, unknown> } } } }) => {
    const route = routeFor(response.notification.request.content.data);
    if (route) router.push(route as never);
  };
  // the app was opened by tapping a notification
  N.getLastNotificationResponseAsync().then((r) => { if (r) open(r); }).catch(() => {});
  const tapped = N.addNotificationResponseReceivedListener(open);
  const refreshed = N.addPushTokenListener((t) => { saveToken(String(t.data)).catch(() => {}); });
  return () => { tapped.remove(); refreshed.remove(); };
}
