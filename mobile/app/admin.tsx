// Super admin: approve uploads, handle content reports, manage organizations.
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardScroll } from '../src/components/KeyboardScroll';
import { Button, Message, Muted, Tabs, Title } from '../src/components/ui';
import { VideoPlayer } from '../src/components/media';
import { useI18n } from '../src/i18n/I18nProvider';
import { api } from '../src/lib/api';
import { API_URL } from '../src/lib/config';
import {
  adminOrganizationHistory, adminOrganizations, adminReports, adminSetOrgStatus, deleteWorkout, listPendingMedia, resolveReport, reviewMedia,
  setDefaultOrganization, type AdminOrg, type OrgHistory, type AdminReport, type PendingMedia,
} from '../src/lib/data';
import { refreshBadge } from '../src/lib/push';
import { useSession } from '../src/lib/session';
import { DEFAULT_THEME as theme } from '../src/theme/themes';

type Tab = 'uploads' | 'reports' | 'orgs';

export default function Admin() {
  const { t, tError, language } = useI18n();
  const { session, signOut } = useSession();
  const [tab, setTab] = useState<Tab>('uploads');
  const [items, setItems] = useState<PendingMedia[] | null>(null);
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [orgs, setOrgs] = useState<AdminOrg[] | null>(null);
  const [history, setHistory] = useState<OrgHistory[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, r, o, h] = await Promise.all([
        listPendingMedia(), adminReports(), adminOrganizations(), adminOrganizationHistory().catch(() => []),
      ]);
      setItems(m); setReports(r); setOrgs(o); setHistory(h);
    } catch (err) {
      setError(tError(err));
    }
  }, [tError]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const headers = { Authorization: `Bearer ${session?.access_token ?? ''}` };
  const when = (iso: string) => new Date(iso).toLocaleString(language === 'ro' ? 'ro-RO' : 'en-GB');

  // Runs an action for one item; errors show as a popup that stays.
  async function act(id: string, fn: () => Promise<void>) {
    setBusyId(id); setInfo(null);
    try { await fn(); } catch (err) { Alert.alert(t('schedule.notPossible'), tError(err)); }
    setBusyId(null);
    await load();
    refreshBadge();
  }

  const confirm = (title: string, text: string, ok: string, fn: () => void) =>
    Alert.alert(title, text, [{ text: t('common.cancel'), style: 'cancel' }, { text: ok, style: 'destructive', onPress: fn }]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardScroll contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <View style={styles.top}>
          <View style={{ flex: 1 }}><Title>{t('admin.title')}</Title></View>
          <Pressable onPress={() => router.push('/settings')} hitSlop={10} accessibilityRole="button"
            accessibilityLabel={t('settings.title')} style={styles.iconBtn}>
            <Ionicons name="settings-outline" size={22} color={theme.text} />
          </Pressable>
          <Pressable onPress={async () => { await signOut(); router.replace('/'); }} hitSlop={10}
            accessibilityRole="button" accessibilityLabel={t('settings.signOut')} style={styles.iconBtn}>
            <Ionicons name="log-out-outline" size={22} color={theme.text} />
          </Pressable>
        </View>

        <Tabs value={tab} onChange={(k) => { setTab(k); setInfo(null); }} tabs={[
          { key: 'uploads', label: t('admin.tabUploads'), badge: items?.length },
          { key: 'reports', label: t('admin.tabReports'), badge: reports?.length },
          { key: 'orgs', label: t('admin.tabOrgs') },
        ]} />
        <Message text={error} />
        <Message kind="info" text={info} />

        {/* ------------------------------------------------ uploads */}
        {tab === 'uploads' ? (
          <>
            <Muted>{items ? (items.length ? t('admin.pending', { count: items.length }) : t('admin.empty')) : t('common.loading')}</Muted>
            {(items ?? []).map((m) => {
              const original = `${API_URL}/api/admin/media/${m.id}/original`;
              return (
                <View key={m.id} style={styles.card}>
                  <Text style={styles.org}>{m.organizations?.name ?? '—'}</Text>
                  <Muted>{when(m.created_at)}</Muted>
                  {m.kind === 'video'
                    ? <VideoPlayer uri={original} headers={headers} style={styles.preview} />
                    : <Image source={{ uri: original, headers }} style={styles.preview} contentFit="contain" />}
                  <TextInput placeholder={t('admin.reason')} placeholderTextColor={theme.muted}
                    value={reasons[m.id] ?? ''} onChangeText={(v) => setReasons({ ...reasons, [m.id]: v })}
                    style={styles.input} />
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Button kind="danger" label={t('admin.reject')} busy={busyId === m.id}
                        onPress={() => act(m.id, () => reviewMedia(m.id, false, reasons[m.id]))} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button label={t('admin.approve')} busy={busyId === m.id}
                        onPress={() => act(m.id, () => reviewMedia(m.id, true))} />
                    </View>
                  </View>
                </View>
              );
            })}
          </>
        ) : null}

        {/* ------------------------------------------------ reports */}
        {tab === 'reports' ? (
          <>
            {reports && !reports.length ? <Muted>{t('admin.noReports')}</Muted> : null}
            {(reports ?? []).map((r) => (
              <View key={r.id} style={styles.card}>
                <Text style={styles.org}>{r.organization_name}</Text>
                {r.workout_name ? <Text style={styles.big}>{r.workout_name}</Text> : null}
                <Text style={{ fontSize: 16, color: theme.text }}>{r.reason}</Text>
                <Muted>{[r.reporter_email ? t('admin.reportedBy', { email: r.reporter_email }) : '', when(r.created_at)]
                  .filter(Boolean).join('  ·  ')}</Muted>
                {r.workout_id ? (
                  <Button kind="secondary" label={t('admin.openWorkout')}
                    onPress={() => router.push({ pathname: '/workout/[id]', params: { id: r.workout_id! } })} />
                ) : null}
                <View style={styles.row}>
                  {r.workout_id ? (
                    <View style={{ flex: 1 }}>
                      <Button kind="danger" label={t('admin.deleteWorkout')} busy={busyId === r.id}
                        onPress={() => confirm(t('admin.deleteWorkout'),
                          t('admin.deleteWorkoutConfirm', { name: r.workout_name ?? '', org: r.organization_name }),
                          t('common.delete'),
                          () => act(r.id, async () => { await deleteWorkout(r.workout_id!); await resolveReport(r.id); }))} />
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Button label={t('admin.resolve')} busy={busyId === r.id} onPress={() => act(r.id, () => resolveReport(r.id))} />
                  </View>
                </View>
              </View>
            ))}
          </>
        ) : null}

        {/* ------------------------------------------------ organizations */}
        {tab === 'orgs' ? (
          <>
            {orgs ? <Muted>{t('admin.orgsCount', { n: orgs.length })}</Muted> : null}
            {(orgs ?? []).map((o) => (
              <View key={o.id} style={styles.card}>
                <View style={styles.row}>
                  <Text style={[styles.big, { flex: 1 }]}>{o.name}</Text>
                  {o.is_default ? <Text style={[styles.badge, styles.badgeDefault]}>{t('admin.default')}</Text> : null}
                  <Text style={[styles.badge, o.status === 'paused' ? styles.badgeBad : styles.badgeOk]}>
                    {t(`admin.status.${o.status}` as never)}
                  </Text>
                </View>
                <Muted>{[t('admin.code', { code: o.join_code }), t('admin.plan', { plan: o.plan })].join('  ·  ')}</Muted>
                <Muted>{o.owner_email ? t('admin.owner', { email: o.owner_email }) : t('admin.noOwner')}</Muted>
                <Muted>{[t('admin.clients', { n: o.clients }), o.open_reports ? t('admin.reports', { n: o.open_reports }) : '']
                  .filter(Boolean).join('  ·  ')}</Muted>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    {o.status === 'paused'
                      ? <Button kind="secondary" label={t('admin.activate')} busy={busyId === o.id}
                          onPress={() => act(o.id, () => adminSetOrgStatus(o.id, 'active'))} />
                      : <Button kind="secondary" label={t('admin.pause')} busy={busyId === o.id}
                          onPress={() => act(o.id, () => adminSetOrgStatus(o.id, 'paused'))} />}
                  </View>
                  {!o.is_default ? (
                    <View style={{ flex: 1 }}>
                      <Button kind="secondary" label={t('admin.makeDefault')} busy={busyId === o.id}
                        onPress={() => confirm(t('admin.makeDefault'), t('admin.makeDefaultConfirm', { name: o.name }),
                          t('admin.makeDefault'), () => act(o.id, () => setDefaultOrganization(o.id)))} />
                    </View>
                  ) : null}
                </View>
                {!o.is_default ? (
                  <Button kind="danger" label={t('admin.close')} busy={busyId === o.id}
                    onPress={() => confirm(t('admin.close'), t('admin.closeConfirm', { name: o.name, n: o.clients }),
                      t('admin.close'), () => act(o.id, async () => {
                        const r = await api.closeOrganization(o.id);
                        setInfo(t('admin.closed', { name: o.name, n: r.clients }));
                      }))} />
                ) : null}
              </View>
            ))}

            {/* history: every organization with its dates; only open ones are active */}
            {history.length ? <Text style={[styles.big, { marginTop: 12 }]}>{t('admin.history')}</Text> : null}
            {history.map((h) => (
              <View key={h.id} style={[styles.card, { gap: 4 }]}>
                <View style={styles.row}>
                  <Text style={[styles.org, { flex: 1, color: theme.text }]}>{h.name}</Text>
                  <Text style={[styles.badge, h.active ? styles.badgeOk : styles.badgeBad]}>
                    {h.active ? t('admin.active') : t('admin.status.closed')}
                  </Text>
                </View>
                <Muted>{[t('admin.code', { code: h.join_code }), h.owner_email ?? ''].filter(Boolean).join('  ·  ')}</Muted>
                <Muted>{t('admin.period', {
                  from: when(h.created_at),
                  to: h.closed_at ? when(h.closed_at) : t('admin.now'),
                })}</Muted>
              </View>
            ))}
          </>
        ) : null}
      </KeyboardScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: theme.border },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: theme.border },
  org: { fontSize: 15, fontWeight: '700', color: theme.muted },
  big: { fontSize: 18, fontWeight: '700', color: theme.text },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: '#000000' },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  badge: { fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  badgeOk: { backgroundColor: '#E8F2EC', color: '#1E4D36' },
  badgeBad: { backgroundColor: '#FDECEA', color: '#8C1D18' },
  badgeDefault: { backgroundColor: '#E7F1F7', color: '#16324A' },
});
