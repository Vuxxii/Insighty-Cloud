import { afterEach, describe, expect, it } from 'vitest';
import { InsightyyyDB } from '../src/db/db';
import { createProject, findProjectsByPrefix } from '../src/db/projects';
import { captureInsight } from '../src/db/insights';
import { parseIdQuery } from '../src/search/parser';
import { resolveIdQueryAcross } from '../src/search/resolve';
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

describe('reusable prefixes: cross-project resolution (approved mock C)', () => {
  it('a shared prefix resolves against EVERY matching project, labelled', async () => {
    const database = makeDb();
    const a = await createProject('Rawabi Credit Research', 'Q3', database);
    const b = await createProject('Deal Pipeline', 'q3', database);
    await captureInsight(textInput(a.id, 'from rawabi'), database);
    await captureInsight(textInput(b.id, 'from pipeline'), database);

    const matches = await findProjectsByPrefix('Q3', database);
    expect(matches.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());

    const freshA = (await database.projects.get(a.id))!;
    const freshB = (await database.projects.get(b.id))!;
    const res = await resolveIdQueryAcross([freshA, freshB], parseIdQuery('1'), database);
    expect(res.items).toHaveLength(2);
    const byProject = new Map(res.items.map((i) => [i.project.id, i.insight]));
    expect(byProject.get(a.id)?.content[0]).toMatchObject({ value: 'from rawabi' });
    expect(byProject.get(b.id)?.content[0]).toMatchObject({ value: 'from pipeline' });
    // Per-project notes stay separate.
    expect(res.byProject.get(a.id)?.insights).toHaveLength(1);
    expect(res.byProject.get(b.id)?.insights).toHaveLength(1);
  });

  it('within each project, numbers are still assigned once (D1 untouched)', async () => {
    const database = makeDb();
    const a = await createProject('One', 'X', database);
    const b = await createProject('Two', 'X', database);
    const a1 = await captureInsight(textInput(a.id, 'a1'), database);
    const b1 = await captureInsight(textInput(b.id, 'b1'), database);
    const a2 = await captureInsight(textInput(a.id, 'a2'), database);
    expect(a1.ref_id).toBe(1);
    expect(b1.ref_id).toBe(1); // same number, DIFFERENT project — disambiguated by label
    expect(a2.ref_id).toBe(2);
  });

  it('archived projects still resolve by prefix, listed after active ones', async () => {
    const database = makeDb();
    const active = await createProject('Active', 'Z', database);
    const old = await createProject('Old', 'Z', database);
    await database.projects.update(old.id, { archived_at: new Date().toISOString() });
    const matches = await findProjectsByPrefix('z', database);
    expect(matches).toHaveLength(2);
    expect(matches[0].id).toBe(active.id);
    expect(matches[1].id).toBe(old.id);
  });
});
