import { afterEach, describe, expect, it, vi } from 'vitest';
import { InsightyyyDB } from '../src/db/db';
import { createProject } from '../src/db/projects';
import { captureInsight, softDeleteInsight } from '../src/db/insights';
import {
  describeRefList,
  normaliseRanges,
  parseIdQuery,
  routeQuery,
} from '../src/search/parser';
import { resolveIdQuery, searchText } from '../src/search/resolve';
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

async function seed(database: InsightyyyDB, count: number) {
  const project = await createProject('Parse', 'PR', database);
  for (let i = 1; i <= count; i++) {
    await captureInsight(
      {
        project_id: project.id,
        source_tag: `Source ${i}`,
        content: [{ type: 'text', value: `insight number ${i}` }],
        direction: 'auto',
      },
      database,
    );
  }
  return (await database.projects.get(project.id))!;
}

/** Phase 3 verify gate: one test per row of the PRD §3.B edge-case table. */
describe('§3.B row: `7-1` reverse range normalises to 1-7, no error', () => {
  it('parses and normalises', () => {
    const q = parseIdQuery('7-1');
    expect(q).toEqual({ kind: 'ranges', ranges: [{ lo: 1, hi: 7 }] });
  });
});

describe('§3.B row: `1-100` with only 20 insights returns what exists + a not-found note', () => {
  it('resolves existing and reports 21–100 without an error state', async () => {
    const database = makeDb();
    const project = await seed(database, 20);
    const result = await resolveIdQuery(project.id, project.current_seq, parseIdQuery('1-100'), database);
    expect(result.insights.map((i) => i.ref_id)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    expect(result.clamped).toEqual({ from: 21, to: 100 });
    expect(describeRefList(result.missingRefs)).toBe('');
  });
});

describe('§3.B row: `3` where #3 was deleted → explicit not-found, never a blank screen', () => {
  it('reports the deleted ref explicitly with zero results', async () => {
    const database = makeDb();
    const project = await seed(database, 5);
    const three = await database.insights
      .where('[project_id+ref_id]')
      .equals([project.id, 3])
      .first();
    await softDeleteInsight(three!.id, database);
    const result = await resolveIdQuery(project.id, project.current_seq, parseIdQuery('3'), database);
    expect(result.insights).toHaveLength(0);
    expect(result.deletedRefs).toEqual([3]);
  });
});

describe('§3.B row: ` 1 , 3 ` whitespace trims and parses normally', () => {
  it('parses', () => {
    expect(parseIdQuery(' 1 , 3 ')).toEqual({
      kind: 'ranges',
      ranges: [
        { lo: 1, hi: 1 },
        { lo: 3, hi: 3 },
      ],
    });
  });
});

describe('§3.B row: `1,,3` and trailing commas ignore empty segments', () => {
  it('parses', () => {
    expect(parseIdQuery('1,,3')).toEqual({
      kind: 'ranges',
      ranges: [
        { lo: 1, hi: 1 },
        { lo: 3, hi: 3 },
      ],
    });
    expect(parseIdQuery('1,3,')).toEqual({
      kind: 'ranges',
      ranges: [
        { lo: 1, hi: 1 },
        { lo: 3, hi: 3 },
      ],
    });
  });
});

describe('§3.B row: `0` or negative → empty result, no crash', () => {
  it('zero yields empty', async () => {
    const database = makeDb();
    const project = await seed(database, 3);
    const q = parseIdQuery('0');
    expect(q.kind).toBe('empty');
    const result = await resolveIdQuery(project.id, project.current_seq, q, database);
    expect(result.insights).toHaveLength(0);
  });
  it('negative-looking input (`-3` alone) does not crash and runs nothing', () => {
    expect(parseIdQuery('-3').kind).toBe('incomplete');
  });
});

describe('§3.B row: `1-` / `-5` incomplete ranges run no query until valid', () => {
  it('flags incomplete', () => {
    expect(parseIdQuery('1-').kind).toBe('incomplete');
    expect(parseIdQuery('-5').kind).toBe('incomplete');
    expect(parseIdQuery('1-2-3').kind).toBe('incomplete');
  });
});

describe('§3.B row: duplicate IDs (`1,1,3`) de-duplicate', () => {
  it('merges duplicates in normalisation', () => {
    const norm = normaliseRanges(parseIdQuery('1,1,3'), 10);
    expect(norm.ranges).toEqual([
      { lo: 1, hi: 1 },
      { lo: 3, hi: 3 },
    ]);
  });
  it('resolves each insight once', async () => {
    const database = makeDb();
    const project = await seed(database, 3);
    const result = await resolveIdQuery(project.id, project.current_seq, parseIdQuery('1,1,3'), database);
    expect(result.insights.map((i) => i.ref_id)).toEqual([1, 3]);
  });
});

describe('§3.B row: `5-99999999` huge range clamps and uses key-range queries only', () => {
  it('clamps to current_seq and never enumerates candidate IDs', async () => {
    const database = makeDb();
    const project = await seed(database, 20);

    const whereSpy = vi.spyOn(database.insights, 'where');
    const getSpy = vi.spyOn(database.insights, 'get');

    const result = await resolveIdQuery(
      project.id,
      project.current_seq,
      parseIdQuery('5-99999999'),
      database,
    );

    expect(result.insights.map((i) => i.ref_id)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 5),
    );
    expect(result.clamped).toEqual({ from: 21, to: 99999999 });
    // Exactly ONE compound-index key-range query; zero per-ID lookups.
    expect(whereSpy).toHaveBeenCalledTimes(1);
    expect(whereSpy).toHaveBeenCalledWith('[project_id+ref_id]');
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe('§3.B row: result ordering is ascending by ref_id regardless of query order', () => {
  it('orders ascending', async () => {
    const database = makeDb();
    const project = await seed(database, 10);
    const result = await resolveIdQuery(
      project.id,
      project.current_seq,
      parseIdQuery('9, 2-3, 7'),
      database,
    );
    expect(result.insights.map((i) => i.ref_id)).toEqual([2, 3, 7, 9]);
  });
});

describe('§3.B: mixed queries resolve to the union of parts', () => {
  it('`1-4,9,12-14` unions', async () => {
    const database = makeDb();
    const project = await seed(database, 14);
    const result = await resolveIdQuery(
      project.id,
      project.current_seq,
      parseIdQuery('1-4,9,12-14'),
      database,
    );
    expect(result.insights.map((i) => i.ref_id)).toEqual([1, 2, 3, 4, 9, 12, 13, 14]);
  });
});

describe('routing (PRD §3.B / §3.A.0)', () => {
  it('prefixed query against a known project routes there, case-insensitively', () => {
    expect(routeQuery('q3-42', ['Q3', 'X'])).toEqual({
      type: 'prefixed',
      prefix: 'q3',
      idQuery: { kind: 'ranges', ranges: [{ lo: 42, hi: 42 }] },
    });
  });
  it('an unknown prefix falls through (`1-7` stays a range without a project named 1)', () => {
    expect(routeQuery('1-7', ['Q3'])).toEqual({
      type: 'ids',
      idQuery: { kind: 'ranges', ranges: [{ lo: 1, hi: 7 }] },
    });
  });
  it('bare numeric stays scoped to the active project', () => {
    expect(routeQuery('42', ['Q3']).type).toBe('ids');
  });
  it('everything else falls through to text search', () => {
    expect(routeQuery('quarterly report', ['Q3'])).toEqual({
      type: 'text',
      text: 'quarterly report',
    });
  });
  it('blank input restores the default feed', () => {
    expect(routeQuery('   ', ['Q3']).type).toBe('blank');
  });
});

describe('text search scope (PRD §3.B)', () => {
  it('finds matches in source_tag, text, url href/title, and image alt', async () => {
    const database = makeDb();
    const project = await createProject('Scope', 'SC', database);
    const capture = (content: Parameters<typeof captureInsight>[0]['content'], tag = 'tag') =>
      captureInsight(
        { project_id: project.id, source_tag: tag, content, direction: 'auto' },
        database,
      );
    await capture([{ type: 'text', value: 'the quick brown fox' }]);
    await capture([{ type: 'url', href: 'https://example.com/Zebra-paper', title: 'Striped PDF' }]);
    await capture(
      [
        {
          type: 'image',
          blob: new Blob([new Uint8Array([1])], { type: 'image/webp' }),
          mime: 'image/webp',
          width: 1,
          height: 1,
          alt: 'whiteboard giraffe sketch',
        },
      ],
      'Meeting notes',
    );

    expect((await searchText(project.id, 'QUICK', database)).map((i) => i.ref_id)).toEqual([1]);
    expect((await searchText(project.id, 'zebra', database)).map((i) => i.ref_id)).toEqual([2]);
    expect((await searchText(project.id, 'striped', database)).map((i) => i.ref_id)).toEqual([2]);
    expect((await searchText(project.id, 'giraffe', database)).map((i) => i.ref_id)).toEqual([3]);
    expect((await searchText(project.id, 'meeting', database)).map((i) => i.ref_id)).toEqual([3]);
    expect(await searchText(project.id, 'absent', database)).toEqual([]);
  });
});
