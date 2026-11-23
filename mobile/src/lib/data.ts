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

// Saves a new order (after drag-and-drop): position = place in the list.
export async function saveSectionOrder(ordered: Section[]): Promise<void> {
  for (let i = 0; i < ordered.length; i += 1) {
    if (ordered[i].position !== i) {
      check(await supabase.from('sections').update({ position: i }).eq('id', ordered[i].id));
    }
  }
}

// Number of workouts in each section: { sectionId: count }
export async function sectionWorkoutCounts(): Promise<Record<string, number>> {
  const rows = check(await supabase.from('section_workouts').select('section_id')) as { section_id: string }[];
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.section_id] = (counts[r.section_id] ?? 0) + 1;
  return counts;
}

// Saves the order of the workouts inside one section (each section has its own order).
export async function saveWorkoutOrder(sectionId: string, ordered: { id: string }[]): Promise<void> {
  for (let i = 0; i < ordered.length; i += 1) {
    check(await supabase.from('section_workouts').update({ position: i })
      .eq('section_id', sectionId).eq('workout_id', ordered[i].id));
  }
}

// ---------------------------------------------------------------- workouts
export async function listSectionWorkouts(sectionId: string): Promise<Workout[]> {
  const rows = check(await supabase.from('section_workouts')
    .select('position, workouts(*)').eq('section_id', sectionId).order('position')) as
    unknown as { position: number; workouts: Workout | null }[];
  return rows.map((r) => r.workouts).filter((w): w is Workout => Boolean(w));
}

// The workouts of a section with each one's first published picture, in ONE request
// (before, every workout asked for its pictures separately, which was slow on a far-away server).
export type WorkoutRow = Workout & { thumbId: string | null };

