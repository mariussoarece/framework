// A published picture from the VPS (fetches a signed link first).
import React, { useEffect, useState } from 'react';
import { Image, type ImageContentFit } from 'expo-image';
import type { StyleProp, ImageStyle } from 'react-native';
import { mediaLinks } from '../lib/api';

// refreshKey: change it (e.g. on pull-to-refresh) to ask the server again.
export function useMediaUrl(mediaId: string | null | undefined, refreshKey = 0): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (mediaId) {
      mediaLinks(mediaId)
        .then((l) => { if (alive) setUrl(l.image?.url ?? null); })
        .catch(() => { if (alive) setUrl(null); });
    } else setUrl(null);
    return () => { alive = false; };
  }, [mediaId, refreshKey]);
  return url;
}

export function MediaImage({ mediaId, style, contentFit = 'cover', label, refreshKey, onSize }: {
  mediaId: string | null | undefined;
  refreshKey?: number;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  label?: string;
  onSize?: (width: number, height: number) => void;   // the picture's own size, once loaded
}) {
  const url = useMediaUrl(mediaId, refreshKey);
  if (!url) return null;
  // cache by media id, not by the (changing) signed URL
  return (
    <Image
      source={{ uri: url, cacheKey: `media-${mediaId}` }}
      style={style}
      contentFit={contentFit}
      transition={200}
      accessibilityLabel={label}
      onLoad={onSize ? (e) => onSize(e.source.width, e.source.height) : undefined}
    />
  );
}
