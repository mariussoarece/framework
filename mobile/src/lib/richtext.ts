// Turns the owner's TipTap document into simple blocks the app can draw.
// Pure functions (no React) so they can be tested with plain Node.
import type { RichDoc, RichNode } from './types';

export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  highlight?: string;
  href?: string;
  fontFamily?: string;
};

export type Block =
  | { kind: 'paragraph'; align: Align; spans: Span[] }
  | { kind: 'heading'; level: number; align: Align; spans: Span[] }
  | { kind: 'listItem'; ordered: boolean; index: number; depth: number; spans: Span[] };

export type Align = 'left' | 'center' | 'right' | 'justify';

const ALIGNS: Align[] = ['left', 'center', 'right', 'justify'];
const align = (n: RichNode): Align =>
  ALIGNS.includes(n.attrs?.textAlign as Align) ? (n.attrs?.textAlign as Align) : 'left';

// Only http(s) and mailto links are opened.
export function safeHref(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined;
  return /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : undefined;
}

// Accepts #rgb / #rrggbb / rgb(...) colors only.
export function cssColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const c = v.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) || /^rgba?\([\d\s.,%]+\)$/i.test(c) ? c : undefined;
}

function spansOf(nodes: RichNode[] = []): Span[] {
  const spans: Span[] = [];
  for (const n of nodes) {
    if (n.type === 'hardBreak') {
      spans.push({ text: '\n' });
      continue;
    }
    if (n.type !== 'text' || !n.text) continue;
    const s: Span = { text: n.text };
    for (const m of n.marks ?? []) {
      if (m.type === 'bold') s.bold = true;
      else if (m.type === 'italic') s.italic = true;
      else if (m.type === 'underline') s.underline = true;
      else if (m.type === 'strike') s.strike = true;
      else if (m.type === 'highlight') s.highlight = cssColor(m.attrs?.color) ?? '#FFF3A3';
      else if (m.type === 'link') s.href = safeHref(m.attrs?.href);
      else if (m.type === 'textStyle') {
        if (typeof m.attrs?.fontFamily === 'string') s.fontFamily = m.attrs.fontFamily as string;
        const c = cssColor(m.attrs?.color);
        if (c) s.color = c;
      }
    }
    spans.push(s);
  }
  return spans;
}

function walkList(list: RichNode, depth: number, out: Block[]) {
  const ordered = list.type === 'orderedList';
  const start = Number(list.attrs?.start ?? 1);
  (list.content ?? []).forEach((item, i) => {
    let first = true;
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        walkList(child, depth + 1, out);
      } else if (first) {
        out.push({ kind: 'listItem', ordered, index: start + i, depth, spans: spansOf(child.content) });
        first = false;
      } else {
        out.push({ kind: 'paragraph', align: align(child), spans: spansOf(child.content) });
      }
    }
  });
}

export function toBlocks(doc: RichDoc | null | undefined): Block[] {
  const out: Block[] = [];
  for (const n of doc?.content ?? []) {
    if (n.type === 'paragraph') out.push({ kind: 'paragraph', align: align(n), spans: spansOf(n.content) });
    else if (n.type === 'heading') {
      out.push({ kind: 'heading', level: Number(n.attrs?.level ?? 2), align: align(n), spans: spansOf(n.content) });
    } else if (n.type === 'bulletList' || n.type === 'orderedList') walkList(n, 0, out);
  }
  return out;
}

export function plainText(doc: RichDoc | null | undefined): string {
  return toBlocks(doc).map((b) => b.spans.map((s) => s.text).join('')).join('\n').trim();
}
