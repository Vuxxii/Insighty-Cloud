import { afterEach, describe, expect, it } from 'vitest';
import { InsightyyyDB } from '../src/db/db';
import { createProject, PrefixConflictError } from '../src/db/projects';
import { captureInsight } from '../src/db/insights';
import { exportProject } from '../src/backup/exporter';
import {
  importAsNewProject,
  mergeIntoProject,
  parseImportFile,
  replaceProject,
  ImportValidationError,
} from '../src/backup/importer';
import type { Block, ImageBlock, Insight } from '../src/db/types';
import { freshDbName } from './setup';

const openDbs: InsightyyyDB[] = [];

function makeDb(): InsightyyyDB {
  const database = new InsightyyyDB(freshDbName());
  openDbs.push(database);
  return database;
}

afterEach(async () => {
  for (const database of openDbs.splice(0)) {
    await database.delete();
  }
});

function imageBlock(bytes: number[], mime = 'image/webp'): ImageBlock {
  return {
    type: 'image',
    blob: new Blob([new Uint8Array(bytes)], { type: mime }),
    mime,
    width: 10,
    height: 20,
    alt: 'fixture image',
  };
}

async function seedProject(database: InsightyyyDB) {
  const project = await createProject('Quarter Three', 'Q3', database);
  await captureInsight(
    {
      project_id: project.id,
      source_tag: 'Q3 Report',
      content: [{ type: 'text', value: 'first insight — نص عربي' }],
      direction: 'auto',
    },
    database,
  );
  await captureInsight(
    {
      project_id: project.id,
      source_tag: 'Q3 Report',
      content: [
        imageBlock([1, 2, 3, 4, 5, 6, 7, 8]),
        { type: 'url', href: 'https://example.com/doc', title: 'The Doc' },
      ],
      direction: 'ltr',
    },
    database,
  );
  await captureInsight(
    {
      project_id: project.id,
      source_tag: 'Field Notes',
      content: [{ type: 'text', value: 'third' }, imageBlock([9, 9, 9, 9], 'image/jpeg')],
      direction: 'rtl',
    },
    database,
  );
  return project;
}

async function comparableInsights(database: InsightyyyDB, projectId: string) {
  const rows = await database.insights.where('project_id').equals(projectId).toArray();
  rows.sort((a, b) => a.ref_id - b.ref_id);
  return Promise.all(
    rows.map(async (row: Insight) => ({
      ref_id: row.ref_id,
      source_tag: row.source_tag,
      direction: row.direction,
      timestamp: row.timestamp,
      deleted_at: row.deleted_at,
      purged: row.purged,
      content: await Promise.all(
        row.content.map(async (block: Block) => {
          if (block.type === 'image') {
            return {
              type: 'image',
              mime: block.mime,
              width: block.width,
              height: block.height,
              alt: block.alt,
              bytes: [...new Uint8Array(await block.blob.arrayBuffer())],
            };
          }
          return block;
        }),
      ),
    })),
  );
}

