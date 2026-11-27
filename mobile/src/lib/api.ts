// Calls to the Node server (<API_URL>/api/...).
import { API_URL } from './config';
import { supabase } from './supabase';
import { cacheUsable } from './mediaCache';

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

// Signed links expire; reuse them until 10 minutes before that.
// Only published media are kept: "waiting for approval" must be asked again,
// otherwise an image approved later would never appear (bug before).
const linkCache = new Map<string, MediaLinks>();

export async function mediaLinks(id: string, fresh = false): Promise<MediaLinks> {
  const cached = linkCache.get(id);
  if (!fresh && cacheUsable(cached, Date.now())) return cached!;
  const links = await call<MediaLinks>('GET', `/api/media/${encodeURIComponent(id)}/url`);
  if (links.status === 'published') linkCache.set(id, links);
  else linkCache.delete(id);
  return links;
}

export const api = {
  // creating an account and "Forgot password": the server sends the emails (see server/src/authmail.js)
  signUp: (email: string, password: string, language: string, device: unknown) =>
    call<{ status: string }>('POST', '/api/auth/signup', { email, password, language, device }),
  recover: (email: string, language: string, device: unknown) =>
    call<{ status: string }>('POST', '/api/auth/recover', { email, language, device }),
  deleteAccount: () => call<{ deleted: boolean }>('DELETE', '/api/account'),
  testPush: () => call<{ devices: number; sent: number }>('POST', '/api/push/test'),
  closeOrganization: (id: string) =>
    call<{ clients: number }>('POST', `/api/admin/organizations/${encodeURIComponent(id)}/close`),
};
