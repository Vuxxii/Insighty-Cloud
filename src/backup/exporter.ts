import JSZip from 'jszip';
import { db, updateMeta, type InsightyyyDB } from '../db/db';
import { nowIso, type Block, type Insight } from '../db/types';
import {
  APP_VERSION,
  ZIP_THRESHOLD_BYTES,
  bufferToBase64,
  exportFilename,
  projectToExported,
  sha256Hex,
  type ExportFile,
  type ExportedBlock,
  type ExportedInsight,
} from './format';
import { SCHEMA_VERSION } from '../db/types';

export interface ExportResult {
  blob: Blob;
  filename: string;
  format: 'json' | 'zip';
}

interface ImageEntry {
  path: string;
  blob: Blob;
}

function imageFilename(refId: number, blockIndex: number, mime: string): string {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp';
  return `images/${String(refId).padStart(6, '0')}-${blockIndex}.${ext}`;
}

async function buildExport(
  projectId: string,
  database: InsightyyyDB,
): Promise<{ file: ExportFile; images: ImageEntry[]; totalImageBytes: number }> {
  const project = await database.projects.get(projectId);
  if (!project) throw new Error('Project not found.');
  const insights = await database.insights.where('project_id').equals(projectId).toArray();
  insights.sort((a, b) => a.ref_id - b.ref_id);

  const images: ImageEntry[] = [];
  let totalImageBytes = 0;

  const exportedInsights: ExportedInsight[] = insights.map((insight: Insight) => ({
    id: insight.id,
    ref_id: insight.ref_id,
    source_tag: insight.source_tag,
    content: insight.content.map((block: Block, idx: number): ExportedBlock => {
      if (block.type === 'image') {
        const path = imageFilename(insight.ref_id, idx, block.mime);
        images.push({ path, blob: block.blob });
        totalImageBytes += block.blob.size;
        return {
          type: 'image',
          mime: block.mime,
          width: block.width,
          height: block.height,
          ...(block.alt !== undefined ? { alt: block.alt } : {}),
          file: path,
        };
      }
      return block;
    }),
    direction: insight.direction,
    timestamp: insight.timestamp,
    updated_at: insight.updated_at,
    deleted_at: insight.deleted_at,
    purged: insight.purged,
  }));

  const file: ExportFile = {
    schema_version: SCHEMA_VERSION,
    app_version: APP_VERSION,
    exported_at: nowIso(),
    project: projectToExported(project),
    insights: exportedInsights,
  };
  return { file, images, totalImageBytes };
}

/**
 * Export a project as JSON (base64 images inline) or zip (manifest.json + /images/
 * with SHA-256 checksums) — zip above 25MB of image payload (PRD §3.C).
 * Base64 exists only here, at the export boundary (PRD §2.1).
 */
export async function exportProject(
  projectId: string,
  opts: { format?: 'json' | 'zip'; database?: InsightyyyDB } = {},
): Promise<ExportResult> {
  const database = opts.database ?? db;
  const { file, images, totalImageBytes } = await buildExport(projectId, database);
  const format = opts.format ?? (totalImageBytes > ZIP_THRESHOLD_BYTES ? 'zip' : 'json');

  if (format === 'json') {
    // Inline images as base64 `data`; drop the zip-only `file` reference.
    const byPath = new Map(images.map((img) => [img.path, img.blob]));
    for (const insight of file.insights) {
      for (const block of insight.content) {
        if ((block as { type?: string }).type === 'image') {
          const img = block as { file?: string; data?: string };
          if (img.file) {
            const blob = byPath.get(img.file)!;
            img.data = bufferToBase64(await blob.arrayBuffer());
            delete img.file;
          }
        }
      }
    }
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    return { blob, filename: exportFilename(file.project.name, 'json'), format };
  }

  const zip = new JSZip();
  const manifestImages: Record<string, { bytes: number; sha256: string }> = {};
  for (const img of images) {
    const buffer = await img.blob.arrayBuffer();
    manifestImages[img.path] = { bytes: buffer.byteLength, sha256: await sha256Hex(buffer) };
    zip.file(img.path, buffer);
  }
  file.images = manifestImages;
  zip.file('manifest.json', JSON.stringify(file, null, 2));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, filename: exportFilename(file.project.name, 'zip'), format };
}

/** Every successful export (manual or auto) updates last_export_at (PRD §2.4). */
export async function markExported(database: InsightyyyDB = db): Promise<void> {
  await updateMeta({ last_export_at: nowIso() }, database);
}

export function triggerDownload(result: ExportResult): void {
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
