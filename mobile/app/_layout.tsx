import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider, useI18n } from '../src/i18n/I18nProvider';
import { SessionProvider, useSession } from '../src/lib/session';
import { AppState } from 'react-native';
import { refreshBadge, registerForPush, startPushListeners } from '../src/lib/push';

// Registers this phone for notifications once someone is signed in, and follows taps.
function PushSetup() {
  const { profile } = useSession();
  React.useEffect(() => startPushListeners(), []);
  React.useEffect(() => {
    if (!profile?.id) return;
    registerForPush().then(() => refreshBadge()).catch(() => {});
    // each time the app comes back to the front, the icon number is brought up to date
    const sub = AppState.addEventListener('change', (s: string) => { if (s === 'active') refreshBadge(); });
    return () => sub.remove();
  }, [profile?.id]);
  return null;
}

function Routes() {
  const { t } = useI18n();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="settings" options={{ headerShown: true, title: t('settings.title'), headerBackTitle: t('common.back') }} />
      <Stack.Screen name="schedule" options={{ headerShown: true, title: '', headerBackTitle: t('common.back') }} />
      <Stack.Screen name="workouts" options={{ headerShown: true, title: '', headerBackTitle: t('common.back') }} />
      <Stack.Screen name="section/[id]" options={{ headerShown: true, title: '', headerBackTitle: t('common.back') }} />
      <Stack.Screen name="workout/[id]" options={{ headerShown: true, title: '', headerBackTitle: t('common.back') }} />
      <Stack.Screen name="section-edit" options={{ headerShown: true, title: t('sections.edit'), presentation: 'modal' }} />
      <Stack.Screen name="workout-edit" options={{ headerShown: true, title: t('workouts.add'), presentation: 'modal' }} />
      <Stack.Screen name="class/[id]" options={{ headerShown: true, title: '', headerBackTitle: t('common.back') }} />
      <Stack.Screen name="memberships" options={{ headerShown: true, title: t('memberships.title'), headerBackTitle: t('common.back') }} />
      <Stack.Screen name="clients" options={{ headerShown: true, title: t('clients.title'), headerBackTitle: t('common.back') }} />
      <Stack.Screen name="become-owner" options={{ headerShown: true, title: t('becomeOwner.title'), headerBackTitle: t('common.back') }} />
      <Stack.Screen name="messages" options={{ headerShown: true, title: t('messages.title'), headerBackTitle: t('common.back') }} />
      <Stack.Screen name="report" options={{ headerShown: true, title: t('report.title'), presentation: 'modal' }} />
      <Stack.Screen name="edit-home" options={{ headerShown: true, title: t('edit.title'), presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider>
          <StatusBar style="auto" />
          <PushSetup />
          <Routes />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
