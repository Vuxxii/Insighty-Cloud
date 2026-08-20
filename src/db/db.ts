import Dexie, { type Table } from 'dexie';
import { SCHEMA_VERSION, nowIso, type Insight, type Meta, type Project } from './types';

/**
 * Dexie's version() chain is the migration runner (PRD §6 Phase 1).
 * Any store change bumps SCHEMA_VERSION in types.ts and adds a new version() block here.
 */
export class InsightyyyDB extends Dexie {
  meta!: Table<Meta, string>;
  projects!: Table<Project, string>;
  insights!: Table<Insight, string>;

  constructor(name = 'insightyyy') {
    super(name);
    this.version(1).stores({
      meta: 'key',
      projects: 'id, name',
      // Compound UNIQUE index on [project_id, ref_id] — no partial-index qualifier
      // needed because ref_ids are monotonic and assigned exactly once (D1, PRD §4).
      insights:
        'id, &[project_id+ref_id], [project_id+source_tag], [project_id+deleted_at], project_id',
    });
    // v2 (cloud): dirty flags for sync push scans + cloud fields on meta.
    this.version(SCHEMA_VERSION)
      .stores({
        meta: 'key',
        projects: 'id, name, dirty',
        insights:
          'id, &[project_id+ref_id], [project_id+source_tag], [project_id+deleted_at], project_id, dirty',
      })
      .upgrade(async (tx) => {
        await tx
          .table('meta')
          .toCollection()
          .modify((m: Meta) => {
            m.schema_version = SCHEMA_VERSION;
            m.device_id = m.device_id ?? null;
            m.seq_blocks = m.seq_blocks ?? {};
            m.sync_cursor = m.sync_cursor ?? null;
            m.cloud_key_cache = m.cloud_key_cache ?? null;
            m.cloud_pending_bundle = m.cloud_pending_bundle ?? null;
          });
      });
  }
}

export const db = new InsightyyyDB();

export const DEFAULT_META: Meta = {
  key: 'meta',
  schema_version: SCHEMA_VERSION,
  last_export_at: null,
  storage_persisted: false,
  backup_dir_handle: null,
  auto_backup: { enabled: true, every_n: 25 },
  captures_since_backup: 0,
  last_capture_day: null,
  device_id: null,
  seq_blocks: {},
  sync_cursor: null,
  cloud_key_cache: null,
  cloud_pending_bundle: null,
};

export async function getMeta(database: InsightyyyDB = db): Promise<Meta> {
  const m = await database.meta.get('meta');
  if (m) return m;
  await database.meta.put(DEFAULT_META);
  return { ...DEFAULT_META };
}

export async function updateMeta(
  patch: Partial<Omit<Meta, 'key'>>,
  database: InsightyyyDB = db,
): Promise<Meta> {
  return database.transaction('rw', database.meta, async () => {
    const current = await getMeta(database);
    const next = { ...current, ...patch };
    await database.meta.put(next);
    return next;
  });
}

export function touch<T extends { updated_at: string }>(row: T): T {
  return { ...row, updated_at: nowIso() };
}
