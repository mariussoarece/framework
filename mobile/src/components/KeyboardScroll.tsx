// A ScrollView that keeps the field you're typing in visible above the keyboard.
// iOS: the scroll view gets extra space for the keyboard (automaticallyAdjustKeyboardInsets).
// Android: the screen shrinks above the keyboard (KeyboardAvoidingView).
// Both: after the keyboard opens, it scrolls so the focused field sits just above it.
import React, { useEffect, useRef } from 'react';
import {
  Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, type ScrollViewProps,
} from 'react-native';

const MARGIN = 24;   // space between the field and the keyboard

export function KeyboardScroll({ children, onScroll, style, ...rest }: ScrollViewProps & { children: React.ReactNode }) {
  const ref = useRef<ScrollView>(null);
  const offset = useRef(0);
  const keyboardTop = useRef<number | null>(null);

  const revealRef = useRef<() => void>(() => {});

  useEffect(() => {
    function reveal() {
      const input = TextInput.State.currentlyFocusedInput?.() as
        | { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void }
        | null;
      const top = keyboardTop.current;
      if (!input?.measureInWindow || top === null) return;
      input.measureInWindow((_x, y, _w, h) => {
        const overlap = y + h + MARGIN - top;
        if (overlap > 0) ref.current?.scrollTo({ y: offset.current + overlap, animated: true });
      });
    }
    revealRef.current = reveal;
    const shown = Keyboard.addListener('keyboardDidShow', (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      // Android resizes the screen first; give it a moment
      setTimeout(reveal, Platform.OS === 'android' ? 120 : 0);
    });
    const changed = Keyboard.addListener('keyboardDidChangeFrame', (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      setTimeout(reveal, 0);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => { keyboardTop.current = null; });
    return () => { shown.remove(); changed.remove(); hidden.remove(); };
  }, []);

  const scroll = (
    <ScrollView
      ref={ref}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      scrollEventThrottle={16}
      style={style}
      {...rest}
      onScroll={(e) => { offset.current = e.nativeEvent.contentOffset.y; onScroll?.(e); }}
      // switching to another field while the keyboard is open: bring that one into view too
      onTouchEnd={() => { if (keyboardTop.current !== null) setTimeout(() => revealRef.current(), 150); }}
    >
      {children}
    </ScrollView>
  );

  if (Platform.OS === 'ios') return scroll;
  const bg = (StyleSheet.flatten(style) as { backgroundColor?: string } | undefined)?.backgroundColor;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: bg }} behavior="padding">
      {scroll}
    </KeyboardAvoidingView>
  );
}

