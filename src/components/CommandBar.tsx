import { forwardRef } from 'react';
import { useApp } from '../state/app';
import { describeRefList } from '../search/parser';

export const CommandBar = forwardRef<HTMLInputElement>(function CommandBar(_props, ref) {
  const app = useApp();

  return (
    <div className="command-bar">
      <input
        ref={ref}
        type="search"
        placeholder={`Search ${app.activeProject ? `“${app.activeProject.name}”` : ''} — try 42, 1-7, ${app.activeProject?.prefix ?? 'Q3'}-42, or any text  (/)`}
        value={app.query}
        onChange={(e) => app.setQuery(e.target.value)}
        aria-label="Command bar: reference IDs, ranges, prefixed IDs, or text search"
      />
      <ResultNotes />
    </div>
  );
});

function ResultNotes() {
  const { feed } = useApp();
  if (feed.kind === 'incomplete') {
    return <div className="result-note">Finish typing the range to search (e.g. 1-7).</div>;
  }
  if (feed.kind === 'text') {
    return (
      <div className="result-note">
        {feed.insights.length === 0
          ? `No matches for “${feed.query}”.`
          : `${feed.insights.length} match${feed.insights.length === 1 ? '' : 'es'} for “${feed.query}”.`}
      </div>
    );
  }
  if (feed.kind !== 'ids') return null;

  // Notes per queried project (prefixes are reusable, so a query may span several).
  // When exactly one project was queried, the project name is left out — unchanged
  // single-project behaviour. A blank screen is never allowed (PRD §3.B).
  const multi = feed.projects.length > 1;
  const notes: React.ReactNode[] = [];
  for (const project of feed.projects) {
    const result = feed.byProject.get(project.id);
    if (!result) continue;
    const who = multi ? `${project.name}: ` : '';
    if (result.purgedRefs.length > 0) {
      notes.push(
        <div className="result-note strong" key={`p-${project.id}`}>
          {who}
          {result.purgedRefs.map((r) => `insight #${r} was permanently deleted`).join(' · ')} — the
          number stays retired.
        </div>,
      );
    }
    if (result.deletedRefs.length > 0) {
      notes.push(
        <div className="result-note" key={`d-${project.id}`}>
          {who}#{describeRefList(result.deletedRefs)} not found (deleted — toggle “Show deleted” to
          restore).
        </div>,
      );
    }
    if (result.missingRefs.length > 0) {
      notes.push(
        <div className="result-note" key={`m-${project.id}`}>
          {who}#{describeRefList(result.missingRefs)} not found.
        </div>,
      );
    }
    if (result.clamped) {
      notes.push(
        <div className="result-note" key={`c-${project.id}`}>
          {who}IDs {result.clamped.from}–{result.clamped.to} not found ({project.prefix} currently
          ends at {project.current_seq}).
        </div>,
      );
    }
  }
  if (feed.items.length === 0 && notes.length === 0) {
    notes.push(
      <div className="result-note" key="none">
        Nothing matched that ID query.
      </div>,
    );
  }
  return <>{notes}</>;
}
