// Sign in / create account / forgot password.
import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Field, Message, Muted, Screen, Title } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';
import { supabase } from '../src/lib/supabase';
import { useSession } from '../src/lib/session';

const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export default function Auth() {
  const { t, tError } = useI18n();
  const params = useLocalSearchParams<{ role?: string }>();
  const { refresh } = useSession();
  const [mode, setMode] = useState<'signIn' | 'signUp'>(params.role === 'owner' ? 'signUp' : 'signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit() {
    setError(null); setInfo(null);
    const e = email.trim().toLowerCase();
    if (!validEmail(e)) return setError(t('auth.emailInvalid'));
    if (password.length < 8) return setError(t('auth.passwordShort'));
    setBusy(true);
    try {
      if (mode === 'signIn') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: e, password });
        if (err) throw err;
        await refresh();
        router.replace('/');
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email: e, password });
        if (err) throw err;
        if (data.session) { await refresh(); router.replace('/'); }
        else { setInfo(t('auth.checkEmail')); setMode('signIn'); }
      }
    } catch (err) {
      setError(tError(err));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    setError(null); setInfo(null);
    const e = email.trim().toLowerCase();
    if (!validEmail(e)) return setError(t('auth.emailInvalid'));
    setBusy(true);
    try {
      await supabase.auth.resetPasswordForEmail(e);
      setInfo(t('auth.resetSent'));
    } catch (err) {
      setError(tError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>{mode === 'signIn' ? t('auth.signIn') : t('auth.signUp')}</Title>
      <Message text={info} kind="info" />
      <Message text={error} />
      <Field label={t('auth.email')} value={email} onChangeText={setEmail}
        autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry
        autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
        textContentType={mode === 'signIn' ? 'password' : 'newPassword'} onSubmitEditing={submit} />
      <Button label={mode === 'signIn' ? t('auth.signIn') : t('auth.signUp')} onPress={submit} busy={busy} />
      <Button kind="link" label={mode === 'signIn' ? t('auth.toSignUp') : t('auth.toSignIn')}
        onPress={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setError(null); }} />
      {mode === 'signIn' ? <Button kind="link" label={t('auth.forgot')} onPress={forgot} /> : null}
      <Muted>{' '}</Muted>
      <Button kind="link" label={t('common.back')} onPress={() => router.back()} />
    </Screen>
  );
}
