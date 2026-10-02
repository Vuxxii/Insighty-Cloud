import { db, type InsightyyyDB } from '../db/db';
import type { Insight, Project } from '../db/types';
import { normaliseRanges, type ClampNote, type IdQuery } from './parser';

export interface IdQueryResult {
  /** Active (non-deleted, non-purged) insights, ascending by ref_id. */
  insights: Insight[];
  /** Requested refs that were purged — shown as "permanently deleted" (PRD §3.D). */
  purgedRefs: number[];
  /** Requested refs that are soft-deleted (restorable via Show deleted). */
  deletedRefs: number[];
  /** Requested refs ≤ current_seq with no row at all. */
  missingRefs: number[];
  /** Requested span above current_seq, reported without enumeration. */
  clamped: ClampNote | null;
}

/**
 * Resolve an ID query via IDBKeyRange on the compound [project_id, ref_id] index —
 * one .between() per merged range, never per-ID enumeration (PRD §3.B).
 */
export async function resolveIdQuery(
  projectId: string,
  currentSeq: number,
  query: IdQuery,
  database: InsightyyyDB = db,
): Promise<IdQueryResult> {
  const { ranges, clamped } = normaliseRanges(query, currentSeq);
  const insights: Insight[] = [];
  const purgedRefs: number[] = [];
  const deletedRefs: number[] = [];
  const missingRefs: number[] = [];

  for (const range of ranges) {
    const rows = await database.insights
      .where('[project_id+ref_id]')
      .between([projectId, range.lo], [projectId, range.hi], true, true)
      .toArray();
    const byRef = new Map(rows.map((r: Insight) => [r.ref_id, r]));
    for (let ref = range.lo; ref <= range.hi; ref++) {
      const row = byRef.get(ref);
      if (!row) missingRefs.push(ref);
      else if (row.purged) purgedRefs.push(ref);
      else if (row.deleted_at !== null) deletedRefs.push(ref);
      else insights.push(row);
    }
  }
  insights.sort((a, b) => a.ref_id - b.ref_id); // ascending, regardless of query order
  return { insights, purgedRefs, deletedRefs, missingRefs, clamped };
}

export interface CrossProjectResult {
  /** All active matches, each labelled with its project. Ordered by project, then ref. */
  items: Array<{ insight: Insight; project: Project }>;
  /** Per-project resolution details (for notes), keyed by project id. */
  byProject: Map<string, IdQueryResult>;
  /** The projects that were queried. */
  projects: Project[];
}

/**
 * Resolve one ID query across SEVERAL projects (reusable prefixes, approved 2026-10):
 * the same handwritten "Q3-42" may exist in more than one project — every match is
 * returned, labelled, never silently narrowed.
 */
export async function resolveIdQueryAcross(
  projects: Project[],
  query: IdQuery,
  database: InsightyyyDB = db,
): Promise<CrossProjectResult> {
  const items: CrossProjectResult['items'] = [];
  const byProject = new Map<string, IdQueryResult>();
  for (const project of projects) {
    const result = await resolveIdQuery(project.id, project.current_seq, query, database);
    byProject.set(project.id, result);
    for (const insight of result.insights) items.push({ insight, project });
  }
  return { items, byProject, projects };
}

/**
 * Text search (PRD §3.B): linear scan over the project's insights across source_tag,
 * text values, url href/title, and image alt. Case-insensitive. Fine to several
 * thousand insights; no index in v1.
 */
export async function searchText(
  projectId: string,
  queryText: string,
  database: InsightyyyDB = db,
): Promise<Insight[]> {
  const needle = queryText.toLowerCase();
  const rows = await database.insights.where('project_id').equals(projectId).toArray();
  const matches = rows.filter((row: Insight) => {
    if (row.deleted_at !== null || row.purged) return false;
    if (row.source_tag.toLowerCase().includes(needle)) return true;
    return row.content.some((block) => {
      switch (block.type) {
        case 'text':
          return block.value.toLowerCase().includes(needle);
        case 'url':
          return (
            block.href.toLowerCase().includes(needle) ||
            (block.title ?? '').toLowerCase().includes(needle)
          );
        case 'image':
          return (block.alt ?? '').toLowerCase().includes(needle);
        default:
          return false;
      }
    });
  });
  matches.sort((a, b) => b.ref_id - a.ref_id); // search results read newest-first
  return matches;
}
