// Media building blocks: picking from the phone, video player, gallery, status tiles.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Network from 'expo-network';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { mediaLinks, type MediaLinks } from '../lib/api';
import { pickVideoUrl } from '../lib/video';
import type { PickedAsset } from '../lib/upload';
import type { VideoQuality } from '../lib/types';
import type { Theme } from '../theme/themes';

// ---------------------------------------------------------------- picking
export async function pickMedia(opts: {
  allowVideo: boolean;
  multiple: boolean;
  permissionText: string;
}): Promise<PickedAsset[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(opts.permissionText);
    return [];
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: opts.allowVideo ? ['images', 'videos'] : ['images'],
    allowsMultipleSelection: opts.multiple,
    quality: 0.85,                // also converts iPhone HEIC photos to JPEG
    videoMaxDuration: 600,
  });
  if (res.canceled) return [];
  return res.assets.map((a) => ({
    uri: a.uri,
    kind: a.type === 'video' ? 'video' : 'image',
    mimeType: a.mimeType ?? null,
  }));
}

// ---------------------------------------------------------------- video
export function VideoPlayer({ uri, headers, style }: {
  uri: string; headers?: Record<string, string>; style?: object;
}) {
  const player = useVideoPlayer({ uri, headers }, (p) => { p.loop = false; });
  return <VideoView player={player} style={style ?? styles.media} nativeControls allowsFullscreen contentFit="contain" />;
}

function useCellular(): boolean {
  const [cellular, setCellular] = useState(false);
  useEffect(() => {
    Network.getNetworkStateAsync()
      .then((s) => setCellular(s.type === Network.NetworkStateType.CELLULAR))
      .catch(() => setCellular(false));
  }, []);
  return cellular;
}

// One published picture or video, fetched through a signed link.
export function MediaItem({ mediaId, quality, theme, width }: {
  mediaId: string; quality: VideoQuality; theme: Theme; width: number;
}) {
  const [links, setLinks] = useState<MediaLinks | null>(null);
  const [failed, setFailed] = useState(false);
  const cellular = useCellular();

  useEffect(() => {
    let alive = true;
    mediaLinks(mediaId).then((l) => { if (alive) setLinks(l); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [mediaId]);

  const box = { width, height: Math.round(width * 0.75) };
  if (failed) return null;
  if (!links) return <View style={[styles.placeholder, box]}><ActivityIndicator color={theme.primary} /></View>;
  if (links.status !== 'published') return <PendingTile status={links.status} theme={theme} style={box} />;

  if (links.kind === 'video') {
    const url = pickVideoUrl(links, quality, cellular);
    return url ? <VideoPlayer uri={url} style={[styles.media, box]} /> : null;
  }
  return links.image
    ? <Image source={{ uri: links.image.url, cacheKey: `media-${mediaId}` }} style={[styles.media, box]} contentFit="contain" />
    : null;
}

export function MediaGallery({ ids, quality, theme }: { ids: string[]; quality: VideoQuality; theme: Theme }) {
  const width = Dimensions.get('window').width - 40;
  if (!ids.length) return null;
  if (ids.length === 1) return <MediaItem mediaId={ids[0]} quality={quality} theme={theme} width={width} />;
  return (
    <FlatList
      data={ids}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator
      keyExtractor={(id) => id}
      renderItem={({ item }) => <MediaItem mediaId={item} quality={quality} theme={theme} width={width} />}
      ItemSeparatorComponent={() => <View style={{ width: 0 }} />}
    />
  );
}

// Grey tile with "Waiting for approval" / "Not approved".
export function PendingTile({ status, theme, style, label }: {
  status: string; theme: Theme; style?: object; label?: string;
}) {
  const rejected = status === 'rejected';
  return (
    <View style={[styles.placeholder, { borderColor: theme.border }, style]}>
      <Ionicons name={rejected ? 'close-circle-outline' : 'time-outline'} size={26} color={rejected ? '#B3261E' : theme.muted} />
      {label ? <Text style={{ color: theme.muted, fontSize: 13, textAlign: 'center' }}>{label}</Text> : null}
    </View>
  );
}

// Small square used in edit forms: local picks, existing media, remove button.
export function Thumb({ uri, kind, status, statusLabel, onRemove, theme }: {
  uri?: string | null; kind: 'image' | 'video'; status?: string; statusLabel?: string;
  onRemove?: () => void; theme: Theme;
}) {
  return (
    <View style={styles.thumbWrap}>
      {uri && kind === 'image'
        ? <Image source={{ uri }} style={styles.thumb} contentFit="cover" />
        : (
          <View style={[styles.thumb, styles.placeholder, { borderColor: theme.border }]}>
            <Ionicons name={kind === 'video' ? 'videocam-outline' : 'image-outline'} size={26} color={theme.muted} />
          </View>
        )}
      {statusLabel ? (
        <Text style={[styles.badge, status === 'rejected' ? styles.badgeBad : null]} numberOfLines={2}>{statusLabel}</Text>
      ) : null}
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} style={styles.remove} accessibilityRole="button" accessibilityLabel="remove">
          <Ionicons name="close" size={16} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  media: { width: '100%', aspectRatio: 4 / 3, borderRadius: 14, backgroundColor: '#000000' },
  placeholder: {
    alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', gap: 6, padding: 8,
  },
  thumbWrap: { width: 96, gap: 4 },
  thumb: { width: 96, height: 96, borderRadius: 10 },
  badge: { fontSize: 11, color: '#6F5B00', backgroundColor: '#FFF3C4', borderRadius: 6, paddingHorizontal: 4, overflow: 'hidden' },
  badgeBad: { color: '#8C1D18', backgroundColor: '#FDECEA' },
  remove: {
    position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
});
