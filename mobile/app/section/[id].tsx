// Main -> Section -> list of workouts. The owner sees "+ Add workout".
import { ScreenBackground } from '../../src/components/ScreenBackground';
import React, { useCallback, useState } from 'react';
import { KeyboardScroll } from '../../src/components/KeyboardScroll';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Message, Muted } from '../../src/components/ui';
import { useI18n } from '../../src/i18n/I18nProvider';
import { getSection, listSectionWorkoutRows, saveWorkoutOrder, type WorkoutRow } from '../../src/lib/data';
import { cached, remember } from '../../src/lib/listCache';
import { DragList } from '../../src/components/DragList';
import { AddButton } from '../../src/components/AddButton';
import { restText, workoutSummary } from '../../src/lib/format';
import { useSession } from '../../src/lib/session';
import { MediaImage } from '../../src/components/MediaImage';
import { themeFor } from '../../src/theme/themes';

type Row = WorkoutRow;

export default function SectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, tError, language } = useI18n();
  const { home, profile } = useSession();
  const navigation = useNavigation();
  const theme = themeFor(home?.theme_key);
  const isOwner = profile?.role === 'owner';
  const cacheKey = `section-workouts:${id}`;
  const [rows, setRows] = useState<Row[] | null>(() => cached<Row[]>(cacheKey));   // last list, shown at once
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mediaKey, setMediaKey] = useState(0);   // bump to fetch pictures again (e.g. after approval)
  const [reordering, setReordering] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function reorder(next: Row[]) {
    setRows(next);                       // show the new order right away
    try {
      await saveWorkoutOrder(id, next);
    } catch (err) {
      Alert.alert(t('schedule.notPossible'), tError(err));
    }
    await load();
  }

  const load = useCallback(async () => {
    setMediaKey((k) => k + 1);
    try {
      // name and list at the same time, the list with its pictures in one request
      const [section, list] = await Promise.all([getSection(id), listSectionWorkoutRows(id)]);
      navigation.setOptions({ title: section?.name ?? '' });
      setRows(remember(cacheKey, list));
      setError(null);
    } catch (err) {
      setError(tError(err));
    }
  }, [id, cacheKey, navigation, tError]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScreenBackground theme={theme}>
      <KeyboardScroll
        scrollEnabled={!reordering && !dragging}
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={styles.content}
        refreshControl={reordering ? undefined : <RefreshControl refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Message text={error} />

        {isOwner ? (
          <AddButton theme={theme} label={t('workouts.add')}
            onPress={() => router.push({ pathname: '/workout-edit', params: { section: id } })} />
        ) : null}

        {rows && !rows.length ? <Muted theme={theme}>{t('workouts.empty')}</Muted> : null}

        {isOwner && rows && rows.length > 1 ? (
          <Pressable onPress={() => setReordering(!reordering)} accessibilityRole="button"
            style={[styles.reorderBtn, { borderColor: theme.border, backgroundColor: reordering ? theme.primary : theme.surface }]}>
            <Ionicons name={reordering ? 'checkmark' : 'swap-vertical'} size={20} color={reordering ? theme.onPrimary : theme.text} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: reordering ? theme.onPrimary : theme.text }}>
              {reordering ? t('common.done') : t('sections.reorder')}
            </Text>
          </Pressable>
        ) : null}

        {reordering && rows ? (
          <>
            <Muted theme={theme}>{t('workouts.reorderHint')}</Muted>
            <DragList
              items={rows}
              keyOf={(x) => x.id}
              theme={theme}
              moveUpLabel={t('sections.moveUp')}
              moveDownLabel={t('sections.moveDown')}
              onDragging={setDragging}
              onReorder={reorder}
              renderRow={(x) => (
                <View style={styles.dragRow}>
                  {x.thumbId
                    ? <MediaImage mediaId={x.thumbId} style={styles.dragThumb} />
                    : <View style={[styles.dragThumb, styles.noThumb, { borderColor: theme.border }]}>
                        <Ionicons name="body-outline" size={20} color={theme.muted} />
                      </View>}
                  <Text style={[styles.name, { color: theme.text, flex: 1 }]} numberOfLines={1}>{x.name}</Text>
                </View>
              )}
            />
          </>
        ) : null}

        {!reordering ? (rows ?? []).map((w) => (
          <Pressable key={w.id} accessibilityRole="button" accessibilityLabel={w.name}
            onPress={() => router.push({ pathname: '/workout/[id]', params: { id: w.id } })}
            style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}>
            {w.thumbId
              ? <MediaImage mediaId={w.thumbId} refreshKey={mediaKey} style={styles.thumb} />
              : <View style={[styles.thumb, styles.noThumb, { borderColor: theme.border }]}>
                  <Ionicons name="body-outline" size={28} color={theme.muted} />
                </View>}
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>{w.name}</Text>
              <Text style={{ color: theme.muted, fontSize: 15 }}>
                {[workoutSummary(language, w), restText(language, w)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={theme.muted} />
          </Pressable>
        )) : null}
      </KeyboardScroll>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 16, borderWidth: 1 },
  thumb: { width: 72, height: 72, borderRadius: 12 },
  noThumb: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  name: { fontSize: 18, fontWeight: '700' },
  reorderBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignSelf: 'flex-end', paddingHorizontal: 16,
  },
  dragRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dragThumb: { width: 44, height: 44, borderRadius: 10 },
});
