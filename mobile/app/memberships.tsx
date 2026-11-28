// Memberships (like gym passes), paid at the location.
//  Owner:  requests to approve, the plans offered (add / edit / stop offering), active memberships.
//  Client: their memberships (what is left, until when) and the plans they can ask for.
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Button, Choice, Field, Message, Muted, Screen } from '../src/components/ui';
import { OptionField } from '../src/components/pickers';
import { Card, CardTitle, usePlanText } from '../src/components/PlanCard';
import { useI18n } from '../src/i18n/I18nProvider';
import {
  cancelMembership, decideMembership, listMemberships, listPlans, requestMembership, savePlan,
  type MembershipPlan, type MembershipRow,
} from '../src/lib/data';
import { positiveInt } from '../src/lib/format';
import { refreshBadge } from '../src/lib/push';
import { CURRENCIES, parseMoney } from '../src/lib/schedule';
import { useSession } from '../src/lib/session';
import { themeFor } from '../src/theme/themes';

type PlanForm = {
  id?: string; name: string; description: string; price: string; currency: string;
  unlimited: boolean; classes: string; days: string; active: boolean;
};

export default function Memberships() {
  const { t, tError, language } = useI18n();
  const { profile, org, home } = useSession();
  const theme = themeFor(home?.theme_key);
  const isOwner = profile?.role === 'owner';
  const text = usePlanText();
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [rows, setRows] = useState<MembershipRow[]>([]);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.organization_id) return;
    try {
      const [p, m] = await Promise.all([listPlans(profile.organization_id), listMemberships()]);
      setPlans(p); setRows(m);
    } catch (err) {
      setError(tError(err));
    }
  }, [profile?.organization_id, tError]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try { await fn(); } catch (err) { Alert.alert(t('schedule.notPossible'), tError(err)); }
    setBusy(null);
    await load();
    refreshBadge();
  }

  // ---------------------------------------------------------------- owner: plan form
  const newForm = (): PlanForm => ({
    name: '', description: '', price: '', currency: plans[plans.length - 1]?.currency ?? (language === 'ro' ? 'RON' : 'EUR'),
    unlimited: false, classes: '8', days: '30', active: true,
  });
  const editForm = (p: MembershipPlan): PlanForm => ({
    id: p.id, name: p.name, description: p.description ?? '',
    price: p.price_cents ? (p.price_cents / 100).toFixed(p.price_cents % 100 ? 2 : 0) : '',
    currency: p.currency, unlimited: p.classes === null, classes: String(p.classes ?? 8), days: String(p.valid_days),
    active: p.active,
  });

  async function saveForm() {
    if (!form) return;
    if (!form.name.trim()) return Alert.alert(t('save.notSaved'), t('memberships.nameMissing'));
    const price = form.price.trim() ? parseMoney(form.price) : 0;
    const classes = form.unlimited ? null : positiveInt(form.classes);
    const days = positiveInt(form.days);
    if (price === null || (!form.unlimited && (!classes || classes > 500)) || !days || days > 730) {
      return Alert.alert(t('save.notSaved'), t('workout.invalidNumbers'));
    }
    await act('form', async () => {
      await savePlan({
        id: form.id, name: form.name.trim(), description: form.description.trim(), price_cents: price,
        currency: form.currency, classes, valid_days: days, active: form.active,
      });
      setForm(null);
    });
  }

  const pending = rows.filter((m) => m.status === 'pending');
  // a client can have one membership at a time (waiting, or active with classes left)
  const blocking = !isOwner && rows.some((m) => m.status === 'pending'
    || (m.status === 'active' && !m.expired && (m.remaining === null || m.remaining > 0)));
  const current = rows.filter((m) => m.status === 'active' && !m.expired);
  const past = rows.filter((m) => m.status !== 'pending' && !(m.status === 'active' && !m.expired));
  const statusBadge = (m: MembershipRow): [string, 'ok' | 'wait' | 'off'] =>
    m.status === 'pending' ? [t('memberships.status.pending'), 'wait']
      : m.status === 'active' && !m.expired ? [t('memberships.status.active'), 'ok']
        : m.status === 'active' ? [t('memberships.status.expired'), 'off']
          : [t(`memberships.status.${m.status}` as never), 'off'];

  const h = (s: string) => <Text style={[styles.h, { color: theme.text }]}>{s}</Text>;

  return (
    <Screen header theme={theme} onRefresh={load}>
      <Message text={error} />
      <Muted theme={theme}>{isOwner ? t('memberships.ownerIntro') : t('memberships.clientIntro', { org: org?.name ?? '' })}</Muted>

      {/* ------------------------------------------------ owner */}
      {isOwner ? (
        <>
          {pending.length ? h(t('memberships.requests')) : null}
          {pending.map((m) => (
            <Card key={m.id} theme={theme}>
              <CardTitle theme={theme} text={m.client_name} badge={t('memberships.status.pending')} badgeKind="wait" />
              <Text style={{ color: theme.text, fontSize: 15 }}>{m.name} · {text.summary(m.classes, m.valid_days ?? 0)}</Text>
              <Muted theme={theme}>{text.price(m.price_cents, m.currency)}</Muted>
              <View style={styles.pair}>
                <View style={{ flex: 1 }}>
                  <Button theme={theme} kind="secondary" label={t('memberships.decline')} busy={busy === `d${m.id}`}
                    onPress={() => act(`d${m.id}`, () => decideMembership(m.id, false))} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button theme={theme} label={t('memberships.approve')} busy={busy === `a${m.id}`}
                    onPress={() => act(`a${m.id}`, () => decideMembership(m.id, true))} />
                </View>
              </View>
            </Card>
          ))}

          {h(t('memberships.plans'))}
          {!plans.length && !form ? <Muted theme={theme}>{t('memberships.noPlans')}</Muted> : null}
          {plans.map((p) => (form?.id === p.id ? null : (
            <Card key={p.id} theme={theme}>
              <CardTitle theme={theme} text={p.name} badge={p.active ? undefined : t('memberships.notOffered')} badgeKind="off" />
              <Text style={{ color: theme.text, fontSize: 15 }}>{text.summary(p.classes, p.valid_days)}</Text>
              {p.price_cents ? <Muted theme={theme}>{text.price(p.price_cents, p.currency)}</Muted> : null}
              {p.description ? <Text style={{ color: theme.text }}>{p.description}</Text> : null}
              <Button theme={theme} kind="secondary" label={t('common.edit')} onPress={() => setForm(editForm(p))} />
            </Card>
          )))}

          {form ? (
            <Card theme={theme}>
              <Field theme={theme} label={t('memberships.name')} value={form.name} placeholder={t('memberships.namePlaceholder')}
                onChangeText={(v) => setForm({ ...form, name: v })} maxLength={60} />
              <Choice theme={theme} title={t('memberships.limited')} selected={!form.unlimited}
                onPress={() => setForm({ ...form, unlimited: false })} />
              <Choice theme={theme} title={t('memberships.unlimited')} selected={form.unlimited}
                onPress={() => setForm({ ...form, unlimited: true })} />
              <View style={styles.pair}>
                {!form.unlimited ? (
                  <View style={{ flex: 1 }}>
                    <Field theme={theme} label={t('memberships.classes')} value={form.classes} keyboardType="number-pad"
                      onChangeText={(v) => setForm({ ...form, classes: v })} maxLength={3} />
                  </View>
                ) : null}
                <View style={{ flex: 1 }}>
                  <Field theme={theme} label={t('memberships.days')} value={form.days} keyboardType="number-pad"
                    onChangeText={(v) => setForm({ ...form, days: v })} maxLength={3} />
                </View>
              </View>
              <View style={styles.pair}>
                <View style={{ flex: 1 }}>
                  <Field theme={theme} label={t('schedule.price')} value={form.price} keyboardType="decimal-pad"
                    placeholder="250" onChangeText={(v) => setForm({ ...form, price: v })} maxLength={9} />
                </View>
                <OptionField flex theme={theme} label={t('schedule.currency')}
                  value={Math.max(0, CURRENCIES.indexOf(form.currency as never))}
                  options={CURRENCIES.map((_, i) => i)} format={(i) => CURRENCIES[i]}
                  onChange={(i) => setForm({ ...form, currency: CURRENCIES[i] })} />
              </View>
              <Field theme={theme} label={t('memberships.description')} value={form.description} multiline
                onChangeText={(v) => setForm({ ...form, description: v })} maxLength={500} style={{ minHeight: 90 }} />
              {form.id ? (
                <Choice theme={theme} title={t('memberships.offered')} hint={t('memberships.offeredHint')}
                  selected={form.active} onPress={() => setForm({ ...form, active: !form.active })} />
              ) : null}
              <Muted theme={theme}>{t('memberships.linkHint')}</Muted>
              <View style={styles.pair}>
                <View style={{ flex: 1 }}><Button theme={theme} kind="secondary" label={t('common.cancel')} onPress={() => setForm(null)} /></View>
                <View style={{ flex: 1 }}><Button theme={theme} label={t('common.save')} onPress={saveForm} busy={busy === 'form'} /></View>
              </View>
            </Card>
          ) : (
            <Button theme={theme} label={t('memberships.addPlan')} onPress={() => setForm(newForm())} />
          )}

          {current.length ? h(t('memberships.active')) : null}
          {current.map((m) => (
            <Card key={m.id} theme={theme}>
              <CardTitle theme={theme} text={m.client_name} badge={t('memberships.status.active')} badgeKind="ok" />
              <Text style={{ color: theme.text, fontSize: 15 }}>{m.name}</Text>
              <Muted theme={theme}>{text.left(m)}</Muted>
              <Button theme={theme} kind="secondary" label={t('memberships.cancel')} busy={busy === `c${m.id}`}
                onPress={() => Alert.alert(t('memberships.cancel'), t('memberships.cancelConfirm', { name: m.client_name }), [
                  { text: t('schedule.keep'), style: 'cancel' },
                  { text: t('memberships.cancel'), style: 'destructive', onPress: () => act(`c${m.id}`, () => cancelMembership(m.id)) },
                ])} />
            </Card>
          ))}
        </>
      ) : null}

      {/* ------------------------------------------------ client */}
      {!isOwner ? (
        <>
          {rows.length ? h(t('memberships.mine')) : null}
          {[...pending, ...current, ...past].map((m) => {
            const [badge, kind] = statusBadge(m);
            return (
              <Card key={m.id} theme={theme}>
                <CardTitle theme={theme} text={m.name} badge={badge} badgeKind={kind} />
                {m.status === 'active' ? <Text style={{ color: theme.text, fontSize: 15 }}>{text.left(m)}</Text> : null}
                {m.status === 'pending' ? (
                  <>
                    <Muted theme={theme}>{t('memberships.waiting')}</Muted>
                    <Button theme={theme} kind="secondary" label={t('memberships.withdraw')} busy={busy === `c${m.id}`}
                      onPress={() => act(`c${m.id}`, () => cancelMembership(m.id))} />
                  </>
                ) : null}
              </Card>
            );
          })}

          {h(t('memberships.available'))}
          {blocking && plans.some((p) => p.active) ? <Muted theme={theme}>{t('memberships.oneAtATime')}</Muted> : null}
          {!plans.filter((p) => p.active).length ? <Muted theme={theme}>{t('memberships.noneOffered')}</Muted> : null}
          {plans.filter((p) => p.active).map((p) => {
            const asked = pending.some((m) => m.plan_id === p.id);
            return (
              <Card key={p.id} theme={theme}>
                <CardTitle theme={theme} text={p.name} />
                <Text style={{ color: theme.text, fontSize: 15 }}>{text.summary(p.classes, p.valid_days)}</Text>
                {p.price_cents ? <Muted theme={theme}>{text.price(p.price_cents, p.currency)}</Muted> : null}
                {p.description ? <Text style={{ color: theme.text }}>{p.description}</Text> : null}
                <Button theme={theme} label={asked ? t('memberships.requested') : t('memberships.want')} disabled={asked || blocking}
                  busy={busy === `r${p.id}`}
                  onPress={() => Alert.alert(p.name, t('memberships.wantConfirm', { org: org?.name ?? '' }), [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('memberships.want'), onPress: () => act(`r${p.id}`, () => requestMembership(p.id)) },
                  ])} />
              </Card>
            );
          })}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 19, fontWeight: '700', marginTop: 10 },
  pair: { flexDirection: 'row', gap: 10 },
});
