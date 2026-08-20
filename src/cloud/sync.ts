import { db, type InsightyyyDB } from '../db/db';
import { getMeta, updateMeta } from '../db/db';
import type { Block, Insight, Project } from '../db/types';
import { base64ToBuffer, bufferToBase64 } from '../backup/format';
import { decryptString, encryptString, type CipherEnvelope } from './crypto';
import { getMasterKey, getUserId, isUnlocked } from './auth';
import { getSupabase } from './supabase';
import { ensureBlock } from './blocks';

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error' | 'locked';

export interface SyncState {
  phase: SyncPhase;
  pendingPush: number;
  lastSyncAt: string | null;
  detail?: string;
}

type Listener = (state: SyncState) => void;
const listeners = new Set<Listener>();
let state: SyncState = { phase: 'locked', pendingPush: 0, lastSyncAt: null };

export function onSyncState(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function getSyncState(): SyncState {
  return state;
}

/* ————— Serialization: everything content-bearing goes INSIDE the ciphertext ————— */

interface SerializedBlock {
  type: string;
  [k: string]: unknown;
}

async function serializeContent(insight: Insight): Promise<string> {
  const blocks: SerializedBlock[] = await Promise.all(
    insight.content.map(async (block: Block) => {
      if (block.type === 'image') {
        return {
          type: 'image',
          mime: block.mime,
          width: block.width,
          height: block.height,
          ...(block.alt !== undefined ? { alt: block.alt } : {}),
          data: bufferToBase64(await block.blob.arrayBuffer()),
        };
      }
      return block as unknown as SerializedBlock;
    }),
  );
  return JSON.stringify({
    source_tag: insight.source_tag,
    direction: insight.direction,
    content: blocks,
  });
}

function deserializeContent(json: string): Pick<Insight, 'source_tag' | 'direction' | 'content'> {
  const parsed = JSON.parse(json) as {
    source_tag: string;
    direction: Insight['direction'];
    content: SerializedBlock[];
  };
  const content: Block[] = parsed.content.map((block) => {
    if (block.type === 'image') {
      const { data, mime, width, height, alt } = block as unknown as {
        data: string;
        mime: string;
        width: number;
        height: number;
        alt?: string;
      };
      return {
        type: 'image',
        blob: new Blob([base64ToBuffer(data)], { type: mime }),
        mime,
        width,
        height,
        ...(alt !== undefined ? { alt } : {}),
      };
    }
    return block as unknown as Block;
  });
  return { source_tag: parsed.source_tag, direction: parsed.direction, content };
}

/* ————— Push ————— */

async function pushProjects(database: InsightyyyDB, mk: CryptoKey, userId: string): Promise<void> {
  const dirty = await database.projects.where('dirty').equals(1).toArray();
  for (const project of dirty) {
    const name_enc = await encryptString(project.name, mk);
    const { error } = await getSupabase()
      .from('projects')
      .upsert({
        id: project.id,
        user_id: userId,
        prefix: project.prefix,
        name_enc,
        created_at: project.created_at,
        updated_at: project.updated_at,
        archived_at: project.archived_at,
      });
    if (error) {
      // Fresh local project: the insert must also seed the allocator.
      if (error.code === '23502' || error.message.includes('next_seq')) {
        throw new Error(`Project push failed: ${error.message}`);
      }
      throw new Error(`Project push failed: ${error.message}`);
    }
    await database.projects.update(project.id, { dirty: 0 });
  }
}

async function pushInsights(database: InsightyyyDB, mk: CryptoKey, userId: string): Promise<void> {
  const dirty = await database.insights.where('dirty').equals(1).toArray();
  for (const insight of dirty) {
    const content_enc = await encryptString(await serializeContent(insight), mk);
    const { error } = await getSupabase()
      .from('insights')
      .upsert({
        id: insight.id,
        user_id: userId,
        project_id: insight.project_id,
        ref_id: insight.ref_id,
        content_enc,
        timestamp: insight.timestamp,
        updated_at: insight.updated_at,
        deleted_at: insight.deleted_at,
        purged: insight.purged,
      });
    if (error) throw new Error(`Insight push failed (ref ${insight.ref_id}): ${error.message}`);
    await database.insights.update(insight.id, { dirty: 0 });
  }
}

/* ————— Pull (LWW per row; local dirty rows are never overwritten) ————— */

interface RemoteProject {
  id: string;
  prefix: string;
  name_enc: CipherEnvelope;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface RemoteInsight {
  id: string;
  project_id: string;
  ref_id: number;
  content_enc: CipherEnvelope;
  timestamp: string;
  updated_at: string;
  deleted_at: string | null;
  purged: boolean;
}

/** Pure merge decision, unit-tested: apply remote only when local is absent, or
 * remote is strictly newer AND local has no unpushed edits. */
export function shouldApplyRemote(
  local: { updated_at: string; dirty?: number } | undefined,
  remoteUpdatedAt: string,
): boolean {
  if (!local) return true;
  if (local.dirty === 1) return false;
  return remoteUpdatedAt > local.updated_at;
}

async function pullAll(database: InsightyyyDB, mk: CryptoKey): Promise<void> {
  const meta = await getMeta(database);
  const cursor = meta.sync_cursor ?? '1970-01-01T00:00:00.000Z';
  let maxSeen = cursor;

  const { data: projects, error: pErr } = await getSupabase()
    .from('projects')
    .select('id, prefix, name_enc, created_at, updated_at, archived_at')
    .gt('updated_at', cursor)
    .order('updated_at', { ascending: true });
  if (pErr) throw new Error(`Project pull failed: ${pErr.message}`);

  for (const remote of (projects ?? []) as RemoteProject[]) {
    const local = await database.projects.get(remote.id);
    if (shouldApplyRemote(local, remote.updated_at)) {
      const name = await decryptString(remote.name_enc, mk);
      const next: Project = {
        id: remote.id,
        name,
        prefix: remote.prefix,
        current_seq: local?.current_seq ?? 0,
        created_at: remote.created_at,
        updated_at: remote.updated_at,
        archived_at: remote.archived_at,
        dirty: 0,
      };
      await database.projects.put(next);
    }
    if (remote.updated_at > maxSeen) maxSeen = remote.updated_at;
  }

  const { data: insights, error: iErr } = await getSupabase()
    .from('insights')
    .select('id, project_id, ref_id, content_enc, timestamp, updated_at, deleted_at, purged')
    .gt('updated_at', cursor)
    .order('updated_at', { ascending: true })
    .limit(500);
  if (iErr) throw new Error(`Insight pull failed: ${iErr.message}`);

  for (const remote of (insights ?? []) as RemoteInsight[]) {
    const local = await database.insights.get(remote.id);
    if (shouldApplyRemote(local, remote.updated_at)) {
      const body = remote.purged
        ? { source_tag: '', direction: 'auto' as const, content: [] as Block[] }
        : deserializeContent(await decryptString(remote.content_enc, mk));
      const next: Insight = {
        id: remote.id,
        project_id: remote.project_id,
        ref_id: remote.ref_id,
        ...body,
        timestamp: remote.timestamp,
        updated_at: remote.updated_at,
        deleted_at: remote.deleted_at,
        purged: remote.purged,
        dirty: 0,
      };
      await database.insights.put(next);
      // Keep the local high-water mark honest for pulled refs (D1 monotonic).
      const project = await database.projects.get(remote.project_id);
      if (project && project.current_seq < remote.ref_id) {
        await database.projects.put({ ...project, current_seq: remote.ref_id });
      }
    }
    if (remote.updated_at > maxSeen) maxSeen = remote.updated_at;
  }

  await updateMeta({ sync_cursor: maxSeen }, database);
}

/* ————— Orchestration ————— */

let syncing = false;

export async function countPending(database: InsightyyyDB = db): Promise<number> {
  const [projectCount, insightCount] = await Promise.all([
    database.projects.where('dirty').equals(1).count(),
    database.insights.where('dirty').equals(1).count(),
  ]);
  return projectCount + insightCount;
}

/** Push dirty rows, pull remote changes, top up ID blocks. Safe to call often. */
export async function syncNow(database: InsightyyyDB = db): Promise<void> {
  if (syncing) return;
  if (!isUnlocked()) {
    setState({ phase: 'locked', pendingPush: await countPending(database) });
    return;
  }
  const mk = getMasterKey()!;
  const userId = getUserId()!;
  syncing = true;
  setState({ phase: 'syncing' });
  try {
    await pushProjects(database, mk, userId);
    await pushInsights(database, mk, userId);
    await pullAll(database, mk);
    const { active } = await import('../db/projects').then((m) => m.listProjects(database));
    for (const project of active) {
      await ensureBlock(project.id, database);
    }
    setState({
      phase: 'idle',
      pendingPush: await countPending(database),
      lastSyncAt: new Date().toISOString(),
    });
  } catch (err) {
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    setState({
      phase: offline ? 'offline' : 'error',
      pendingPush: await countPending(database),
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    syncing = false;
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

/** Background cadence: on unlock, then every 60s, plus on regained connectivity. */
export function startSyncLoop(): void {
  if (intervalId) return;
  void syncNow();
  intervalId = setInterval(() => void syncNow(), 60_000);
  window.addEventListener('online', () => void syncNow());
}

export function stopSyncLoop(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  setState({ phase: 'locked' });
}
