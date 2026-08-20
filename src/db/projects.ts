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

export class PrefixConflictError extends Error {
  constructor(public prefix: string) {
    super(`Prefix "${prefix}" is already used by a non-archived project.`);
    this.name = 'PrefixConflictError';
  }
}

export function validatePrefix(prefix: string): string | null {
  if (!PREFIX_RE.test(prefix)) {
    return 'Prefix must be 1–6 letters or digits.';
  }
  return null;
}

/** Prefix uniqueness is enforced among non-archived projects only (PRD §3.A.0), so it
 * cannot be a plain unique index — checked in code inside the same transaction. */
async function assertPrefixFree(
  database: InsightyyyDB,
  prefix: string,
  exceptId?: string,
): Promise<void> {
  const clash = await database.projects
    .filter(
      (p) =>
        p.archived_at === null &&
        p.prefix.toUpperCase() === prefix.toUpperCase() &&
        p.id !== exceptId,
    )
    .first();
  if (clash) throw new PrefixConflictError(prefix);
}

export async function createProject(
  name: string,
  prefix: string,
  database: InsightyyyDB = db,
): Promise<Project> {
  const invalid = validatePrefix(prefix);
  if (invalid) throw new Error(invalid);
  return database.transaction('rw', database.projects, async () => {
    await assertPrefixFree(database, prefix);
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
  });
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
    if (patch.prefix !== undefined && project.archived_at === null) {
      await assertPrefixFree(database, patch.prefix, id);
    }
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
    if (!archived) {
      // Un-archiving re-enters the non-archived prefix namespace — must not collide.
      await assertPrefixFree(database, project.prefix, id);
    }
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

/** Resolve a prefix (case-insensitive) to a project — archived projects remain
 * resolvable via prefixed queries (PRD §3.D). Non-archived wins on collision. */
export async function findProjectByPrefix(
  prefix: string,
  database: InsightyyyDB = db,
): Promise<Project | undefined> {
  const matches = await database.projects
    .filter((p) => p.prefix.toUpperCase() === prefix.toUpperCase())
    .toArray();
  return matches.find((p) => p.archived_at === null) ?? matches[0];
}
