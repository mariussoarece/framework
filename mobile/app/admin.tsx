// Super admin: approve or reject uploaded pictures and videos.
import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Button, Message, Muted, Title } from '../src/components/ui';
import { VideoPlayer } from '../src/components/media';
import { useI18n } from '../src/i18n/I18nProvider';
import { API_URL } from '../src/lib/config';
import { listPendingMedia, reviewMedia, type PendingMedia } from '../src/lib/data';
import { useSession } from '../src/lib/session';
import { DEFAULT_THEME as theme } from '../src/theme/themes';

export default function Admin() {
  const { t, tError, language } = useI18n();
  const { session } = useSession();
  const [items, setItems] = useState<PendingMedia[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await listPendingMedia());
      setError(null);
    } catch (err) {
      setError(tError(err));
    }
  }, [tError]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const headers = { Authorization: `Bearer ${session?.access_token ?? ''}` };

  async function decide(id: string, approve: boolean) {
    setBusyId(id);
    try {
      await reviewMedia(id, approve, reasons[id]);
      setItems((items ?? []).filter((m) => m.id !== id));
    } catch (err) {
      setError(tError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <Title>{t('admin.title')}</Title>
        <Message text={error} />
        <Muted>{items ? (items.length ? t('admin.pending', { count: items.length }) : t('admin.empty')) : t('common.loading')}</Muted>

        {(items ?? []).map((m) => {
          const original = `${API_URL}/api/admin/media/${m.id}/original`;
          return (
            <View key={m.id} style={styles.card}>
              <Text style={styles.org}>{m.organizations?.name ?? '—'}</Text>
              <Muted>{new Date(m.created_at).toLocaleString(language === 'ro' ? 'ro-RO' : 'en-GB')}</Muted>
              {m.kind === 'video'
                ? <VideoPlayer uri={original} headers={headers} style={styles.preview} />
                : <Image source={{ uri: original, headers }} style={styles.preview} contentFit="contain" />}
              <TextInput placeholder={t('admin.reason')} placeholderTextColor={theme.muted}
                value={reasons[m.id] ?? ''} onChangeText={(v) => setReasons({ ...reasons, [m.id]: v })}
                style={styles.input} />
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Button kind="danger" label={t('admin.reject')} onPress={() => decide(m.id, false)} busy={busyId === m.id} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label={t('admin.approve')} onPress={() => decide(m.id, true)} busy={busyId === m.id} />
                </View>
              </View>
            </View>
          );
        })}

        <Button kind="secondary" label={t('settings.title')} onPress={() => router.push('/settings')} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: theme.border },
  org: { fontSize: 18, fontWeight: '700', color: theme.text },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: '#000000' },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  row: { flexDirection: 'row', gap: 10 },
});
