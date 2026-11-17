import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import type { TextKey } from './en';
import { errorText, pickLanguage, translate, type Language } from './translate';

const STORAGE_KEY = 'language';

type I18n = {
  language: Language;
  setLanguage: (l: Language) => void;
  t: (key: TextKey, vars?: Record<string, string | number>) => string;
  tError: (err: unknown) => string;
};

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<Language>(() => pickLanguage(getLocales()[0]?.languageCode));

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved) setLang(pickLanguage(saved));
    });
  }, []);

  const setLanguage = useCallback((l: Language) => {
    setLang(l);
    AsyncStorage.setItem(STORAGE_KEY, l);
  }, []);

  const value = useMemo<I18n>(() => ({
    language,
    setLanguage,
    t: (key, vars) => translate(language, key, vars),
    tError: (err) => errorText(language, err),
  }), [language, setLanguage]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
