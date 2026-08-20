import { afterEach, describe, expect, it } from 'vitest';
import { InsightyyyDB } from '../src/db/db';
import { createProject } from '../src/db/projects';
import { captureInsight } from '../src/db/insights';
import { clearLastErrorForTest, getLastError, guardWrite, onAppError } from '../src/ui/errorBus';
import { freshDbName } from './setup';

const openDbs: InsightyyyDB[] = [];
function makeDb(): InsightyyyDB {
  const database = new InsightyyyDB(freshDbName());
  openDbs.push(database);
  return database;
}

afterEach(async () => {
  clearLastErrorForTest();
  for (const database of openDbs.splice(0)) await database.delete();
});

function quotaError(): DOMException {
  return new DOMException('Quota exceeded', 'QuotaExceededError');
}

describe('Phase 1 verify gate: simulated QuotaExceededError surfaces a visible error', () => {
  it('a quota failure during capture is reported visibly AND still rejects', async () => {
    const database = makeDb();
    const project = await createProject('Quota', 'QU', database);

    // Simulate the storage layer refusing the write.
    const originalAdd = database.insights.add.bind(database.insights);
    database.insights.add = (async () => {
      throw quotaError();
    }) as unknown as typeof originalAdd;

    const seen: string[] = [];
    const off = onAppError((e) => seen.push(`${e.title}: ${e.detail}`));

    await expect(
      guardWrite(() =>
        captureInsight(
          {
            project_id: project.id,
            source_tag: 'src',
            content: [{ type: 'text', value: 'x' }],
            direction: 'auto',
          },
          database,
        ),
      ),
    ).rejects.toThrow();

    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/Storage is full/);
    expect(seen[0]).toMatch(/Do NOT write this reference number/);
    expect(getLastError()?.blocking).toBe(true);

    // Invariant 2 corollary: the aborted transaction burned no ref_id.
    database.insights.add = originalAdd;
    const fresh = await database.projects.get(project.id);
    expect(fresh?.current_seq).toBe(0);
    const insight = await captureInsight(
      {
        project_id: project.id,
        source_tag: 'src',
        content: [{ type: 'text', value: 'retry' }],
        direction: 'auto',
      },
      database,
    );
    expect(insight.ref_id).toBe(1);
  });

  it('a transaction abort surfaces as a blocking "NOT saved" error', async () => {
    const seen: string[] = [];
    const off = onAppError((e) => seen.push(e.title));
    await expect(
      guardWrite(async () => {
        throw new DOMException('aborted', 'AbortError');
      }),
    ).rejects.toThrow();
    off();
    expect(seen).toEqual(['Save failed — NOT saved']);
  });
});
