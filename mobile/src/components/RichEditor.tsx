// Rich-text editor for owners (TipTap, through TenTap).
// In Expo Go: bold, italic, underline, strike, lists, links, headings, colors.
// Text alignment and font choice need TenTap's advanced setup (development build), added later.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { RichText as TenTapEditor, Toolbar, useEditorBridge } from '@10play/tentap-editor';
import type { RichDoc } from '../lib/types';
import type { Theme } from '../theme/themes';

export type EditorHandle = ReturnType<typeof useEditorBridge>;

export function useRichEditor(initial: RichDoc | null | undefined): EditorHandle {
  return useEditorBridge({
    autofocus: false,
    avoidIosKeyboard: true,
    initialContent: (initial ?? '') as never,
  });
}

// Reads the document; returns null when the editor is empty.
export async function editorDoc(editor: EditorHandle): Promise<RichDoc | null> {
  const json = (await editor.getJSON()) as RichDoc;
  const text = await editor.getText();
  return text.trim() ? json : null;
}

export function RichEditor({ editor, theme, height = 260 }: { editor: EditorHandle; theme: Theme; height?: number }) {
  return (
    <View style={[styles.box, { borderColor: theme.border, backgroundColor: '#FFFFFF' }]}>
      <View style={{ height }}>
        <TenTapEditor editor={editor} />
      </View>
      <Toolbar editor={editor} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
});
