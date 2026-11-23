// Full-screen pictures: black background, swipe left/right between the workout's pictures,
// pinch to zoom (iPhone), tap ✕ or the picture to close (Android: also the back button).
import React, { useEffect, useState } from 'react';
import { Dimensions, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mediaLinks } from '../lib/api';
import { useI18n } from '../i18n/I18nProvider';

type Pic = { id: string; url: string };

export function ImageViewer({ ids, startId, onClose }: {
  ids: string[];                 // all media of the workout; videos are skipped
  startId: string | null;        // the picture that was tapped; null = closed
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [pics, setPics] = useState<Pic[]>([]);
  const [index, setIndex] = useState(0);
  const { width, height } = Dimensions.get('window');
  // read here, outside the Modal: inside it the safe area is reported as 0 on iPhone,
  // which put the ✕ under the clock/battery where it can't be tapped
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!startId) { setPics([]); return; }   // closed: next opening starts at the tapped picture
    let alive = true;
    // the links are usually already on the phone (the page just showed these pictures)
    Promise.all(ids.map((id) => mediaLinks(id).then((l) => ({ id, l })).catch(() => null))).then((all) => {
      if (!alive) return;
      const list = all.flatMap((x) => (x && x.l.status === 'published' && x.l.kind !== 'video' && x.l.image
        ? [{ id: x.id, url: x.l.image.url }] : []));
      setPics(list);
      setIndex(Math.max(0, list.findIndex((p) => p.id === startId)));
    });
    return () => { alive = false; };
  }, [ids, startId]);

  const open = Boolean(startId) && pics.length > 0;
  return (
    <Modal visible={open} animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.back}>
        <FlatList
          data={pics}
          horizontal
          pagingEnabled
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          keyExtractor={(p) => p.id}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <ScrollView style={{ width, height }} contentContainerStyle={styles.center}
              maximumZoomScale={4} minimumZoomScale={1} centerContent
              showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
              {/* a single tap on the picture also closes it */}
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')}>
                <Image source={{ uri: item.url, cacheKey: `media-${item.id}` }} style={{ width, height }} contentFit="contain" />
              </Pressable>
            </ScrollView>
          )}
        />
        <View style={[styles.top, { top: insets.top + 8 }]} pointerEvents="box-none">
          {pics.length > 1 ? <Text style={styles.count}>{index + 1} / {pics.length}</Text> : <View />}
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')}
            style={styles.close}>
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: '#000000' },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  top: {
    position: 'absolute', left: 0, right: 0, flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16,
  },
  count: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  close: {
    width: 48, height: 48, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
});
