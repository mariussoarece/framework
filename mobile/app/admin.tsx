// Super admin area. Media approval and organization management come in a later step.
import React from 'react';
import { router } from 'expo-router';
import { Button, Muted, Screen, Title } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';

export default function Admin() {
  const { t } = useI18n();
  return (
    <Screen>
      <Title>{t('admin.title')}</Title>
      <Muted>{t('common.comingSoon')}</Muted>
      <Button kind="secondary" label={t('settings.title')} onPress={() => router.push('/settings')} />
    </Screen>
  );
}
