import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider, useI18n } from '../src/i18n/I18nProvider';
import { SessionProvider } from '../src/lib/session';

function Routes() {
  const { t } = useI18n();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="settings" options={{ headerShown: true, title: t('settings.title'), headerBackTitle: t('common.back') }} />
      <Stack.Screen name="schedule" options={{ headerShown: true, title: '', headerBackTitle: t('common.back') }} />
      <Stack.Screen name="workouts" options={{ headerShown: true, title: '', headerBackTitle: t('common.back') }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider>
          <StatusBar style="auto" />
          <Routes />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
