import { afterEach, describe, expect, it } from 'vitest';
import { InsightyyyDB } from '../src/db/db';
import { createProject } from '../src/db/projects';
import {
  captureInsight,
  purgeInsight,
  restoreInsight,
  softDeleteInsight,
} from '../src/db/insights';
import { resolveIdQuery } from '../src/search/resolve';
import { parseIdQuery } from '../src/search/parser';
import { verifyLibrary } from '../src/verify/verifyLibrary';
import { printTitle } from '../src/pdf/print';
import { freshDbName } from './setup';

const openDbs: InsightyyyDB[] = [];
function makeDb(): InsightyyyDB {
  const database = new InsightyyyDB(freshDbName());
  openDbs.push(database);
  return database;
}
afterEach(async () => {
  for (const database of openDbs.splice(0)) await database.delete();
});

async function seed(database: InsightyyyDB, count: number, withImage = false) {
  const project = await createProject('Del', 'DL', database);
  for (let i = 1; i <= count; i++) {
    await captureInsight(
      {
        project_id: project.id,
        source_tag: `s${i}`,
        content: withImage
          ? [
              { type: 'text', value: `insight ${i}` },
              {
                type: 'image',
                blob: new Blob([new Uint8Array([i, i, i])], { type: 'image/webp' }),
                mime: 'image/webp',
                width: 1,
                height: 1,
              },
            ]
          : [{ type: 'text', value: `insight ${i}` }],
        direction: 'auto',
      },
      database,
    );
  }
  return (await database.projects.get(project.id))!;
}

describe('Phase 5 verify gate: purge leaves a tombstone, current_seq unchanged (D1)', () => {
  it('purged ref retrieval reports "permanently deleted", never blank or reused', async () => {
    const database = makeDb();
    const project = await seed(database, 5);
    const row3 = await database.insights
      .where('[project_id+ref_id]')
      .equals([project.id, 3])
      .first();
    await purgeInsight(row3!.id, database);

    // current_seq unchanged after purge.
    const fresh = (await database.projects.get(project.id))!;
    expect(fresh.current_seq).toBe(5);

    // Retrieval categorises #3 as purged — the UI renders the explicit message.
    const result = await resolveIdQuery(project.id, fresh.current_seq, parseIdQuery('3'), database);
    expect(result.insights).toHaveLength(0);
    expect(result.purgedRefs).toEqual([3]);

    // Tombstone row persists with content removed.
    const tombstone = await database.insights
      .where('[project_id+ref_id]')
      .equals([project.id, 3])
      .first();
    expect(tombstone?.purged).toBe(true);
    expect(tombstone?.content).toEqual([]);

    // The number stays retired: the next capture takes 6, never 3.
    const next = await captureInsight(
      {
        project_id: project.id,
        source_tag: 'after',
        content: [{ type: 'text', value: 'new' }],
        direction: 'auto',
      },
      database,
    );
    expect(next.ref_id).toBe(6);
  });

  it('soft delete hides from retrieval; restore brings it back and bumps updated_at', async () => {
    const database = makeDb();
    const project = await seed(database, 2);
    const row = await database.insights
      .where('[project_id+ref_id]')
      .equals([project.id, 2])
      .first();
    await softDeleteInsight(row!.id, database);
    let result = await resolveIdQuery(project.id, 2, parseIdQuery('2'), database);
    expect(result.deletedRefs).toEqual([2]);

    await new Promise((r) => setTimeout(r, 5));
    await restoreInsight(row!.id, database);
    result = await resolveIdQuery(project.id, 2, parseIdQuery('2'), database);
    expect(result.insights.map((i) => i.ref_id)).toEqual([2]);
    const restored = await database.insights.get(row!.id);
    expect(restored!.updated_at > row!.updated_at).toBe(true);
  });
});

describe('PDF print title (suggested save filename)', () => {
  it('stamps project name + date, hour and minute, filename-safe', () => {
    expect(printTitle('Quarter Three', new Date(2026, 7, 12, 21, 5))).toBe(
      'Quarter Three 2026-08-12 21-05',
    );
  });
});

describe('Phase 5 verify gate: Verify Library (PRD §3.F)', () => {
  it('reports a clean bill on an intact project', async () => {
    const database = makeDb();
    const project = await seed(database, 4, true);
    const report = await verifyLibrary(project.id, database, async () => undefined);
    expect(report.missingRefs).toEqual([]);
    expect(report.undecodableImages).toEqual([]);
    expect(report.totals).toMatchObject({ insights: 4, active: 4, images: 4 });
  });

  it('detects a deliberately corrupted blob and reports it by ref_id', async () => {
    const database = makeDb();
    const project = await seed(database, 3, true);
    // Corrupt insight #2's image: replace with an empty blob.
    const row = await database.insights
      .where('[project_id+ref_id]')
      .equals([project.id, 2])
      .first();
    const corrupted = {
      ...row!,
      content: row!.content.map((b) =>
        b.type === 'image' ? { ...b, blob: new Blob([], { type: 'image/webp' }) } : b,
      ),
    };
    await database.insights.put(corrupted);

    const report = await verifyLibrary(project.id, database, async (blob) => {
      if (blob.size === 0) throw new Error('empty blob');
    });
    expect(report.undecodableImages).toHaveLength(1);
    expect(report.undecodableImages[0]).toMatchObject({ ref_id: 2, blockIndex: 1 });
  });

  it('reports a missing ref (row vanished behind a possibly-transcribed number) loudly', async () => {
    const database = makeDb();
    const project = await seed(database, 5);
    // Simulate silent storage loss: row #4 disappears entirely (no tombstone).
    const row = await database.insights
      .where('[project_id+ref_id]')
      .equals([project.id, 4])
      .first();
    await database.insights.delete(row!.id);

    const report = await verifyLibrary(project.id, database, async () => undefined);
    expect(report.missingRefs).toEqual([4]);
  });

  it('tombstones are NOT missing refs — purged numbers stay accounted for', async () => {
    const database = makeDb();
    const project = await seed(database, 3);
    const row = await database.insights
      .where('[project_id+ref_id]')
      .equals([project.id, 2])
      .first();
    await purgeInsight(row!.id, database);
    const report = await verifyLibrary(project.id, database, async () => undefined);
    expect(report.missingRefs).toEqual([]);
    expect(report.totals.purged).toBe(1);
  });
});
