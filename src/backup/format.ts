import type { Direction, Project } from '../db/types';

export const APP_VERSION = '0.1.0';
export const ZIP_THRESHOLD_BYTES = 25 * 1024 * 1024;

/** Wire form of a content block. Images carry base64 `data` in JSON form, or a
 * `file` path into /images/ in zip form. Unknown types round-trip untouched. */
export type ExportedBlock =
  | { type: 'text'; value: string }
  | { type: 'url'; href: string; title?: string }
  | {
      type: 'image';
      mime: string;
      width: number;
      height: number;
      alt?: string;
      data?: string;
      file?: string;
    }
  | Record<string, unknown>;

export interface ExportedInsight {
  id: string;
  ref_id: number;
  source_tag: string;
  content: ExportedBlock[];
  direction: Direction;
  timestamp: string;
  updated_at: string;
  deleted_at: string | null;
  purged: boolean;
}

export interface ExportedProject {
  name: string;
  prefix: string;
  current_seq: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ExportFile {
  schema_version: number;
  app_version: string;
  exported_at: string;
  project: ExportedProject;
  insights: ExportedInsight[];
  /** Zip form only: per image file, byte size and SHA-256 (PRD §3.C). */
  images?: Record<string, { bytes: number; sha256: string }>;
}

export function projectToExported(p: Project): ExportedProject {
  return {
    name: p.name,
    prefix: p.prefix,
    current_seq: p.current_seq,
    created_at: p.created_at,
    updated_at: p.updated_at,
    archived_at: p.archived_at,
  };
}

export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

export function exportFilename(projectName: string, ext: 'json' | 'zip', date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `insightyyy_${slugify(projectName)}_${y}-${m}-${d}.${ext}`;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
