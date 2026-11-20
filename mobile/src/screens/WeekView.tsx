// The week's timetable for everyone: each day, classes one per line (time, name,
// instructor, places taken) and open hours as a window.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Message, Muted } from '../components/ui';
import { WeekRange } from '../components/WeekRange';
import { useI18n } from '../i18n/I18nProvider';
import { weekOverview, type WeekEntry } from '../lib/data';
import { addDays, dayLabel, shortTime, today, weekStart } from '../lib/schedule';
import type { Theme } from '../theme/themes';

export function WeekView({ theme, tz, reloadKey }: { theme: Theme; tz: string; reloadKey?: number }) {
  const { t, tError, language } = useI18n();
  const [start, setStart] = useState(() => weekStart(today(tz)));
  const [entries, setEntries] = useState<WeekEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await weekOverview(start, 7));
      setError(null);
    } catch (err) {
      setError(tError(err));
    }
  }, [start, tError]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const thisWeek = weekStart(today(tz));

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.nav}>
        <Pressable onPress={() => setStart(addDays(start, -7))} disabled={start <= thisWeek} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('schedule.prevWeek')}>
          <Ionicons name="chevron-back" size={26} color={start <= thisWeek ? theme.border : theme.primary} />
        </Pressable>
        <WeekRange from={dayLabel(days[0], language)} to={dayLabel(days[6], language)} theme={theme} />
        <Pressable onPress={() => setStart(addDays(start, 7))} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('schedule.nextWeek')}>
          <Ionicons name="chevron-forward" size={26} color={theme.primary} />
        </Pressable>
      </View>
      <Message text={error} />
      {entries && !entries.length ? <Muted theme={theme}>{t('schedule.nothingThisWeek')}</Muted> : null}

      {days.map((d) => {
        const list = (entries ?? []).filter((e) => e.day === d);
        if (!list.length) return null;
        const off = list.some((e) => e.day_off);
        return (
          <View key={d} style={[styles.day, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.dayTitle, { color: theme.text }]}>{dayLabel(d, language)}</Text>
            {off ? <Text style={{ color: '#B3261E', fontWeight: '700' }}>{t('schedule.closed')}</Text> : list.map((e) => (
              <View key={e.availability_id} style={[styles.row, { borderTopColor: theme.border }]}>
                <Text style={[styles.time, { color: theme.primary }]}>
                  {shortTime(e.start_time)}–{shortTime(e.end_time)}
                </Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.name, { color: theme.text }]}>
                    {e.kind === 'class' ? e.title : t('schedule.typeOpen')}
                  </Text>
                  <Text style={{ color: theme.muted, fontSize: 14 }}>
                    {e.kind === 'class'
                      ? [e.instructor ? t('schedule.with', { name: e.instructor }) : '', t('schedule.taken', { booked: e.booked, capacity: e.capacity })]
                        .filter(Boolean).join('  ·  ')
                      : t('schedule.sessions', { n: e.slot_minutes })}
                  </Text>
                </View>
                {e.kind === 'class' && e.booked >= e.capacity
                  ? <Text style={styles.full}>{t('schedule.full')}</Text> : null}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  day: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  dayTitle: { fontSize: 17, fontWeight: '700', textTransform: 'capitalize' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  time: { fontSize: 15, fontWeight: '700', width: 98 },
  name: { fontSize: 16, fontWeight: '700' },
  full: { fontSize: 12, fontWeight: '700', color: '#8C1D18', backgroundColor: '#FDECEA', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
});
