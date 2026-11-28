// A membership plan or a client's membership, as a card. Used in Memberships and on the class screen.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider';
import type { MembershipRow } from '../lib/data';
import { dayLabel, formatMoney } from '../lib/schedule';
import type { Theme } from '../theme/themes';

export function usePlanText() {
  const { t, language } = useI18n();
  return {
    // "8 classes · 30 days" / "Unlimited classes · 30 days"
    summary: (classes: number | null, days: number) =>
      `${classes === null ? t('memberships.unlimited') : t('memberships.classesN', { n: classes })} · ${t('memberships.daysN', { n: days })}`,
    price: (cents: number, currency: string) =>
      cents > 0 ? `${formatMoney(cents, currency, language)} · ${t('class.paidAtStudio')}` : '',
    // "5 of 8 left · until Thursday 31 December"
    left: (m: MembershipRow) => [
      m.classes === null ? t('memberships.unlimitedLeft') : t('memberships.left', { n: m.remaining ?? 0, total: m.classes }),
      m.ends_on ? t('memberships.until', { date: dayLabel(m.ends_on, language) }) : '',
    ].filter(Boolean).join(' · '),
  };
}

export function Card({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>{children}</View>;
}

export function CardTitle({ theme, text, badge, badgeKind }: {
  theme: Theme; text: string; badge?: string; badgeKind?: 'ok' | 'wait' | 'off';
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.title, { color: theme.text }]}>{text}</Text>
      {badge ? (
        <Text style={[styles.badge, badgeKind === 'ok' ? styles.ok : badgeKind === 'wait' ? styles.wait : styles.off]}>{badge}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '700', flex: 1 },
  badge: { fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  ok: { color: '#1B5E20', backgroundColor: '#E3F2E1' },
  wait: { color: '#7A4100', backgroundColor: '#FFF4E5' },
  off: { color: '#5F5F5F', backgroundColor: '#ECECEC' },
});
