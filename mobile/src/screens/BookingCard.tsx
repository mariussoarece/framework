// One booking: day, time, status; optional client name and buttons.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { useI18n } from '../i18n/I18nProvider';
import type { Booking } from '../lib/data';
import { clock, dayKey, dayLabel, formatMoney } from '../lib/schedule';
import type { Theme } from '../theme/themes';

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#FFF4E5', fg: '#7A4100' },
  awaitingPayment: { bg: '#FFF4E5', fg: '#7A4100' },
  accepted: { bg: '#E8F2EC', fg: '#1E4D36' },
  declined: { bg: '#F1F1F1', fg: '#555555' },
  cancelled: { bg: '#F1F1F1', fg: '#555555' },
};

export function BookingCard({ booking: b, tz, theme, showClient, onAccept, onDecline, onCancel }: {
  booking: Booking; tz: string; theme: Theme; showClient?: boolean;
  onAccept?: () => void; onDecline?: () => void; onCancel?: () => void;
}) {
  const { t, language } = useI18n();
  const waitingPay = b.status === 'pending' && b.payment_status === 'requires_payment';
  const statusKey = waitingPay ? 'awaitingPayment' : b.status;
  const colors = STATUS_COLOR[statusKey];
  const client = b.profiles?.display_name || b.profiles?.email || t('schedule.client');

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.top}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.day, { color: theme.text }]}>{dayLabel(dayKey(b.starts_at, tz), language)}</Text>
          <Text style={{ color: theme.text, fontSize: 16 }}>
            {clock(b.starts_at, tz, language)}–{clock(b.ends_at, tz, language)}
            {b.price_cents > 0 ? `  ·  ${formatMoney(b.price_cents, b.currency, language)}` : ''}
          </Text>
          {showClient ? <Text style={{ color: theme.muted, fontSize: 15 }}>{client}</Text> : null}
        </View>
        <Text style={[styles.badge, { backgroundColor: colors.bg, color: colors.fg }]}>
          {t(`schedule.status.${statusKey}` as never)}
        </Text>
      </View>
      {onAccept || onDecline ? (
        <View style={styles.row}>
          {onDecline ? <View style={{ flex: 1 }}><Button theme={theme} kind="secondary" label={t('schedule.decline')} onPress={onDecline} /></View> : null}
          {onAccept ? <View style={{ flex: 1 }}><Button theme={theme} label={t('schedule.accept')} onPress={onAccept} disabled={waitingPay} /></View> : null}
        </View>
      ) : null}
      {onCancel ? <Button theme={theme} kind="link" label={t('schedule.cancel')} onPress={onCancel} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  top: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  day: { fontSize: 16, fontWeight: '700', textTransform: 'capitalize' },
  badge: { fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 10 },
});
