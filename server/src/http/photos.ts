import { randomBytes } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { PROFILE_RULES } from '@apex/shared';
import { HttpError } from './router.ts';

/** Stored photo file names: 32 hex characters + .webp (random, so URLs never collide or leak). */
export const PHOTO_FILE = /^[a-f0-9]{32}\.webp$/;

const ALLOWED = ['jpeg', 'png', 'webp'] as const;

/** The real file type from the first bytes, ignoring whatever name/extension it came with. */
export function sniffImageType(buf: Buffer): (typeof ALLOWED)[number] | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Validates an uploaded photo and turns it into a 256×256 WebP: JPEG / PNG / WebP only (checked
 * by content, then by actually decoding it), ≤ 5 MB, centre-cropped, EXIF/metadata stripped
 * (sharp drops it unless asked to keep it). Throws HttpError 400/413 for anything else.
 */
export async function processPhoto(buf: Buffer): Promise<Buffer> {
  if (buf.length === 0) throw new HttpError(400, 'empty upload');
  if (buf.length > PROFILE_RULES.photoMaxBytes) throw new HttpError(413, 'photo larger than 5 MB');
  const sniffed = sniffImageType(buf);
  if (!sniffed) throw new HttpError(400, 'only JPEG, PNG or WebP images');
  let meta: Metadata;
  try {
    // limitInputPixels guards against decompression bombs (tiny file, enormous image).
    meta = await sharp(buf, { failOn: 'error', limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw new HttpError(400, 'not a valid image');
  }
  if (meta.format !== sniffed || !meta.width || !meta.height) throw new HttpError(400, 'not a valid image');
  try {
    const size = PROFILE_RULES.photoSize;
    return await sharp(buf, { failOn: 'error', limitInputPixels: 50_000_000 })
      .rotate() // honour the camera's orientation before the metadata is dropped
      .resize(size, size, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new HttpError(400, 'not a valid image');
  }
}

/** Writes a processed photo under a random name; returns the file name. */
export function savePhoto(dir: string, webp: Buffer): string {
  mkdirSync(dir, { recursive: true });
  const file = `${randomBytes(16).toString('hex')}.webp`;
  writeFileSync(join(dir, file), webp);
  return file;
}

export function deletePhoto(dir: string, file: string | null): void {
  if (!file || !PHOTO_FILE.test(file)) return;
  try {
    unlinkSync(join(dir, file));
  } catch {
    // Already gone.
  }
}
