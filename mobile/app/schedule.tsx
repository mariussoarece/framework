// Placeholder: built in a later step.
import React from 'react';
import { Muted, Screen } from '../src/components/ui';
import { useI18n } from '../src/i18n/I18nProvider';
import { useSession } from '../src/lib/session';
import { themeFor } from '../src/theme/themes';

export default function Placeholder() {
  const { t } = useI18n();
  const { home } = useSession();
  const theme = themeFor(home?.theme_key);
  return (
    <Screen header theme={theme}>
      <Muted theme={theme}>{t('common.comingSoon')}</Muted>
    </Screen>
  );
}
