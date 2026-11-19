// Database reads and writes for sections, workouts, the home page and approvals.
// Row-level security on the server decides what each user may see and change.
import { supabase } from './supabase';
import type { HomeButton, RichDoc } from './types';
import type { MediaRow } from './upload';

export type Section = {
  id: string;
  organization_id: string;
  name: string;
  cover_media_id: string | null;
  position: number;
};

export type Workout = {
  id: string;
  organization_id: string;
  name: string;
  sets: number | null;
  reps: number | null;
  duration_seconds: number | null;
  rest_seconds: number | null;
  description: RichDoc | null;
  warning: string | null;
  avoid: string | null;
};

export type WorkoutInput = Omit<Workout, 'id' | 'organization_id'>;

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

// ---------------------------------------------------------------- sections
export async function listSections(): Promise<Section[]> {
  return check(await supabase.from('sections').select('*').order('position').order('created_at'));
}

export async function getSection(id: string): Promise<Section | null> {
  return check(await supabase.from('sections').select('*').eq('id', id).maybeSingle());
}

export async function saveSection(
  orgId: string,
  input: { id?: string; name: string; cover_media_id: string | null },
): Promise<Section> {
  if (input.id) {
    const rows = check(await supabase.from('sections')
      .update({ name: input.name, cover_media_id: input.cover_media_id }).eq('id', input.id).select());
    return (rows as Section[])[0];
  }
  const existing = await listSections();
  const position = existing.reduce((m, s) => Math.max(m, s.position), -1) + 1;
  return check(await supabase.from('sections')
    .insert({ organization_id: orgId, name: input.name, cover_media_id: input.cover_media_id, position })
    .select().single());
}

// Deletes the section; workouts that were only in this section are deleted too.
export async function deleteSection(id: string): Promise<void> {
  const workoutIds = (await listSectionWorkouts(id)).map((w) => w.id);
  check(await supabase.from('sections').delete().eq('id', id));
  for (const wid of workoutIds) {
    if ((await workoutSectionIds(wid)).length === 0) await deleteWorkout(wid);
  }
}

// Swap a section with its neighbour (direction -1 = up, +1 = down).
export async function moveSection(sections: Section[], index: number, direction: -1 | 1): Promise<void> {
  const other = index + direction;
  if (other < 0 || other >= sections.length) return;
  const ordered = sections.map((s, i) => ({ id: s.id, position: i }));
  [ordered[index].position, ordered[other].position] = [ordered[other].position, ordered[index].position];
  for (const s of [ordered[index], ordered[other]]) {
    check(await supabase.from('sections').update({ position: s.position }).eq('id', s.id));
  }
}

// ---------------------------------------------------------------- workouts
export async function listSectionWorkouts(sectionId: string): Promise<Workout[]> {
  const rows = check(await supabase.from('section_workouts')
    .select('position, workouts(*)').eq('section_id', sectionId).order('position')) as
    unknown as { position: number; workouts: Workout | null }[];
  return rows.map((r) => r.workouts).filter((w): w is Workout => Boolean(w));
}

export async function getWorkout(id: string): Promise<Workout | null> {
  return check(await supabase.from('workouts').select('*').eq('id', id).maybeSingle());
}

export async function workoutSectionIds(workoutId: string): Promise<string[]> {
  const rows = check(await supabase.from('section_workouts').select('section_id').eq('workout_id', workoutId)) as
    { section_id: string }[];
  return rows.map((r) => r.section_id);
}

export async function workoutMedia(workoutId: string): Promise<MediaRow[]> {
  const rows = check(await supabase.from('workout_media')
    .select('position, media(*)').eq('workout_id', workoutId).order('position')) as
    unknown as { position: number; media: MediaRow | null }[];
  return rows.map((r) => r.media).filter((m): m is MediaRow => Boolean(m));
}

export async function saveWorkout(orgId: string, id: string | null, input: WorkoutInput, sectionIds: string[]): Promise<Workout> {
  const w: Workout = id
    ? (check(await supabase.from('workouts').update(input).eq('id', id).select()) as Workout[])[0]
    : check(await supabase.from('workouts').insert({ ...input, organization_id: orgId }).select().single());

  const current = id ? await workoutSectionIds(w.id) : [];
  const toRemove = current.filter((s) => !sectionIds.includes(s));
  const toAdd = sectionIds.filter((s) => !current.includes(s));
  if (toRemove.length) {
    check(await supabase.from('section_workouts').delete().eq('workout_id', w.id).in('section_id', toRemove));
  }
  for (const sectionId of toAdd) {
    // put new workouts at the end of the section
    const last = check(await supabase.from('section_workouts').select('position')
      .eq('section_id', sectionId).order('position', { ascending: false }).limit(1)) as { position: number }[];
    check(await supabase.from('section_workouts').insert({
      section_id: sectionId, workout_id: w.id, organization_id: orgId, position: (last[0]?.position ?? -1) + 1,
    }));
  }
  return w;
}

export async function deleteWorkout(id: string): Promise<void> {
  const media = await workoutMedia(id);
  check(await supabase.from('workouts').delete().eq('id', id));
  if (media.length) await deleteMedia(media.map((m) => m.id));
}

