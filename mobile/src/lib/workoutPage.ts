// Everything the workout page needs: the workout, its pictures/videos and their signed links.
// Started when a finger touches a workout in the list, so by the time the page opens most of it
// has arrived; the page then reuses the same request instead of starting again.
import { mediaLinks } from './api';
import { getWorkout, workoutMedia, type Workout } from './data';
import type { MediaRow } from './upload';

export type WorkoutPage = { workout: Workout | null; media: MediaRow[] };

const KEEP_MS = 20_000;   // a started load is reused for 20 s, then fetched fresh
const pending = new Map<string, { at: number; promise: Promise<WorkoutPage> }>();

export function loadWorkoutPage(id: string, fresh = false): Promise<WorkoutPage> {
  const hit = pending.get(id);
  if (!fresh && hit && Date.now() - hit.at < KEEP_MS) return hit.promise;
  const promise = (async () => {
    const mediaPromise = workoutMedia(id).then((media) => {
      // ask for every signed link right away (in parallel); the player and pictures find them ready
      for (const m of media) if (m.status === 'published') mediaLinks(m.id).catch(() => {});
      return media;
    });
    const [workout, media] = await Promise.all([getWorkout(id), mediaPromise]);
    return { workout, media };
  })();
  promise.catch(() => pending.delete(id));
  pending.set(id, { at: Date.now(), promise });
  return promise;
}

export function prefetchWorkoutPage(id: string): void {
  loadWorkoutPage(id).catch(() => {});
}
