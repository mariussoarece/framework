// Owner: booking requests, upcoming sessions, the week, the timetable (open hours and
// classes, several days at once, every week or N weeks), and time off (whole days, blocked sessions).
import React, { useCallback, useState } from 'react';
import { KeyboardScroll } from '../components/KeyboardScroll';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Choice, Message, Muted, Tabs } from '../components/ui';
import { DateField, OptionField, TimeField } from '../components/pickers';
import { BookingCard } from './BookingCard';
import { WeekView } from './WeekView';
import { useI18n } from '../i18n/I18nProvider';
import {
  addDayOff, blockSlot, cancelBooking, daySlots, decideBooking, deleteAvailability, deleteDayOff, listAvailability,
  listBookings, listDaysOff, saveAvailability, type Availability, type Booking, type DayOff, type DaySlot,
  type ScheduleKind,
} from '../lib/data';
import {
  addMinutes, clock, dayKey, dayLabel, formatMoney, isIsoDate, minutesOf, parseMoney, parseTime, shortTime, today,
  untilForWeeks, WEEK_ORDER, weekdayName, weeksBetween, SESSION_LENGTHS, MAX_ATTENDANTS, MAX_WEEKS, range1,
} from '../lib/schedule';
import { positiveInt } from '../lib/format';
import { useSession } from '../lib/session';
import type { Theme } from '../theme/themes';

type Tab = 'requests' | 'upcoming' | 'week' | 'hours' | 'off';

type EntryForm = {
  id?: string;
  kind: ScheduleKind;
  weekdays: number[];
  title: string;
  instructor: string;
  from: string;          // open: window start; class: start time
  to: string;            // open only
  length: string;        // session length (open) or class length
  capacity: string;
  price: string;
  repeat: 'always' | 'weeks';
  weeks: string;
  startsOn: string;
};

