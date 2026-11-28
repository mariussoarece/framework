// Language, video quality, join code (owners), switch organization (clients),
// sign out and Delete my account.
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Choice, Field, Message, Muted, Screen } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';
import { LANGUAGES, type Language } from '../src/i18n/translate';
import { api } from '../src/lib/api';
import { OptionField } from '../src/components/pickers';
import { setOrganizationTimezone } from '../src/lib/data';
import { deviceTimeZone, TIME_ZONES } from '../src/lib/schedule';
import { supabase } from '../src/lib/supabase';
import { useSession } from '../src/lib/session';
import type { VideoQuality } from '../src/lib/types';

export default function Settings() {
  const { t, tError, language, setLanguage } = useI18n();
  const { session, profile, org, refresh, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // name and phone: the organization's owner sees them in "My clients"
  const [name, setName] = useState(profile?.display_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [savingDetails, setSavingDetails] = useState(false);
  const detailsChanged = name.trim() !== (profile?.display_name ?? '') || phone.trim() !== (profile?.phone ?? '');
  async function saveDetails() {
    if (!profile) return;
    const cleanPhone = phone.trim();
    if (cleanPhone && !/^[0-9+() .-]{3,30}$/.test(cleanPhone)) {
      Alert.alert(t('save.notSaved'), t('settings.phoneInvalid'));
      return;
    }
    setSavingDetails(true);
    const { error: err } = await supabase.from('profiles')
      .update({ display_name: name.trim() || null, phone: cleanPhone || null }).eq('id', profile.id);
    setSavingDetails(false);
    if (err) Alert.alert(t('save.notSaved'), tError(err));
    else { await refresh(); Alert.alert(t('settings.detailsSaved')); }
  }

  // the organization's time zone: all class times are in it
  const zones = [...new Set([org?.timezone, deviceTimeZone(), ...TIME_ZONES].filter(Boolean) as string[])];
  async function changeTimezone(tz: string) {
    if (!org || tz === org.timezone) return;
    try { await setOrganizationTimezone(org.id, tz); await refresh(); } catch (err) { Alert.alert(t('save.notSaved'), tError(err)); }
  }

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
    <Screen header onRefresh={refresh}>
      <Muted>{t('settings.account', { email: session?.user.email ?? '' })}</Muted>
      <Message text={error} />

      {profile?.role === 'owner' && org ? (
        <Message kind="info" text={t('settings.joinCode', { code: org.join_code })} />
      ) : null}

      {profile && profile.role !== 'super_admin' ? (
        <View style={{ gap: 8 }}>
          <Muted style={{ fontWeight: '600' }}>{t('settings.details')}</Muted>
          <Field label={t('settings.name')} value={name} onChangeText={setName} maxLength={80}
            autoComplete="name" textContentType="name" />
          <Field label={t('settings.phone')} value={phone} onChangeText={setPhone} maxLength={30}
            keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
            hint={profile.role === 'client' ? t('settings.detailsHint') : undefined} />
          {detailsChanged ? (
            <Button label={t('settings.saveDetails')} onPress={saveDetails} busy={savingDetails} />
          ) : null}
        </View>
      ) : null}

      {profile?.role === 'owner' && org ? (
        <OptionField label={t('settings.timezone')} value={Math.max(0, zones.indexOf(org.timezone))}
          options={zones.map((_, i) => i)} format={(i) => zones[i].replace(/_/g, ' ')}
          onChange={(i) => changeTimezone(zones[i])} />
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
        {profile?.role === 'owner' ? (
          <Button kind="secondary" label={t('clients.button')} onPress={() => router.push('/clients')} />
        ) : null}
        {profile?.role === 'owner' || profile?.role === 'client' ? (
          <Button kind="secondary" label={t('memberships.title')} onPress={() => router.push('/memberships')} />
        ) : null}
        {profile?.role === 'owner' || profile?.role === 'client' ? (
          <Button kind="secondary" label={profile.role === 'owner' ? t('messages.ownerButton') : t('messages.clientButton')}
            onPress={() => router.push('/messages')} />
        ) : null}
        {profile?.role === 'client' ? (
          <>
            <Button kind="secondary" label={t('settings.switchOrg')} onPress={() => router.push('/onboarding/client')} />
            <Button kind="secondary" label={t('settings.becomeOwner')} onPress={() => router.push('/become-owner')} />
          </>
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
