// Owner: booking requests (accept/decline), upcoming sessions, weekly timetable, days off.
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Message, Muted, Tabs } from '../components/ui';
import { BookingCard } from './BookingCard';
import { useI18n } from '../i18n/I18nProvider';
import {
  addDayOff, cancelBooking, decideBooking, deleteAvailability, deleteDayOff, listAvailability, listBookings,
  listDaysOff, saveAvailability, type Availability, type Booking, type DayOff,
} from '../lib/data';
import {
  clock, dayKey, dayLabel, formatMoney, isIsoDate, minutesOf, parseMoney, parseTime, shortTime, today,
  WEEK_ORDER, weekdayName,
} from '../lib/schedule';
import { positiveInt } from '../lib/format';
import { useSession } from '../lib/session';
import type { Theme } from '../theme/themes';

type Tab = 'requests' | 'upcoming' | 'hours' | 'off';

type HoursForm = { id?: string; weekday: number; from: string; to: string; length: string; capacity: string; price: string };
const EMPTY_FORM: HoursForm = { weekday: 1, from: '09:00', to: '17:00', length: '60', capacity: '1', price: '' };

export function OwnerSchedule({ theme }: { theme: Theme }) {
  const { t, tError, language } = useI18n();
  const { org } = useSession();
  const tz = org?.timezone ?? 'Europe/Bucharest';
  const paid = org?.plan !== 'none';
  const [tab, setTab] = useState<Tab>('requests');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [hours, setHours] = useState<Availability[]>([]);
  const [daysOff, setDaysOff] = useState<DayOff[]>([]);
  const [form, setForm] = useState<HoursForm | null>(null);
  const [newDay, setNewDay] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, h, d] = await Promise.all([
        listBookings({ owner: true, upcomingOnly: true }),
        listAvailability(),
        listDaysOff(today(tz)),
      ]);
      setBookings(b); setHours(h); setDaysOff(d);
      setError(null);
    } catch (err) {
      setError(tError(err));
    }
  }, [tz, tError]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try { await fn(); await load(); } catch (err) { setError(tError(err)); await load(); }
  };

  const requests = bookings.filter((b) => b.status === 'pending');
  const upcoming = bookings.filter((b) => b.status === 'accepted');

  // ---------------------------------------------------------------- opening hours
  async function saveForm() {
    if (!form || !org) return;
    const from = parseTime(form.from);
    const to = parseTime(form.to);
    if (!from || !to || minutesOf(to) <= minutesOf(from)) return setError(t('schedule.hoursInvalid'));
    const length = positiveInt(form.length);
    if (!length || length < 10 || length > 480 || minutesOf(from) + length > minutesOf(to)) {
      return setError(t('schedule.lengthInvalid'));
    }
    const capacity = positiveInt(form.capacity);
    if (!capacity || capacity > 200) return setError(t('workout.invalidNumbers'));
    const price = paid ? (form.price.trim() ? parseMoney(form.price) : 0) : 0;
    if (price === null) return setError(t('workout.invalidNumbers'));
    await run(async () => {
      await saveAvailability(org.id, {
        id: form.id, weekday: form.weekday, start_time: from, end_time: to,
        slot_minutes: length, capacity, price_cents: price, currency: 'EUR',
      });
      setForm(null);
    });
  }

  function editHours(a: Availability) {
    setForm({
      id: a.id, weekday: a.weekday, from: shortTime(a.start_time), to: shortTime(a.end_time),
      length: String(a.slot_minutes), capacity: String(a.capacity),
      price: a.price_cents ? (a.price_cents / 100).toFixed(a.price_cents % 100 ? 2 : 0) : '',
    });
  }

  function removeHours(a: Availability) {
    Alert.alert(t('schedule.deleteHours'),
      `${weekdayName(a.weekday, language)} ${shortTime(a.start_time)}–${shortTime(a.end_time)}`, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => run(() => deleteAvailability(a.id)) },
      ]);
  }

  async function addOff() {
    const d = newDay.trim();
    if (!isIsoDate(d) || d < today(tz)) return setError(t('schedule.dayInvalid'));
    if (daysOff.some((x) => x.day === d)) { setNewDay(''); return; }
    await run(async () => { await addDayOff(org!.id, d); setNewDay(''); });
  }

  const input = (value: string, onChange: (v: string) => void, opts: { numeric?: boolean; placeholder?: string } = {}) => (
    <TextInput value={value} onChangeText={onChange} placeholder={opts.placeholder} placeholderTextColor={theme.muted}
      keyboardType={opts.numeric ? 'decimal-pad' : 'numbers-and-punctuation'}
      style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: '#FFFFFF' }]} />
  );

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing}
        onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Tabs theme={theme} value={tab} onChange={(k) => { setTab(k); setError(null); }} tabs={[
        { key: 'requests', label: t('schedule.requests'), badge: requests.length },
        { key: 'upcoming', label: t('schedule.upcoming') },
        { key: 'hours', label: t('schedule.timetable') },
        { key: 'off', label: t('schedule.daysOff') },
      ]} />
      <Message text={error} />

      {tab === 'requests' ? (
        <>
          {!requests.length ? <Muted theme={theme}>{t('schedule.noRequests')}</Muted> : null}
          {requests.map((b) => (
            <BookingCard key={b.id} booking={b} tz={tz} theme={theme} showClient
              onAccept={() => run(() => decideBooking(b.id, true))}
              onDecline={() => run(() => decideBooking(b.id, false))} />
          ))}
        </>
      ) : null}

      {tab === 'upcoming' ? (
        <>
          {!upcoming.length ? <Muted theme={theme}>{t('schedule.noBookings')}</Muted> : null}
          {upcoming.map((b) => (
            <BookingCard key={b.id} booking={b} tz={tz} theme={theme} showClient
              onCancel={() => Alert.alert(t('schedule.cancel'), t('schedule.cancelConfirm', {
                day: dayLabel(dayKey(b.starts_at, tz), language), time: clock(b.starts_at, tz, language),
              }), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('schedule.cancel'), style: 'destructive', onPress: () => run(() => cancelBooking(b.id)) },
              ])} />
          ))}
        </>
      ) : null}

      {tab === 'hours' ? (
        <>
          {!hours.length && !form ? <Muted theme={theme}>{t('schedule.noHours')}</Muted> : null}
          {WEEK_ORDER.map((wd) => hours.filter((h) => h.weekday === wd).map((h) => (
            <Pressable key={h.id} onPress={() => editHours(h)} accessibilityRole="button"
              style={[styles.hours, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.hoursDay, { color: theme.text }]}>{weekdayName(h.weekday, language)}</Text>
                <Text style={{ color: theme.text, fontSize: 16 }}>{shortTime(h.start_time)}–{shortTime(h.end_time)}</Text>
                <Text style={{ color: theme.muted, fontSize: 14 }}>
                  {[`${h.slot_minutes} min`, `${h.capacity} ×`, h.price_cents ? formatMoney(h.price_cents, h.currency, language) : '']
                    .filter(Boolean).join('  ·  ')}
                </Text>
              </View>
              <Pressable onPress={() => removeHours(h)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.delete')}>
                <Ionicons name="trash-outline" size={22} color="#B3261E" />
              </Pressable>
            </Pressable>
          )))}

          {form ? (
            <View style={[styles.form, { backgroundColor: theme.surface, borderColor: theme.primary }]}>
              <Text style={[styles.label, { color: theme.text }]}>{t('schedule.weekday')}</Text>
              <View style={styles.chips}>
                {WEEK_ORDER.map((wd) => (
                  <Pressable key={wd} onPress={() => setForm({ ...form, weekday: wd })} accessibilityRole="radio"
                    accessibilityState={{ selected: form.weekday === wd }}
                    style={[styles.chip, { borderColor: theme.primary, backgroundColor: form.weekday === wd ? theme.primary : 'transparent' }]}>
                    <Text style={{ color: form.weekday === wd ? theme.onPrimary : theme.primary, fontWeight: '700' }}>
                      {weekdayName(wd, language).slice(0, 3)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.pair}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.label, { color: theme.text }]}>{t('schedule.from')}</Text>
                  {input(form.from, (v) => setForm({ ...form, from: v }))}
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.label, { color: theme.text }]}>{t('schedule.to')}</Text>
                  {input(form.to, (v) => setForm({ ...form, to: v }))}
                </View>
              </View>
              <View style={styles.pair}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.label, { color: theme.text }]}>{t('schedule.length')}</Text>
                  {input(form.length, (v) => setForm({ ...form, length: v.replace(/[^0-9]/g, '') }), { numeric: true })}
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.label, { color: theme.text }]}>{t('schedule.capacity')}</Text>
                  {input(form.capacity, (v) => setForm({ ...form, capacity: v.replace(/[^0-9]/g, '') }), { numeric: true })}
                </View>
              </View>
              {paid ? (
                <View style={{ gap: 4 }}>
                  <Text style={[styles.label, { color: theme.text }]}>{t('schedule.price')}</Text>
                  {input(form.price, (v) => setForm({ ...form, price: v }), { numeric: true, placeholder: '30' })}
                </View>
              ) : <Muted theme={theme}>{t('schedule.priceNone')}</Muted>}
              <View style={styles.pair}>
                <View style={{ flex: 1 }}><Button theme={theme} kind="secondary" label={t('common.cancel')} onPress={() => setForm(null)} /></View>
                <View style={{ flex: 1 }}><Button theme={theme} label={t('common.save')} onPress={saveForm} /></View>
              </View>
            </View>
          ) : (
            <Button theme={theme} label={t('schedule.addHours')} onPress={() => setForm({ ...EMPTY_FORM })} />
          )}
          <Muted theme={theme}>{t('schedule.timezone', { tz })}</Muted>
        </>
      ) : null}

      {tab === 'off' ? (
        <>
          {!daysOff.length ? <Muted theme={theme}>{t('schedule.noDaysOff')}</Muted> : null}
          {daysOff.map((d) => (
            <View key={d.id} style={[styles.hours, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.hoursDay, { color: theme.text, flex: 1 }]}>{dayLabel(d.day, language)}</Text>
              <Pressable onPress={() => run(() => deleteDayOff(d.id))} hitSlop={10} accessibilityRole="button"
                accessibilityLabel={t('common.delete')}>
                <Ionicons name="trash-outline" size={22} color="#B3261E" />
              </Pressable>
            </View>
          ))}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: theme.text }]}>{t('schedule.addDayOff')}</Text>
            {input(newDay, setNewDay, { placeholder: t('schedule.dayOffHint') })}
          </View>
          <Button theme={theme} label={t('schedule.addDayOff')} onPress={addOff} disabled={!newDay.trim()} />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 48 },
  label: { fontSize: 14, fontWeight: '600' },
  hours: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  hoursDay: { fontSize: 16, fontWeight: '700', textTransform: 'capitalize' },
  form: { borderRadius: 16, borderWidth: 2, padding: 14, gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, minWidth: 52, alignItems: 'center' },
  pair: { flexDirection: 'row', gap: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
});
