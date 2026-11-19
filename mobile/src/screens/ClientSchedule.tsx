// Client: free times by day (tap to request), and my bookings with cancel.
import React, { useCallback, useState } from 'react';
import { KeyboardScroll } from '../components/KeyboardScroll';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Message, Muted, Tabs } from '../components/ui';
import { Ionicons } from '@expo/vector-icons';
import { BookingCard } from './BookingCard';
import { WeekView } from './WeekView';
import { useI18n } from '../i18n/I18nProvider';
import { cancelBooking, freeSlots, listBookings, requestBooking, type Booking, type FreeSlot } from '../lib/data';
import { addDays, bookableRange, clock, dayKey, dayLabel, formatMoney, groupByDay, today, weekStart } from '../lib/schedule';
import { useSession } from '../lib/session';
import type { Theme } from '../theme/themes';

export function ClientSchedule({ theme }: { theme: Theme }) {
  const { t, tError, language } = useI18n();
  const { org, profile } = useSession();
  const tz = org?.timezone ?? 'Europe/Bucharest';
  const [tab, setTab] = useState<'book' | 'week' | 'mine'>('book');
  const thisWeek = weekStart(today(tz));
  const [week, setWeek] = useState(thisWeek);     // Monday of the week shown in "Book"
  const MAX_WEEKS_AHEAD = 12;
  const [slots, setSlots] = useState<FreeSlot[] | null>(null);
  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [past, setPast] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const range = bookableRange(week, today(tz));   // this week: from today to Sunday
    try {
      const [s, u, p] = await Promise.all([
        freeSlots(range.from, range.days),
        listBookings({ owner: false, upcomingOnly: true, clientId: profile?.id }),
        listBookings({ owner: false, upcomingOnly: false, clientId: profile?.id }),
      ]);
      setSlots(s); setUpcoming(u); setPast(p);
    } catch (err) {
      setError(tError(err));
    }
  }, [tz, week, profile?.id, tError]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function ask(slot: FreeSlot) {
    const day = dayLabel(dayKey(slot.starts_at, tz), language);
    const time = clock(slot.starts_at, tz, language) + (slot.title ? ` · ${slot.title}` : '');
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
      Alert.alert(t('schedule.notPossible'), tError(err));
      await load();
    } finally {
      setBusy(null);
    }
  }

  function cancel(b: Booking) {
    const day = dayLabel(dayKey(b.starts_at, tz), language);
    Alert.alert(t('schedule.cancel'), t('schedule.cancelConfirm', { day, time: clock(b.starts_at, tz, language) }), [
      { text: t('schedule.keep'), style: 'cancel' },
      {
        text: t('schedule.yesCancel'), style: 'destructive', onPress: async () => {
          setInfo(null);
          try {
            await cancelBooking(b.id);
            setInfo(t('schedule.cancelled'));
          } catch (err) {
            Alert.alert(t('schedule.notPossible'), tError(err));
          }
          await load();
        },
      },
    ]);
  }

  const days = groupByDay(slots ?? [], tz);
  const active = upcoming.filter((b) => b.status === 'pending' || b.status === 'accepted');

  return (
    <KeyboardScroll
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing}
        onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Tabs theme={theme} value={tab} onChange={setTab} tabs={[
        { key: 'book', label: t('schedule.book') },
        { key: 'week', label: t('schedule.week') },
        { key: 'mine', label: t('schedule.myBookings'), badge: active.length },
      ]} />
      <Message text={error} />
      <Message kind="info" text={info} />

      {tab === 'week' ? <WeekView theme={theme} tz={tz} /> : null}

      {tab === 'book' ? (
        <>
          {org?.status === 'paused' ? <Message text={t('error.organization_unavailable')} /> : null}
          <View style={styles.nav}>
            <Pressable onPress={() => setWeek(addDays(week, -7))} disabled={week <= thisWeek} hitSlop={10}
              accessibilityRole="button" accessibilityLabel={t('schedule.prevWeek')}>
              <Ionicons name="chevron-back" size={26} color={week <= thisWeek ? theme.border : theme.primary} />
            </Pressable>
            <Text style={[styles.range, { color: theme.text }]}>
              {dayLabel(week, language)} – {dayLabel(addDays(week, 6), language)}
            </Text>
            <Pressable onPress={() => setWeek(addDays(week, 7))} disabled={week >= addDays(thisWeek, 7 * MAX_WEEKS_AHEAD)}
              hitSlop={10} accessibilityRole="button" accessibilityLabel={t('schedule.nextWeek')}>
              <Ionicons name="chevron-forward" size={26} color={theme.primary} />
            </Pressable>
          </View>
          {slots && !slots.some((x) => x.remaining > 0) ? <Muted theme={theme}>{t('schedule.nothingThisWeek')}</Muted> : null}
          {days.map((d) => {
            const classes = d.items.filter((x) => x.kind === 'class');
            const open = d.items.filter((x) => x.kind !== 'class' && x.remaining > 0);
            if (!classes.length && !open.length) return null;
            return (
              <View key={d.day} style={[styles.day, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.dayTitle, { color: theme.text }]}>{dayLabel(d.day, language)}</Text>
                {classes.map((c) => {
                  const full = c.remaining <= 0;
                  return (
                    <Pressable key={c.starts_at} onPress={() => ask(c)} disabled={full || busy !== null}
                      accessibilityRole="button" accessibilityState={{ disabled: full }}
                      style={({ pressed }) => [styles.classRow, { borderColor: full ? theme.border : theme.primary, opacity: pressed || busy === c.starts_at ? 0.6 : 1 }]}>
                      <Text style={[styles.classTime, { color: full ? theme.muted : theme.primary }]}>
                        {clock(c.starts_at, tz, language)}–{clock(c.ends_at, tz, language)}
                      </Text>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[styles.className, { color: theme.text }]}>{c.title}</Text>
                        <Text style={{ color: theme.muted, fontSize: 14 }}>
                          {[c.instructor ? t('schedule.with', { name: c.instructor }) : '',
                            t('schedule.taken', { booked: c.capacity - c.remaining, capacity: c.capacity }),
                            c.price_cents > 0 ? formatMoney(c.price_cents, c.currency, language) : '']
                            .filter(Boolean).join('  ·  ')}
                        </Text>
                      </View>
                      {full ? <Text style={styles.full}>{t('schedule.full')}</Text> : null}
                    </Pressable>
                  );
                })}
                {open.length ? (
                  <View style={styles.slots}>
                    {open.map((s) => (
                      <Pressable key={s.starts_at} onPress={() => ask(s)} disabled={busy !== null}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.slot, { borderColor: theme.primary, opacity: pressed || busy === s.starts_at ? 0.6 : 1 }]}>
                        <Text style={[styles.slotTime, { color: theme.primary }]}>{clock(s.starts_at, tz, language)}</Text>
                        {s.price_cents > 0
                          ? <Text style={[styles.slotSub, { color: theme.muted }]}>{formatMoney(s.price_cents, s.currency, language)}</Text>
                          : null}
                        {s.capacity > 1
                          ? <Text style={[styles.slotSub, { color: theme.muted }]}>{t('schedule.places', { n: s.remaining })}</Text>
                          : null}
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
          <Muted theme={theme}>{t('schedule.timezone', { tz })}</Muted>
        </>
      ) : null}

      {tab === 'mine' ? (
        <>
          {!upcoming.length ? <Muted theme={theme}>{t('schedule.noBookings')}</Muted> : null}
          {upcoming.map((b) => (
            <BookingCard key={b.id} booking={b} tz={tz} theme={theme}
              onCancel={b.status === 'pending' || b.status === 'accepted' ? () => cancel(b) : undefined} />
          ))}
          {past.length ? <Text style={[styles.dayTitle, { color: theme.text, marginTop: 8 }]}>{t('schedule.past')}</Text> : null}
          {past.map((b) => <BookingCard key={b.id} booking={b} tz={tz} theme={theme} />)}
        </>
      ) : null}
    </KeyboardScroll>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  range: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700', textTransform: 'capitalize' },
  day: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  dayTitle: { fontSize: 17, fontWeight: '700', textTransform: 'capitalize' },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slot: { borderWidth: 1.5, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', minWidth: 84 },
  slotTime: { fontSize: 17, fontWeight: '700' },
  slotSub: { fontSize: 12 },
  classRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 12, padding: 12 },
  classTime: { fontSize: 15, fontWeight: '700', width: 98 },
  className: { fontSize: 16, fontWeight: '700' },
  full: { fontSize: 12, fontWeight: '700', color: '#8C1D18', backgroundColor: '#FDECEA', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
});
