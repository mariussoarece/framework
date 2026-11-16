// Pictures and videos: upload to the VPS, signed links, FFmpeg conversion.
//
// Layout under MEDIA_ROOT:
//   uploads/<org>/<id>.<ext>          original, waiting for approval
//   published/<org>/<id>_720.mp4      published video, 720p (short side)
//   published/<org>/<id>_1080.mp4     published video, 1080p (only if the source is larger than 720p)
//   published/<org>/<id>.jpg          published picture (max 1600 px wide)
// Nginx serves published/ at /media/ with signed, expiring links.
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, unlink } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { HttpError, sendFile } from './http.js';
import { eq } from './db.js';

const TYPES = {
  image: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  video: { 'video/mp4': 'mp4', 'video/quicktime': 'mov' },
};
const CONTENT_TYPE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime' };

// Safe join: never lets a stored path escape the media root.
export function mediaPath(root, area, rel) {
  const clean = normalize(String(rel));
  if (clean.startsWith('/') || clean.split(/[/\\]/).includes('..')) throw new Error('bad_media_path');
  return join(root, area, clean);
}

// Same formula as nginx: md5("<expires>/media/<rel> <secret>"), base64url.
export function signMediaUrl(cfg, rel, now = Date.now()) {
  const expires = Math.floor(now / 1000) + cfg.mediaLinkTtl;
  const uri = `/media/${rel}`;
  const md5 = createHash('md5').update(`${expires}${uri} ${cfg.mediaLinkSecret}`).digest('base64url');
  return { url: `${cfg.publicUrl}${uri}?md5=${md5}&expires=${expires}`, expires };
}

// POST /api/media?kind=image|video[&workout_id=...]   body = the raw file
export async function uploadMedia(ctx, req, user, query) {
  const { cfg, db } = ctx;
  const profile = user.profile;
  if (profile?.role !== 'owner' || !profile.organization_id) throw new HttpError(403, 'owners_only');

  const kind = query.get('kind');
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[kind]?.[type];
  if (!ext) throw new HttpError(415, 'unsupported_type');

  const max = (kind === 'video' ? cfg.maxVideoMb : cfg.maxImageMb) * 1024 * 1024;
  if (Number(req.headers['content-length'] || 0) > max) throw new HttpError(413, 'file_too_large');

  const workoutId = query.get('workout_id');
  if (workoutId) {
    const w = await db.as(user.token).one('workouts', `id=${eq(workoutId)}&select=id,organization_id`);
    if (!w) throw new HttpError(404, 'workout_not_found');
  }

  const id = randomUUID();
  const org = profile.organization_id;
  const rel = `${org}/${id}.${ext}`;
  const file = mediaPath(cfg.mediaRoot, 'uploads', rel);
  await mkdir(dirname(file), { recursive: true });

  let size = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > max) return cb(new HttpError(413, 'file_too_large'));
      cb(null, chunk);
    },
  });
  try {
    await pipeline(req, limiter, createWriteStream(file));
    if (size === 0) throw new HttpError(400, 'empty_file');
  } catch (err) {
    await unlink(file).catch(() => {});
    throw err;
  }

  const row = await db.service.insert('media', {
    id, organization_id: org, kind, original_path: rel, uploaded_by: user.userId,
  });
  if (workoutId) {
    await db.as(user.token).insert('workout_media', { workout_id: workoutId, media_id: id, organization_id: org });
  }
  return row;
}

// GET /api/media/:id/url   -> signed links (only for media the user may see)
export async function mediaUrls(ctx, user, id) {
  const m = await ctx.db.as(user.token).one('media', `id=${eq(id)}`);
  if (!m) throw new HttpError(404, 'media_not_found');
  if (m.status !== 'published') return { id: m.id, kind: m.kind, status: m.status };
  const out = { id: m.id, kind: m.kind, status: m.status, width: m.width, height: m.height };
  if (m.image_path) Object.assign(out, { image: signMediaUrl(ctx.cfg, m.image_path) });
  if (m.file_720) out.video_720 = signMediaUrl(ctx.cfg, m.file_720);
  if (m.file_1080) out.video_1080 = signMediaUrl(ctx.cfg, m.file_1080);
  return out;
}