export async function listSectionWorkoutRows(sectionId: string): Promise<WorkoutRow[]> {
  type M = { position: number; media: { id: string; kind: string; status: string } | null };
  const rows = check(await supabase.from('section_workouts')
    .select('position, workouts(*, workout_media(position, media(id, kind, status)))')
    .eq('section_id', sectionId).order('position')) as
    unknown as { position: number; workouts: (Workout & { workout_media?: M[] }) | null }[];
  return rows.flatMap((r) => {
    if (!r.workouts) return [];
    const { workout_media: media = [], ...w } = r.workouts;
    const first = [...media].sort((a, b) => a.position - b.position)
      .find((m) => m.media?.kind === 'image' && m.media.status === 'published');
    return [{ ...(w as Workout), thumbId: first?.media?.id ?? null }];
  });
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

// Order of a workout's pictures/videos; the first approved picture is the one shown in the list.
export async function saveWorkoutMediaOrder(workoutId: string, mediaIds: string[]): Promise<void> {
  await Promise.all(mediaIds.map(async (mediaId, i) => {
    check(await supabase.from('workout_media').update({ position: i }).eq('workout_id', workoutId).eq('media_id', mediaId));
  }));
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
  front_size: string;
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
export type ScheduleKind = 'open' | 'class';

export type Availability = {
  id: string;
  organization_id: string;
  weekday: number;
  kind: ScheduleKind;
  title: string | null;       // class name
  instructor: string | null;
  start_time: string;         // "09:00:00"
  end_time: string;
  slot_minutes: number;       // session length; for a class: its length
  capacity: number;
  price_cents: number;
  currency: string;
  valid_from: string;         // YYYY-MM-DD
  valid_until: string | null; // null = every week, no end
};

export type AvailabilityInput = {
  id?: string;
  weekdays: number[];
  kind: ScheduleKind;
  title: string | null;
  instructor: string | null;
  start: string;              // "HH:MM"
  end: string | null;         // open hours only
  slot_minutes: number;
  capacity: number;
  price_cents: number;
  valid_from: string;
  valid_until: string | null;
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
  title: string | null;
  instructor: string | null;
  profiles?: { display_name: string | null; email: string | null } | null;
};

export async function listAvailability(): Promise<Availability[]> {
  return check(await supabase.from('availability').select('*').order('weekday').order('start_time'));
}

// Creates the entry on every chosen weekday (all or nothing), or updates one entry.
// The database refuses clashes ("schedule_clash|..."), see errorText().
export async function saveAvailability(a: AvailabilityInput): Promise<void> {
  check(await supabase.rpc('save_availability', {
    p_id: a.id ?? null, p_weekdays: a.weekdays, p_kind: a.kind, p_title: a.title, p_instructor: a.instructor,
    p_start: a.start, p_end: a.end, p_slot_minutes: a.slot_minutes, p_capacity: a.capacity,
    p_price_cents: a.price_cents, p_valid_from: a.valid_from, p_valid_until: a.valid_until,
  }));
}

export async function deleteAvailability(id: string): Promise<void> {
  check(await supabase.rpc('delete_availability', { p_id: id }));
}

// Whole days off (blocked sessions have times and are handled by daySlots/blockSlot).
export async function listDaysOff(fromDay: string): Promise<DayOff[]> {
  return check(await supabase.from('availability_exceptions').select('id, organization_id, day, closed')
    .eq('closed', true).is('start_time', null).gte('day', fromDay).order('day'));
}

export async function addDayOff(orgId: string, day: string): Promise<void> {
  check(await supabase.from('availability_exceptions').insert({ organization_id: orgId, day, closed: true }));
}

export async function deleteDayOff(id: string): Promise<void> {
  check(await supabase.from('availability_exceptions').delete().eq('id', id));
}

export type FreeSlot = {
  starts_at: string;
  ends_at: string;
  remaining: number;          // 0 = full
  capacity: number;
  price_cents: number;
  currency: string;
  availability_id: string | null;
  kind: ScheduleKind;
  title: string | null;
  instructor: string | null;
};

export async function freeSlots(fromDay: string, days = 14): Promise<FreeSlot[]> {
  return check(await supabase.rpc('available_slots', { p_from: fromDay, p_days: days })) as FreeSlot[];
}

export type WeekEntry = {
  day: string;
  availability_id: string;
  kind: ScheduleKind;
  title: string | null;
  instructor: string | null;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  capacity: number;
  booked: number;
  day_off: boolean;
};

export async function weekOverview(fromDay: string, days = 7): Promise<WeekEntry[]> {
  return check(await supabase.rpc('week_overview', { p_from: fromDay, p_days: days })) as WeekEntry[];
}

export type DaySlot = {
  starts_at: string; ends_at: string; booked: number; capacity: number;
  kind: ScheduleKind; title: string | null; blocked: boolean;
};

export async function daySlots(day: string): Promise<DaySlot[]> {
  return check(await supabase.rpc('day_slots', { p_day: day })) as DaySlot[];
}

export async function blockSlot(startsAt: string, block: boolean): Promise<void> {
  check(await supabase.rpc('block_slot', { p_starts_at: startsAt, p_block: block }));
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

// ---------------------------------------------------------------- reports
export const REPORT_REASONS = ['inappropriate', 'dangerous', 'copyright', 'other'] as const;
export type ReportReason = typeof REPORT_REASONS[number];

export async function reportWorkout(orgId: string, workoutId: string, reporterId: string, reason: string): Promise<void> {
  check(await supabase.from('content_reports').insert({
    organization_id: orgId, workout_id: workoutId, reporter_id: reporterId, reason,
  }));
}

// ---------------------------------------------------------------- super admin: organizations and reports
export type AdminOrg = {
  id: string; name: string; join_code: string; plan: string; status: 'trial' | 'active' | 'paused';
  is_default: boolean; trial_ends_at: string; created_at: string; owner_email: string | null;
  clients: number; open_reports: number;
};

export async function adminOrganizations(): Promise<AdminOrg[]> {
  return check(await supabase.rpc('admin_organizations')) as AdminOrg[];
}

export async function adminSetOrgStatus(id: string, status: 'active' | 'paused'): Promise<void> {
  check(await supabase.rpc('admin_set_org_status', { p_org: id, p_status: status }));
}

export async function setDefaultOrganization(id: string): Promise<void> {
  check(await supabase.rpc('set_default_organization', { p_org: id }));
}

export type AdminReport = {
  id: string; status: string; reason: string; created_at: string;
  organization_id: string; organization_name: string;
  workout_id: string | null; workout_name: string | null;
  media_id: string | null; media_kind: string | null; reporter_email: string | null;
};

export async function adminReports(): Promise<AdminReport[]> {
  return check(await supabase.rpc('admin_reports', { p_status: 'open' })) as AdminReport[];
}

export async function resolveReport(id: string): Promise<void> {
  check(await supabase.rpc('resolve_report', { p_id: id }));
}
