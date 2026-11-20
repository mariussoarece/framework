// Date and time fields with the phone's own pickers.
// iPhone: compact field that opens the native calendar / clock wheel.
// Android: a button that opens the system date / time dialog.
// Values stay plain text the rest of the app already uses: "YYYY-MM-DD" and "HH:MM".
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../i18n/I18nProvider';
import { dateFromKey, keyFromDate, timeFromHHMM, hhmmFromTime } from '../lib/pickerValues';
import { dayLabel } from '../lib/schedule';
import { DEFAULT_THEME, type Theme } from '../theme/themes';

type Common = { label: string; theme?: Theme; flex?: boolean };

export function DateField({ label, value, onChange, minimum, theme = DEFAULT_THEME, flex }: Common & {
  value: string;                 // YYYY-MM-DD ('' = not chosen yet)
  onChange: (v: string) => void;
  minimum?: string;              // YYYY-MM-DD
}) {
  const { language } = useI18n();
  const [open, setOpen] = useState(false);
  const date = dateFromKey(value || minimum || keyFromDate(new Date()));
  const min = minimum ? dateFromKey(minimum) : undefined;
  const locale = language === 'ro' ? 'ro-RO' : 'en-GB';

  function changed(e: DateTimePickerEvent, d?: Date) {
    if (Platform.OS === 'android') setOpen(false);
    if (e.type === 'set' && d) onChange(keyFromDate(d));
  }

  return (
    <View style={[styles.field, flex ? { flex: 1 } : null]}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      {Platform.OS === 'ios' ? (
        <View style={styles.iosRow}>
          <DateTimePicker value={date} mode="date" display="compact" minimumDate={min} locale={locale}
            onChange={changed} accentColor={theme.primary} />
        </View>
      ) : (
        <>
          <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={label}
            style={[styles.button, { borderColor: theme.border, backgroundColor: '#FFFFFF' }]}>
            <Ionicons name="calendar-outline" size={20} color={theme.primary} />
            <Text style={[styles.value, { color: value ? theme.text : theme.muted }]}>
              {value ? dayLabel(value, language) : '—'}
            </Text>
          </Pressable>
          {open ? <DateTimePicker value={date} mode="date" minimumDate={min} onChange={changed} /> : null}
        </>
      )}
    </View>
  );
}

export function TimeField({ label, value, onChange, theme = DEFAULT_THEME, flex, minuteInterval = 5 }: Common & {
  value: string;                 // HH:MM
  onChange: (v: string) => void;
  minuteInterval?: 1 | 5 | 10 | 15 | 30;
}) {
  const { language } = useI18n();
  const [open, setOpen] = useState(false);
  const time = timeFromHHMM(value || '09:00');
  const locale = language === 'ro' ? 'ro-RO' : 'en-GB';

  function changed(e: DateTimePickerEvent, d?: Date) {
    if (Platform.OS === 'android') setOpen(false);
    if (e.type === 'set' && d) onChange(hhmmFromTime(d));
  }

  return (
    <View style={[styles.field, flex ? { flex: 1 } : null]}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      {Platform.OS === 'ios' ? (
        <View style={styles.iosRow}>
          <DateTimePicker value={time} mode="time" display="compact" locale={locale} minuteInterval={minuteInterval}
            onChange={changed} accentColor={theme.primary} />
        </View>
      ) : (
        <>
          <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={label}
            style={[styles.button, { borderColor: theme.border, backgroundColor: '#FFFFFF' }]}>
            <Ionicons name="time-outline" size={20} color={theme.primary} />
            <Text style={[styles.value, { color: theme.text }]}>{value || '—'}</Text>
          </Pressable>
          {open ? <DateTimePicker value={time} mode="time" is24Hour minuteInterval={minuteInterval} onChange={changed} /> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600' },
  iosRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  value: { fontSize: 16, textTransform: 'capitalize' },
});
