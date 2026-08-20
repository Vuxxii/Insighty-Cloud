import { useState } from 'react';
import type { Insight } from '../db/types';
import { useApp } from '../state/app';
import { InsightCard } from './InsightCard';
import { EditDialog } from './EditDialog';
import { PurgeDialog } from './PurgeDialog';

export function Feed() {
  const app = useApp();
  const [editing, setEditing] = useState<Insight | null>(null);
  const [purging, setPurging] = useState<Insight | null>(null);

  if (!app.activeProject) {
    return (
      <div className="feed-empty">
        <p>No project yet.</p>
        <p className="muted">Create one from the top bar to start capturing insights.</p>
      </div>
    );
  }

  const project =
    app.feed.kind === 'ids' ? app.feed.project : app.activeProject;
  const insights = app.feed.kind === 'incomplete' ? [] : app.feed.insights;

  return (
    <>
      <div className="feed-controls">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={app.showDeleted}
            onChange={(e) => app.setShowDeleted(e.target.checked)}
          />
          Show deleted
        </label>
        <span className="muted">
          {app.feed.kind === 'default'
            ? `${insights.length} insight${insights.length === 1 ? '' : 's'}, newest first`
            : app.feed.kind === 'ids'
              ? `ID results in ${project.name}, ascending`
              : ''}
        </span>
      </div>

      {insights.length === 0 && app.feed.kind === 'default' && (
        <div className="feed-empty">
          <p>Nothing captured yet in {project.name}.</p>
          <p className="muted">
            Paste a screenshot or type an insight, then write the shown reference (e.g.{' '}
            {project.prefix}-1) in your notebook.
          </p>
        </div>
      )}

      {insights.map((insight) => (
        <InsightCard
          key={insight.id}
          insight={insight}
          project={project}
          onEdit={setEditing}
          onPurge={setPurging}
        />
      ))}

      {editing && <EditDialog insight={editing} onClose={() => setEditing(null)} />}
      {purging && (
        <PurgeDialog insight={purging} project={project} onClose={() => setPurging(null)} />
      )}
    </>
  );
}
