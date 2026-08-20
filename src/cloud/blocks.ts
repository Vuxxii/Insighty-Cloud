import { db, getMeta, updateMeta, type InsightyyyDB } from '../db/db';
import { uuid, type Meta, type SeqBlock } from '../db/types';
import { getSupabase } from './supabase';

export const BLOCK_SIZE = 100;
/** Reserve a fresh block when fewer than this many numbers remain locally. */
export const LOW_WATER = 20;

export async function getDeviceId(database: InsightyyyDB = db): Promise<string> {
  const meta = await getMeta(database);
  if (meta.device_id) return meta.device_id;
  const id = uuid();
  await updateMeta({ device_id: id }, database);
  return id;
}

export function blocksRemaining(blocks: SeqBlock[] | undefined): number {
  return (blocks ?? []).reduce((sum, b) => sum + Math.max(0, b.start + b.size - b.next), 0);
}

/** The number the NEXT capture will take — shown in the UI before submission.
 * Cloud mode reads the device's reserved blocks; null = no numbers available
 * (offline with exhausted blocks — capture must not guess). */
export function peekNextRefFromBlocks(blocks: SeqBlock[] | undefined): number | null {
  for (const block of blocks ?? []) {
    if (block.next < block.start + block.size) return block.next;
  }
  return null;
}

/** Pure state transition: consume the next number. Throws if none available. */
export function takeFromBlocks(blocks: SeqBlock[]): { ref: number; blocks: SeqBlock[] } {
  const next = [...blocks].map((b) => ({ ...b }));
  for (const block of next) {
    if (block.next < block.start + block.size) {
      const ref = block.next;
      block.next += 1;
      // Drop exhausted blocks so the list stays tiny.
      return { ref, blocks: next.filter((b) => b.next < b.start + b.size || b === block) };
    }
  }
  throw new Error('No reserved reference numbers left on this device.');
}

export class NoBlockError extends Error {
  constructor() {
    super(
      'No reserved reference numbers available for this project on this device. ' +
        'Connect to the internet once so a new block can be reserved — nothing was saved.',
    );
    this.name = 'NoBlockError';
  }
}

/** Server call: atomically reserve the next range for this device (RLS-scoped). */
async function reserveFromServer(projectId: string, deviceId: string): Promise<SeqBlock> {
  const { data, error } = await getSupabase().rpc('reserve_block', {
    p_project_id: projectId,
    p_device_id: deviceId,
    p_size: BLOCK_SIZE,
  });
  if (error) throw new Error(`Block reservation failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Block reservation returned nothing.');
  return {
    project_id: projectId,
    start: row.block_start,
    size: row.block_size,
    next: row.block_start,
  };
}

/**
 * Ensure this device holds enough upcoming numbers for the project. Called on
 * login, after sync, and after captures — so the Capture Zone can always show
 * "Next: Q3-47" instantly and offline capture keeps working between connections.
 * Silently a no-op when offline (existing blocks keep serving).
 */
export async function ensureBlock(projectId: string, database: InsightyyyDB = db): Promise<void> {
  const meta = await getMeta(database);
  const existing = meta.seq_blocks[projectId] ?? [];
  if (blocksRemaining(existing) > LOW_WATER) return;
  try {
    const deviceId = await getDeviceId(database);
    const fresh = await reserveFromServer(projectId, deviceId);
    const current = await getMeta(database); // re-read: reservation took time
    const merged = [...(current.seq_blocks[projectId] ?? []), fresh];
    await updateMeta({ seq_blocks: { ...current.seq_blocks, [projectId]: merged } }, database);
  } catch {
    // Offline or server unreachable: keep serving from what we have.
  }
}

/** Peek helper for UI: next ref for a project, or null when blocks are dry. */
export async function peekNextRef(
  projectId: string,
  database: InsightyyyDB = db,
): Promise<number | null> {
  const meta = await getMeta(database);
  return peekNextRefFromBlocks(meta.seq_blocks[projectId]);
}

/** Read blocks inside a transaction (capture-time). */
export function metaBlocks(meta: Meta, projectId: string): SeqBlock[] {
  return meta.seq_blocks[projectId] ?? [];
}
