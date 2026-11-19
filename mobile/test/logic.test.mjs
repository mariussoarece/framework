// Tests for the app's plain logic (translations, rich text), no phone needed.
//   npm test        (after npm run setup, which installs TypeScript)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require(process.env.TS_PATH || 'typescript');

// Compile the .ts modules we test into a temp folder as .mjs files.
const out = mkdtempSync(join(tmpdir(), 'mobile-logic-'));
for (const rel of ['src/i18n/en.ts', 'src/i18n/ro.ts', 'src/i18n/translate.ts', 'src/lib/richtext.ts', 'src/lib/format.ts', 'src/lib/video.ts', 'src/lib/schedule.ts']) {
  const src = readFileSync(join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
    .outputText.replace(/from '(\.\.?\/[^']+)'/g, (_, p) => `from './${p.split('/').pop()}.mjs'`);
  writeFileSync(join(out, rel.split('/').pop().replace('.ts', '.mjs')), js);
}
const load = (name) => import(pathToFileURL(join(out, name)).href);
const { en } = await load('en.mjs');
const { ro } = await load('ro.mjs');
const { translate, errorText, pickLanguage } = await load('translate.mjs');
const { toBlocks, plainText, safeHref, cssColor } = await load('richtext.mjs');
const { workoutSummary, restText, duration, positiveInt } = await load('format.mjs');
const { pickVideoUrl } = await load('video.mjs');
const sch = await load('schedule.mjs');

test('Romanian has exactly the English keys, none empty', () => {
  assert.deepEqual(Object.keys(ro).sort(), Object.keys(en).sort());
  for (const [k, v] of Object.entries(ro)) assert.ok(v.trim(), `ro ${k} is empty`);
});

test('placeholders match between languages', () => {
  const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const k of Object.keys(en)) assert.equal(vars(ro[k]), vars(en[k]), k);
});

test('translate fills placeholders; language from device code', () => {
  assert.equal(translate('ro', 'client.join', { name: 'Dojo' }), 'Alătură-te la Dojo');
  assert.equal(translate('en', 'client.default', { name: 'YogaByTheSofa' }), 'No code? Continue with YogaByTheSofa');
  assert.equal(pickLanguage('ro-RO'), 'ro');
  assert.equal(pickLanguage('de'), 'en');
  assert.equal(pickLanguage(null), 'en');
});

test('server and login errors become friendly text', () => {
  assert.equal(errorText('en', { message: 'name_taken' }), en['error.name_taken']);
  assert.equal(errorText('ro', new Error('Invalid login credentials')), ro['error.invalid_credentials']);
  assert.equal(errorText('en', new TypeError('Network request failed')), en['error.network']);
  assert.equal(errorText('en', new Error('something odd')), en['common.error']);
});

test('rich text: formatting, alignment, lists, links', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [{ type: 'text', text: 'Welcome' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Breathe ', marks: [{ type: 'bold' }, { type: 'italic' }] },
        { type: 'text', text: 'deeply', marks: [{ type: 'underline' }, { type: 'textStyle', attrs: { fontFamily: 'Georgia' } }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        { type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
      ] },
      { type: 'orderedList', attrs: { start: 3 }, content: [
        { type: 'listItem', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Warm up' }] },
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Neck' }] }] }] },
        ] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stretch' }] }] },
      ] },
      { type: 'image', attrs: { src: 'x' } },
    ],
  };
  const b = toBlocks(doc);
  assert.deepEqual(b[0], { kind: 'heading', level: 1, align: 'center', spans: [{ text: 'Welcome' }] });
  assert.deepEqual(b[1].spans[0], { text: 'Breathe ', bold: true, italic: true });
  assert.deepEqual(b[1].spans[1], { text: 'deeply', underline: true, fontFamily: 'Georgia' });
  assert.equal(b[1].spans[2].text, '\n');
  assert.equal(b[1].spans[3].href, 'https://example.com');
  assert.equal(b[1].spans[4].href, undefined, 'javascript: links are dropped');
  assert.deepEqual(b.slice(2).map((x) => [x.kind, x.ordered, x.index, x.depth, x.spans[0].text]), [
    ['listItem', true, 3, 0, 'Warm up'],
    ['listItem', false, 1, 1, 'Neck'],
    ['listItem', true, 4, 0, 'Stretch'],
  ]);
  assert.equal(b.length, 5, 'unknown node types are skipped');
  assert.equal(plainText(doc).split('\n')[0], 'Welcome');
  assert.deepEqual(toBlocks(null), []);
  assert.equal(safeHref('mailto:a@b.c'), 'mailto:a@b.c');
});

test('rich text: strike, color, highlight; unsafe colors dropped', () => {
  const b = toBlocks({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'a', marks: [{ type: 'strike' }, { type: 'textStyle', attrs: { color: '#ff0000' } }] },
    { type: 'text', text: 'b', marks: [{ type: 'highlight' }, { type: 'textStyle', attrs: { color: 'url(javascript:x)' } }] },
  ] }] });
  assert.deepEqual(b[0].spans[0], { text: 'a', strike: true, color: '#ff0000' });
  assert.deepEqual(b[0].spans[1], { text: 'b', highlight: '#FFF3A3' });
  assert.equal(cssColor('rgb(1, 2, 3)'), 'rgb(1, 2, 3)');
});

