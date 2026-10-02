import { useState } from 'react';
import type { Insight, Project } from '../db/types';
import { useApp } from '../state/app';
import { InsightCard } from './InsightCard';
import { EditDialog } from './EditDialog';
import { PurgeDialog } from './PurgeDialog';
import { tagColor } from '../ui/tagColor';

/** Filter row for ID results (approved mock C): narrow multi-project matches, or
 * widen a bare-number search to every project. */
function FilterChips() {
  const app = useApp();
  if (app.feed.kind !== 'ids') return null;
  const { projects, scopeAll } = app.feed;
  const multi = projects.length > 1;
  if (!multi && scopeAll === false && app.activeProjects.length <= 1) return null;

  const filter = app.projectFilter;
  const toggle = (id: string) => {
    const next = new Set(filter ?? projects.map((p) => p.id));
    if (next.has(id)) next.delete(id);
    else next.add(id);
    app.setProjectFilter(next.size === projects.length ? null : next);
  };

  return (
    <div className="filter-row">
      <span className="filter-label">FILTER</span>
      {multi ? (
        <>
          <button
            type="button"
            className={`chiplet${filter === null ? ' on' : ''}`}
            onClick={() => app.setProjectFilter(null)}
          >
            All projects
          </button>
          {projects.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`chiplet${filter === null || filter.has(p.id) ? ' on' : ''}`}
              onClick={() => toggle(p.id)}
            >
              <span className="chipdot" style={{ background: tagColor(p.id) }} />
              {p.name}
            </button>
          ))}
        </>
      ) : (
        !scopeAll && (
          <button type="button" className="chiplet" onClick={app.widenScope}>
            Search all projects
          </button>
        )
      )}
    </div>
  );
}

export function Feed() {
  const app = useApp();
  const [editing, setEditing] = useState<Insight | null>(null);
  const [purging, setPurging] = useState<{ insight: Insight; project: Project } | null>(null);

  if (!app.activeProject) {
    return (
      <div className="feed-empty">
        <p>No project yet.</p>
        <p className="muted">Create one from the projects screen to start capturing insights.</p>
      </div>
    );
  }

  const feed = app.feed;
  let items: Array<{ insight: Insight; project: Project }>;
  let showProjectTag = false;
  if (feed.kind === 'incomplete') {
    items = [];
  } else if (feed.kind === 'ids') {
    const filter = app.projectFilter;
    items = filter === null ? feed.items : feed.items.filter((i) => filter.has(i.project.id));
    showProjectTag = feed.projects.length > 1;
  } else {
    items = feed.insights.map((insight) => ({ insight, project: app.activeProject! }));
  }

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
          {feed.kind === 'default'
            ? `${items.length} insight${items.length === 1 ? '' : 's'}, newest first`
            : feed.kind === 'ids'
              ? `${items.length} match${items.length === 1 ? '' : 'es'}${showProjectTag ? ` across ${feed.projects.length} projects` : ''}, ascending`
              : ''}
        </span>
      </div>

      <FilterChips />

      {items.length === 0 && feed.kind === 'default' && (
        <div className="feed-empty">
          <p>Nothing captured yet in {app.activeProject.name}.</p>
          <p className="muted">
            Paste a screenshot or type an insight, then write the shown reference (e.g.{' '}
            {app.activeProject.prefix}-1) in your notebook.
          </p>
        </div>
      )}

      {items.map(({ insight, project }) => (
        <InsightCard
          key={insight.id}
          insight={insight}
          project={project}
          projectTag={showProjectTag}
          onEdit={setEditing}
          onPurge={(ins) => setPurging({ insight: ins, project })}
        />
      ))}

      {editing && <EditDialog insight={editing} onClose={() => setEditing(null)} />}
      {purging && (
        <PurgeDialog
          insight={purging.insight}
          project={purging.project}
          onClose={() => setPurging(null)}
        />
      )}
    </>
  );
}