// Removes media rows; the server then deletes the files.
export async function deleteMedia(ids: string[]): Promise<void> {
  if (ids.length) check(await supabase.from('media').delete().in('id', ids));
}

// ---------------------------------------------------------------- home page
export async function saveHome(orgId: string, home: {
  theme_key: string;
  background_media_id: string | null;
  foreground_media_id: string | null;
  description: RichDoc | null;
}, buttons: Pick<HomeButton, 'id' | 'label' | 'icon' | 'color'>[]): Promise<void> {
  check(await supabase.from('home_settings').update(home).eq('organization_id', orgId));
  for (const b of buttons) {
    check(await supabase.from('home_buttons').update({ label: b.label, icon: b.icon, color: b.color }).eq('id', b.id));
  }
}

export async function mediaStatus(ids: string[]): Promise<Record<string, MediaRow>> {
  if (!ids.length) return {};
  const rows = check(await supabase.from('media').select('id, organization_id, kind, status, reject_reason').in('id', ids)) as MediaRow[];
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

// ---------------------------------------------------------------- super admin
export type PendingMedia = MediaRow & { created_at: string; organizations: { name: string } | null };

export async function listPendingMedia(): Promise<PendingMedia[]> {
  return check(await supabase.from('media').select('id, organization_id, kind, status, created_at, organizations(name)')
    .eq('status', 'pending').order('created_at')) as unknown as PendingMedia[];
}

export async function reviewMedia(id: string, approve: boolean, reason?: string): Promise<void> {
  check(await supabase.rpc('review_media', { p_media: id, p_approve: approve, p_reason: reason || null }));
}

// ---------------------------------------------------------------- scheduling
export type Availability = {
  id: string;
  organization_id: string;
  weekday: number;
  start_time: string;       // "09:00:00"
  end_time: string;
  slot_minutes: number;
  capacity: number;
  price_cents: number;
  currency: string;
};

export type DayOff = { id: string; organization_id: string; day: string; closed: boolean };

export type Booking = {
  id: string;
  organization_id: string;
  client_id: string;
  starts_at: string;
  ends_at: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  payment_status: 'not_required' | 'requires_payment' | 'authorized' | 'captured' | 'canceled' | 'refunded';
  price_cents: number;
  currency: string;
  cancelled_by: 'client' | 'owner' | 'system' | null;
  profiles?: { display_name: string | null; email: string | null } | null;
};

export async function listAvailability(): Promise<Availability[]> {
  return check(await supabase.from('availability').select('*').order('weekday').order('start_time'));
}

export async function saveAvailability(orgId: string, a: Omit<Availability, 'id' | 'organization_id'> & { id?: string }): Promise<void> {
  const { id, ...row } = a;
  if (id) check(await supabase.from('availability').update(row).eq('id', id));
  else check(await supabase.from('availability').insert({ ...row, organization_id: orgId }));
}

export async function deleteAvailability(id: string): Promise<void> {
  check(await supabase.from('availability').delete().eq('id', id));
}

export async function listDaysOff(fromDay: string): Promise<DayOff[]> {
  return check(await supabase.from('availability_exceptions').select('id, organization_id, day, closed')
    .eq('closed', true).gte('day', fromDay).order('day'));
}

export async function addDayOff(orgId: string, day: string): Promise<void> {
  check(await supabase.from('availability_exceptions').insert({ organization_id: orgId, day, closed: true }));
}

export async function deleteDayOff(id: string): Promise<void> {
  check(await supabase.from('availability_exceptions').delete().eq('id', id));
}

export type FreeSlot = { starts_at: string; ends_at: string; remaining: number; price_cents: number; currency: string };

export async function freeSlots(fromDay: string, days = 14): Promise<FreeSlot[]> {
  return check(await supabase.rpc('available_slots', { p_from: fromDay, p_days: days })) as FreeSlot[];
}

export async function requestBooking(startsAt: string): Promise<Booking> {
  return check(await supabase.rpc('request_booking', { p_starts_at: startsAt })) as Booking;
}

export async function decideBooking(id: string, accept: boolean): Promise<void> {
  check(await supabase.rpc('decide_booking', { p_booking: id, p_accept: accept }));
}

export async function cancelBooking(id: string): Promise<void> {
  check(await supabase.rpc('cancel_booking', { p_booking: id }));
}

// Client: own bookings. Owner: all bookings of the organization, with the client's name.
export async function listBookings(opts: { owner: boolean; upcomingOnly: boolean; clientId?: string }): Promise<Booking[]> {
  let q = supabase.from('bookings')
    .select(opts.owner ? '*, profiles(display_name, email)' : '*')
    .order('starts_at', { ascending: opts.upcomingOnly });
  if (!opts.owner && opts.clientId) q = q.eq('client_id', opts.clientId);
  if (opts.upcomingOnly) q = q.gte('ends_at', new Date().toISOString());
  else q = q.lt('ends_at', new Date().toISOString()).limit(50);
  return check(await q) as unknown as Booking[];
}
