// Owner: theme, background and front image, description, button labels/icons/colors.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Message, Muted, Screen } from '../src/components/ui';
import { pickMedia, Thumb } from '../src/components/media';
import { RichEditor, editorDoc, useRichEditor } from '../src/components/RichEditor';
import { useI18n } from '../src/i18n/I18nProvider';
import { deleteMedia, mediaStatus, saveHome } from '../src/lib/data';
import { useSession } from '../src/lib/session';
import { uploadAsset, type MediaRow, type PickedAsset } from '../src/lib/upload';
import type { HomeButton } from '../src/lib/types';
import { DEFAULT_THEME, ICONS, iconFor, THEMES, themeFor } from '../src/theme/themes';

const COLORS = ['#4F7D6B', '#1F6FA8', '#D9643A', '#C62828', '#7B4FA0', '#111111', '#B8860B', '#2E7D32'];

type ImageSlot = { mediaId: string | null; picked: PickedAsset | null };

export default function EditHome() {
  const { t, tError } = useI18n();
  const { org, home, buttons, profile, refresh } = useSession();
  const [themeKey, setThemeKey] = useState(home?.theme_key ?? DEFAULT_THEME.key);
  const [bg, setBg] = useState<ImageSlot>({ mediaId: home?.background_media_id ?? null, picked: null });
  const [fg, setFg] = useState<ImageSlot>({ mediaId: home?.foreground_media_id ?? null, picked: null });
  const [btns, setBtns] = useState<HomeButton[]>(buttons);
  const [statuses, setStatuses] = useState<Record<string, MediaRow>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editor = useRichEditor(home?.description);
  const theme = themeFor(themeKey);

  useEffect(() => {
    mediaStatus([home?.background_media_id, home?.foreground_media_id].filter(Boolean) as string[])
      .then(setStatuses).catch(() => {});
  }, [home?.background_media_id, home?.foreground_media_id]);

  if (profile?.role !== 'owner' || !org) return null;

  const statusLabel = (id: string | null) => {
    const s = id ? statuses[id]?.status : undefined;
    return s === 'pending' || s === 'approved' ? t('media.pending') : s === 'rejected' ? t('media.rejected') : undefined;
  };

  async function choose(set: (s: ImageSlot) => void) {
    const [a] = await pickMedia({ allowVideo: false, multiple: false, permissionText: t('media.permission') });
    if (a) set({ mediaId: null, picked: a });
  }

  async function uploadSlot(slot: ImageSlot, n: number, total: number): Promise<string | null> {
    if (!slot.picked) return slot.mediaId;
    const row = await uploadAsset(slot.picked, {
      onProgress: (f) => setProgress(t('media.uploading', { current: n, total, percent: Math.round(f * 100) })),
    });
    return row.id;
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const total = [bg, fg].filter((s) => s.picked).length;
      let n = 0;
      const bgId = await uploadSlot(bg, bg.picked ? ++n : n, total);
      const fgId = await uploadSlot(fg, fg.picked ? ++n : n, total);
      setProgress(null);
      await saveHome(org!.id, {
        theme_key: themeKey,
        background_media_id: bgId,
        foreground_media_id: fgId,
        description: await editorDoc(editor),
      }, btns.map((b) => ({ ...b, label: b.label.trim() || (b.type === 'scheduling' ? 'Scheduling' : 'Workout Maintenance') })));
      // images that were replaced or removed: delete them (and their files)
      const old = [home?.background_media_id, home?.foreground_media_id].filter(Boolean) as string[];
      await deleteMedia(old.filter((id) => id !== bgId && id !== fgId)).catch(() => {});
      await refresh();
      router.back();
    } catch (err) {
      setError(tError(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const ImageField = ({ label, hint, slot, set }: {
    label: string; hint?: string; slot: ImageSlot; set: (s: ImageSlot) => void;
  }) => (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Muted>{hint}</Muted> : null}
      <View style={styles.row}>
        {slot.picked || slot.mediaId ? (
          <Thumb uri={slot.picked?.uri} kind="image" theme={theme}
            status={slot.mediaId ? statuses[slot.mediaId]?.status : undefined}
            statusLabel={slot.picked ? undefined : statusLabel(slot.mediaId)}
            onRemove={() => set({ mediaId: null, picked: null })} />
        ) : null}
        <View style={{ flex: 1 }}>
          <Button kind="secondary" label={t('edit.choose')} onPress={() => choose(set)} />
        </View>
      </View>
    </View>
  );

  return (
    <Screen header>
      <Message text={error} />

      <Text style={styles.label}>{t('edit.theme')}</Text>
      <View style={styles.wrap}>
        {THEMES.map((th) => (
          <Pressable key={th.key} onPress={() => setThemeKey(th.key)} accessibilityRole="radio"
            accessibilityState={{ selected: themeKey === th.key }}
            style={[styles.themeChip, { backgroundColor: th.background, borderColor: themeKey === th.key ? th.primary : th.border, borderWidth: themeKey === th.key ? 3 : 1 }]}>
            <View style={[styles.dot, { backgroundColor: th.primary }]} />
            <Text style={{ color: th.text, fontWeight: '600' }}>{th.name}</Text>
          </Pressable>
        ))}
      </View>

      <ImageField label={t('edit.background')} slot={bg} set={setBg} />
      <ImageField label={t('edit.foreground')} hint={t('edit.foregroundHint')} slot={fg} set={setFg} />
      <Muted>{t('media.approvalNote')}</Muted>

      <Text style={styles.label}>{t('edit.description')}</Text>
      <Muted>{t('edit.descriptionHint')}</Muted>
      <RichEditor editor={editor} theme={theme} />

      <Text style={styles.label}>{t('edit.buttons')}</Text>
      {btns.map((b, i) => (
        <View key={b.id} style={[styles.card, { borderColor: theme.border }]}>
          <View style={[styles.preview, { backgroundColor: b.color }]}>
            <Ionicons name={iconFor(b.icon) as never} size={24} color="#FFFFFF" />
            <Text style={styles.previewText} numberOfLines={1}>{b.label || ' '}</Text>
          </View>
          <Text style={styles.small}>{t('edit.label')}</Text>
          <TextInput value={b.label} maxLength={40} style={[styles.input, { borderColor: theme.border }]}
            onChangeText={(v) => setBtns(btns.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
          <Text style={styles.small}>{t('edit.icon')}</Text>
          <View style={styles.wrap}>
            {Object.keys(ICONS).map((k) => (
              <Pressable key={k} onPress={() => setBtns(btns.map((x, j) => (j === i ? { ...x, icon: k } : x)))}
                accessibilityRole="radio" accessibilityState={{ selected: b.icon === k }}
                style={[styles.iconChip, { borderColor: b.icon === k ? b.color : theme.border, borderWidth: b.icon === k ? 2 : 1 }]}>
                <Ionicons name={iconFor(k) as never} size={22} color={theme.text} />
              </Pressable>
            ))}
          </View>
          <Text style={styles.small}>{t('edit.color')}</Text>
          <View style={styles.wrap}>
            {COLORS.map((c) => (
              <Pressable key={c} onPress={() => setBtns(btns.map((x, j) => (j === i ? { ...x, color: c } : x)))}
                accessibilityRole="radio" accessibilityState={{ selected: b.color.toUpperCase() === c }}
                style={[styles.color, { backgroundColor: c, borderWidth: b.color.toUpperCase() === c ? 3 : 0 }]} />
            ))}
          </View>
        </View>
      ))}

      {progress ? <Message kind="info" text={progress} /> : null}
      <Button label={t('common.save')} onPress={save} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 17, fontWeight: '700', color: '#2E2A24', marginTop: 8 },
  small: { fontSize: 14, fontWeight: '600', color: '#6F675C' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  themeChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, minHeight: 56, paddingHorizontal: 16 },
  previewText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', flex: 1 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  iconChip: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  color: { width: 36, height: 36, borderRadius: 18, borderColor: '#000000' },
});
