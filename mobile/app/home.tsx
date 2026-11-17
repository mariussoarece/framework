// The organization's branded main page: name, background, foreground image,
// description and the two buttons (Scheduling, Workouts) the owner configured.
import React from 'react';
import { router, Redirect } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MediaImage } from '../src/components/MediaImage';
import { RichText } from '../src/components/RichText';
import { Loading, Message } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';
import { useSession } from '../src/lib/session';
import type { HomeButton } from '../src/lib/types';
import { iconFor, themeFor } from '../src/theme/themes';

export default function Home() {
  const { t } = useI18n();
  const { ready, org, home, buttons, profile, refresh } = useSession();
  const isOwner = profile?.role === 'owner';
  const [refreshing, setRefreshing] = React.useState(false);
  const theme = themeFor(home?.theme_key);

  if (!ready) return <Loading />;
  if (!org) return <Redirect href="/" />;

  const paused = org.status === 'paused';

  function open(b: HomeButton) {
    router.push(b.type === 'scheduling' ? '/schedule' : '/workouts');
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {home?.background_media_id
        ? <MediaImage mediaId={home.background_media_id} style={StyleSheet.absoluteFill} />
        : null}
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.text}
            onRefresh={async () => { setRefreshing(true); await refresh().catch(() => {}); setRefreshing(false); }} />}
        >
          <View style={styles.header}>
            <Text style={[styles.orgName, { color: theme.text }]} accessibilityRole="header" numberOfLines={2}>
              {org.name}
            </Text>
            {isOwner ? (
              <Pressable onPress={() => router.push('/edit-home')} accessibilityRole="button"
                accessibilityLabel={t('home.edit')} hitSlop={12}
                style={[styles.gear, { backgroundColor: theme.surface }]}>
                <Ionicons name="create-outline" size={22} color={theme.text} />
              </Pressable>
            ) : null}
            <Pressable onPress={() => router.push('/settings')} accessibilityRole="button"
              accessibilityLabel={t('home.settings')} hitSlop={12}
              style={[styles.gear, { backgroundColor: theme.surface }]}>
              <Ionicons name="settings-outline" size={22} color={theme.text} />
            </Pressable>
          </View>

          {paused ? <Message text={t('home.paused')} /> : null}

          {home?.foreground_media_id ? (
            <MediaImage mediaId={home.foreground_media_id} contentFit="contain" style={styles.foreground}
              label={org.name} />
          ) : null}

          {home?.description ? (
            <View style={[styles.card, { backgroundColor: theme.surface }]}>
              <RichText doc={home.description} theme={theme} />
            </View>
          ) : null}

          <View style={styles.buttons}>
            {buttons.map((b) => (
              <Pressable key={b.id} onPress={() => open(b)} accessibilityRole="button" accessibilityLabel={b.label}
                style={({ pressed }) => [styles.bigButton, { backgroundColor: b.color, opacity: pressed ? 0.85 : 1 }]}>
                <Ionicons name={iconFor(b.icon) as never} size={30} color="#FFFFFF" />
                <Text style={styles.bigButtonText} numberOfLines={2}>{b.label}</Text>
                <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 18, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orgName: { flex: 1, fontSize: 30, fontWeight: '800' },
  gear: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  foreground: { width: '100%', height: 220, borderRadius: 16 },
  card: { borderRadius: 16, padding: 18 },
  buttons: { gap: 14, marginTop: 4 },
  bigButton: {
    minHeight: 76, borderRadius: 18, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 16,
  },
  bigButtonText: { flex: 1, color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
});
