// Product / tile media is stored as { primaryUrl, gallery: [{ url }], thumbnailUrl? }.
// Older records use `images` instead of `gallery`; read both everywhere.

function entryUrl(entry: any): string {
  return typeof entry === 'string' ? entry : String(entry?.url || '');
}

export function mediaUrls(media: any): string[] {
  if (!media || typeof media !== 'object') return [];
  const entries = Array.isArray(media.gallery) ? media.gallery : Array.isArray(media.images) ? media.images : [];
  const urls = [media.primaryUrl || media.primaryImage || '', ...entries.map(entryUrl)].filter(Boolean);
  return urls.filter((url, index) => urls.indexOf(url) === index);
}

export function primaryImageUrl(media: any): string {
  return mediaUrls(media)[0] || '';
}

/** Small rendition for lists and search; falls back to the full image. */
export function thumbnailUrl(media: any): string {
  return String(media?.thumbnailUrl || '') || primaryImageUrl(media);
}

export function hasImage(media: any): boolean {
  return mediaUrls(media).length > 0;
}

/** True when a tile variant shows its design's image rather than its own. */
export function isInheritedFromDesign(media: any): boolean {
  return Boolean(media?.inheritedFromDesignId) && hasImage(media);
}

export function toMedia(urls: string[], thumbnail?: string | null) {
  const gallery = urls.filter(Boolean).map((url) => ({ url }));
  return {
    primaryUrl: gallery[0]?.url || null,
    gallery,
    ...(gallery.length && thumbnail ? { thumbnailUrl: thumbnail } : {}),
  };
}
