// Who is logged in, their profile, and their organization's home page.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { HomeButton, HomeSettings, Organization, Profile } from './types';
import { useI18n } from '../i18n/I18nProvider';
import { pickLanguage } from '../i18n/translate';

const PENDING_ROLE = 'pendingRole';
export type PendingRole = 'client' | 'owner';

type State = {
  ready: boolean;
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  org: Organization | null;
  home: HomeSettings | null;
  buttons: HomeButton[];
  pendingRole: PendingRole | null;
  setPendingRole: (r: PendingRole | null) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<State | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { setLanguage } = useI18n();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [home, setHome] = useState<HomeSettings | null>(null);
  const [buttons, setButtons] = useState<HomeButton[]>([]);
  const [pendingRole, setPending] = useState<PendingRole | null>(null);

  const [loading, setLoading] = useState(0);

  // Loads everything first, then updates all state at once, so screens never see
  // a session without its profile (that briefly sent owners to "Create organization").
  const load = useCallback(async (s: Session | null) => {
    setLoading((n) => n + 1);
    try {
      let p: Profile | null = null;
      let o: Organization | null = null;
      let h: HomeSettings | null = null;
      let b: HomeButton[] = [];
      if (s) {
        const pr = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
        if (pr.error) throw pr.error;
        p = pr.data as Profile | null;
        if (p?.organization_id) {
          const [or, hr, br] = await Promise.all([
            supabase.from('organizations').select('*').eq('id', p.organization_id).single(),
            supabase.from('home_settings').select('*').eq('organization_id', p.organization_id).maybeSingle(),
            supabase.from('home_buttons').select('*').eq('organization_id', p.organization_id).order('position'),
          ]);
          if (or.error) throw or.error;
          o = or.data as Organization;
          h = (hr.data as HomeSettings) ?? null;
          b = (br.data as HomeButton[]) ?? [];
        }
      }
      setSession(s); setProfile(p); setOrg(o); setHome(h); setButtons(b);
      if (p?.language) setLanguage(pickLanguage(p.language));
      // already set up: the "Client / Owner" choice from the welcome screen no longer matters
      if (p?.organization_id || p?.role === 'super_admin') {
        setPending(null);
        await AsyncStorage.removeItem(PENDING_ROLE);
      }
    } finally {
      setLoading((n) => n - 1);
    }
  }, [setLanguage]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const role = await AsyncStorage.getItem(PENDING_ROLE);
      if (role === 'client' || role === 'owner') setPending(role);
      const { data } = await supabase.auth.getSession();
      try { await load(data.session); } catch (e) { console.warn(e); }
      if (alive) setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        load(s).catch((e) => console.warn(e));
      } else if (event === 'TOKEN_REFRESHED') {
        setSession(s);
      }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [load]);

  const value = useMemo<State>(() => ({
    ready, loading: loading > 0, session, profile, org, home, buttons, pendingRole,
    setPendingRole: async (r) => {
      setPending(r);
      if (r) await AsyncStorage.setItem(PENDING_ROLE, r);
      else await AsyncStorage.removeItem(PENDING_ROLE);
    },
    refresh: async () => {
      const { data } = await supabase.auth.getSession();
      await load(data.session);
    },
    signOut: async () => {
      await supabase.auth.signOut();
      await AsyncStorage.removeItem(PENDING_ROLE);
      setPending(null);
      await load(null);
    },
  }), [ready, loading, session, profile, org, home, buttons, pendingRole, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): State {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

// Where the user belongs right now.
export function nextRoute(s: Pick<State, 'session' | 'profile' | 'org' | 'pendingRole'>): string {
  if (!s.session) return '/welcome';
  const p = s.profile;
  if (!p) return s.pendingRole ? `/onboarding/${s.pendingRole}` : '/welcome';
  if (p.role === 'super_admin') return '/admin';
  if (!p.organization_id || !s.org || s.org.status === 'closed') {
    return p.role === 'owner' ? '/onboarding/owner' : '/onboarding/client';
  }
  return '/home';
}
