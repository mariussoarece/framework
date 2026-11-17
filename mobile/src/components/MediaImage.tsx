// A published picture from the VPS (fetches a signed link first).
import React, { useEffect, useState } from 'react';
import { Image, type ImageContentFit } from 'expo-image';
import type { StyleProp, ImageStyle } from 'react-native';
import { mediaLinks } from '../lib/api';

export function useMediaUrl(mediaId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (mediaId) {
      mediaLinks(mediaId)
        .then((l) => { if (alive) setUrl(l.image?.url ?? null); })
        .catch(() => { if (alive) setUrl(null); });
    }
    return () => { alive = false; };
  }, [mediaId]);
  return url;
}

export function MediaImage({ mediaId, style, contentFit = 'cover', label }: {
  mediaId: string | null | undefined;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  label?: string;
}) {
  const url = useMediaUrl(mediaId);
  if (!url) return null;
  // cache by media id, not by the (changing) signed URL
  return (
    <Image
      source={{ uri: url, cacheKey: `media-${mediaId}` }}
      style={style}
      contentFit={contentFit}
      transition={200}
      accessibilityLabel={label}
    />
  );
}
