import { useEffect, useState } from 'react';
import { onSyncState, syncNow, type SyncState } from '../cloud/sync';
import { getUserEmail } from '../cloud/auth';

/** Top-bar sync chip: Synced / Syncing / N pending / Offline / Locked. */
export function SyncStatus({ onAccountClick }: { onAccountClick: () => void }) {
  const [state, setState] = useState<SyncState | null>(null);

  useEffect(() => onSyncState(setState), []);
  if (!state) return null;

  const label =
    state.phase === 'syncing'
      ? 'Syncing…'
      : state.phase === 'offline'
        ? `Offline${state.pendingPush ? ` · ${state.pendingPush} pending` : ''}`
        : state.phase === 'error'
          ? 'Sync error'
          : state.phase === 'locked'
            ? 'Locked'
            : state.pendingPush > 0
              ? `${state.pendingPush} pending`
              : 'Synced';

  const cls =
    state.phase === 'idle' && state.pendingPush === 0
      ? 'protected'
      : state.phase === 'syncing'
        ? 'unknown'
        : 'at-risk';

  return (
    <button
      type="button"
      className={`storage-status ${cls}`}
      style={{ background: 'transparent' }}
      title={
        (getUserEmail() ? `${getUserEmail()} — ` : '') +
        (state.detail ?? 'End-to-end encrypted sync. Click for account options.')
      }
      onClick={() => {
        void syncNow();
        onAccountClick();
      }}
    >
      <span className="dot" />
      {label}
    </button>
  );
}
