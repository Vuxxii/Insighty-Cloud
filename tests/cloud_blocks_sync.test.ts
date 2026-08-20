import { afterEach, describe, expect, it } from 'vitest';
import { InsightyyyDB, getMeta, updateMeta } from '../src/db/db';
import { createProject } from '../src/db/projects';
import { captureInsight } from '../src/db/insights';
import {
  blocksRemaining,
  peekNextRefFromBlocks,
  takeFromBlocks,
} from '../src/cloud/blocks';
import { shouldApplyRemote } from '../src/cloud/sync';
import { freshDbName } from './setup';
import type { SeqBlock } from '../src/db/types';

const openDbs: InsightyyyDB[] = [];
function makeDb(): InsightyyyDB {
  const database = new InsightyyyDB(freshDbName());
  openDbs.push(database);
  return database;
}
afterEach(async () => {
  for (const database of openDbs.splice(0)) await database.delete();
});

const block = (start: number, size: number, next = start): SeqBlock => ({
  project_id: 'p',
  start,
  size,
  next,
});

describe('reserved ID blocks (collision-impossible offline capture)', () => {
  it('peek shows the exact number the next capture will take', () => {
    expect(peekNextRefFromBlocks([block(43, 100)])).toBe(43);
    expect(peekNextRefFromBlocks([block(43, 100, 90)])).toBe(90);
    expect(peekNextRefFromBlocks([block(43, 2, 45), block(200, 100)])).toBe(200);
    expect(peekNextRefFromBlocks([])).toBeNull();
    expect(peekNextRefFromBlocks(undefined)).toBeNull();
  });

  it('take consumes sequentially and rolls into the next block at exhaustion', () => {
    let state = [block(43, 2), block(200, 100)];
    const taken: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = takeFromBlocks(state);
      taken.push(r.ref);
      state = r.blocks;
    }
    expect(taken).toEqual([43, 44, 200, 201]);
  });

  it('take throws when dry (capture must refuse, never guess a number)', () => {
    expect(() => takeFromBlocks([block(43, 2, 45)])).toThrow(/No reserved/);
  });

  it('remaining counts across blocks', () => {
    expect(blocksRemaining([block(43, 100, 90), block(200, 100)])).toBe(53 + 100);
  });

  it('capture consumes from the block atomically and updates current_seq to max', async () => {
    const database = makeDb();
    const project = await createProject('Cloud', 'CL', database);
    await updateMeta(
      { seq_blocks: { [project.id]: [{ ...block(43, 100), project_id: project.id }] } },
      database,
    );

    const insight = await captureInsight(
      {
        project_id: project.id,
        source_tag: 's',
        content: [{ type: 'text', value: 'block-assigned' }],
        direction: 'auto',
      },
      database,
      { fromBlock: true },
    );
    expect(insight.ref_id).toBe(43);
    expect(insight.dirty).toBe(1);

    const meta = await getMeta(database);
    expect(meta.seq_blocks[project.id][0].next).toBe(44);
    const fresh = await database.projects.get(project.id);
    expect(fresh?.current_seq).toBe(43); // max(local 0, 43)
  });

  it('capture with no block available refuses loudly and burns nothing', async () => {
    const database = makeDb();
    const project = await createProject('Dry', 'DR', database);
    await expect(
      captureInsight(
        {
          project_id: project.id,
          source_tag: 's',
          content: [{ type: 'text', value: 'x' }],
          direction: 'auto',
        },
        database,
        { fromBlock: true },
      ),
    ).rejects.toThrow(/No reserved reference numbers/);
    expect(await database.insights.count()).toBe(0);
    const fresh = await database.projects.get(project.id);
    expect(fresh?.current_seq).toBe(0);
  });
});

describe('sync merge policy (LWW, local dirty wins)', () => {
  it('applies remote when local is absent', () => {
    expect(shouldApplyRemote(undefined, '2026-08-15T10:00:00Z')).toBe(true);
  });
  it('never overwrites unpushed local edits', () => {
    expect(
      shouldApplyRemote({ updated_at: '2026-08-15T09:00:00Z', dirty: 1 }, '2026-08-15T10:00:00Z'),
    ).toBe(false);
  });
  it('applies strictly-newer remote over clean local', () => {
    expect(
      shouldApplyRemote({ updated_at: '2026-08-15T09:00:00Z', dirty: 0 }, '2026-08-15T10:00:00Z'),
    ).toBe(true);
    expect(
      shouldApplyRemote({ updated_at: '2026-08-15T11:00:00Z', dirty: 0 }, '2026-08-15T10:00:00Z'),
    ).toBe(false);
  });
});
