// Client: free times by day (tap to request), and my bookings with cancel.
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Message, Muted, Tabs } from '../components/ui';
import { BookingCard } from './BookingCard';
import { useI18n } from '../i18n/I18nProvider';
import { cancelBooking, freeSlots, listBookings, requestBooking, type Booking, type FreeSlot } from '../lib/data';
import { clock, dayKey, dayLabel, formatMoney, groupByDay, today } from '../lib/schedule';
import { useSession } from '../lib/session';
import type { Theme } from '../theme/themes';

export function ClientSchedule({ theme }: { theme: Theme }) {
  const { t, tError, language } = useI18n();
  const { org, profile } = useSession();
  const tz = org?.timezone ?? 'Europe/Bucharest';
  const [tab, setTab] = useState<'book' | 'mine'>('book');
  const [slots, setSlots] = useState<FreeSlot[] | null>(null);
  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [past, setPast] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, u, p] = await Promise.all([
        freeSlots(today(tz), 14),
        listBookings({ owner: false, upcomingOnly: true, clientId: profile?.id }),
        listBookings({ owner: false, upcomingOnly: false, clientId: profile?.id }),
      ]);
      setSlots(s); setUpcoming(u); setPast(p);
      setError(null);
    } catch (err) {
      setError(tError(err));
    }
  }, [tz, profile?.id, tError]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function ask(slot: FreeSlot) {
    const day = dayLabel(dayKey(slot.starts_at, tz), language);
    const time = clock(slot.starts_at, tz, language);
    Alert.alert(t('schedule.confirmTitle'), t('schedule.confirmText', { day, time, org: org?.name ?? '' }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('schedule.request'), onPress: () => book(slot) },
    ]);
  }

  async function book(slot: FreeSlot) {
    setBusy(slot.starts_at); setError(null); setInfo(null);
    try {
      const b = await requestBooking(slot.starts_at);
      setInfo(b.payment_status === 'requires_payment' ? t('schedule.paymentLater') : t('schedule.requested'));
      await load();
      setTab('mine');
    } catch (err) {
      setError(tError(err));
      await load();
    } finally {
      setBusy(null);
    }
  }

  function cancel(b: Booking) {
    const day = dayLabel(dayKey(b.starts_at, tz), language);
    Alert.alert(t('schedule.cancel'), t('schedule.cancelConfirm', { day, time: clock(b.starts_at, tz, language) }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('schedule.cancel'), style: 'destructive', onPress: async () => {
          try { await cancelBooking(b.id); await load(); } catch (err) { setError(tError(err)); }
        },
      },
    ]);
  }

  const days = groupByDay(slots ?? [], tz);
  const active = upcoming.filter((b) => b.status === 'pending' || b.status === 'accepted');

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing}
        onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Tabs theme={theme} value={tab} onChange={setTab} tabs={[
        { key: 'book', label: t('schedule.book') },
        { key: 'mine', label: t('schedule.myBookings'), badge: active.length },
      ]} />
      <Message text={error} />
      <Message kind="info" text={info} />

      {tab === 'book' ? (
        <>
          {org?.status === 'paused' ? <Message text={t('error.organization_unavailable')} /> : null}
          {slots && !slots.length ? <Muted theme={theme}>{t('schedule.noSlots')}</Muted> : null}
          {days.map((d) => (
            <View key={d.day} style={[styles.day, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.dayTitle, { color: theme.text }]}>{dayLabel(d.day, language)}</Text>
              <View style={styles.slots}>
                {d.items.map((s) => (
                  <Pressable key={s.starts_at} onPress={() => ask(s)} disabled={busy !== null}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.slot, { borderColor: theme.primary, opacity: pressed || busy === s.starts_at ? 0.6 : 1 }]}>
                    <Text style={[styles.slotTime, { color: theme.primary }]}>{clock(s.starts_at, tz, language)}</Text>
                    {s.price_cents > 0
                      ? <Text style={[styles.slotSub, { color: theme.muted }]}>{formatMoney(s.price_cents, s.currency, language)}</Text>
                      : null}
                    {s.remaining > 1
                      ? <Text style={[styles.slotSub, { color: theme.muted }]}>{t('schedule.places', { n: s.remaining })}</Text>
                      : null}
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          <Muted theme={theme}>{t('schedule.timezone', { tz })}</Muted>
        </>
      ) : (
        <>
          {!upcoming.length ? <Muted theme={theme}>{t('schedule.noBookings')}</Muted> : null}
          {upcoming.map((b) => (
            <BookingCard key={b.id} booking={b} tz={tz} theme={theme}
              onCancel={b.status === 'pending' || b.status === 'accepted' ? () => cancel(b) : undefined} />
          ))}
          {past.length ? <Text style={[styles.dayTitle, { color: theme.text, marginTop: 8 }]}>{t('schedule.past')}</Text> : null}
          {past.map((b) => <BookingCard key={b.id} booking={b} tz={tz} theme={theme} />)}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  day: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  dayTitle: { fontSize: 17, fontWeight: '700', textTransform: 'capitalize' },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slot: { borderWidth: 1.5, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', minWidth: 84 },
  slotTime: { fontSize: 17, fontWeight: '700' },
  slotSub: { fontSize: 12 },
});
