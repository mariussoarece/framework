// A workout: pictures/videos on top, then sets, repetitions or time, rest, description,
// warning and what to avoid. The owner gets an Edit button.
import { ScreenBackground } from '../../src/components/ScreenBackground';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MediaGallery } from '../../src/components/media';
import { RichText } from '../../src/components/RichText';
import { Loading, Message } from '../../src/components/ui';
import { useI18n } from '../../src/i18n/I18nProvider';
import { getWorkout, workoutMedia, type Workout } from '../../src/lib/data';
import { restText, workoutSummary } from '../../src/lib/format';
import { useSession } from '../../src/lib/session';
import type { MediaRow } from '../../src/lib/upload';
import { themeFor } from '../../src/theme/themes';

export default function WorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, tError, language } = useI18n();
  const { home, profile } = useSession();
  const navigation = useNavigation();
  const theme = themeFor(home?.theme_key);
  const isOwner = profile?.role === 'owner';
  const [w, setW] = useState<Workout | null>(null);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const workout = await getWorkout(id);
        setW(workout);
        setMedia(await workoutMedia(id));
        navigation.setOptions({
          title: workout?.name ?? '',
          headerRight: isOwner ? () => (
            <Pressable onPress={() => router.push({ pathname: '/workout-edit', params: { id } })} hitSlop={10}
              accessibilityRole="button" accessibilityLabel={t('common.edit')}>
              <Ionicons name="create-outline" size={24} color={theme.primary} />
            </Pressable>
          ) : undefined,
        });
      } catch (err) {
        setError(tError(err));
      }
    })();
  }, [id, isOwner, navigation, t, tError, theme.primary]));

  if (error) return <View style={{ padding: 20 }}><Message text={error} /></View>;
  if (!w) return <Loading theme={theme} />;

  // clients only receive published media from the server; owners also see what is waiting
  const visible = media.filter((m) => m.status === 'published' || isOwner).map((m) => m.id);
  const summary = workoutSummary(language, w);
  const rest = restText(language, w);

  return (
    <ScreenBackground theme={theme}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: 'transparent' }} contentContainerStyle={styles.content}>
        <MediaGallery ids={visible} quality={profile?.video_quality ?? 'auto'} theme={theme} />

        <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">{w.name}</Text>

        {summary || rest ? (
          <View style={styles.chips}>
            {summary ? <Chip icon="repeat" text={summary} color={theme.primary} /> : null}
            {rest ? <Chip icon="pause-circle-outline" text={rest} color={theme.muted} /> : null}
          </View>
        ) : null}

        {w.warning ? (
          <Notice icon="warning-outline" title={t('workout.warningTitle')} text={w.warning} bg="#FFF4E5" fg="#7A4100" />
        ) : null}
        {w.avoid ? (
          <Notice icon="hand-left-outline" title={t('workout.avoidTitle')} text={w.avoid} bg="#FDECEA" fg="#8C1D18" />
        ) : null}

        {w.description ? (
          <View style={[styles.card, { backgroundColor: theme.surface }]}>
            <RichText doc={w.description} theme={theme} />
          </View>
        ) : null}

        {profile?.role === 'client' ? (
          <Pressable onPress={() => router.push({ pathname: '/report', params: { workout: w.id, name: w.name } })}
            accessibilityRole="button" style={styles.report} hitSlop={8}>
            <Ionicons name="flag-outline" size={16} color={theme.muted} />
            <Text style={{ color: theme.muted, fontSize: 14, textDecorationLine: 'underline' }}>{t('report.link')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ScreenBackground>
  );
}

function Chip({ icon, text, color }: { icon: string; text: string; color: string }) {
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <Ionicons name={icon as never} size={18} color={color} />
      <Text style={{ color, fontSize: 16, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

function Notice({ icon, title, text, bg, fg }: { icon: string; title: string; text: string; bg: string; fg: string }) {
  return (
    <View style={[styles.notice, { backgroundColor: bg }]} accessibilityRole="alert">
      <Ionicons name={icon as never} size={22} color={fg} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: fg, fontWeight: '700', fontSize: 16 }}>{title}</Text>
        <Text style={{ color: fg, fontSize: 16, lineHeight: 22 }}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  notice: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 14 },
  card: { borderRadius: 16, padding: 18 },
  report: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 12, padding: 8 },
});
