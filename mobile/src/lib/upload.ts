// Uploads a picked picture or video to the server (streamed from disk, with progress).
import * as FileSystem from 'expo-file-system/legacy';
import { API_URL } from './config';
import { ApiError } from './api';
import { supabase } from './supabase';

export type PickedAsset = {
  uri: string;
  kind: 'image' | 'video';
  mimeType?: string | null;
};

export type MediaRow = {
  id: string;
  organization_id: string;
  kind: 'image' | 'video';
  status: 'pending' | 'approved' | 'published' | 'rejected';
  reject_reason?: string | null;
};

function mimeFor(a: PickedAsset): string {
  if (a.mimeType && /^(image|video)\//.test(a.mimeType)) return a.mimeType;
  const ext = a.uri.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return a.kind === 'video' ? 'video/mp4' : 'image/jpeg';
}

export async function uploadAsset(
  asset: PickedAsset,
  opts: { workoutId?: string; onProgress?: (fraction: number) => void } = {},
): Promise<MediaRow> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const url = `${API_URL}/api/media?kind=${asset.kind}${opts.workoutId ? `&workout_id=${encodeURIComponent(opts.workoutId)}` : ''}`;

  const task = FileSystem.createUploadTask(
    url,
    asset.uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${token ?? ''}`,
        'Content-Type': mimeFor(asset),
      },
    },
    (p) => {
      if (p.totalBytesExpectedToSend > 0) opts.onProgress?.(p.totalBytesSent / p.totalBytesExpectedToSend);
    },
  );
  const res = await task.uploadAsync();
  if (!res) throw new ApiError(0, 'upload_cancelled');
  let body: { error?: string } & Partial<MediaRow> = {};
  try { body = JSON.parse(res.body); } catch { /* not JSON */ }
  if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, body.error ?? `http_${res.status}`);
  return body as MediaRow;
}
