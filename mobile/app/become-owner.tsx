// Client: how to open your own organization. An account is either a client of one
// organization or the owner of one, so there are two ways (see the texts).
import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Muted, Screen } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';
import { api } from '../src/lib/api';
import { useSession } from '../src/lib/session';
import { themeFor } from '../src/theme/themes';

export default function BecomeOwner() {
  const { t, tError } = useI18n();
  const { home, org, signOut } = useSession();
  const theme = themeFor(home?.theme_key);
  const orgName = org?.name ?? '';

  async function goSignOut() {
    await signOut();
    router.replace('/');
  }

  function confirmDelete() {
    Alert.alert(t('becomeOwner.deleteTitle'), t('becomeOwner.deleteText', { org: orgName }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive', onPress: async () => {
          try {
            await api.deleteAccount();
            await signOut();
            Alert.alert(t('settings.deleted'), t('becomeOwner.afterDelete'));
            router.replace('/');
          } catch (err) {
            Alert.alert(t('save.notSaved'), tError(err));
          }
        },
      },
    ]);
  }

  const card = [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }];
  const text = [styles.text, { color: theme.text }];
  return (
    <Screen header theme={theme}>
      <Text style={text}>{t('becomeOwner.intro')}</Text>

      <View style={card}>
        <Text style={[styles.h, { color: theme.text }]}>{t('becomeOwner.way1Title')}</Text>
        <Text style={text}>{t('becomeOwner.way1Steps')}</Text>
        <Muted theme={theme}>{t('becomeOwner.way1Note')}</Muted>
        <Button theme={theme} kind="secondary" label={t('settings.signOut')} onPress={goSignOut} />
      </View>

      <View style={card}>
        <Text style={[styles.h, { color: theme.text }]}>{t('becomeOwner.way2Title')}</Text>
        <Text style={text}>{t('becomeOwner.way2Steps')}</Text>
        <Muted theme={theme}>{t('becomeOwner.way2Note', { org: orgName })}</Muted>
        <Button theme={theme} kind="danger" label={t('settings.delete')} onPress={confirmDelete} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  h: { fontSize: 18, fontWeight: '700' },
  text: { fontSize: 16, lineHeight: 23 },
});
