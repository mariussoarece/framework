// Client: a class in detail (picture, name, instructor, when, places, price, description)
// with the button to book it. Opened from Scheduling > Book.
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '../../src/components/ScreenBackground';
import { MediaImage } from '../../src/components/MediaImage';
import { RichText } from '../../src/components/RichText';
import { Button, Loading, Message, Muted } from '../../src/components/ui';
import { useI18n } from '../../src/i18n/I18nProvider';
import { getAvailability, requestBooking, type Availability } from '../../src/lib/data';
import { clock, dayKey, dayLabel, formatMoney, lengthLabel } from '../../src/lib/schedule';
import { useSession } from '../../src/lib/session';
import { themeFor } from '../../src/theme/themes';

export default function ClassDetails() {
  const { id, start, end, remaining, capacity } = useLocalSearchParams<{
    id: string; start: string; end: string; remaining?: string; capacity?: string;
  }>();
  const { t, tError, language } = useI18n();
  const { home, org, profile } = useSession();
  const theme = themeFor(home?.theme_key);
  const tz = org?.timezone ?? 'Europe/Bucharest';
  const [c, setC] = useState<Availability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    getAvailability(id).then((a) => (a ? setC(a) : setError(t('class.notFound')))).catch((err) => setError(tError(err)));
  }, [id, t, tError]));

  const left = Number(remaining ?? '0');
  const total = Number(capacity ?? '0');
  const full = left <= 0;
  const day = start ? dayLabel(dayKey(start, tz), language) : '';
  const time = start && end ? `${clock(start, tz, language)}–${clock(end, tz, language)}` : '';

  function confirm() {
    Alert.alert(t('schedule.confirmTitle'), t('schedule.confirmText', {
      day, time: `${clock(start, tz, language)} · ${c?.title ?? ''}`, org: org?.name ?? '',
    }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('class.book'), onPress: book },
    ]);
  }

  async function book() {
    setBusy(true);
    try {
      await requestBooking(start);
      Alert.alert(t('class.requestedTitle'), t('schedule.requested'), [
        { text: 'OK', onPress: () => router.replace('/schedule?tab=mine') },
      ]);
    } catch (err) {
      Alert.alert(t('schedule.notPossible'), tError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!c && !error) return <Loading theme={theme} />;

  return (
    <ScreenBackground theme={theme}>
      {/* "automatic": starts below the see-through header, like the workout screen */}
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={styles.content}>
        <Message text={error} />
        {c ? (
          <>
            {c.image_media_id ? <MediaImage mediaId={c.image_media_id} style={styles.picture} /> : null}
            <Text style={[styles.title, { color: theme.text }]}>{c.title}</Text>
            {c.instructor ? (
              <View style={styles.line}>
                <Ionicons name="person-outline" size={20} color={theme.muted} />
                <Text style={[styles.info, { color: theme.text }]}>{t('schedule.with', { name: c.instructor })}</Text>
              </View>
            ) : null}
            <View style={styles.line}>
              <Ionicons name="calendar-outline" size={20} color={theme.muted} />
              <Text style={[styles.info, { color: theme.text }]}>{day}</Text>
            </View>
            <View style={styles.line}>
              <Ionicons name="time-outline" size={20} color={theme.muted} />
              <Text style={[styles.info, { color: theme.text }]}>{time}  ·  {lengthLabel(c.slot_minutes)}</Text>
            </View>
            <View style={styles.line}>
              <Ionicons name="people-outline" size={20} color={theme.muted} />
              <Text style={[styles.info, { color: theme.text }]}>
                {full ? t('schedule.full') : t('class.placesLeft', { n: left, capacity: total })}
              </Text>
            </View>
            {c.price_cents > 0 ? (
              <View style={styles.line}>
                <Ionicons name="pricetag-outline" size={20} color={theme.muted} />
                <Text style={[styles.info, { color: theme.text }]}>
                  {formatMoney(c.price_cents, c.currency, language)}
                  {`  ·  ${t('class.paidAtStudio')}`}
                </Text>
              </View>
            ) : null}

            {c.description ? (
              <View style={[styles.card, { backgroundColor: theme.surface }]}>
                <RichText doc={c.description} theme={theme} />
              </View>
            ) : null}

            {profile?.role === 'client' ? (
              <Button theme={theme} label={full ? t('schedule.full') : t('class.book')} onPress={confirm}
                busy={busy} disabled={full} />
            ) : null}
            <Muted theme={theme}>{t('schedule.timezone', { tz })}</Muted>
          </>
        ) : null}
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  picture: { width: '100%', aspectRatio: 16 / 9, borderRadius: 16 },
  title: { fontSize: 26, fontWeight: '800' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  info: { fontSize: 16, flexShrink: 1 },
  card: { borderRadius: 16, padding: 16 },
});
