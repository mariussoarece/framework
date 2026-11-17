// Small shared building blocks.
import React from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View, type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DEFAULT_THEME, type Theme } from '../theme/themes';

export function Screen({ children, theme = DEFAULT_THEME, scroll = true, style }: {
  children: React.ReactNode; theme?: Theme; scroll?: boolean; style?: ViewStyle;
}) {
  const body = scroll
    ? <ScrollView contentContainerStyle={[styles.content, style]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    : <View style={[styles.content, { flex: 1 }, style]}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Title({ children, theme = DEFAULT_THEME }: { children: React.ReactNode; theme?: Theme }) {
  return <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">{children}</Text>;
}

export function Muted({ children, theme = DEFAULT_THEME, style }: {
  children: React.ReactNode; theme?: Theme; style?: object;
}) {
  return <Text style={[styles.muted, { color: theme.muted }, style]}>{children}</Text>;
}

export function Button({ label, onPress, busy, disabled, kind = 'primary', theme = DEFAULT_THEME, color }: {
  label: string; onPress: () => void; busy?: boolean; disabled?: boolean;
  kind?: 'primary' | 'secondary' | 'danger' | 'link'; theme?: Theme; color?: string;
}) {
  const bg = kind === 'primary' ? (color ?? theme.primary) : kind === 'danger' ? '#B3261E' : 'transparent';
  const fg = kind === 'primary' ? theme.onPrimary : kind === 'danger' ? '#FFFFFF' : (color ?? theme.primary);
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        kind === 'link' ? styles.link : null,
        { backgroundColor: bg, borderColor: kind === 'secondary' ? theme.border : 'transparent', opacity: off ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, theme = DEFAULT_THEME, ...input }: TextInputProps & {
  label: string; hint?: string; theme?: Theme;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.muted}
        {...input}
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
      />
      {hint ? <Muted theme={theme}>{hint}</Muted> : null}
    </View>
  );
}

export function Message({ text, kind = 'error' }: { text?: string | null; kind?: 'error' | 'info' }) {
  if (!text) return null;
  return (
    <Text accessibilityLiveRegion="polite"
      style={[styles.message, kind === 'error' ? styles.error : styles.info]}>{text}</Text>
  );
}

export function Loading({ theme = DEFAULT_THEME }: { theme?: Theme }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
      <ActivityIndicator color={theme.primary} />
    </View>
  );
}

export function Choice({ title, hint, selected, onPress, theme = DEFAULT_THEME }: {
  title: string; hint?: string; selected: boolean; onPress: () => void; theme?: Theme;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, {
        borderColor: selected ? theme.primary : theme.border,
        backgroundColor: theme.surface,
        borderWidth: selected ? 2 : 1,
      }]}
    >
      <Text style={[styles.choiceTitle, { color: theme.text }]}>{title}</Text>
      {hint ? <Muted theme={theme}>{hint}</Muted> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  muted: { fontSize: 15, lineHeight: 21 },
  button: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, borderWidth: 1 },
  link: { minHeight: 40 },
  buttonText: { fontSize: 17, fontWeight: '600' },
  field: { gap: 6 },
  label: { fontSize: 15, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17 },
  message: { fontSize: 15, padding: 12, borderRadius: 10, overflow: 'hidden' },
  error: { backgroundColor: '#FDECEA', color: '#8C1D18' },
  info: { backgroundColor: '#E8F2EC', color: '#1E4D36' },
  choice: { borderRadius: 12, padding: 16, gap: 4 },
  choiceTitle: { fontSize: 17, fontWeight: '600' },
});
