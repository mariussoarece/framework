// Which video file to play, from the client's setting and the connection. Pure, tested.
import type { VideoQuality } from './types';

export type VideoLinks = { video_720?: { url: string }; video_1080?: { url: string } };

export function pickVideoUrl(links: VideoLinks, quality: VideoQuality, onCellular: boolean): string | null {
  const low = links.video_720?.url ?? null;
  const high = links.video_1080?.url ?? null;
  const wantHigh = quality === '1080' || (quality === 'auto' && !onCellular);
  return wantHigh ? (high ?? low) : (low ?? high);
}
