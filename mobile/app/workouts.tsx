// Main -> Sections. Clients pick a section; the owner also adds, edits and reorders sections.
import React, { useCallback, useState } from 'react';
import { KeyboardScroll } from '../src/components/KeyboardScroll';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MediaImage } from '../src/components/MediaImage';
import { Message, Muted } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';
import { listSections, saveSectionOrder, type Section } from '../src/lib/data';
import { DragList } from '../src/components/DragList';
import { useSession } from '../src/lib/session';
import { themeFor } from '../src/theme/themes';

export default function Workouts() {
  const { t, tError } = useI18n();
  const { home, buttons, profile } = useSession();
  const navigation = useNavigation();
  const theme = themeFor(home?.theme_key);
  const isOwner = profile?.role === 'owner';
  const [sections, setSections] = useState<Section[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [dragging, setDragging] = useState(false);

  const title = buttons.find((b) => b.type === 'workouts')?.label ?? '';

  const load = useCallback(async () => {
    try {
      setSections(await listSections());
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
    <KeyboardScroll
      scrollEnabled={!dragging}
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing}
        onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Message text={error} />

      {isOwner ? (
        <Pressable onPress={() => router.push('/section-edit')} accessibilityRole="button"
          style={({ pressed }) => [styles.add, { borderColor: theme.primary, opacity: pressed ? 0.7 : 1 }]}>
          <Ionicons name="add-circle" size={30} color={theme.primary} />
          <Text style={[styles.addText, { color: theme.primary }]}>{t('sections.add')}</Text>
        </Pressable>
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
                  : <View style={[styles.dragCover, { backgroundColor: theme.primary, opacity: 0.25 }]} />}
                <Text style={[styles.dragName, { color: theme.text }]} numberOfLines={1}>{x.name}</Text>
              </View>
            )}
          />
        </>
      ) : null}

      {!reordering ? (sections ?? []).map((s) => (
        <View key={s.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Pressable style={styles.cardMain} accessibilityRole="button" accessibilityLabel={s.name}
            onPress={() => router.push({ pathname: '/section/[id]', params: { id: s.id } })}>
            {s.cover_media_id
              ? <MediaImage mediaId={s.cover_media_id} style={styles.cover} />
              : <View style={[styles.cover, { backgroundColor: theme.primary, opacity: 0.25 }]} />}
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>{s.name}</Text>
            <Ionicons name="chevron-forward" size={22} color={theme.muted} />
          </Pressable>
          {isOwner ? (
            <View style={styles.tools}>
              <Pressable onPress={() => router.push({ pathname: '/section-edit', params: { id: s.id } })} hitSlop={8}
                accessibilityRole="button" accessibilityLabel={t('sections.edit')}>
                <Ionicons name="create-outline" size={22} color={theme.text} />
              </Pressable>
            </View>
          ) : null}
        </View>
      )) : null}
    </KeyboardScroll>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 2, borderStyle: 'dashed', borderRadius: 16, minHeight: 64,
  },
  addText: { fontSize: 18, fontWeight: '700' },
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12 },
  cover: { width: 64, height: 64, borderRadius: 12 },
  name: { flex: 1, fontSize: 19, fontWeight: '700' },
  reorderBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignSelf: 'flex-end', paddingHorizontal: 16,
  },
  dragRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dragCover: { width: 44, height: 44, borderRadius: 10 },
  dragName: { flex: 1, fontSize: 17, fontWeight: '700' },
  tools: { flexDirection: 'row', justifyContent: 'flex-end', gap: 22, paddingHorizontal: 16, paddingBottom: 12 },
});
