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

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      setProfile(null); setOrg(null); setHome(null); setButtons([]);
      return;
    }
    const { data: p, error } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
    if (error) throw error;
    setProfile(p as Profile | null);
    if (p?.language) setLanguage(pickLanguage(p.language));

    if (p?.organization_id) {
      const [o, h, b] = await Promise.all([
        supabase.from('organizations').select('*').eq('id', p.organization_id).single(),
        supabase.from('home_settings').select('*').eq('organization_id', p.organization_id).maybeSingle(),
        supabase.from('home_buttons').select('*').eq('organization_id', p.organization_id).order('position'),
      ]);
      setOrg((o.data as Organization) ?? null);
      setHome((h.data as HomeSettings) ?? null);
      setButtons((b.data as HomeButton[]) ?? []);
    } else {
      setOrg(null); setHome(null); setButtons([]);
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
    ready, session, profile, org, home, buttons, pendingRole,
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
  }), [ready, session, profile, org, home, buttons, pendingRole, load]);

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
