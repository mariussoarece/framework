// Client path: join with a code, or continue with the default organization.
import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Button, Field, Message, Screen, Title } from '../../src/components/ui';
import { useI18n } from '../../src/i18n/I18nProvider';
import { supabase } from '../../src/lib/supabase';
import { useSession } from '../../src/lib/session';

type Found = { id: string; name: string; join_code: string; is_default: boolean };

export default function ClientOnboarding() {
  const { t, tError } = useI18n();
  const { profile, org, refresh, setPendingRole, signOut } = useSession();
  const [code, setCode] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [fallback, setFallback] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wasClosed = Boolean(profile && (!profile.organization_id || org?.status === 'closed'));

  useEffect(() => {
    supabase.rpc('find_organization', { p_code: null }).then(({ data }) => {
      const rows = (data as Found[] | null) ?? [];
      setFallback(rows[0] ?? null);
    });
  }, []);

  async function find() {
    setError(null); setFound(null);
    const c = code.trim().toLowerCase();
    if (!c) return;
    setBusy(true);
    const { data, error: err } = await supabase.rpc('find_organization', { p_code: c });
    setBusy(false);
    const rows = (data as Found[] | null) ?? [];
    if (err || !rows.length) setError(t('error.organization_not_found'));
    else setFound(rows[0]);
  }

  async function join(joinCode: string | null) {
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.rpc('join_organization', { p_code: joinCode });
      if (err) throw err;
      await setPendingRole(null);
      await refresh();
      router.replace('/');
    } catch (err) {
      setError(tError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>{t('client.title')}</Title>
      {wasClosed && fallback ? <Message kind="info" text={t('client.closed', { name: fallback.name })} /> : null}
      <Message text={error} />
      <Field label={t('client.code')} hint={t('client.codeHint')} value={code}
        onChangeText={(v) => { setCode(v); setFound(null); }}
        autoCapitalize="none" autoCorrect={false} onSubmitEditing={find} returnKeyType="search" />
      {found
        ? <Button label={t('client.join', { name: found.name })} onPress={() => join(found.join_code)} busy={busy} />
        : <Button label={t('client.find')} onPress={find} busy={busy} disabled={!code.trim()} />}
      {fallback
        ? <Button kind="secondary" label={t('client.default', { name: fallback.name })} onPress={() => join(null)} disabled={busy} />
        : null}
      <Button kind="link" label={t('settings.signOut')} onPress={async () => { await signOut(); router.replace('/'); }} />
    </Screen>
  );
}
