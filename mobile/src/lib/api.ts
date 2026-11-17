// Calls to the Node server (<API_URL>/api/...).
import { API_URL } from './config';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(public status: number, code: string) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `http_${res.status}`);
  return json as T;
}

export type SignedLink = { url: string; expires: number };
export type MediaLinks = {
  id: string;
  kind: 'image' | 'video';
  status: string;
  width?: number;
  height?: number;
  image?: SignedLink;
  video_720?: SignedLink;
  video_1080?: SignedLink;
};

// Signed links expire; keep them until shortly before that.
const linkCache = new Map<string, MediaLinks>();

export async function mediaLinks(id: string): Promise<MediaLinks> {
  const cached = linkCache.get(id);
  const soonest = cached && Math.min(
    ...[cached.image, cached.video_720, cached.video_1080].filter(Boolean).map((l) => l!.expires),
  );
  if (cached && soonest && soonest * 1000 - Date.now() > 10 * 60 * 1000) return cached;
  const fresh = await call<MediaLinks>('GET', `/api/media/${encodeURIComponent(id)}/url`);
  linkCache.set(id, fresh);
  return fresh;
}

export const api = {
  deleteAccount: () => call<{ deleted: boolean }>('DELETE', '/api/account'),
};
