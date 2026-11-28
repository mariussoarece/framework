// Client: a class in detail (picture, name, instructor, when, places, price, description)
// with the button to book it. Opened from Scheduling > Book.
import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenBackground } from '../../src/components/ScreenBackground';
import { MediaImage } from '../../src/components/MediaImage';
import { RichText } from '../../src/components/RichText';
import { Button, Loading, Message, Muted } from '../../src/components/ui';
import { useI18n } from '../../src/i18n/I18nProvider';
import {
  getAvailability, listMemberships, listPlans, plansOfClass, requestBooking, requestMembership,
  type Availability, type MembershipPlan, type MembershipRow,
} from '../../src/lib/data';
import { usePlanText } from '../../src/components/PlanCard';
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
  const [refreshing, setRefreshing] = useState(false);
  // memberships that cover this class, and the client's own
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [mine, setMine] = useState<MembershipRow[]>([]);
  const planText = usePlanText();

  const load = useCallback(async () => {
    try {
      const a = await getAvailability(id);
      if (!a) { setError(t('class.notFound')); return; }
      setC(a);
      const [ids, all, m] = await Promise.all([plansOfClass(id), listPlans(a.organization_id), listMemberships()]);
      setPlans(all.filter((p) => ids.includes(p.id)));
      setMine(m);
    } catch (err) {
      setError(tError(err));
    }
  }, [id, t, tError]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const day0 = start ? dayKey(start, tz) : '';
  // the client's active membership that this booking would use
  const using = mine.find((m) => m.status === 'active' && !m.expired && plans.some((p) => p.id === m.plan_id)
    && (m.remaining === null || m.remaining > 0) && m.starts_on! <= day0 && day0 <= m.ends_on!);

  // one membership at a time: none can be requested while one is waiting or still usable
  const blocking = mine.some((m) => m.status === 'pending'
    || (m.status === 'active' && !m.expired && (m.remaining === null || m.remaining > 0)));

  async function want(p: MembershipPlan) {
    Alert.alert(p.name, t('memberships.wantConfirm', { org: org?.name ?? '' }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('memberships.want'), onPress: async () => {
          try { await requestMembership(p.id); await load(); Alert.alert(t('memberships.requestedTitle'), t('memberships.waiting')); }
          catch (err) { Alert.alert(t('schedule.notPossible'), tError(err)); }
        },
      },
    ]);
  }

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
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.primary}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
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

            {plans.length && profile?.role === 'client' ? (
              <View style={[styles.card, { backgroundColor: theme.surface, gap: 8 }]}>
                <Text style={[styles.section, { color: theme.text }]}>{t('memberships.title')}</Text>
                {using ? (
                  <Text style={{ color: theme.text, fontSize: 15 }}>
                    {t('memberships.usesYours', { name: using.name })} {planText.left(using)}
                  </Text>
                ) : blocking ? (
                  <Muted theme={theme}>{t('memberships.oneAtATime')}</Muted>
                ) : plans.map((p) => {
                  const asked = mine.some((m) => m.plan_id === p.id && m.status === 'pending');
                  return (
                    <View key={p.id} style={{ gap: 4 }}>
                      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{p.name}</Text>
                      <Text style={{ color: theme.muted, fontSize: 14 }}>
                        {[planText.summary(p.classes, p.valid_days), p.price_cents ? planText.price(p.price_cents, p.currency) : '']
                          .filter(Boolean).join(' · ')}
                      </Text>
                      <Button theme={theme} kind="secondary" label={asked ? t('memberships.requested') : t('memberships.want')}
                        disabled={asked} onPress={() => want(p)} />
                    </View>
                  );
                })}
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
  section: { fontSize: 17, fontWeight: '700' },
});
