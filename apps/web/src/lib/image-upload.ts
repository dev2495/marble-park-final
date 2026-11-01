import { gql } from '@apollo/client';

// Every catalogue image is resized and compressed in the browser before upload:
// phone photos (often 5–15 MB) become ~150–400 KB, fit the server's 5 MB limit,
// upload fast on shop Wi-Fi and keep the server disk small.

export const UPLOAD_IMAGE_ASSET = gql`
  mutation UploadCatalogueImage($filename: String!, $contentBase64: String!, $scope: String) {
    uploadStoredAsset(filename: $filename, contentBase64: $contentBase64, scope: $scope) {
      id
      result
    }
  }
`;

export const IMAGE_RULES = {
  fullEdge: 1600,
  thumbEdge: 480,
  maxSourceBytes: 25 * 1024 * 1024,
  maxUploadBytes: 5 * 1024 * 1024,
  extensions: ['jpg', 'jpeg', 'png', 'webp'],
} as const;

export type PreparedImage = {
  full: Blob;
  thumb: Blob;
  extension: 'webp' | 'jpg';
  width: number;
  height: number;
  originalBytes: number;
};

let webpSupport: boolean | null = null;
function canEncodeWebp() {
  if (webpSupport !== null) return webpSupport;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    webpSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

async function decode(source: Blob): Promise<{ draw: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' } as any);
      return { draw: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Older Safari rejects the options bag; fall through to <img>.
    }
  }
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return { draw: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('This file could not be read as an image. Use JPG, PNG or WebP.');
  }
}

function encode(draw: CanvasImageSource, width: number, height: number, maxEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image compression is not available in this browser.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(draw, 0, 0, canvas.width, canvas.height);
  const type = canEncodeWebp() ? 'image/webp' : 'image/jpeg';
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image compression failed.'))), type, quality));
}

/** Resize to 1600px (full) and 480px (thumbnail) and compress. */
export async function prepareImage(source: Blob): Promise<PreparedImage> {
  if (source.size > IMAGE_RULES.maxSourceBytes) {
    throw new Error(`Image is ${(source.size / 1048576).toFixed(1)} MB; the limit is 25 MB before compression.`);
  }
  const decoded = await decode(source);
  try {
    let quality = 0.82;
    let full = await encode(decoded.draw, decoded.width, decoded.height, IMAGE_RULES.fullEdge, quality);
    while (full.size > IMAGE_RULES.maxUploadBytes && quality > 0.5) {
      quality -= 0.1;
      full = await encode(decoded.draw, decoded.width, decoded.height, IMAGE_RULES.fullEdge, quality);
    }
    const thumb = await encode(decoded.draw, decoded.width, decoded.height, IMAGE_RULES.thumbEdge, 0.78);
    return {
      full,
      thumb,
      extension: full.type === 'image/webp' ? 'webp' : 'jpg',
      width: decoded.width,
      height: decoded.height,
      originalBytes: source.size,
    };
  } finally {
    decoded.close();
  }
}

export function blobBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

type UploadFn = (options: { variables: { filename: string; contentBase64: string; scope: string } }) => Promise<any>;

/** Compress, then upload full image and thumbnail. Returns their public URLs. */
export async function uploadCompressedImage(upload: UploadFn, source: Blob, baseName: string, scope = 'tile-design-image') {
  const prepared = await prepareImage(source);
  const safeBase = baseName.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  const send = async (blob: Blob, suffix: string) => {
    const response = await upload({ variables: { filename: `${safeBase}${suffix}.${prepared.extension}`, contentBase64: await blobBase64(blob), scope } });
    const url = response?.data?.uploadStoredAsset?.result?.publicUrl;
    if (!url) throw new Error('The server did not return an image URL.');
    return String(url);
  };
  const url = await send(prepared.full, '');
  const thumbnail = await send(prepared.thumb, '-thumb');
  return { url, thumbnailUrl: thumbnail, bytes: prepared.full.size, originalBytes: prepared.originalBytes };
}