describe('Phase 1 verify gate: export → import-as-new → export round-trip', () => {
  it('round-trips insight data byte-accurately via JSON', async () => {
    const source = makeDb();
    const project = await seedProject(source);
    const before = await comparableInsights(source, project.id);

    const exported = await exportProject(project.id, { format: 'json', database: source });
    expect(exported.filename).toMatch(/^insightyyy_quarter-three_\d{4}-\d{2}-\d{2}\.json$/);

    const target = makeDb();
    const parsed = await parseImportFile(exported.blob);
    const imported = await importAsNewProject(parsed, target);

    expect(imported.prefix).toBe('Q3');
    expect(imported.current_seq).toBe(3);
    const after = await comparableInsights(target, imported.id);
    expect(after).toEqual(before);

    // Second-generation export from the imported copy must be equivalent again.
    const reExported = await exportProject(imported.id, { format: 'json', database: target });
    const reParsed = await parseImportFile(reExported.blob);
    const third = makeDb();
    const secondGen = await importAsNewProject(reParsed, third);
    expect(await comparableInsights(third, secondGen.id)).toEqual(before);
  });

  it('round-trips via zip with verified checksums', async () => {
    const source = makeDb();
    const project = await seedProject(source);
    const before = await comparableInsights(source, project.id);

    const exported = await exportProject(project.id, { format: 'zip', database: source });
    expect(exported.filename).toMatch(/\.zip$/);

    const parsed = await parseImportFile(exported.blob);
    expect(Object.keys(parsed.file.images ?? {})).toHaveLength(2);
    for (const entry of Object.values(parsed.file.images ?? {})) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.bytes).toBeGreaterThan(0);
    }

    const target = makeDb();
    const imported = await importAsNewProject(parsed, target);
    expect(await comparableInsights(target, imported.id)).toEqual(before);
  });

  it('refuses a zip whose image bytes are corrupted, naming the file', async () => {
    const source = makeDb();
    const project = await seedProject(source);
    const exported = await exportProject(project.id, { format: 'zip', database: source });

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer());
    const imagePath = Object.keys(zip.files).find(
      (f) => f.startsWith('images/') && !f.endsWith('/'),
    )!;
    const original = await zip.file(imagePath)!.async('uint8array');
    original[0] = original[0] ^ 0xff; // flip bits, same length → checksum must catch it
    zip.file(imagePath, original);
    const corrupted = await zip.generateAsync({ type: 'blob' });

    await expect(parseImportFile(corrupted)).rejects.toThrowError(
      new RegExp(`${imagePath}.*checksum|checksum.*${imagePath}`),
    );
  });

  it('refuses a newer schema_version without touching the database', async () => {
    const source = makeDb();
    const project = await seedProject(source);
    const exported = await exportProject(project.id, { format: 'json', database: source });
    const doc = JSON.parse(await exported.blob.text());
    doc.schema_version = 999;
    const tampered = new Blob([JSON.stringify(doc)], { type: 'application/json' });
    await expect(parseImportFile(tampered)).rejects.toBeInstanceOf(ImportValidationError);
  });

  it('import-as-new refuses a prefix collision instead of renumbering', async () => {
    const source = makeDb();
    const project = await seedProject(source);
    const exported = await exportProject(project.id, { format: 'json', database: source });
    const parsed = await parseImportFile(exported.blob);
    // Importing into the SAME db where prefix Q3 is active must throw.
    await expect(importAsNewProject(parsed, source)).rejects.toBeInstanceOf(PrefixConflictError);
    // Nothing was written: still exactly one project.
    expect(await source.projects.count()).toBe(1);
  });

  it('merge renumbers continuing from current_seq and reports the mapping', async () => {
    const source = makeDb();
    const project = await seedProject(source); // seq = 3
    const exported = await exportProject(project.id, { format: 'json', database: source });
    const parsed = await parseImportFile(exported.blob);

    const target = makeDb();
    const targetProject = await createProject('Target', 'T', target);
    await captureInsight(
      {
        project_id: targetProject.id,
        source_tag: 'existing',
        content: [{ type: 'text', value: 'pre-existing' }],
        direction: 'auto',
      },
      target,
    ); // target seq = 1

    const { project: merged, renumbered } = await mergeIntoProject(parsed, targetProject.id, target);
    expect(merged.current_seq).toBe(4);
    expect(renumbered).toEqual([
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
    ]);
  });

  it('replace overwrites contents and preserves imported ref_ids', async () => {
    const source = makeDb();
    const project = await seedProject(source);
    const exported = await exportProject(project.id, { format: 'json', database: source });
    const parsed = await parseImportFile(exported.blob);

    const target = makeDb();
    const victim = await createProject('Victim', 'V', target);
    await captureInsight(
      {
        project_id: victim.id,
        source_tag: 'doomed',
        content: [{ type: 'text', value: 'will be replaced' }],
        direction: 'auto',
      },
      target,
    );

    const replaced = await replaceProject(parsed, victim.id, target);
    expect(replaced.prefix).toBe('Q3');
    expect(replaced.current_seq).toBe(3);
    const rows = await target.insights.where('project_id').equals(victim.id).toArray();
    expect(rows.map((r: Insight) => r.ref_id).sort((a: number, b: number) => a - b)).toEqual([
      1, 2, 3,
    ]);
    expect(rows.find((r: Insight) => r.source_tag === 'doomed')).toBeUndefined();
  });
});
