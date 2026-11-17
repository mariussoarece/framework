// First launch: "Client" or "Owner".
import React from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Muted, Screen, Title } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';
import { LANGUAGES } from '../src/i18n/translate';
import { useSession, type PendingRole } from '../src/lib/session';
import { DEFAULT_THEME as theme } from '../src/theme/themes';

export default function Welcome() {
  const { t, language, setLanguage } = useI18n();
  const { session, setPendingRole } = useSession();

  async function choose(role: PendingRole) {
    await setPendingRole(role);
    router.push(session ? `/onboarding/${role}` : `/auth?role=${role}`);
  }

  const Option = ({ role, icon, title, hint }: { role: PendingRole; icon: string; title: string; hint: string }) => (
    <Pressable accessibilityRole="button" onPress={() => choose(role)}
      style={({ pressed }) => [styles.option, { opacity: pressed ? 0.85 : 1 }]}>
      <Ionicons name={icon as never} size={32} color={theme.primary} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Muted>{hint}</Muted>
      </View>
      <Ionicons name="chevron-forward" size={22} color={theme.muted} />
    </Pressable>
  );

  return (
    <Screen>
      <View style={styles.langRow}>
        {LANGUAGES.map((l) => (
          <Pressable key={l.code} onPress={() => setLanguage(l.code)} accessibilityRole="button"
            accessibilityState={{ selected: language === l.code }}>
            <Text style={[styles.lang, language === l.code && styles.langOn]}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ gap: 8, marginTop: 24 }}>
        <Title>{t('welcome.title')}</Title>
        <Muted>{t('welcome.subtitle')}</Muted>
      </View>
      <Option role="client" icon="person-outline" title={t('welcome.client')} hint={t('welcome.clientHint')} />
      <Option role="owner" icon="briefcase-outline" title={t('welcome.owner')} hint={t('welcome.ownerHint')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  langRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16 },
  lang: { fontSize: 15, color: theme.muted, paddingVertical: 6 },
  langOn: { color: theme.text, fontWeight: '700' },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: 16,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: theme.border,
  },
  optionTitle: { fontSize: 19, fontWeight: '700', color: theme.text },
});
