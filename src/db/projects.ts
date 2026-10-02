import { db, type InsightyyyDB } from './db';
import { PREFIX_RE, nowIso, uuid, type Project } from './types';

export function suggestPrefix(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words
    .map((w) => [...w].find((ch) => /[A-Za-z0-9]/.test(ch)) ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 6);
  return initials || 'P';
}

export function validatePrefix(prefix: string): string | null {
  if (!PREFIX_RE.test(prefix)) {
    return 'Prefix must be 1–6 letters or digits.';
  }
  return null;
}

/* Prefixes are REUSABLE across projects (approved 2026-10): no uniqueness check
 * anywhere. A prefixed search that matches several projects shows every match,
 * labelled by project — ambiguity is surfaced, never silently resolved. Within a
 * project, ref_ids are still assigned exactly once, forever (D1 unchanged). */

export async function createProject(
  name: string,
  prefix: string,
  database: InsightyyyDB = db,
): Promise<Project> {
  const invalid = validatePrefix(prefix);
  if (invalid) throw new Error(invalid);
  const now = nowIso();
  const project: Project = {
    id: uuid(),
    name: name.trim(),
    prefix,
    current_seq: 0,
    created_at: now,
    updated_at: now,
    archived_at: null,
    dirty: 1,
  };
  await database.projects.add(project);
  return project;
}

export async function renameProject(
  id: string,
  patch: { name?: string; prefix?: string },
  database: InsightyyyDB = db,
): Promise<Project> {
  if (patch.prefix !== undefined) {
    const invalid = validatePrefix(patch.prefix);
    if (invalid) throw new Error(invalid);
  }
  return database.transaction('rw', database.projects, async () => {
    const project = await database.projects.get(id);
    if (!project) throw new Error('Project not found.');
    const next: Project = {
      ...project,
      name: patch.name?.trim() ?? project.name,
      prefix: patch.prefix ?? project.prefix,
      updated_at: nowIso(),
      dirty: 1,
    };
    await database.projects.put(next);
    return next;
  });
}

export async function setArchived(
  id: string,
  archived: boolean,
  database: InsightyyyDB = db,
): Promise<Project> {
  return database.transaction('rw', database.projects, async () => {
    const project = await database.projects.get(id);
    if (!project) throw new Error('Project not found.');
    const next: Project = {
      ...project,
      archived_at: archived ? nowIso() : null,
      updated_at: nowIso(),
      dirty: 1,
    };
    await database.projects.put(next);
    return next;
  });
}

export async function listProjects(
  database: InsightyyyDB = db,
): Promise<{ active: Project[]; archived: Project[] }> {
  const all = await database.projects.toArray();
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  all.sort((a, b) => collator.compare(a.name, b.name));
  return {
    active: all.filter((p) => p.archived_at === null),
    archived: all.filter((p) => p.archived_at !== null),
  };
}

/** ALL projects matching a prefix, case-insensitively — archived included, since a
 * handwritten pointer must keep resolving (PRD §3.D). Active projects first. */
export async function findProjectsByPrefix(
  prefix: string,
  database: InsightyyyDB = db,
): Promise<Project[]> {
  const matches = await database.projects
    .filter((p) => p.prefix.toUpperCase() === prefix.toUpperCase())
    .toArray();
  matches.sort((a, b) =>
    (a.archived_at === null ? 0 : 1) - (b.archived_at === null ? 0 : 1) ||
    a.name.localeCompare(b.name),
  );
  return matches;
}
