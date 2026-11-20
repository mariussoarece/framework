// The organization's background picture behind inner screens (Scheduling, Workout
// Maintenance, sections, workouts), with a light veil in the theme color so text stays
// readable. The picture is downloaded once and cached on the phone, so this costs
// almost nothing per screen.
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { MediaImage } from './MediaImage';
import { useSession } from '../lib/session';
import { withAlpha, type Theme } from '../theme/themes';

const VEIL = 0.55;   // 0 = picture fully visible, 1 = plain theme color

export function ScreenBackground({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  const { home } = useSession();
  const [key, setKey] = useState(0);
  useFocusEffect(useCallback(() => { setKey((k) => k + 1); }, []));
  const id = home?.background_media_id;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {id ? (
        <>
          <MediaImage mediaId={id} refreshKey={key} style={StyleSheet.absoluteFill} />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(theme.background, VEIL) }]} />
        </>
      ) : null}
      {children}
    </View>
  );
}
