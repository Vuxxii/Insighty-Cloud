import { useEffect, useMemo, useState } from 'react';
import type { Block, Insight, Project } from '../db/types';
import { useApp, QUICK_EDIT_WINDOW_MS } from '../state/app';

function ImageView({ block }: { block: Extract<Block, { type: 'image' }> }) {
  const url = useMemo(() => URL.createObjectURL(block.blob), [block.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt={block.alt ?? ''} width={block.width} height={block.height} style={{ height: 'auto' }} />;
}

/** All user content renders via text nodes / escaped JSX bindings — never innerHTML
 * (invariant 6). Only http(s) schemes are linkified (PRD §3.E). */
function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'text':
      return <p className="text-block">{block.value}</p>;
    case 'image':
      return <ImageView block={block} />;
    case 'url': {
      const isHttp = /^https?:\/\//i.test(block.href);
      if (!isHttp) {
        return (
          <p className="text-block">
            {block.title ? `${block.title} — ` : ''}
            {block.href}
          </p>
        );
      }
      return (
        <p className="text-block">
          <a href={block.href} target="_blank" rel="noopener noreferrer">
            {block.title || block.href}
          </a>
        </p>
      );
    }
    default:
      // Unknown block types render as a visible placeholder, never dropped (invariant 7).
      return (
        <div className="unknown-block">
          Unsupported content block type “{String((block as { type?: unknown }).type)}” — created by
          a newer version of Insightyyy. The data is preserved.
        </div>
      );
  }
}

export function InsightCard({
  insight,
  project,
  onEdit,
  onPurge,
}: {
  insight: Insight;
  project: Project;
  onEdit: (insight: Insight) => void;
  onPurge: (insight: Insight) => void;
}) {
  const app = useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDeleted = insight.deleted_at !== null;
  const quickEdit =
    app.lastCapture?.insightId === insight.id &&
    Date.now() < app.lastCapture.until &&
    Date.now() - new Date(insight.timestamp).getTime() < QUICK_EDIT_WINDOW_MS;

  if (insight.purged) {
    return (
      <article className="insight-card deleted">
        <div className="card-head">
          <span className="card-ref">
            {project.prefix}-{insight.ref_id}
          </span>
          <span className="card-source">permanently deleted (number stays retired)</span>
        </div>
      </article>
    );
  }

  return (
    <article className={`insight-card${isDeleted ? ' deleted' : ''}`}>
      <div className="card-head">
        <span className="card-ref">
          {project.prefix}-{insight.ref_id}
        </span>
        {insight.source_tag && <span className="card-source">{insight.source_tag}</span>}
        <span className="card-date">
          {new Date(insight.timestamp).toLocaleDateString()}{' '}
          {new Date(insight.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {isDeleted ? ' · deleted' : ''}
        </span>
      </div>
      <div className="card-body" dir={insight.direction}>
        {insight.content.map((block, i) => (
          <BlockView key={i} block={block} />
        ))}
      </div>
      <div className="card-actions">
        {!isDeleted && (
          <button type="button" className={`btn${quickEdit ? ' btn-primary' : ' btn-ghost'}`} onClick={() => onEdit(insight)}>
            {quickEdit ? 'Quick Edit' : 'Edit'}
          </button>
        )}
        {!isDeleted && !confirmDelete && (
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
        {!isDeleted && confirmDelete && (
          <>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setConfirmDelete(false);
                void app.removeInsight(insight.id);
              }}
            >
              Confirm delete
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </>
        )}
        {isDeleted && (
          <>
            <button type="button" className="btn" onClick={() => void app.unremoveInsight(insight.id)}>
              Restore
            </button>
            <button type="button" className="btn btn-danger" onClick={() => onPurge(insight)}>
              Purge…
            </button>
          </>
        )}
      </div>
    </article>
  );
}
