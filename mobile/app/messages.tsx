// Messages from the organization. The owner writes one (it goes to every client as a push
// notification) and sees the ones sent; clients read them here too.
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Button, Field, Message, Muted, Screen } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';
import { listAnnouncements, sendAnnouncement, type Announcement } from '../src/lib/data';
import { useSession } from '../src/lib/session';
import { themeFor } from '../src/theme/themes';

export default function Messages() {
  const { t, tError, language } = useI18n();
  const { profile, home } = useSession();
  const theme = themeFor(home?.theme_key);
  const isOwner = profile?.role === 'owner';
  const [list, setList] = useState<Announcement[] | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.organization_id) return;
    try { setList(await listAnnouncements(profile.organization_id)); } catch (err) { setError(tError(err)); }
  }, [profile?.organization_id, tError]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function confirmSend() {
    Alert.alert(t('messages.confirmTitle'), t('messages.confirmText'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('messages.send'), onPress: send },
    ]);
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await sendAnnouncement(title, body);
      setTitle(''); setBody('');
      Alert.alert(t('messages.sentTitle'), t('messages.sentText'));
      await load();
    } catch (err) {
      Alert.alert(t('save.notSaved'), tError(err));
    } finally {
      setBusy(false);
    }
  }

  const when = (iso: string) => new Date(iso).toLocaleString(language === 'ro' ? 'ro-RO' : 'en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <Screen header theme={theme}>
      {isOwner ? (
        <View style={{ gap: 10 }}>
          <Muted theme={theme}>{t('messages.ownerIntro')}</Muted>
          <Field theme={theme} label={t('messages.titleLabel')} value={title} onChangeText={setTitle} maxLength={80} />
          <Field theme={theme} label={t('messages.bodyLabel')} value={body} onChangeText={setBody} multiline maxLength={500}
            style={{ minHeight: 140 }} hint={`${body.length}/500`} />
          <Button theme={theme} label={t('messages.send')} onPress={confirmSend} busy={busy}
            disabled={!title.trim() || !body.trim()} />
        </View>
      ) : null}
      <Message text={error} />
      <Text style={[styles.heading, { color: theme.text }]}>{isOwner ? t('messages.sentList') : t('messages.title')}</Text>
      {list && !list.length ? <Muted theme={theme}>{t('messages.none')}</Muted> : null}
      {(list ?? []).map((a) => (
        <View key={a.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.text }]}>{a.title}</Text>
          <Text style={{ color: theme.text, fontSize: 16, lineHeight: 22 }}>{a.body}</Text>
          <Text style={{ color: theme.muted, fontSize: 13 }}>{when(a.created_at)}</Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 18, fontWeight: '700', marginTop: 12 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 6 },
  title: { fontSize: 17, fontWeight: '700' },
});
