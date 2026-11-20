// The dashed "+ Add ..." button used above lists (sections, workouts).
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '../theme/themes';

export function AddButton({ label, onPress, theme }: { label: string; onPress: () => void; theme: Theme }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.add, { borderColor: theme.primary, opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name="add-circle" size={26} color={theme.primary} />
      <Text style={[styles.text, { color: theme.primary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 2, borderStyle: 'dashed', borderRadius: 16, minHeight: 52,
  },
  text: { fontSize: 17, fontWeight: '700' },
});
