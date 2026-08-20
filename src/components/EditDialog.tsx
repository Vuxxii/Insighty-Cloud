import { useState } from 'react';
import type { Block, Direction, Insight } from '../db/types';
import { useApp } from '../state/app';
import { processImage, UnsupportedImageError } from '../images/pipeline';
import { reportAppError } from '../ui/errorBus';

/** Standard item edit flow — also serves Quick Edit (same semantics, PRD §3.A):
 * updates updated_at, never changes ref_id. */
export function EditDialog({ insight, onClose }: { insight: Insight; onClose: () => void }) {
  const app = useApp();
  const [blocks, setBlocks] = useState<Block[]>(insight.content);
  const [source, setSource] = useState(insight.source_tag);
  const [direction, setDirection] = useState<Direction>(insight.direction);
  const [busy, setBusy] = useState(false);

  const setBlock = (i: number, b: Block) =>
    setBlocks((prev) => prev.map((x, j) => (j === i ? b : x)));

  const replaceImage = async (i: number, file: File) => {
    try {
      const processed = await processImage(file);
      const prev = blocks[i];
      setBlock(i, {
        type: 'image',
        ...processed,
        alt: prev.type === 'image' ? prev.alt : undefined,
      });
    } catch (err) {
      reportAppError({
        title: 'Image not replaced',
        detail: err instanceof UnsupportedImageError ? err.message : String(err),
        blocking: false,
      });
    }
  };

  async function save() {
    setBusy(true);
    try {
      await app.saveEdit(insight.id, { content: blocks, source_tag: source, direction });
      onClose();
    } catch {
      // error already surfaced
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="error-overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        <h2>Edit insight (ref stays {insight.ref_id})</h2>

        <label>Source tag</label>
        <input type="text" value={source} onChange={(e) => setSource(e.target.value)} />

        <label>Direction</label>
        <div className="dir-toggle">
          {(['auto', 'ltr', 'rtl'] as const).map((d) => (
            <button
              type="button"
              key={d}
              className={direction === d ? 'on' : ''}
              onClick={() => setDirection(d)}
            >
              {d.toUpperCase()}
            </button>
          ))}
        </div>

        {blocks.map((block, i) => {
          switch (block.type) {
            case 'text':
              return (
                <div key={i}>
                  <label>Text</label>
                  <textarea
                    dir={direction}
                    style={{
                      width: '100%',
                      minHeight: 90,
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 9,
                    }}
                    value={block.value}
                    onChange={(e) => setBlock(i, { ...block, value: e.target.value })}
                  />
                </div>
              );
            case 'url':
              return (
                <div key={i}>
                  <label>Link</label>
                  <input
                    type="text"
                    value={block.href}
                    onChange={(e) => setBlock(i, { ...block, href: e.target.value })}
                  />
                  <label>Link title (typed by you — never fetched)</label>
                  <input
                    type="text"
                    value={block.title ?? ''}
                    onChange={(e) => setBlock(i, { ...block, title: e.target.value })}
                  />
                </div>
              );
            case 'image':
              return (
                <div key={i}>
                  <label>
                    Image ({block.mime}, {block.width}×{block.height})
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void replaceImage(i, f);
                        e.target.value = '';
                      }}
                    />
                  </div>
                  <label>Alt text (searchable)</label>
                  <input
                    type="text"
                    value={block.alt ?? ''}
                    onChange={(e) => setBlock(i, { ...block, alt: e.target.value })}
                  />
                </div>
              );
            default:
              return (
                <div key={i} className="unknown-block">
                  Unsupported block type — preserved as-is.
                </div>
              );
          }
        })}

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
