import type { ImageBlock } from '../db/types';

export const MAX_DIMENSION_DEFAULT = 2000;

export class UnsupportedImageError extends Error {
  constructor(mime: string) {
    super(
      `Unsupported image format (${mime || 'unknown'}). ` +
        'This browser cannot decode it, so it was NOT saved — no reference number was assigned.',
    );
    this.name = 'UnsupportedImageError';
  }
}

export interface CodecSupport {
  webp: boolean;
}

let codecSupport: CodecSupport | null = null;

/** Detect WebP encode support ONCE at startup (PRD §2.1), not per capture. */
export async function detectCodecSupport(): Promise<CodecSupport> {
  if (codecSupport) return codecSupport;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const blob = await canvasToBlob(canvas, 'image/webp', 0.8);
    codecSupport = { webp: blob !== null && blob.type === 'image/webp' };
  } catch {
    codecSupport = { webp: false };
  }
  return codecSupport;
}

/** Test seam. */
export function setCodecSupportForTest(support: CodecSupport | null): void {
  codecSupport = support;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export function isHeic(file: { type?: string; name?: string }): boolean {
  const mime = (file.type ?? '').toLowerCase();
  const name = (file.name ?? '').toLowerCase();
  return (
    mime === 'image/heic' ||
    mime === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

export interface CodecChoice {
  mime: 'image/webp' | 'image/jpeg' | 'image/png';
  quality: number;
}

/** JPEG threshold below which a source JPEG is treated as non-photographic. */
const PHOTO_SIZE_THRESHOLD = 300 * 1024;

/**
 * Codec policy (PRD §2.1): WebP default (screenshots dominate), JPEG only when the
 * source is already a large JPEG (camera photo). PNG/JPEG fallback without WebP encode.
 */
export function chooseCodec(
  sourceMime: string,
  sourceBytes: number,
  support: CodecSupport,
): CodecChoice {
  const photographic = sourceMime === 'image/jpeg' && sourceBytes > PHOTO_SIZE_THRESHOLD;
  if (photographic) return { mime: 'image/jpeg', quality: 0.82 };
  if (support.webp) return { mime: 'image/webp', quality: 0.85 };
  return { mime: 'image/png', quality: 1 };
}

export function fitWithin(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const largest = Math.max(width, height);
  if (largest <= maxDimension) return { width, height };
  const scale = maxDimension / largest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decode honouring EXIF orientation (hard requirement, PRD §2.1): canvas re-encode
 * strips EXIF, so orientation must be applied at decode time or phone photos persist
 * sideways forever.
 */
async function decodeOriented(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new UnsupportedImageError(blob.type);
  }
}

/**
 * Full pipeline: decode (EXIF-aware) → downscale → re-encode per codec policy.
 * Transparency is preserved on the WebP/PNG paths (never flattened, PRD §2.1).
 * Throws UnsupportedImageError for undecodable input (e.g. HEIC outside Safari) —
 * an undecodable blob must never be persisted behind a valid ref_id.
 */
export async function processImage(
  file: Blob & { name?: string },
  maxDimension: number = MAX_DIMENSION_DEFAULT,
): Promise<Omit<ImageBlock, 'type'>> {
  const support = await detectCodecSupport();
  const bitmap = await decodeOriented(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxDimension);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const choice = chooseCodec(file.type, file.size, support);
    const blob = await canvasToBlob(canvas, choice.mime, choice.quality);
    if (!blob) throw new UnsupportedImageError(file.type);
    return { blob, mime: blob.type, width, height };
  } finally {
    bitmap.close();
  }
}
