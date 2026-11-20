// When a remembered signed link can be reused. Pure, tested.
// Only published media count: "waiting for approval" must be asked again.
export type CachedLinks = {
  status: string;
  image?: { expires: number };
  video_720?: { expires: number };
  video_1080?: { expires: number };
};

export function cacheUsable(cached: CachedLinks | undefined, now: number): boolean {
  if (!cached || cached.status !== 'published') return false;
  const expiries = [cached.image, cached.video_720, cached.video_1080].filter(Boolean).map((l) => l!.expires);
  if (!expiries.length) return false;
  return Math.min(...expiries) * 1000 - now > 10 * 60 * 1000;
}
