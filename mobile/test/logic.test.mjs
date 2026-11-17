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
for (const rel of ['src/i18n/en.ts', 'src/i18n/ro.ts', 'src/i18n/translate.ts', 'src/lib/richtext.ts']) {
  const src = readFileSync(join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
    .outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'");
  writeFileSync(join(out, rel.split('/').pop().replace('.ts', '.mjs')), js);
}
const load = (name) => import(pathToFileURL(join(out, name)).href);
const { en } = await load('en.mjs');
const { ro } = await load('ro.mjs');
const { translate, errorText, pickLanguage } = await load('translate.mjs');
const { toBlocks, plainText, safeHref } = await load('richtext.mjs');

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