export function OwnerSchedule({ theme }: { theme: Theme }) {
  const { t, tError, language } = useI18n();
  const { org } = useSession();
  const tz = org?.timezone ?? 'Europe/Bucharest';
  const paid = org?.plan !== 'none';
  const [tab, setTab] = useState<Tab>('requests');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [entries, setEntries] = useState<Availability[]>([]);
  const [daysOff, setDaysOff] = useState<DayOff[]>([]);
  const [form, setForm] = useState<EntryForm | null>(null);
  const [newDay, setNewDay] = useState('');
  const [blockDay, setBlockDay] = useState('');
  const [blockList, setBlockList] = useState<DaySlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const emptyForm = (kind: ScheduleKind): EntryForm => ({
    kind, weekdays: [], title: '', instructor: '',
    from: kind === 'class' ? '18:00' : '09:00', to: '17:00', length: '60',
    capacity: kind === 'class' ? '10' : '1', price: '', repeat: 'always', weeks: '4', startsOn: today(tz),
  });

  const load = useCallback(async () => {
    try {
      const [b, h, d] = await Promise.all([
        listBookings({ owner: true, upcomingOnly: true }),
        listAvailability(),
        listDaysOff(today(tz)),
      ]);
      setBookings(b); setEntries(h); setDaysOff(d);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(tError(err));
    }
  }, [tz, tError]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try { await fn(); } catch (err) { Alert.alert(t('schedule.notPossible'), tError(err)); }
    await load();
  };

  const requests = bookings.filter((b) => b.status === 'pending');
  const upcoming = bookings.filter((b) => b.status === 'accepted');

  // ---------------------------------------------------------------- timetable entries
  async function saveForm() {
    if (!form) return;
    if (!form.weekdays.length) return setError(t('schedule.chooseDay'));
    if (form.kind === 'class' && !form.title.trim()) return setError(t('schedule.nameMissing'));
    const from = parseTime(form.from);
    const length = positiveInt(form.length);
    if (!from) return setError(t('schedule.hoursInvalid'));
    if (!length || length < 10 || length > 480) return setError(t('schedule.lengthInvalid'));
    let to: string | null = null;
    if (form.kind === 'open') {
      to = parseTime(form.to);
      if (!to || minutesOf(to) <= minutesOf(from)) return setError(t('schedule.hoursInvalid'));
      if (minutesOf(from) + length > minutesOf(to)) return setError(t('schedule.lengthInvalid'));
    } else if (!addMinutes(from, length)) {
      return setError(t('schedule.lengthInvalid'));
    }
    const capacity = positiveInt(form.capacity);
    if (!capacity || capacity > MAX_ATTENDANTS) return setError(t('workout.invalidNumbers'));
    const price = paid ? (form.price.trim() ? parseMoney(form.price) : 0) : 0;
    if (price === null) return setError(t('workout.invalidNumbers'));
    if (!isIsoDate(form.startsOn)) return setError(t('schedule.dayInvalid'));
    let until: string | null = null;
    if (form.repeat === 'weeks') {
      const weeks = positiveInt(form.weeks);
      if (!weeks || weeks > MAX_WEEKS) return setError(t('schedule.weeksInvalid'));
      until = untilForWeeks(form.startsOn, weeks);
    }
    await run(async () => {
      await saveAvailability({
        id: form.id, weekdays: form.weekdays, kind: form.kind,
        title: form.kind === 'class' ? form.title.trim() : null,
        instructor: form.kind === 'class' ? (form.instructor.trim() || null) : null,
        start: from, end: to, slot_minutes: length, capacity, price_cents: price,
        valid_from: form.startsOn, valid_until: until,
      });
      setForm(null);
    });
  }

  function editEntry(a: Availability) {
    setForm({
      id: a.id, kind: a.kind, weekdays: [a.weekday], title: a.title ?? '', instructor: a.instructor ?? '',
      from: shortTime(a.start_time), to: shortTime(a.end_time), length: String(a.slot_minutes),
      capacity: String(a.capacity),
      price: a.price_cents ? (a.price_cents / 100).toFixed(a.price_cents % 100 ? 2 : 0) : '',
      repeat: a.valid_until ? 'weeks' : 'always',
      weeks: a.valid_until ? String(weeksBetween(a.valid_from, a.valid_until)) : '4',
      startsOn: a.valid_from,
    });
  }

  function removeEntry(a: Availability) {
    Alert.alert(t('schedule.deleteHours'),
      `${weekdayName(a.weekday, language)} ${shortTime(a.start_time)}–${shortTime(a.end_time)}${a.title ? ` · ${a.title}` : ''}`, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => run(() => deleteAvailability(a.id)) },
      ]);
  }

  function toggleDay(wd: number) {
    if (!form) return;
    if (form.id) return setForm({ ...form, weekdays: [wd] });       // editing: one day
    setForm({ ...form, weekdays: form.weekdays.includes(wd) ? form.weekdays.filter((x) => x !== wd) : [...form.weekdays, wd] });
  }

  // ---------------------------------------------------------------- time off
  async function addOff() {
    const d = newDay.trim();
    if (!isIsoDate(d) || d < today(tz)) return setError(t('schedule.dayInvalid'));
    if (daysOff.some((x) => x.day === d)) { setNewDay(''); return; }
    await run(async () => { await addDayOff(org!.id, d); setNewDay(''); });
    if (blockDay === d) setBlockList([]);
  }

  async function showDay(chosen?: string) {
    const d = (chosen ?? blockDay).trim();
    if (!isIsoDate(d) || d < today(tz)) return setError(t('schedule.dayInvalid'));
    setError(null);
    try { setBlockList(await daySlots(d)); } catch (err) { setError(tError(err)); }
  }

  async function toggleBlock(s: DaySlot) {
    setError(null);
    try {
      await blockSlot(s.starts_at, !s.blocked);
      setReloadKey((k) => k + 1);
    } catch (err) {
      Alert.alert(t('schedule.notPossible'), tError(err));
    }
    try { setBlockList(await daySlots(blockDay.trim())); } catch { /* list stays; pull to refresh */ }
  }

  // ---------------------------------------------------------------- UI helpers
  const input = (value: string, onChange: (v: string) => void, opts: { numeric?: boolean; placeholder?: string } = {}) => (
    <TextInput value={value} onChangeText={onChange} placeholder={opts.placeholder} placeholderTextColor={theme.muted}
      keyboardType={opts.numeric ? 'decimal-pad' : 'default'} autoCorrect={false}
      style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: '#FFFFFF' }]} />
  );
  const labelled = (label: string, child: React.ReactNode) => (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      {child}
    </View>
  );
  const validity = (a: Availability) =>
    a.valid_until ? t('schedule.until', { date: dayLabel(a.valid_until, language) }) : t('schedule.everyWeek');

  return (
    <KeyboardScroll
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await load();
          if (blockDay) await showDay(blockDay);
          setRefreshing(false);
        }} />}
    >
      <Tabs theme={theme} value={tab} onChange={(k) => { setTab(k); setError(null); }} tabs={[
        { key: 'requests', label: t('schedule.requests'), badge: requests.length },
        { key: 'upcoming', label: t('schedule.upcoming') },
        { key: 'week', label: t('schedule.week') },
        { key: 'hours', label: t('schedule.timetable') },
        { key: 'off', label: t('schedule.timeOff') },
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
                { text: t('schedule.keep'), style: 'cancel' },
                { text: t('schedule.yesCancel'), style: 'destructive', onPress: () => run(() => cancelBooking(b.id)) },
              ])} />
          ))}
        </>
      ) : null}

      {tab === 'week' ? <WeekView theme={theme} tz={tz} reloadKey={reloadKey} /> : null}

      {tab === 'hours' ? (
        <>
          {!entries.length && !form ? <Muted theme={theme}>{t('schedule.noHours')}</Muted> : null}
          {!form ? WEEK_ORDER.map((wd) => entries.filter((h) => h.weekday === wd).map((h) => (
            <Pressable key={h.id} onPress={() => editEntry(h)} accessibilityRole="button"
              style={[styles.entry, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.entryDay, { color: theme.text }]}>
                  {weekdayName(h.weekday, language)}  ·  {shortTime(h.start_time)}–{shortTime(h.end_time)}
                </Text>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>
                  {h.kind === 'class'
                    ? `${h.title}${h.instructor ? ` · ${t('schedule.with', { name: h.instructor })}` : ''}`
                    : `${t('schedule.typeOpen')} · ${t('schedule.sessions', { n: h.slot_minutes })}`}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 14 }}>
                  {[`${t('schedule.attendants')}: ${h.capacity}`,
                    h.price_cents ? formatMoney(h.price_cents, h.currency, language) : '', validity(h)]
                    .filter(Boolean).join('  ·  ')}
                </Text>
              </View>
              <Pressable onPress={() => removeEntry(h)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.delete')}>
                <Ionicons name="trash-outline" size={22} color="#B3261E" />
              </Pressable>
            </Pressable>
          ))) : null}

          {form ? (
            <View style={[styles.form, { backgroundColor: theme.surface, borderColor: theme.primary }]}>
              <Text style={[styles.formTitle, { color: theme.text }]}>
                {form.id ? t('schedule.editEntry') : t('schedule.addEntry')}
              </Text>
              {!form.id ? (
                <>
                  <Choice theme={theme} title={t('schedule.typeOpen')} hint={t('schedule.typeOpenHint')}
                    selected={form.kind === 'open'} onPress={() => setForm({ ...emptyForm('open'), weekdays: form.weekdays })} />
                  <Choice theme={theme} title={t('schedule.typeClass')} hint={t('schedule.typeClassHint')}
                    selected={form.kind === 'class'} onPress={() => setForm({ ...emptyForm('class'), weekdays: form.weekdays })} />
                </>
              ) : null}

              <Text style={[styles.label, { color: theme.text }]}>{t('schedule.days')}</Text>
              <View style={styles.chips}>
                {WEEK_ORDER.map((wd) => {
                  const on = form.weekdays.includes(wd);
                  return (
                    <Pressable key={wd} onPress={() => toggleDay(wd)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                      style={[styles.chip, { borderColor: theme.primary, backgroundColor: on ? theme.primary : 'transparent' }]}>
                      <Text style={{ color: on ? theme.onPrimary : theme.primary, fontWeight: '700' }}>
                        {weekdayName(wd, language).slice(0, 3)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {form.kind === 'class' ? (
                <>
                  {labelled(t('schedule.className'), input(form.title, (v) => setForm({ ...form, title: v }), { placeholder: 'Yoga Flow' }))}
                  {labelled(t('schedule.instructor'), input(form.instructor, (v) => setForm({ ...form, instructor: v })))}
                  <View style={styles.pair}>
                    <TimeField flex theme={theme} label={t('schedule.startTime')} value={form.from}
                      onChange={(v) => setForm({ ...form, from: v })} />
                    <OptionField flex theme={theme} label={t('schedule.classLength')} value={Number(form.length)} options={SESSION_LENGTHS}
                      format={(n) => t('schedule.minutes', { n })} onChange={(n) => setForm({ ...form, length: String(n) })} />
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.pair}>
                    <TimeField flex theme={theme} label={t('schedule.from')} value={form.from}
                      onChange={(v) => setForm({ ...form, from: v })} />
                    <TimeField flex theme={theme} label={t('schedule.to')} value={form.to}
                      onChange={(v) => setForm({ ...form, to: v })} />
                  </View>
                  <OptionField flex theme={theme} label={t('schedule.length')} value={Number(form.length)} options={SESSION_LENGTHS}
                      format={(n) => t('schedule.minutes', { n })} onChange={(n) => setForm({ ...form, length: String(n) })} />
                </>
              )}

              <View style={styles.pair}>
                <OptionField flex theme={theme} label={t('schedule.attendants')} value={Number(form.capacity)}
                  options={range1(MAX_ATTENDANTS)} format={(n) => String(n)}
                  onChange={(n) => setForm({ ...form, capacity: String(n) })} />
                {paid ? labelled(t('schedule.price'), input(form.price, (v) => setForm({ ...form, price: v }), { numeric: true, placeholder: '30' })) : <View style={{ flex: 1 }} />}
              </View>
              {!paid ? <Muted theme={theme}>{t('schedule.priceNone')}</Muted> : null}

              <Text style={[styles.label, { color: theme.text }]}>{t('schedule.repeat')}</Text>
              <Choice theme={theme} title={t('schedule.everyWeek')} selected={form.repeat === 'always'}
                onPress={() => setForm({ ...form, repeat: 'always' })} />
              <Choice theme={theme} title={t('schedule.forWeeks')} selected={form.repeat === 'weeks'}
                onPress={() => setForm({ ...form, repeat: 'weeks' })} />
              <View style={styles.pair}>
                <DateField flex theme={theme} label={t('schedule.startsOn')} value={form.startsOn}
                  minimum={form.id && form.startsOn < today(tz) ? form.startsOn : today(tz)}
                  onChange={(v) => setForm({ ...form, startsOn: v })} />
                {form.repeat === 'weeks'
                  ? <OptionField flex theme={theme} label={t('schedule.weeks')} value={Number(form.weeks)}
                      options={range1(MAX_WEEKS)} format={(n) => (n === 1 ? t('schedule.week1') : t('schedule.weeksN', { n }))}
                      onChange={(n) => setForm({ ...form, weeks: String(n) })} />
                  : <View style={{ flex: 1 }} />}
              </View>

              <View style={styles.pair}>
                <View style={{ flex: 1 }}><Button theme={theme} kind="secondary" label={t('common.cancel')} onPress={() => { setForm(null); setError(null); }} /></View>
                <View style={{ flex: 1 }}><Button theme={theme} label={t('common.save')} onPress={saveForm} /></View>
              </View>
            </View>
          ) : (
            <Button theme={theme} label={t('schedule.addEntry')} onPress={() => setForm(emptyForm('open'))} />
          )}
          <Muted theme={theme}>{t('schedule.timezone', { tz })}</Muted>
        </>
      ) : null}

      {tab === 'off' ? (
        <>
          <Text style={[styles.formTitle, { color: theme.text }]}>{t('schedule.wholeDays')}</Text>
          {!daysOff.length ? <Muted theme={theme}>{t('schedule.noDaysOff')}</Muted> : null}
          {daysOff.map((d) => (
            <View key={d.id} style={[styles.entry, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.entryDay, { color: theme.text, flex: 1 }]}>{dayLabel(d.day, language)}</Text>
              <Pressable onPress={async () => { await run(() => deleteDayOff(d.id)); if (blockDay === d.day) showDay(d.day); }}
                hitSlop={10} accessibilityRole="button"
                accessibilityLabel={t('common.delete')}>
                <Ionicons name="trash-outline" size={22} color="#B3261E" />
              </Pressable>
            </View>
          ))}
          <DateField theme={theme} label={t('schedule.addDayOff')} value={newDay} minimum={today(tz)} onChange={setNewDay} />
          <Button theme={theme} kind="secondary" label={t('schedule.addDayOff')} onPress={addOff} disabled={!newDay.trim()} />

          <Text style={[styles.formTitle, { color: theme.text, marginTop: 12 }]}>{t('schedule.blockTimes')}</Text>
          <Muted theme={theme}>{t('schedule.blockHint')}</Muted>
          <DateField theme={theme} label={t('schedule.date')} value={blockDay} minimum={today(tz)}
            onChange={(v) => { setBlockDay(v); showDay(v); }} />
          {blockDay && daysOff.some((x) => x.day === blockDay)
            ? <Message kind="info" text={t('schedule.dayIsOff')} />
            : blockList && !blockList.length ? <Muted theme={theme}>{t('schedule.noSessionsDay')}</Muted> : null}
          {blockList && blockList.length > 0 && !daysOff.some((x) => x.day === blockDay) ? (
            <View style={styles.slots}>
              {blockList.map((s) => (
                <Pressable key={s.starts_at} onPress={() => toggleBlock(s)} accessibilityRole="switch"
                  accessibilityState={{ checked: s.blocked }}
                  style={[styles.slot, {
                    borderColor: s.blocked ? '#B3261E' : theme.primary,
                    backgroundColor: s.blocked ? '#FDECEA' : 'transparent',
                  }]}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: s.blocked ? '#8C1D18' : theme.primary }}>
                    {clock(s.starts_at, tz, language)}–{clock(s.ends_at, tz, language)}
                  </Text>
                  {s.title ? <Text style={{ fontSize: 12, color: theme.muted }} numberOfLines={1}>{s.title}</Text> : null}
                  <Text style={{ fontSize: 12, color: s.blocked ? '#8C1D18' : theme.muted }}>
                    {s.blocked ? t('schedule.blocked') : s.booked ? t('schedule.booked', { n: s.booked }) : t('schedule.free')}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </KeyboardScroll>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 48 },
  label: { fontSize: 14, fontWeight: '600' },
  formTitle: { fontSize: 17, fontWeight: '700' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  entryDay: { fontSize: 16, fontWeight: '700', textTransform: 'capitalize' },
  form: { borderRadius: 16, borderWidth: 2, padding: 14, gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, minWidth: 52, alignItems: 'center' },
  pair: { flexDirection: 'row', gap: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slot: { borderWidth: 1.5, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', minWidth: 120 },
});
