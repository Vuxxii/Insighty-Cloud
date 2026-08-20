import JSZip from 'jszip';
import { db, type InsightyyyDB } from '../db/db';
import { PrefixConflictError } from '../db/projects';
import {
  SCHEMA_VERSION,
  nowIso,
  uuid,
  type Block,
  type Insight,
  type Project,
} from '../db/types';
import { base64ToBuffer, sha256Hex, type ExportFile, type ExportedBlock } from './format';

export type ImportMode = 'new-project' | 'replace' | 'merge';

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportValidationError';
  }
}

export interface ParsedImport {
  file: ExportFile;
  /** Fully materialised content blocks (image blobs reconstructed). */
  insights: Array<Omit<Insight, 'id' | 'project_id'>>;
}

function materialiseBlock(
  block: ExportedBlock,
  imageBytes: Map<string, ArrayBuffer>,
): Block {
  const type = (block as { type?: string }).type;
  if (type === 'text' || type === 'url') return block as Block;
  if (type === 'image') {
    const img = block as {
      mime: string;
      width: number;
      height: number;
      alt?: string;
      data?: string;
      file?: string;
    };
    let buffer: ArrayBuffer;
    if (img.data !== undefined) {
      buffer = base64ToBuffer(img.data);
    } else if (img.file !== undefined) {
      const found = imageBytes.get(img.file);
      if (!found) {
        throw new ImportValidationError(`Archive is missing image file "${img.file}".`);
      }
      buffer = found;
    } else {
      throw new ImportValidationError('Image block has neither inline data nor a file reference.');
    }
    return {
      type: 'image',
      blob: new Blob([buffer], { type: img.mime }),
      mime: img.mime,
      width: img.width,
      height: img.height,
      ...(img.alt !== undefined ? { alt: img.alt } : {}),
    };
  }
  // Unknown block types survive import untouched (PRD §3.E — rendered as placeholder).
  return block as unknown as Block;
}

function validateFileShape(file: ExportFile): void {
  if (typeof file.schema_version !== 'number') {
    throw new ImportValidationError('Not an Insightyyy export: missing schema_version.');
  }
  if (file.schema_version > SCHEMA_VERSION) {
    throw new ImportValidationError(
      `This file uses schema version ${file.schema_version}, but this app only understands ` +
        `up to ${SCHEMA_VERSION}. Update the app before importing — nothing was changed.`,
    );
  }
  if (!file.project || typeof file.project.prefix !== 'string') {
    throw new ImportValidationError('Export file has no project record.');
  }
  if (!Array.isArray(file.insights)) {
    throw new ImportValidationError('Export file has no insights array.');
  }
  const seen = new Set<number>();
  for (const ins of file.insights) {
    if (typeof ins.ref_id !== 'number' || ins.ref_id < 1) {
      throw new ImportValidationError(`Insight has an invalid ref_id: ${String(ins.ref_id)}.`);
    }
    if (seen.has(ins.ref_id)) {
      throw new ImportValidationError(`Duplicate ref_id ${ins.ref_id} in export file.`);
    }
    seen.add(ins.ref_id);
  }
}

/**
 * Parse and fully validate an export (JSON or zip) BEFORE any write. Zip checksums are
 * verified here; a mismatch refuses the whole import naming the corrupt file (PRD §3.C).
 */
export async function parseImportFile(input: Blob): Promise<ParsedImport> {
  const isZip = await looksLikeZip(input);
  let file: ExportFile;
  const imageBytes = new Map<string, ArrayBuffer>();

  if (isZip) {
    // ArrayBuffer, not Blob: JSZip's Blob support detection fails outside real browsers.
    const zip = await JSZip.loadAsync(await input.arrayBuffer());
    const manifestEntry = zip.file('manifest.json');
    if (!manifestEntry) throw new ImportValidationError('Zip archive has no manifest.json.');
    file = JSON.parse(await manifestEntry.async('string')) as ExportFile;
    validateFileShape(file);
    for (const [path, expected] of Object.entries(file.images ?? {})) {
      const entry = zip.file(path);
      if (!entry) {
        throw new ImportValidationError(`Archive is missing image file "${path}".`);
      }
      const buffer = await entry.async('arraybuffer');
      if (buffer.byteLength !== expected.bytes) {
        throw new ImportValidationError(
          `Image "${path}" is ${buffer.byteLength} bytes but the manifest expects ` +
            `${expected.bytes}. The archive is corrupt — import refused.`,
        );
      }
      const actual = await sha256Hex(buffer);
      if (actual !== expected.sha256) {
        throw new ImportValidationError(
          `Image "${path}" failed its SHA-256 checksum. The archive is corrupt — import refused.`,
        );
      }
      imageBytes.set(path, buffer);
    }
  } else {
    try {
      file = JSON.parse(await input.text()) as ExportFile;
    } catch {
      throw new ImportValidationError('File is neither valid JSON nor a zip archive.');
    }
    validateFileShape(file);
  }

  const insights = file.insights.map((ins) => ({
    ref_id: ins.ref_id,
    source_tag: ins.source_tag ?? '',
    content: (ins.content ?? []).map((b) => materialiseBlock(b, imageBytes)),
    direction: ins.direction ?? 'auto',
    timestamp: ins.timestamp ?? nowIso(),
    updated_at: ins.updated_at ?? nowIso(),
    deleted_at: ins.deleted_at ?? null,
    purged: ins.purged ?? false,
  }));

  return { file, insights };
}

