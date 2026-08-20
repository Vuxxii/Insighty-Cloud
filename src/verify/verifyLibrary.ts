import { db, getMeta, type InsightyyyDB } from '../db/db';
import type { Insight } from '../db/types';

export interface VerifyReport {
  projectName: string;
  prefix: string;
  currentSeq: number;
  /** Refs 1..current_seq with NO row at all — a lost insight behind a possibly
   * transcribed reference. Reported loudly (PRD §3.F). */
  missingRefs: number[];
  /** Image blobs that failed to decode, by ref_id + block index. */
  undecodableImages: Array<{ ref_id: number; blockIndex: number; reason: string }>;
  totals: {
    insights: number;
    active: number;
    deleted: number;
    purged: number;
    images: number;
    bytes: number;
  };
  lastExportAt: string | null;
  /** Days since last export, or null if never exported. */
  exportAgeDays: number | null;
}

export type BlobDecoder = (blob: Blob) => Promise<void>;

/** Default decoder: a real decode attempt, not just a size check. */
async function decodeWithImageBitmap(blob: Blob): Promise<void> {
  if (blob.size === 0) throw new Error('empty blob');
  const bitmap = await createImageBitmap(blob);
  bitmap.close();
}

/**
 * Verify Library (PRD §3.F): read-only integrity check. Never repairs silently.
 * Work is async and chunked so the UI thread stays responsive.
 */
export async function verifyLibrary(
  projectId: string,
  database: InsightyyyDB = db,
  decoder: BlobDecoder = decodeWithImageBitmap,
  onProgress?: (done: number, total: number) => void,
): Promise<VerifyReport> {
  const project = await database.projects.get(projectId);
  if (!project) throw new Error('Project not found.');
  const rows = await database.insights.where('project_id').equals(projectId).toArray();
  const byRef = new Map(rows.map((r: Insight) => [r.ref_id, r]));

  const missingRefs: number[] = [];
  for (let ref = 1; ref <= project.current_seq; ref++) {
    if (!byRef.has(ref)) missingRefs.push(ref);
  }

  const undecodableImages: VerifyReport['undecodableImages'] = [];
  let images = 0;
  let bytes = 0;
  let done = 0;
  for (const row of rows) {
    for (let blockIndex = 0; blockIndex < row.content.length; blockIndex++) {
      const block = row.content[blockIndex];
      if (block.type === 'image') {
        images += 1;
        bytes += block.blob.size;
        try {
          await decoder(block.blob);
        } catch (err) {
          undecodableImages.push({
            ref_id: row.ref_id,
            blockIndex,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    done += 1;
    onProgress?.(done, rows.length);
    if (done % 50 === 0) await new Promise((r) => setTimeout(r, 0)); // yield to UI
  }

  const meta = await getMeta(database);
  const exportAgeDays = meta.last_export_at
    ? Math.floor((Date.now() - new Date(meta.last_export_at).getTime()) / 86_400_000)
    : null;

  return {
    projectName: project.name,
    prefix: project.prefix,
    currentSeq: project.current_seq,
    missingRefs,
    undecodableImages,
    totals: {
      insights: rows.length,
      active: rows.filter((r) => r.deleted_at === null && !r.purged).length,
      deleted: rows.filter((r) => r.deleted_at !== null && !r.purged).length,
      purged: rows.filter((r) => r.purged).length,
      images,
      bytes,
    },
    lastExportAt: meta.last_export_at,
    exportAgeDays,
  };
}
