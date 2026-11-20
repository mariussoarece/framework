// Main -> Sections. Clients pick a section; the owner also adds, edits and reorders sections.
import { ScreenBackground } from '../src/components/ScreenBackground';
import React, { useCallback, useState } from 'react';
import { KeyboardScroll } from '../src/components/KeyboardScroll';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MediaImage } from '../src/components/MediaImage';
import { Message, Muted } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';
import { listSections, saveSectionOrder, sectionWorkoutCounts, type Section } from '../src/lib/data';
import { workoutCount } from '../src/lib/format';
import { DragList } from '../src/components/DragList';
import { AddButton } from '../src/components/AddButton';
import { useSession } from '../src/lib/session';
import { themeFor } from '../src/theme/themes';

export default function Workouts() {
  const { t, tError, language } = useI18n();
  const { home, buttons, profile } = useSession();
  const navigation = useNavigation();
  const theme = themeFor(home?.theme_key);
  const isOwner = profile?.role === 'owner';
  const [sections, setSections] = useState<Section[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mediaKey, setMediaKey] = useState(0);   // bump to fetch pictures again (e.g. after approval)
  const [reordering, setReordering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const title = buttons.find((b) => b.type === 'workouts')?.label ?? '';

  const load = useCallback(async () => {
    setMediaKey((k) => k + 1);
    try {
      const [list, c] = await Promise.all([listSections(), sectionWorkoutCounts()]);
      setSections(list);
      setCounts(c);
      setError(null);
    } catch (err) {
      setError(tError(err));
    }
  }, [tError]);

  useFocusEffect(useCallback(() => {
    navigation.setOptions({ title });
    load();
  }, [load, navigation, title]));

  async function reorder(next: Section[]) {
    setSections(next);                       // show the new order right away
    try {
      await saveSectionOrder(next);
    } catch (err) {
      Alert.alert(t('schedule.notPossible'), tError(err));
    }
    await load();
  }

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
          <AddButton theme={theme} label={t('sections.add')} onPress={() => router.push('/section-edit')} />
        ) : null}

        {sections && !sections.length ? <Muted theme={theme}>{t('sections.empty')}</Muted> : null}

        {isOwner && sections && sections.length > 1 ? (
          <Pressable onPress={() => setReordering(!reordering)} accessibilityRole="button"
            style={[styles.reorderBtn, { borderColor: theme.border, backgroundColor: reordering ? theme.primary : theme.surface }]}>
            <Ionicons name={reordering ? 'checkmark' : 'swap-vertical'} size={20} color={reordering ? theme.onPrimary : theme.text} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: reordering ? theme.onPrimary : theme.text }}>
              {reordering ? t('common.done') : t('sections.reorder')}
            </Text>
          </Pressable>
        ) : null}

        {reordering && sections ? (
          <>
            <Muted theme={theme}>{t('sections.reorderHint')}</Muted>
            <DragList
              items={sections}
              keyOf={(x) => x.id}
              theme={theme}
              moveUpLabel={t('sections.moveUp')}
              moveDownLabel={t('sections.moveDown')}
              onDragging={setDragging}
              onReorder={reorder}
              renderRow={(x) => (
                <View style={styles.dragRow}>
                  {x.cover_media_id
                    ? <MediaImage mediaId={x.cover_media_id} style={styles.dragCover} />
                    : <View style={[styles.dragCover, styles.noThumb, { borderColor: theme.border }]}>
                        <Ionicons name="albums-outline" size={20} color={theme.muted} />
                      </View>}
                  <Text style={[styles.dragName, { color: theme.text }]} numberOfLines={1}>{x.name}</Text>
                </View>
              )}
            />
          </>
        ) : null}

        {!reordering ? (sections ?? []).map((s) => (
          <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={s.name}
            onPress={() => router.push({ pathname: '/section/[id]', params: { id: s.id } })}
            style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}>
            {s.cover_media_id
              ? <MediaImage mediaId={s.cover_media_id} refreshKey={mediaKey} style={styles.thumb} />
              : <View style={[styles.thumb, styles.noThumb, { borderColor: theme.border }]}>
                  <Ionicons name="albums-outline" size={28} color={theme.muted} />
                </View>}
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>{s.name}</Text>
              <Text style={{ color: theme.muted, fontSize: 15 }}>{workoutCount(language, counts[s.id] ?? 0)}</Text>
            </View>
            {isOwner ? (
              <Pressable onPress={() => router.push({ pathname: '/section-edit', params: { id: s.id } })} hitSlop={10}
                accessibilityRole="button" accessibilityLabel={t('sections.edit')}>
                <Ionicons name="create-outline" size={22} color={theme.text} />
              </Pressable>
            ) : null}
            <Ionicons name="chevron-forward" size={22} color={theme.muted} />
          </Pressable>
        )) : null}
      </KeyboardScroll>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  // same card as a workout in a section
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 16, borderWidth: 1 },
  thumb: { width: 72, height: 72, borderRadius: 12 },
  noThumb: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  name: { fontSize: 18, fontWeight: '700' },
  reorderBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignSelf: 'flex-end', paddingHorizontal: 16,
  },
  dragRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dragCover: { width: 44, height: 44, borderRadius: 10 },
  dragName: { flex: 1, fontSize: 17, fontWeight: '700' },
});
