import { afterEach, describe, expect, it } from 'vitest';
import { InsightyyyDB } from '../src/db/db';
import { createProject, renameProject, suggestPrefix } from '../src/db/projects';
import { captureInsight, editInsight } from '../src/db/insights';
import { resolveDirection } from '../src/text/direction';
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

const textInput = (projectId: string, value: string) => ({
  project_id: projectId,
  source_tag: 'src',
  content: [{ type: 'text' as const, value }],
  direction: 'auto' as const,
});

describe('Phase 2 verify gate: atomic ID assignment (invariant 2)', () => {
  it('an abort between seq-increment and insert burns no ref_id and duplicates none', async () => {
    const database = makeDb();
    const project = await createProject('Atomic', 'AT', database);

    // Force the INSERT half of the transaction to fail after the increment half ran.
    const originalAdd = database.insights.add.bind(database.insights);
    database.insights.add = (async () => {
      throw new DOMException('injected failure', 'AbortError');
    }) as unknown as typeof originalAdd;

    await expect(captureInsight(textInput(project.id, 'doomed'), database)).rejects.toThrow();
    database.insights.add = originalAdd;

    // The seq increment must have rolled back with the aborted transaction.
    const after = await database.projects.get(project.id);
    expect(after?.current_seq).toBe(0);
    expect(await database.insights.where('project_id').equals(project.id).count()).toBe(0);

    // Next capture takes ref 1 — nothing burned, nothing duplicated.
    const first = await captureInsight(textInput(project.id, 'survivor'), database);
    expect(first.ref_id).toBe(1);
    const second = await captureInsight(textInput(project.id, 'next'), database);
    expect(second.ref_id).toBe(2);
  });

  it('concurrent double-submit yields two distinct sequential IDs', async () => {
    const database = makeDb();
    const project = await createProject('Race', 'RC', database);
    const [a, b] = await Promise.all([
      captureInsight(textInput(project.id, 'A'), database),
      captureInsight(textInput(project.id, 'B'), database),
    ]);
    expect([a.ref_id, b.ref_id].sort()).toEqual([1, 2]);
    const fresh = await database.projects.get(project.id);
    expect(fresh?.current_seq).toBe(2);
    // Unique compound index would reject a duplicate pair outright.
    const rows = await database.insights.where('project_id').equals(project.id).toArray();
    expect(new Set(rows.map((r) => r.ref_id)).size).toBe(2);
  });
});

describe('Phase 2 verify gate: direction resolution (PRD §3.A.1)', () => {
  it('resolves Arabic to rtl', () => {
    expect(resolveDirection('مرحبا بالعالم')).toBe('rtl');
  });
  it('resolves Latin to ltr', () => {
    expect(resolveDirection('hello world')).toBe('ltr');
  });
  it('mixed content follows the FIRST strong character', () => {
    expect(resolveDirection('hello مرحبا')).toBe('ltr');
    expect(resolveDirection('مرحبا hello')).toBe('rtl');
    expect(resolveDirection('42 — مرحبا then latin')).toBe('rtl');
  });
  it('digits/punctuation only stays auto', () => {
    expect(resolveDirection('12345 —— !!')).toBe('auto');
  });
  it('manual override wins over content', () => {
    expect(resolveDirection('hello', 'rtl')).toBe('rtl');
    expect(resolveDirection('مرحبا', 'ltr')).toBe('ltr');
  });
});

describe('Quick Edit semantics (PRD §3.A)', () => {
  it('updates updated_at and never changes ref_id', async () => {
    const database = makeDb();
    const project = await createProject('Edit', 'ED', database);
    const captured = await captureInsight(textInput(project.id, 'tpyo'), database);
    await new Promise((r) => setTimeout(r, 5));
    const edited = await editInsight(
      captured.id,
      { content: [{ type: 'text', value: 'typo fixed' }] },
      database,
    );
    expect(edited.ref_id).toBe(captured.ref_id);
    expect(edited.updated_at > captured.updated_at).toBe(true);
    expect(edited.timestamp).toBe(captured.timestamp);
  });
});

describe('project prefixes (PRD §3.A.0)', () => {
  it('suggests initials as the default prefix', () => {
    expect(suggestPrefix('Quarter Three')).toBe('QT');
    expect(suggestPrefix('deep-work journal club extra words here')).toBe('DJCEWH');
  });
  it('rejects prefix collisions among non-archived projects, case-insensitively', async () => {
    const database = makeDb();
    await createProject('One', 'Q3', database);
    await expect(createProject('Two', 'q3', database)).rejects.toThrow(/already used/);
  });
  it('allows renaming a prefix (UI shows the permanence warning)', async () => {
    const database = makeDb();
    const p = await createProject('One', 'AA', database);
    const renamed = await renameProject(p.id, { prefix: 'BB' }, database);
    expect(renamed.prefix).toBe('BB');
  });
});
