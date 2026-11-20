// "Monday 16 November –" on the first line, "Sunday 22 November" right-aligned on the second.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../theme/themes';

export function WeekRange({ from, to, theme }: { from: string; to: string; theme: Theme }) {
  const text = [styles.text, { color: theme.text }];
  return (
    <View style={styles.box} accessible accessibilityLabel={`${from} – ${to}`}>
      <Text style={[text, styles.first]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{from} –</Text>
      <Text style={[text, styles.second]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{to}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, paddingHorizontal: 8 },
  text: { fontSize: 15, fontWeight: '700', textTransform: 'capitalize' },
  first: { textAlign: 'left' },
  second: { textAlign: 'right' },
});
