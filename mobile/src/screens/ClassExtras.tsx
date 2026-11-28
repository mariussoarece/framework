// Owner, class form: the class picture and its description (rich text, like a workout's).
// Remounted (key) for each class edited, so the editor starts with that class's text.
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { MediaImage } from '../components/MediaImage';
import { RichEditor, useRichEditor, type EditorHandle } from '../components/RichEditor';
import { pickMedia } from '../components/media';
import { useI18n } from '../i18n/I18nProvider';
import type { RichDoc } from '../lib/types';
import type { PickedAsset } from '../lib/upload';
import type { Theme } from '../theme/themes';

export type ClassPicture = { mediaId: string | null; picked: PickedAsset | null };

export function ClassExtras({ theme, initialDoc, picture, setPicture, onEditor }: {
  theme: Theme;
  initialDoc: RichDoc | null | undefined;
  picture: ClassPicture;
  setPicture: (p: ClassPicture) => void;
  onEditor: (e: EditorHandle) => void;
}) {
  const { t } = useI18n();
  const editor = useRichEditor(initialDoc);
  useEffect(() => { onEditor(editor); }, [editor, onEditor]);

  async function choose() {
    const [a] = await pickMedia({ allowVideo: false, multiple: false, permissionText: t('media.permission') });
    if (a) setPicture({ mediaId: null, picked: a });
  }

  const has = picture.picked || picture.mediaId;
  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.label, { color: theme.text }]}>{t('class.picture')}</Text>
      {has ? (
        <View style={{ gap: 8 }}>
          {picture.picked
            ? <Image source={{ uri: picture.picked.uri }} style={styles.picture} contentFit="cover" />
            : <MediaImage mediaId={picture.mediaId} style={styles.picture} />}
          <View style={styles.row}>
            <Pressable onPress={choose} style={[styles.small, { borderColor: theme.border }]} accessibilityRole="button">
              <Ionicons name="image-outline" size={18} color={theme.text} />
              <Text style={{ color: theme.text }}>{t('class.changePicture')}</Text>
            </Pressable>
            <Pressable onPress={() => setPicture({ mediaId: null, picked: null })}
              style={[styles.small, { borderColor: theme.border }]} accessibilityRole="button">
              <Ionicons name="trash-outline" size={18} color={theme.text} />
              <Text style={{ color: theme.text }}>{t('class.removePicture')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={choose} accessibilityRole="button"
          style={[styles.add, { borderColor: theme.primary }]}>
          <Ionicons name="image-outline" size={22} color={theme.primary} />
          <Text style={{ color: theme.primary, fontWeight: '700' }}>{t('class.addPicture')}</Text>
        </Pressable>
      )}

      <Text style={[styles.label, { color: theme.text }]}>{t('class.description')}</Text>
      <RichEditor editor={editor} theme={theme} height={200} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: '600' },
  picture: { width: '100%', aspectRatio: 16 / 9, borderRadius: 14 },
  row: { flexDirection: 'row', gap: 10 },
  small: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 2, borderStyle: 'dashed', borderRadius: 14, minHeight: 52 },
});
