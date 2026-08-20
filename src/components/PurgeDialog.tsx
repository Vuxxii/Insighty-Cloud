import { useState } from 'react';
import type { Insight, Project } from '../db/types';
import { useApp } from '../state/app';

/** Hard-delete with typed confirmation (PRD §3.D). The ref_id stays retired forever. */
export function PurgeDialog({
  insight,
  project,
  onClose,
}: {
  insight: Insight;
  project: Project;
  onClose: () => void;
}) {
  const app = useApp();
  const [typed, setTyped] = useState('');
  const expected = `${project.prefix}-${insight.ref_id}`;
  const match = typed.trim().toUpperCase() === expected.toUpperCase();

  return (
    <div className="error-overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        <h2>Permanently delete {expected}?</h2>
        <div className="warning-box">
          This removes the content forever. The reference number <strong>{expected}</strong> stays
          permanently retired — it will never be reassigned, and looking it up will say “permanently
          deleted”. If this number is written in a notebook, that pointer becomes a dead end.
        </div>
        <label>Type the reference ({expected}) to confirm</label>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={expected}
        />
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!match}
            onClick={() => {
              void app.hardPurgeInsight(insight.id).then(onClose);
            }}
          >
            Purge forever
          </button>
        </div>
      </div>
    </div>
  );
}
