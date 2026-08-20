import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UnsupportedImageError,
  chooseCodec,
  fitWithin,
  isHeic,
  processImage,
  setCodecSupportForTest,
} from '../src/images/pipeline';
import { shouldAutoBackup } from '../src/backup/autoBackup';
import { exportFilename, slugify } from '../src/backup/format';

afterEach(() => {
  setCodecSupportForTest(null);
  vi.unstubAllGlobals();
});

describe('codec policy (PRD §2.1)', () => {
  const webpYes = { webp: true };
  const webpNo = { webp: false };

  it('defaults to WebP ~0.85 for screenshots and flat content', () => {
    expect(chooseCodec('image/png', 500_000, webpYes)).toEqual({
      mime: 'image/webp',
      quality: 0.85,
    });
  });

  it('uses JPEG ~0.82 only for large photographic JPEG sources', () => {
    expect(chooseCodec('image/jpeg', 2_000_000, webpYes)).toEqual({
      mime: 'image/jpeg',
      quality: 0.82,
    });
    // Small JPEG (not a camera photo) still goes WebP.
    expect(chooseCodec('image/jpeg', 50_000, webpYes).mime).toBe('image/webp');
  });

  it('falls back to PNG for flat content and JPEG for photos without WebP encode', () => {
    expect(chooseCodec('image/png', 500_000, webpNo).mime).toBe('image/png');
    expect(chooseCodec('image/jpeg', 2_000_000, webpNo).mime).toBe('image/jpeg');
  });
});

describe('resize', () => {
  it('caps the longest side at the max dimension preserving aspect', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(1000, 4000, 2000)).toEqual({ width: 500, height: 2000 });
  });
  it('never upscales', () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });
});

describe('HEIC handling (PRD §2.1)', () => {
  it('detects HEIC/HEIF by MIME and extension', () => {
    expect(isHeic({ type: 'image/heic' })).toBe(true);
    expect(isHeic({ type: '', name: 'IMG_0042.HEIC' })).toBe(true);
    expect(isHeic({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(false);
  });
});

describe('Phase 1 verify gate: EXIF orientation honoured before re-encode', () => {
  function stubCanvas(toBlobResult: Blob | null) {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void) => cb(toBlobResult),
    };
    vi.stubGlobal('document', { createElement: () => canvas });
    return canvas;
  }

  it("decodes with imageOrientation:'from-image' so rotated photos persist upright", async () => {
    setCodecSupportForTest({ webp: true });
    const encoded = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
    stubCanvas(encoded);
    const bitmapSpy = vi.fn(async () => ({ width: 300, height: 400, close: vi.fn() }));
    vi.stubGlobal('createImageBitmap', bitmapSpy);

    const input = new Blob([new Uint8Array(1000)], { type: 'image/jpeg' });
    const result = await processImage(input);

    expect(bitmapSpy).toHaveBeenCalledWith(input, { imageOrientation: 'from-image' });
    // Dimensions come from the ORIENTED bitmap (post-rotation), not raw EXIF-less data.
    expect(result.width).toBe(300);
    expect(result.height).toBe(400);
    expect(result.mime).toBe('image/webp');
  });

  it('never persists an undecodable blob behind a valid ref_id', async () => {
    setCodecSupportForTest({ webp: true });
    stubCanvas(null);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('decode failure');
      }),
    );
    const heic = new Blob([new Uint8Array(10)], { type: 'image/heic' });
    await expect(processImage(heic)).rejects.toBeInstanceOf(UnsupportedImageError);
  });
});

describe('backup cadence + filenames (PRD §2.4, §3.C)', () => {
  it('fires after every N captures', () => {
    expect(shouldAutoBackup(25, 25, '2026-08-12', '2026-08-12').fire).toBe(true);
    expect(shouldAutoBackup(24, 25, '2026-08-12', '2026-08-12').fire).toBe(false);
  });
  it('fires on the first capture of a new day', () => {
    expect(shouldAutoBackup(1, 25, '2026-08-11', '2026-08-12')).toEqual({
      fire: true,
      reason: 'new_day',
    });
  });
  it('builds slugged, dated filenames', () => {
    expect(slugify('Quarter Three! (2026)')).toBe('quarter-three-2026');
    expect(exportFilename('My Proj', 'zip', new Date(2026, 7, 12))).toBe(
      'insightyyy_my-proj_2026-08-12.zip',
    );
  });
});