// GET /api/admin/media/:id/original  -> super admin previews a pending upload
export async function sendOriginal(ctx, req, res, user, id) {
  if (user.profile?.role !== 'super_admin') throw new HttpError(403, 'super_admin_only');
  const m = await ctx.db.service.one('media', `id=${eq(id)}`);
  if (!m) throw new HttpError(404, 'media_not_found');
  const ext = m.original_path.split('.').pop();
  return sendFile(req, res, mediaPath(ctx.cfg.mediaRoot, 'uploads', m.original_path),
    CONTENT_TYPE[ext] || 'application/octet-stream');
}

// ---------------------------------------------------------------------------
// FFmpeg
// ---------------------------------------------------------------------------
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} failed (${code}): ${err}`))));
  });
}

export async function probe(cfg, file) {
  const out = await run(cfg.ffprobe, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:stream_side_data=rotation:format=duration', '-of', 'json', file]);
  const j = JSON.parse(out);
  const s = j.streams?.[0] || {};
  const rotation = Math.abs(Number(s.side_data_list?.find((d) => d.rotation !== undefined)?.rotation || 0));
  const turned = rotation === 90 || rotation === 270;
  return {
    width: turned ? s.height : s.width,
    height: turned ? s.width : s.height,
    duration: Number(j.format?.duration || 0),
  };
}

// Scales so the SHORT side is at most `short` px (works for portrait and landscape),
// H.264 + AAC, faststart so playback begins before the download ends.
export async function encodeVideo(cfg, src, dest, short) {
  const scale = `scale=w='if(gt(iw,ih),-2,trunc(min(${short},iw)/2)*2)':h='if(gt(iw,ih),trunc(min(${short},ih)/2)*2,-2)'`;
  await run(cfg.ffmpeg, ['-y', '-v', 'error', '-i', src, '-vf', scale,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', dest]);
}

export async function encodeImage(cfg, src, dest) {
  await run(cfg.ffmpeg, ['-y', '-v', 'error', '-i', src,
    '-vf', "scale='min(1600,iw)':-2", '-q:v', '3', '-frames:v', '1', dest]);
}

// Called for each approved media item.
export async function processMedia(ctx, mediaId) {
  const { cfg, db, log } = ctx;
  const m = await db.service.one('media', `id=${eq(mediaId)}`);
  if (!m || m.status !== 'approved') return;

  const src = mediaPath(cfg.mediaRoot, 'uploads', m.original_path);
  const org = m.organization_id;
  await mkdir(join(cfg.mediaRoot, 'published', org), { recursive: true });

  try {
    const patch = { status: 'published' };
    if (m.kind === 'video') {
      const info = await probe(cfg, src);
      const shortSide = Math.min(info.width || 0, info.height || 0);
      patch.file_720 = `${org}/${m.id}_720.mp4`;
      await encodeVideo(cfg, src, mediaPath(cfg.mediaRoot, 'published', patch.file_720), 720);
      if (shortSide > 720) {
        patch.file_1080 = `${org}/${m.id}_1080.mp4`;
        await encodeVideo(cfg, src, mediaPath(cfg.mediaRoot, 'published', patch.file_1080), 1080);
      }
      Object.assign(patch, { width: info.width, height: info.height, duration_seconds: info.duration });
    } else {
      patch.image_path = `${org}/${m.id}.jpg`;
      const dest = mediaPath(cfg.mediaRoot, 'published', patch.image_path);
      await encodeImage(cfg, src, dest);
      const info = await probe(cfg, dest);
      Object.assign(patch, { width: info.width, height: info.height });
    }
    await db.service.update('media', `id=${eq(m.id)}`, patch);
    await unlink(src).catch(() => {});
  } catch (err) {
    log.error({ err: err.message, media: m.id }, 'media processing failed');
    await db.service.update('media', `id=${eq(m.id)}`, {
      status: 'rejected', reject_reason: 'processing_failed',
    });
  }
}

export async function deleteMediaFiles(ctx, paths) {
  for (const rel of paths.filter(Boolean)) {
    for (const area of ['uploads', 'published']) {
      await unlink(mediaPath(ctx.cfg.mediaRoot, area, rel)).catch(() => {});
    }
  }
}

export async function deleteOrganizationFiles(ctx, orgId) {
  for (const area of ['uploads', 'published']) {
    await rm(join(ctx.cfg.mediaRoot, area, orgId), { recursive: true, force: true });
  }
}
