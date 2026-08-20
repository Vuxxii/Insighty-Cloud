import { db, getMeta, type InsightyyyDB } from './db';
import { nowIso, uuid, type Block, type Direction, type Insight } from './types';
import { NoBlockError, metaBlocks, takeFromBlocks } from '../cloud/blocks';

export interface CaptureInput {
  project_id: string;
  source_tag: string;
  content: Block[];
  direction: Direction;
}

export interface CaptureOptions {
  /** Cloud mode: assign the ref from this device's reserved block instead of
   * current_seq+1, so numbers can never collide across devices (D1 preserved). */
  fromBlock?: boolean;
}

/**
 * Invariant 2 (build prompt): the seq-increment and the insight insert happen in ONE
 * IndexedDB readwrite transaction. Cloud mode adds `meta` to the same transaction so
 * block consumption is atomic with the insert too — an abort rolls back everything;
 * no ref_id is ever burned or duplicated.
 */
export async function captureInsight(
  input: CaptureInput,
  database: InsightyyyDB = db,
  opts: CaptureOptions = {},
): Promise<Insight> {
  return database.transaction(
    'rw',
    database.projects,
    database.insights,
    database.meta,
    async () => {
      const project = await database.projects.get(input.project_id);
      if (!project) throw new Error('Active project not found.');
      const now = nowIso();

      let ref_id: number;
      if (opts.fromBlock) {
        const meta = await getMeta(database);
        const blocks = metaBlocks(meta, project.id);
        let taken;
        try {
          taken = takeFromBlocks(blocks);
        } catch {
          throw new NoBlockError();
        }
        ref_id = taken.ref;
        await database.meta.put({
          ...meta,
          seq_blocks: { ...meta.seq_blocks, [project.id]: taken.blocks },
        });
      } else {
        ref_id = project.current_seq + 1;
      }

      const insight: Insight = {
        id: uuid(),
        project_id: project.id,
        ref_id,
        source_tag: input.source_tag.trim(),
        content: input.content,
        direction: input.direction,
        timestamp: now,
        updated_at: now,
        deleted_at: null,
        purged: false,
        dirty: 1,
      };
      await database.projects.put({
        ...project,
        current_seq: Math.max(project.current_seq, ref_id),
        updated_at: now,
        dirty: 1,
      });
      await database.insights.add(insight);
      return insight;
    },
  );
}

/** Normal edit (also used by Quick Edit). Never changes ref_id (PRD §3.A). */
export async function editInsight(
  id: string,
  patch: Partial<Pick<Insight, 'source_tag' | 'content' | 'direction'>>,
  database: InsightyyyDB = db,
): Promise<Insight> {
  return database.transaction('rw', database.insights, async () => {
    const insight = await database.insights.get(id);
    if (!insight) throw new Error('Insight not found.');
    if (insight.purged) throw new Error('Cannot edit a purged insight.');
    const next: Insight = { ...insight, ...patch, updated_at: nowIso(), dirty: 1 };
    await database.insights.put(next);
    return next;
  });
}

export async function softDeleteInsight(id: string, database: InsightyyyDB = db): Promise<void> {
  await database.transaction('rw', database.insights, async () => {
    const insight = await database.insights.get(id);
    if (!insight) throw new Error('Insight not found.');
    await database.insights.put({ ...insight, deleted_at: nowIso(), updated_at: nowIso(), dirty: 1 });
  });
}

export async function restoreInsight(id: string, database: InsightyyyDB = db): Promise<void> {
  await database.transaction('rw', database.insights, async () => {
    const insight = await database.insights.get(id);
    if (!insight) throw new Error('Insight not found.');
    if (insight.purged) throw new Error('A purged insight cannot be restored.');
    await database.insights.put({ ...insight, deleted_at: null, updated_at: nowIso(), dirty: 1 });
  });
}

/**
 * Hard delete (D1, PRD §3.D): content is removed but the row persists as a tombstone.
 * The ref_id stays permanently retired; current_seq is untouched.
 */
export async function purgeInsight(id: string, database: InsightyyyDB = db): Promise<void> {
  await database.transaction('rw', database.insights, async () => {
    const insight = await database.insights.get(id);
    if (!insight) throw new Error('Insight not found.');
    const tombstone: Insight = {
      ...insight,
      content: [],
      source_tag: '',
      purged: true,
      deleted_at: insight.deleted_at ?? nowIso(),
      updated_at: nowIso(),
      dirty: 1,
    };
    await database.insights.put(tombstone);
  });
}

/**
 * Range/ID resolution via IDBKeyRange on the compound [project_id, ref_id] index —
 * never by enumerating candidate IDs in a loop (PRD §3.B huge-range row).
 */
export async function getInsightsInRefRange(
  projectId: string,
  lo: number,
  hi: number,
  database: InsightyyyDB = db,
): Promise<Insight[]> {
  return database.insights
    .where('[project_id+ref_id]')
    .between([projectId, lo], [projectId, hi], true, true)
    .toArray();
}

export async function getInsightByRef(
  projectId: string,
  refId: number,
  database: InsightyyyDB = db,
): Promise<Insight | undefined> {
  return database.insights.where('[project_id+ref_id]').equals([projectId, refId]).first();
}

export async function listInsights(
  projectId: string,
  opts: { includeDeleted?: boolean } = {},
  database: InsightyyyDB = db,
): Promise<Insight[]> {
  const all = await database.insights.where('project_id').equals(projectId).toArray();
  const rows = opts.includeDeleted ? all : all.filter((i) => i.deleted_at === null && !i.purged);
  // Default feed state: newest-first (PRD §3.B).
  rows.sort((a, b) => b.ref_id - a.ref_id);
  return rows;
}

/** Source-tag history for the sticky source dropdown, most recent first (PRD §3.A). */
export async function listSourceTags(
  projectId: string,
  database: InsightyyyDB = db,
): Promise<string[]> {
  const rows = await database.insights.where('project_id').equals(projectId).toArray();
  rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const row of rows) {
    const tag = row.source_tag;
    if (tag && !row.purged && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}
