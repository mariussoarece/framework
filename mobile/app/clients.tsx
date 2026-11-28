// Owner: the clients of the organization, with name, email, phone and bookings.
// Tap an email or phone number to write or call.
import React, { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Loading, Message, Muted, Screen } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';
import { myClients, type ClientRow } from '../src/lib/data';
import { useSession } from '../src/lib/session';
import { themeFor } from '../src/theme/themes';

export default function Clients() {
  const { t, tError, language } = useI18n();
  const { home } = useSession();
  const theme = themeFor(home?.theme_key);
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useFocusEffect(useCallback(() => {
    myClients().then(setRows).catch((err) => setError(tError(err)));
  }, [tError]));

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!rows || !q) return rows ?? [];
    return rows.filter((c) => [c.display_name, c.email, c.phone].some((v) => v?.toLowerCase().includes(q)));
  }, [rows, query]);

  const date = (iso: string) => new Date(iso).toLocaleDateString(language === 'ro' ? 'ro-RO' : 'en-GB',
    { day: 'numeric', month: 'short', year: 'numeric' });

  if (!rows && !error) return <Loading theme={theme} />;

  return (
    <Screen header theme={theme}>
      <Message text={error} />
      {rows ? <Text style={[styles.total, { color: theme.text }]}>{t('clients.total', { n: rows.length })}</Text> : null}
      {rows && rows.length > 5 ? (
        <TextInput value={query} onChangeText={setQuery} placeholder={t('clients.search')} placeholderTextColor={theme.muted}
          autoCapitalize="none" autoCorrect={false}
          style={[styles.search, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} />
      ) : null}
      {rows && !rows.length ? <Muted theme={theme}>{t('clients.none')}</Muted> : null}

      {shown.map((c) => (
        <View key={c.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.name, { color: theme.text }]}>{c.display_name || c.email || '—'}</Text>
          {c.email ? (
            <Pressable onPress={() => Linking.openURL(`mailto:${c.email}`)} style={styles.line} accessibilityRole="link">
              <Ionicons name="mail-outline" size={18} color={theme.primary} />
              <Text style={{ color: theme.primary, fontSize: 15 }}>{c.email}</Text>
            </Pressable>
          ) : null}
          {c.phone ? (
            <Pressable onPress={() => Linking.openURL(`tel:${c.phone!.replace(/[^0-9+]/g, '')}`)} style={styles.line}
              accessibilityRole="link">
              <Ionicons name="call-outline" size={18} color={theme.primary} />
              <Text style={{ color: theme.primary, fontSize: 15 }}>{c.phone}</Text>
            </Pressable>
          ) : null}
          <Text style={{ color: theme.text, fontSize: 15 }}>
            {t('clients.booked', { n: c.booked })}
            {c.upcoming ? ` · ${t('clients.upcoming', { n: c.upcoming })}` : ''}
            {c.pending ? ` · ${t('clients.pending', { n: c.pending })}` : ''}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 13 }}>{t('clients.since', { date: date(c.joined_at) })}</Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: { fontSize: 18, fontWeight: '700' },
  search: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 6 },
  name: { fontSize: 17, fontWeight: '700' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
});
