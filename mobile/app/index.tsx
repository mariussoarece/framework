// Sends the user to the right place: welcome, onboarding, home or admin.
import React from 'react';
import { Redirect } from 'expo-router';
import { Loading } from '../src/components/ui';
import { nextRoute, useSession } from '../src/lib/session';

export default function Index() {
  const s = useSession();
  if (!s.ready || s.loading) return <Loading />;
  return <Redirect href={nextRoute(s) as never} />;
}
