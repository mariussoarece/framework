// Client: report a workout (inappropriate, dangerous, copied, other). Required by Apple
// for apps where users publish content; the super admin is notified and decides.
import React, { useState } from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Choice, Field, Message, Muted, Screen } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';
import { REPORT_REASONS, reportWorkout, type ReportReason } from '../src/lib/data';
import { useSession } from '../src/lib/session';
import { themeFor } from '../src/theme/themes';

export default function Report() {
  const { workout, name } = useLocalSearchParams<{ workout: string; name?: string }>();
  const { t, tError } = useI18n();
  const { profile, home } = useSession();
  const theme = themeFor(home?.theme_key);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!reason || !profile?.organization_id) return;
    setBusy(true);
    setError(null);
    try {
      // stored in English for the administrator; details as typed
      const label = { inappropriate: 'Inappropriate', dangerous: 'Dangerous instructions', copyright: 'Copyright', other: 'Other' }[reason];
      await reportWorkout(profile.organization_id, workout, profile.id, details.trim() ? `${label}: ${details.trim()}` : label);
      Alert.alert(t('report.thanks'));
      router.back();
    } catch (err) {
      setError(tError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header theme={theme}>
      <Muted theme={theme}>{t('report.intro', { name: name ?? '' })}</Muted>
      <Message text={error} />
      {REPORT_REASONS.map((r) => (
        <Choice key={r} theme={theme} title={t(`report.reason.${r}` as never)} selected={reason === r} onPress={() => setReason(r)} />
      ))}
      <Field theme={theme} label={t('report.details')} value={details} onChangeText={setDetails} multiline maxLength={800} />
      <Button theme={theme} label={t('report.send')} onPress={send} busy={busy} disabled={!reason} />
    </Screen>
  );
}
