import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider, useI18n } from '../src/i18n/I18nProvider';
import { SessionProvider, useSession } from '../src/lib/session';
import { registerForPush, startPushListeners } from '../src/lib/push';

// Registers this phone for notifications once someone is signed in, and follows taps.
function PushSetup() {
  const { profile } = useSession();
  React.useEffect(() => startPushListeners(), []);
  React.useEffect(() => {
    if (profile?.id) registerForPush().catch(() => {});
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
