// Shows the owner's formatted description (bold, italic, underline, links, lists, alignment, fonts).
import React from 'react';
import { Linking, Text, View } from 'react-native';
import { toBlocks, type Span } from '../lib/richtext';
import type { RichDoc } from '../lib/types';
import type { Theme } from '../theme/themes';

const HEADING_SIZE: Record<number, number> = { 1: 26, 2: 22, 3: 19 };

function Spans({ spans, theme }: { spans: Span[]; theme: Theme }) {
  return (
    <>
      {spans.map((s, i) => (
        <Text
          key={i}
          onPress={s.href ? () => Linking.openURL(s.href!) : undefined}
          accessibilityRole={s.href ? 'link' : undefined}
          style={{
            fontWeight: s.bold ? '700' : undefined,
            fontStyle: s.italic ? 'italic' : undefined,
            textDecorationLine: s.underline || s.href ? 'underline' : undefined,
            color: s.href ? theme.primary : undefined,
            fontFamily: s.fontFamily,
          }}
        >
          {s.text}
        </Text>
      ))}
    </>
  );
}

export function RichText({ doc, theme }: { doc: RichDoc | null | undefined; theme: Theme }) {
  const blocks = toBlocks(doc);
  if (!blocks.length) return null;
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((b, i) => {
        if (b.kind === 'listItem') {
          return (
            <View key={i} style={{ flexDirection: 'row', paddingLeft: 8 + b.depth * 18, gap: 8 }}>
              <Text style={{ color: theme.text, fontSize: 16, lineHeight: 23 }}>{b.ordered ? `${b.index}.` : '•'}</Text>
              <Text style={{ color: theme.text, fontSize: 16, lineHeight: 23, flex: 1 }}>
                <Spans spans={b.spans} theme={theme} />
              </Text>
            </View>
          );
        }
        const size = b.kind === 'heading' ? HEADING_SIZE[b.level] ?? 18 : 16;
        return (
          <Text
            key={i}
            accessibilityRole={b.kind === 'heading' ? 'header' : undefined}
            style={{
              color: theme.text, fontSize: size, lineHeight: Math.round(size * 1.42),
              fontWeight: b.kind === 'heading' ? '700' : '400', textAlign: b.align,
            }}
          >
            <Spans spans={b.spans} theme={theme} />
          </Text>
        );
      })}
    </View>
  );
}
