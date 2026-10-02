import { useState } from 'react';
import { useApp } from '../state/app';
import { tagColor } from '../ui/tagColor';
import { ProjectDialog } from './ProjectDialog';

/** The app's front room (approved mock A): every project as a card in its color,
 * with count, next number, and the most recent capture. Click to enter. */
export function ProjectsHome() {
  const app = useApp();
  const [newOpen, setNewOpen] = useState(false);

  return (
    <div className="home">
      <div className="home-top">
        <h3>Your projects</h3>
        <span className="muted">
          {app.projectCards.length} active
          {app.archivedProjects.length > 0 ? ` · ${app.archivedProjects.length} archived` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
          ＋ New project
        </button>
      </div>

      <div className="pgrid">
        {app.projectCards.map(({ project, count, lastText, lastAt }) => (
          <button
            type="button"
            key={project.id}
            className="pcard"
            onClick={() => app.openProject(project.id)}
          >
            <span className="ribbon" style={{ background: tagColor(project.id) }} />
            <h4>{project.name}</h4>
            <div className="pmeta">
              {project.prefix} · {count} insight{count === 1 ? '' : 's'}
            </div>
            <div className="pnext">
              {project.current_seq + 1}
              <small>NEXT №</small>
            </div>
            {lastText && (
              <div className="plast" title={lastText}>
                ⏱ {lastAt ? new Date(lastAt).toLocaleDateString() : ''} — {lastText}
              </div>
            )}
          </button>
        ))}
        <button type="button" className="pcard newp" onClick={() => setNewOpen(true)}>
          <span className="plus">＋</span>
          <span>New project</span>
        </button>
      </div>

      {app.archivedProjects.length > 0 && (
        <div className="archived-row">
          Archived ({app.archivedProjects.length}):{' '}
          {app.archivedProjects.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ' · '}
              <button type="button" className="linklike" onClick={() => app.openProject(p.id)}>
                {p.name}
              </button>
            </span>
          ))}{' '}
          — still searchable
        </div>
      )}

      {newOpen && <ProjectDialog existing={null} onClose={() => setNewOpen(false)} />}
    </div>
  );
}
