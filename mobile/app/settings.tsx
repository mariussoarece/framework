// Language, video quality, join code (owners), switch organization (clients),
// sign out and Delete my account.
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Choice, Message, Muted, Screen } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';
import { LANGUAGES, type Language } from '../src/i18n/translate';
import { api } from '../src/lib/api';
import { supabase } from '../src/lib/supabase';
import { useSession } from '../src/lib/session';
import type { VideoQuality } from '../src/lib/types';

export default function Settings() {
  const { t, tError, language, setLanguage } = useI18n();
  const { session, profile, org, refresh, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveProfile(patch: Partial<{ language: Language; video_quality: VideoQuality }>) {
    if (!profile) return;
    const { error: err } = await supabase.from('profiles').update(patch).eq('id', profile.id);
    if (err) setError(tError(err));
    else await refresh();
  }

  function changeLanguage(l: Language) {
    setLanguage(l);
    saveProfile({ language: l });
  }

  function confirmDelete() {
    Alert.alert(
      t('settings.deleteTitle'),
      profile?.role === 'owner' ? t('settings.deleteOwner') : t('settings.deleteClient'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: deleteAccount },
      ],
    );
  }

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      await signOut();
      Alert.alert(t('settings.deleted'));
      router.replace('/');
    } catch (err) {
      setError(tError(err));
    } finally {
      setBusy(false);
    }
  }

  const qualities: { key: VideoQuality; title: string; hint?: string }[] = [
    { key: 'auto', title: t('settings.quality.auto'), hint: t('settings.quality.autoHint') },
    { key: '720', title: '720p' },
    { key: '1080', title: '1080p' },
  ];

  return (
    <Screen header>
      <Muted>{t('settings.account', { email: session?.user.email ?? '' })}</Muted>
      <Message text={error} />

      {profile?.role === 'owner' && org ? (
        <Message kind="info" text={t('settings.joinCode', { code: org.join_code })} />
      ) : null}

      <Muted style={{ fontWeight: '600' }}>{t('settings.language')}</Muted>
      {LANGUAGES.map((l) => (
        <Choice key={l.code} title={l.label} selected={language === l.code} onPress={() => changeLanguage(l.code)} />
      ))}

      {profile ? (
        <>
          <Muted style={{ fontWeight: '600', marginTop: 8 }}>{t('settings.videoQuality')}</Muted>
          {qualities.map((q) => (
            <Choice key={q.key} title={q.title} hint={q.hint} selected={profile.video_quality === q.key}
              onPress={() => saveProfile({ video_quality: q.key })} />
          ))}
        </>
      ) : null}

      <View style={{ gap: 12, marginTop: 16 }}>
        {profile?.role === 'client' ? (
          <Button kind="secondary" label={t('settings.switchOrg')} onPress={() => router.push('/onboarding/client')} />
        ) : null}
        <Button kind="secondary" label={t('settings.signOut')}
          onPress={async () => { await signOut(); router.replace('/'); }} />
        {profile?.role !== 'super_admin' ? (
          <Button kind="danger" label={t('settings.delete')} onPress={confirmDelete} busy={busy} />
        ) : null}
      </View>
    </Screen>
  );
}
