// Owner path: name the organization and choose how clients pay.
import React, { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Button, Choice, Field, Message, Muted, Screen, Title } from '../../src/components/ui';
import { useI18n } from '../../src/i18n/I18nProvider';
import { supabase } from '../../src/lib/supabase';
import { useSession } from '../../src/lib/session';
import type { Plan } from '../../src/lib/types';

export default function OwnerOnboarding() {
  const { t, tError } = useI18n();
  const { profile, org, refresh, setPendingRole, signOut } = useSession();
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<Plan>('commission');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // already owns an organization (e.g. signed in again after choosing "I run a business")
  if (profile?.organization_id && org && org.status !== 'closed') return <Redirect href="/" />;

  async function create() {
    setError(null);
    if (name.trim().length < 2) return setError(t('owner.nameHint'));
    setBusy(true);
    try {
      const { error: err } = await supabase.rpc('create_organization', { p_name: name.trim(), p_plan: plan });
      if (err) throw err;
      await setPendingRole(null);
      await refresh();
      router.replace('/');
    } catch (err) {
      if (String((err as Error)?.message).includes('already_owner')) {
        await refresh();
        router.replace('/');
        return;
      }
      setError(tError(err));
    } finally {
      setBusy(false);
    }
  }

  const plans: { key: Plan; title: string; hint: string }[] = [
    { key: 'commission', title: t('owner.plan.commission'), hint: t('owner.plan.commissionHint') },
    { key: 'flat', title: t('owner.plan.flat'), hint: t('owner.plan.flatHint') },
    { key: 'none', title: t('owner.plan.none'), hint: t('owner.plan.noneHint') },
  ];

  return (
    <Screen>
      <Title>{t('owner.title')}</Title>
      <Message text={error} />
      <Field label={t('owner.name')} hint={t('owner.nameHint')} value={name} onChangeText={setName}
        autoCapitalize="words" maxLength={60} />
      <Muted style={{ fontWeight: '600', marginTop: 8 }}>{t('owner.plan')}</Muted>
      {plans.map((p) => (
        <Choice key={p.key} title={p.title} hint={p.hint} selected={plan === p.key} onPress={() => setPlan(p.key)} />
      ))}
      <Message kind="info" text={t('owner.freeMonth')} />
      <Button label={t('owner.create')} onPress={create} busy={busy} />
      <Button kind="link" label={t('settings.signOut')} onPress={async () => { await signOut(); router.replace('/'); }} />
    </Screen>
  );
}
