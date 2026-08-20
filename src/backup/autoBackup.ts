import { db, getMeta, updateMeta, type InsightyyyDB } from '../db/db';
import { exportProject, markExported, triggerDownload, type ExportResult } from './exporter';

const BACKUP_KEEP = 5;
/** Only files matching the app's own pattern are ever rotated/deleted (PRD §2.4). */
const BACKUP_FILE_RE = /^insightyyy_.+_\d{4}-\d{2}-\d{2}(?: \(\d+\))?\.(json|zip)$/;

export function fsAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function chooseBackupDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!fsAccessSupported()) return null;
  const picker = (
    window as unknown as {
      showDirectoryPicker: (o?: object) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  const handle = await picker({ mode: 'readwrite' });
  await updateMeta({ backup_dir_handle: handle });
  return handle;
}

async function verifyHandlePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as unknown as {
    queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
  };
  try {
    if ((await h.queryPermission?.({ mode: 'readwrite' })) === 'granted') return true;
    return (await h.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

async function writeToDirectory(
  handle: FileSystemDirectoryHandle,
  result: ExportResult,
): Promise<void> {
  const fileHandle = await handle.getFileHandle(result.filename, { create: true });
  const writable = await (
    fileHandle as unknown as {
      createWritable: () => Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>;
    }
  ).createWritable();
  await writable.write(result.blob);
  await writable.close();
}

async function rotateBackups(handle: FileSystemDirectoryHandle): Promise<void> {
  const entries: string[] = [];
  const iter = (handle as unknown as { keys?: () => AsyncIterable<string> }).keys?.();
  if (!iter) return;
  for await (const name of iter) {
    if (BACKUP_FILE_RE.test(name)) entries.push(name);
  }
  // Filenames embed the date, so lexicographic sort is chronological per project slug.
  entries.sort();
  const excess = entries.slice(0, Math.max(0, entries.length - BACKUP_KEEP));
  for (const name of excess) {
    try {
      await handle.removeEntry(name);
    } catch {
      // A locked/undeletable old backup must never fail the new backup.
    }
  }
}

/**
 * One-click export (PRD §2.4): writes into the remembered directory when available,
 * otherwise falls back to a normal browser download.
 */
export async function oneClickExport(
  projectId: string,
  database: InsightyyyDB = db,
): Promise<'directory' | 'download'> {
  const result = await exportProject(projectId, { database });
  const meta = await getMeta(database);
  const handle = meta.backup_dir_handle;
  if (handle && (await verifyHandlePermission(handle))) {
    await writeToDirectory(handle, result);
    await rotateBackups(handle);
    await markExported(database);
    return 'directory';
  }
  triggerDownload(result);
  await markExported(database);
  return 'download';
}

export interface AutoBackupDecision {
  fire: boolean;
  reason: 'every_n' | 'new_day' | null;
}

/** Cadence (PRD §2.4): after every N captures, or on the first capture of a new day. */
export function shouldAutoBackup(
  capturesSinceBackup: number,
  everyN: number,
  lastCaptureDay: string | null,
  today: string,
): AutoBackupDecision {
  if (lastCaptureDay !== null && lastCaptureDay !== today) return { fire: true, reason: 'new_day' };
  if (capturesSinceBackup >= everyN) return { fire: true, reason: 'every_n' };
  return { fire: false, reason: null };
}

export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Called after each successful capture. Silently triggers the one-click path when a
 * remembered location exists; otherwise leaves the reminder banner to the UI.
 */
export async function recordCaptureAndMaybeBackup(
  projectId: string,
  database: InsightyyyDB = db,
): Promise<{ backedUp: boolean }> {
  const meta = await getMeta(database);
  if (!meta.auto_backup.enabled) return { backedUp: false };
  const today = todayKey();
  const count = meta.captures_since_backup + 1;
  const decision = shouldAutoBackup(
    count,
    meta.auto_backup.every_n,
    meta.last_capture_day,
    today,
  );
  if (decision.fire && meta.backup_dir_handle) {
    try {
      const result = await exportProject(projectId, { database });
      if (await verifyHandlePermission(meta.backup_dir_handle)) {
        await writeToDirectory(meta.backup_dir_handle, result);
        await rotateBackups(meta.backup_dir_handle);
        await markExported(database);
        await updateMeta({ captures_since_backup: 0, last_capture_day: today }, database);
        return { backedUp: true };
      }
    } catch {
      // Auto-backup failure must never break capture; the staleness banner covers it.
    }
  }
  await updateMeta({ captures_since_backup: count, last_capture_day: today }, database);
  return { backedUp: false };
}
