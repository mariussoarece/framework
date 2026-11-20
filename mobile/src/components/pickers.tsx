// Pickers in the organization's theme colors:
//   DateField   - calendar        ("YYYY-MM-DD")
//   TimeField   - clock wheel     ("HH:MM", 24 h, 5-minute steps)
//   OptionField - list of choices (session length, attendants, weeks)
// Each shows a button in the theme; tapping opens a panel from the bottom.
// Android dates/times use the system dialog (it follows the phone's colors).
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../i18n/I18nProvider';
import { dateFromKey, keyFromDate, timeFromHHMM, hhmmFromTime } from '../lib/pickerValues';
import { dayLabel } from '../lib/schedule';
import { DEFAULT_THEME, isDarkTheme, type Theme } from '../theme/themes';

type Common = { label: string; theme?: Theme; flex?: boolean };

function FieldButton({ label, text, icon, onPress, theme, flex, placeholder }: {
  label: string; text: string; icon: string; onPress: () => void; theme: Theme; flex?: boolean; placeholder?: boolean;
}) {
  return (
    <View style={[styles.field, flex ? { flex: 1 } : null]}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${text}`}
        style={({ pressed }) => [styles.button, { borderColor: theme.primary, backgroundColor: theme.surface, opacity: pressed ? 0.75 : 1 }]}>
        <Ionicons name={icon as never} size={20} color={theme.primary} />
        <Text style={[styles.value, { color: placeholder ? theme.muted : theme.text }]} numberOfLines={1}>{text}</Text>
        <Ionicons name="chevron-down" size={18} color={theme.muted} />
      </Pressable>
    </View>
  );
}

// Bottom panel in the theme's colors.
function Sheet({ visible, title, onClose, theme, children }: {
  visible: boolean; title: string; onClose: () => void; theme: Theme; children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.done')} />
      <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}>
        <View style={[styles.sheetHead, { borderBottomColor: theme.border }]}>
          <Text style={[styles.sheetTitle, { color: theme.text }]}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={{ color: theme.primary, fontSize: 17, fontWeight: '700' }}>{t('common.done')}</Text>
          </Pressable>
        </View>
        {children}
      </SafeAreaView>
    </Modal>
  );
}

export function DateField({ label, value, onChange, minimum, theme = DEFAULT_THEME, flex }: Common & {
  value: string;                 // YYYY-MM-DD ('' = not chosen yet)
  onChange: (v: string) => void;
  minimum?: string;              // YYYY-MM-DD
}) {
  const { language } = useI18n();
  const [open, setOpen] = useState(false);
  const date = dateFromKey(value || minimum || keyFromDate(new Date()));
  const min = minimum ? dateFromKey(minimum) : undefined;

  function changed(e: DateTimePickerEvent, d?: Date) {
    if (Platform.OS === 'android') setOpen(false);
    if (e.type === 'set' && d) {
      onChange(keyFromDate(d));
      if (Platform.OS === 'ios') setOpen(false);     // a tap on a day is the choice
    }
  }

  return (
    <>
      <FieldButton label={label} icon="calendar-outline" theme={theme} flex={flex} placeholder={!value}
        text={value ? dayLabel(value, language) : '—'} onPress={() => setOpen(true)} />
      {Platform.OS === 'ios' ? (
        <Sheet visible={open} title={label} onClose={() => setOpen(false)} theme={theme}>
          <DateTimePicker value={date} mode="date" display="inline" minimumDate={min}
            locale={language === 'ro' ? 'ro-RO' : 'en-GB'} onChange={changed}
            accentColor={theme.primary} themeVariant={isDarkTheme(theme) ? 'dark' : 'light'} />
        </Sheet>
      ) : open ? <DateTimePicker value={date} mode="date" minimumDate={min} onChange={changed} /> : null}
    </>
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

  function changed(e: DateTimePickerEvent, d?: Date) {
    if (Platform.OS === 'android') setOpen(false);
    if (e.type === 'set' && d) onChange(hhmmFromTime(d));
  }

  return (
    <>
      <FieldButton label={label} icon="time-outline" theme={theme} flex={flex} placeholder={!value}
        text={value || '—'} onPress={() => setOpen(true)} />
      {Platform.OS === 'ios' ? (
        <Sheet visible={open} title={label} onClose={() => setOpen(false)} theme={theme}>
          <DateTimePicker value={time} mode="time" display="spinner" minuteInterval={minuteInterval}
            locale={language === 'ro' ? 'ro-RO' : 'en-GB'} onChange={changed}
            textColor={theme.text} themeVariant={isDarkTheme(theme) ? 'dark' : 'light'} />
        </Sheet>
      ) : open ? <DateTimePicker value={time} mode="time" is24Hour minuteInterval={minuteInterval} onChange={changed} /> : null}
    </>
  );
}

const ROW = 52;

export function OptionField({ label, value, options, format, onChange, theme = DEFAULT_THEME, flex }: Common & {
  value: number;
  options: number[];
  format: (n: number) => string;
  onChange: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const list = useRef<FlatList<number>>(null);
  const index = Math.max(0, options.indexOf(value));

  useEffect(() => {
    if (open) setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0.4, animated: false }), 50);
  }, [open, index]);

  return (
    <>
      <FieldButton label={label} icon="options-outline" theme={theme} flex={flex}
        text={options.includes(value) || value ? format(value) : '—'} onPress={() => setOpen(true)} />
      <Sheet visible={open} title={label} onClose={() => setOpen(false)} theme={theme}>
        <FlatList
          ref={list}
          data={options}
          keyExtractor={(n) => String(n)}
          style={{ maxHeight: 360 }}
          getItemLayout={(_, i) => ({ length: ROW, offset: ROW * i, index: i })}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item }) => {
            const on = item === value;
            return (
              <Pressable onPress={() => { onChange(item); setOpen(false); }} accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={[styles.option, { borderBottomColor: theme.border, backgroundColor: on ? theme.surface : 'transparent' }]}>
                <Text style={{ fontSize: 18, color: on ? theme.primary : theme.text, fontWeight: on ? '700' : '400' }}>
                  {format(item)}
                </Text>
                {on ? <Ionicons name="checkmark" size={22} color={theme.primary} /> : null}
              </Pressable>
            );
          }}
        />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600' },
  button: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
  value: { flex: 1, fontSize: 16, textTransform: 'capitalize' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, paddingBottom: 8 },
  sheetHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', flex: 1 },
  option: { height: ROW, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
});