test('workout summaries in both languages', () => {
  assert.equal(workoutSummary('en', { sets: 3, reps: 10, duration_seconds: null, rest_seconds: 30 }), '3 × 10 reps');
  assert.equal(workoutSummary('ro', { sets: 3, reps: 10, duration_seconds: null, rest_seconds: 30 }), '3 × 10 repetări');
  assert.equal(workoutSummary('en', { sets: 2, reps: null, duration_seconds: 90, rest_seconds: null }), '2 × 1 min 30 s');
  assert.equal(restText('ro', { sets: 2, reps: 5, duration_seconds: null, rest_seconds: 60 }), 'Pauză 1 min');
  assert.equal(restText('en', { sets: 2, reps: 5, duration_seconds: null, rest_seconds: null }), '');
  assert.equal(duration('en', 45), '45 s');
});

test('number fields accept only whole positive numbers', () => {
  assert.equal(positiveInt('12'), 12);
  assert.equal(positiveInt(' 3 '), 3);
  for (const bad of ['', '0', '-3', '2.5', 'abc', '1e3']) assert.equal(positiveInt(bad), null, bad);
  assert.equal(positiveInt('0', true), 0);
});

test('video quality choice', () => {
  const both = { video_720: { url: 'L' }, video_1080: { url: 'H' } };
  const only720 = { video_720: { url: 'L' } };
  assert.equal(pickVideoUrl(both, 'auto', true), 'L', 'auto on mobile data -> 720p');
  assert.equal(pickVideoUrl(both, 'auto', false), 'H', 'auto on Wi-Fi -> 1080p');
  assert.equal(pickVideoUrl(both, '720', false), 'L');
  assert.equal(pickVideoUrl(both, '1080', true), 'H');
  assert.equal(pickVideoUrl(only720, '1080', false), 'L', 'falls back when no 1080p version');
  assert.equal(pickVideoUrl({}, 'auto', false), null);
});

test('scheduling: times, prices, dates', () => {
  assert.equal(sch.parseTime('9'), '09:00');
  assert.equal(sch.parseTime('9:5'), '09:05');
  assert.equal(sch.parseTime('17.30'), '17:30');
  for (const bad of ['24:00', '12:60', 'ab', '', '1:2:3']) assert.equal(sch.parseTime(bad), null, bad);
  assert.equal(sch.minutesOf('09:30'), 570);
  assert.equal(sch.parseMoney('30'), 3000);
  assert.equal(sch.parseMoney('30,5'), 3050);
  assert.equal(sch.parseMoney('30.05'), 3005);
  assert.equal(sch.parseMoney('-1'), null);
  assert.equal(sch.parseMoney('1.234'), null);
  assert.ok(sch.isIsoDate('2026-12-25'));
  assert.ok(!sch.isIsoDate('2026-02-30'));
  assert.ok(!sch.isIsoDate('25.12.2026'));
});

test('scheduling: days in the organization time zone', () => {
  // 23:30 UTC on 19 Nov is already 20 Nov in Bucharest (UTC+2)
  assert.equal(sch.dayKey('2026-11-19T23:30:00Z', 'Europe/Bucharest'), '2026-11-20');
  assert.equal(sch.clock('2026-11-20T07:00:00+00:00', 'Europe/Bucharest', 'ro'), '09:00');
  assert.equal(sch.weekdayName(1, 'en'), 'Monday');
  assert.equal(sch.weekdayName(0, 'ro'), 'duminică');
  assert.match(sch.dayLabel('2026-11-20', 'en'), /Friday/);
  const g = sch.groupByDay([
    { starts_at: '2026-11-20T07:00:00Z' }, { starts_at: '2026-11-20T08:00:00Z' }, { starts_at: '2026-11-21T07:00:00Z' },
  ], 'Europe/Bucharest');
  assert.deepEqual(g.map((d) => [d.day, d.items.length]), [['2026-11-20', 2], ['2026-11-21', 1]]);
  assert.match(sch.formatMoney(3000, 'EUR', 'ro'), /30/);
});

test('scheduling: weeks and dates', () => {
  assert.equal(sch.addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(sch.weekStart('2026-11-19'), '2026-11-16', 'Thursday -> Monday');
  assert.equal(sch.weekStart('2026-11-22'), '2026-11-16', 'Sunday belongs to the week that started Monday');
  assert.equal(sch.untilForWeeks('2026-11-19', 3), '2026-12-09');
  assert.equal(sch.weeksBetween('2026-11-19', '2026-12-09'), 3);
  assert.equal(sch.addMinutes('18:00', 90), '19:30');
  assert.equal(sch.addMinutes('23:30', 60), null, 'a class may not pass midnight');
});

test('clash message names the existing entry, in both languages', () => {
  const err = { message: 'schedule_clash|3|18:00|19:00|Low kick' };
  assert.equal(errorText('en', err), 'This overlaps with Wednesday 18:00–19:00 (Low kick). Change the time or the days.');
  assert.equal(errorText('ro', err), 'Se suprapune cu miercuri 18:00–19:00 (Low kick). Schimbă ora sau zilele.');
  assert.equal(errorText('en', { message: 'schedule_clash|1|09:00|17:00|' }),
    'This overlaps with Monday 09:00–17:00. Change the time or the days.');
  assert.equal(errorText('en', { message: 'rule_has_bookings' }), en['error.rule_has_bookings']);
});
