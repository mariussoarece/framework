// Scheduling button: owners manage the timetable and requests, clients book.
import React, { useLayoutEffect } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { ClientSchedule } from '../src/screens/ClientSchedule';
import { OwnerSchedule } from '../src/screens/OwnerSchedule';
import { useSession } from '../src/lib/session';
import { themeFor } from '../src/theme/themes';

export default function Schedule() {
  const { home, buttons, profile } = useSession();
  const navigation = useNavigation();
  const { tab } = useLocalSearchParams<{ tab?: string }>();   // e.g. from a tapped notification
  const theme = themeFor(home?.theme_key);
  const title = buttons.find((b) => b.type === 'scheduling')?.label ?? '';

  useLayoutEffect(() => { navigation.setOptions({ title }); }, [navigation, title]);

  return profile?.role === 'owner'
    ? <OwnerSchedule theme={theme} initialTab={tab} />
    : <ClientSchedule theme={theme} initialTab={tab} />;
}
