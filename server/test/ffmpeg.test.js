// Real FFmpeg conversions (skipped if ffmpeg isn't installed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeVideo, encodeImage, probe } from '../src/media.js';

const cfg = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { hasFfmpeg = false; }

const dir = mkdtempSync(join(tmpdir(), 'ffmpeg-test-'));
function makeVideo(name, w, h) {
  const file = join(dir, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${w}x${h}:rate=25:duration=2`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', file]);
  return file;
}

// "moov" (the index) must come before "mdat" (the data) for playback to start early.
function isFaststart(file) {
  const buf = readFileSync(file);
  let pos = 0;
  while (pos < buf.length) {
    const size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (type === 'moov') return true;
    if (type === 'mdat') return false;
    pos += size;
  }
  return false;
}

test('landscape 1080p becomes 720p and 1080p, faststart', { skip: !hasFfmpeg }, async () => {
  const src = makeVideo('land.mp4', 1920, 1080);
  const info = await probe(cfg, src);
  assert.deepEqual([info.width, info.height], [1920, 1080]);
  assert.ok(info.duration > 1.5);

  await encodeVideo(cfg, src, join(dir, 'land_720.mp4'), 720);
  await encodeVideo(cfg, src, join(dir, 'land_1080.mp4'), 1080);
  const a = await probe(cfg, join(dir, 'land_720.mp4'));
  const b = await probe(cfg, join(dir, 'land_1080.mp4'));
  assert.deepEqual([a.width, a.height], [1280, 720]);
  assert.deepEqual([b.width, b.height], [1920, 1080]);
  assert.ok(isFaststart(join(dir, 'land_720.mp4')), '720p is faststart');
  assert.ok(isFaststart(join(dir, 'land_1080.mp4')), '1080p is faststart');
});

test('portrait phone video keeps its orientation, short side 720', { skip: !hasFfmpeg }, async () => {
  const src = makeVideo('port.mp4', 1080, 1920);
  await encodeVideo(cfg, src, join(dir, 'port_720.mp4'), 720);
  const a = await probe(cfg, join(dir, 'port_720.mp4'));
  assert.deepEqual([a.width, a.height], [720, 1280]);
});

test('phone video with rotation metadata comes out upright', { skip: !hasFfmpeg }, async () => {
  const src = makeVideo('sideways.mp4', 1920, 1080);
  const rotated = join(dir, 'rotated.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-display_rotation', '90', '-i', src, '-c', 'copy', rotated]);
  const info = await probe(cfg, rotated);
  assert.deepEqual([info.width, info.height], [1080, 1920]);
  await encodeVideo(cfg, rotated, join(dir, 'rotated_720.mp4'), 720);
  const a = await probe(cfg, join(dir, 'rotated_720.mp4'));
  assert.deepEqual([a.width, a.height], [720, 1280]);
});

test('small video is not upscaled', { skip: !hasFfmpeg }, async () => {
  const src = makeVideo('small.mp4', 640, 360);
  await encodeVideo(cfg, src, join(dir, 'small_720.mp4'), 720);
  const a = await probe(cfg, join(dir, 'small_720.mp4'));
  assert.deepEqual([a.width, a.height], [640, 360]);
});

test('large picture is resized to 1600 px wide JPEG', { skip: !hasFfmpeg }, async () => {
  const src = join(dir, 'big.png');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=4000x3000', '-frames:v', '1', src]);
  await encodeImage(cfg, src, join(dir, 'big.jpg'));
  const a = await probe(cfg, join(dir, 'big.jpg'));
  assert.deepEqual([a.width, a.height], [1600, 1200]);
});