async function looksLikeZip(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b; // "PK"
}

function maxRef(parsed: ParsedImport): number {
  return parsed.insights.reduce((m, i) => Math.max(m, i.ref_id), 0);
}

/**
 * Mode 1 — Import as new project (the device-hop path, PRD §3.C): preserves every
 * ref_id and the prefix exactly. Prefix collision with a non-archived project throws
 * PrefixConflictError so the UI can prompt archive/rename — never renumber.
 */
export async function importAsNewProject(
  parsed: ParsedImport,
  database: InsightyyyDB = db,
): Promise<Project> {
  return database.transaction('rw', database.projects, database.insights, async () => {
    const clash = await database.projects
      .filter(
        (p) =>
          p.archived_at === null &&
          p.prefix.toUpperCase() === parsed.file.project.prefix.toUpperCase(),
      )
      .first();
    if (clash) throw new PrefixConflictError(parsed.file.project.prefix);

    const now = nowIso();
    const project: Project = {
      id: uuid(),
      name: parsed.file.project.name,
      prefix: parsed.file.project.prefix,
      // current_seq must cover every imported ref_id (monotonic, D1).
      current_seq: Math.max(parsed.file.project.current_seq ?? 0, maxRef(parsed)),
      created_at: parsed.file.project.created_at ?? now,
      updated_at: now,
      archived_at: null,
    };
    await database.projects.add(project);
    await database.insights.bulkAdd(
      parsed.insights.map((ins) => ({ ...ins, id: uuid(), project_id: project.id })),
    );
    return project;
  });
}

/** Mode 2 — Replace project (destructive; typed confirmation happens in the UI). */
export async function replaceProject(
  parsed: ParsedImport,
  targetProjectId: string,
  database: InsightyyyDB = db,
): Promise<Project> {
  return database.transaction('rw', database.projects, database.insights, async () => {
    const target = await database.projects.get(targetProjectId);
    if (!target) throw new Error('Target project not found.');
    const next: Project = {
      ...target,
      name: parsed.file.project.name,
      prefix: parsed.file.project.prefix,
      current_seq: Math.max(parsed.file.project.current_seq ?? 0, maxRef(parsed)),
      updated_at: nowIso(),
    };
    await database.insights.where('project_id').equals(targetProjectId).delete();
    await database.projects.put(next);
    await database.insights.bulkAdd(
      parsed.insights.map((ins) => ({ ...ins, id: uuid(), project_id: targetProjectId })),
    );
    return next;
  });
}

export interface MergeResult {
  project: Project;
  /** old ref_id → new ref_id, so the UI can show what was renumbered. */
  renumbered: Array<{ from: number; to: number }>;
}

/**
 * Mode 3 — Merge (renumbering; use with care). Appends the file's insights as NEW refs
 * continuing from the target's current_seq. The UI must show the PRD's warning and
 * require explicit acknowledgment before calling this.
 */
export async function mergeIntoProject(
  parsed: ParsedImport,
  targetProjectId: string,
  database: InsightyyyDB = db,
): Promise<MergeResult> {
  return database.transaction('rw', database.projects, database.insights, async () => {
    const target = await database.projects.get(targetProjectId);
    if (!target) throw new Error('Target project not found.');
    const sorted = [...parsed.insights].sort((a, b) => a.ref_id - b.ref_id);
    const renumbered: MergeResult['renumbered'] = [];
    let seq = target.current_seq;
    const rows: Insight[] = sorted.map((ins) => {
      seq += 1;
      renumbered.push({ from: ins.ref_id, to: seq });
      return { ...ins, ref_id: seq, id: uuid(), project_id: targetProjectId };
    });
    const project: Project = { ...target, current_seq: seq, updated_at: nowIso() };
    await database.projects.put(project);
    await database.insights.bulkAdd(rows);
    return { project, renumbered };
  });
}
