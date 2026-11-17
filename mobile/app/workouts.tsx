// Main -> Sections. Clients pick a section; the owner also adds, edits and reorders sections.
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MediaImage } from '../src/components/MediaImage';
import { Message, Muted } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';
import { listSections, moveSection, type Section } from '../src/lib/data';
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

  async function move(i: number, dir: -1 | 1) {
    if (!sections) return;
    try {
      await moveSection(sections, i, dir);
      await load();
    } catch (err) {
      setError(tError(err));
    }
  }

  return (
    <ScrollView
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

      {(sections ?? []).map((s, i) => (
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
              <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={8}
                accessibilityRole="button" accessibilityLabel={t('sections.moveUp')}>
                <Ionicons name="arrow-up" size={22} color={i === 0 ? theme.border : theme.text} />
              </Pressable>
              <Pressable onPress={() => move(i, 1)} disabled={i === sections!.length - 1} hitSlop={8}
                accessibilityRole="button" accessibilityLabel={t('sections.moveDown')}>
                <Ionicons name="arrow-down" size={22} color={i === sections!.length - 1 ? theme.border : theme.text} />
              </Pressable>
              <Pressable onPress={() => router.push({ pathname: '/section-edit', params: { id: s.id } })} hitSlop={8}
                accessibilityRole="button" accessibilityLabel={t('sections.edit')}>
                <Ionicons name="create-outline" size={22} color={theme.text} />
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}
    </ScrollView>
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
  tools: { flexDirection: 'row', justifyContent: 'flex-end', gap: 22, paddingHorizontal: 16, paddingBottom: 12 },
});
