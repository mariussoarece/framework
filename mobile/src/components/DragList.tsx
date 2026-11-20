// A list whose rows can be dragged into a new order by their handle (≡).
// Built on React Native's PanResponder + Animated: no extra packages, works in Expo Go.
// Screen readers: each row offers "move up" / "move down" actions instead of dragging.
import React, { useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View, type PanResponderInstance } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { dropIndex, moveItem, shiftFor } from '../lib/reorder';
import type { Theme } from '../theme/themes';

const ROW = 72;   // every row has the same height, so positions are easy to compute

export function DragList<T>({ items, keyOf, renderRow, onReorder, onDragging, theme, moveUpLabel, moveDownLabel }: {
  items: T[];
  keyOf: (item: T) => string;
  renderRow: (item: T) => React.ReactNode;
  onReorder: (next: T[]) => void;
  onDragging?: (active: boolean) => void;   // e.g. stop the page from scrolling meanwhile
  theme: Theme;
  moveUpLabel: string;
  moveDownLabel: string;
}) {
  const [from, setFrom] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dy = useRef(new Animated.Value(0)).current;
  const live = useRef({ from: -1, hover: -1 });   // current values inside the gesture callbacks
  // The gesture callbacks live as long as the list; they read the latest props through this ref,
  // so a redraw in the middle of a drag doesn't interrupt it.
  const latest = useRef({ items, onReorder, onDragging });
  latest.current = { items, onReorder, onDragging };
  const responders = useRef(new Map<number, PanResponderInstance>()).current;

  function finish() {
    const { items: list, onReorder: reorder, onDragging: drag } = latest.current;
    const { from: f, hover: h } = live.current;
    live.current = { from: -1, hover: -1 };
    dy.setValue(0);
    setFrom(null);
    setHover(null);
    drag?.(false);
    if (f >= 0 && h >= 0 && f !== h) reorder(moveItem(list, f, h));
  }

  function handleFor(index: number): PanResponderInstance {
    const existing = responders.get(index);
    if (existing) return existing;
    const created = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        live.current = { from: index, hover: index };
        setFrom(index);
        setHover(index);
        latest.current.onDragging?.(true);
      },
      onPanResponderMove: (_e, g) => {
        dy.setValue(g.dy);
        const h = dropIndex(index, g.dy, ROW, latest.current.items.length);
        if (h !== live.current.hover) {
          live.current.hover = h;
          setHover(h);
        }
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });
    responders.set(index, created);
    return created;
  }

  return (
    <View style={{ height: items.length * ROW }}>
      {items.map((item, i) => {
        const dragging = from === i;
        const shift = from !== null && hover !== null && !dragging ? shiftFor(i, from, hover, ROW) : 0;
        const handle = handleFor(i);
        return (
          <Animated.View
            key={keyOf(item)}
            accessible
            accessibilityActions={[{ name: 'moveUp', label: moveUpLabel }, { name: 'moveDown', label: moveDownLabel }]}
            onAccessibilityAction={(e) => {
              const to = e.nativeEvent.actionName === 'moveUp' ? i - 1 : i + 1;
              if (to >= 0 && to < items.length) onReorder(moveItem(items, i, to));
            }}
            style={[
              styles.row,
              { top: i * ROW, backgroundColor: theme.surface, borderColor: dragging ? theme.primary : theme.border },
              dragging
                ? { zIndex: 10, elevation: 6, shadowOpacity: 0.2, transform: [{ translateY: dy }, { scale: 1.03 }] }
                : { transform: [{ translateY: shift }] },
            ]}
          >
            <View {...handle.panHandlers} style={styles.handle} hitSlop={8}>
              <Ionicons name="reorder-three" size={30} color={dragging ? theme.primary : theme.muted} />
            </View>
            <View style={{ flex: 1 }}>{renderRow(item)}</View>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute', left: 0, right: 0, height: ROW - 8, borderRadius: 14, borderWidth: 1.5,
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 12,
    shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, shadowOpacity: 0,
  },
  handle: { width: 52, height: '100%', alignItems: 'center', justifyContent: 'center' },
});
