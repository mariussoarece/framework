// Login and database client. Talks to your VPS:
//   <API_URL>/auth/v1  (login service)   <API_URL>/rest/v1  (database API)
import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { ANON_KEY, API_URL } from './config';

export const supabase = createClient(API_URL || 'https://invalid.local', ANON_KEY || 'missing', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Keep the login fresh only while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
