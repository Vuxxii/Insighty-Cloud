export type Direction = 'ltr' | 'rtl' | 'auto';

export interface TextBlock {
  type: 'text';
  value: string;
}

export interface ImageBlock {
  type: 'image';
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  alt?: string;
  /** Reserved for future background OCR (PRD §7). Never written in v1. */
  ocr_text?: string;
}

export interface UrlBlock {
  type: 'url';
  href: string;
  /** User-entered only; the app never fetches remote pages (PRD §3.E). */
  title?: string;
}

export type Block = TextBlock | ImageBlock | UrlBlock;

export interface Project {
  id: string;
  name: string;
  /** 1–6 chars, letters/digits, unique among non-archived projects (PRD §3.A.0). */
  prefix: string;
  /** High-water mark of assigned ref_ids. Monotonic — never decreases (D1).
   * Cloud mode: local view of the highest number this device knows was assigned;
   * the server's `next_seq` is the allocation authority via reserved blocks. */
  current_seq: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  /** Cloud (v2): 1 = has local changes not yet pushed. */
  dirty?: number;
}

export interface Insight {
  id: string;
  project_id: string;
  /** Sequential per project, assigned exactly once, forever (D1). */
  ref_id: number;
  source_tag: string;
  content: Block[];
  direction: Direction;
  timestamp: string;
  updated_at: string;
  deleted_at: string | null;
  /** True when content was hard-deleted; the row persists as a tombstone. */
  purged: boolean;
  /** Cloud (v2): 1 = has local changes not yet pushed. Indexed for cheap push scans. */
  dirty?: number;
}

export interface AutoBackupSetting {
  enabled: boolean;
  every_n: number;
}

/** A device-reserved range of upcoming ref numbers (cloud mode): refs are assigned
 * locally from the block, so the next number is known instantly — even offline —
 * and cross-device collisions are impossible by construction (gaps allowed per D1). */
export interface SeqBlock {
  project_id: string;
  start: number;
  size: number;
  /** Next unused number within this block. */
  next: number;
}

export interface CachedKeyBundle {
  email: string;
  /** Ciphertext + salts only — safe at rest (see cloud/crypto.ts). */
  bundle: import('../cloud/crypto').AccountKeyBundle;
}

export interface Meta {
  key: 'meta';
  schema_version: number;
  last_export_at: string | null;
  storage_persisted: boolean;
  backup_dir_handle: FileSystemDirectoryHandle | null;
  auto_backup: AutoBackupSetting;
  /** Captures since the last auto-backup fired (drives the every_n cadence, §2.4). */
  captures_since_backup: number;
  /** Date (YYYY-MM-DD) of the last capture, for the first-capture-of-day trigger. */
  last_capture_day: string | null;
  /** ——— Cloud (v2) ——— */
  /** Stable random id distinguishing this device's block reservations. */
  device_id: string | null;
  /** Reserved ref blocks per project, oldest first (refill ranges are not
   * contiguous when other devices reserve in between). */
  seq_blocks: Record<string, SeqBlock[]>;
  /** Server timestamp watermark of the last completed pull. */
  sync_cursor: string | null;
  /** Encrypted key bundle cache for offline unlock (ciphertext only). */
  cloud_key_cache: CachedKeyBundle | null;
  /** Bundle awaiting upload when signup required email confirmation first. */
  cloud_pending_bundle: CachedKeyBundle | null;
}

export const SCHEMA_VERSION = 2;

export const PREFIX_RE = /^[A-Za-z0-9]{1,6}$/;

export function nowIso(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}
