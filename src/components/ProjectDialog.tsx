import { useState } from 'react';
import type { Project } from '../db/types';
import { suggestPrefix, validatePrefix } from '../db/projects';
import { useApp } from '../state/app';

export function ProjectDialog({
  existing,
  onClose,
}: {
  existing: Project | null;
  onClose: () => void;
}) {
  const app = useApp();
  const [name, setName] = useState(existing?.name ?? '');
  const [prefix, setPrefix] = useState(existing?.prefix ?? '');
  const [prefixTouched, setPrefixTouched] = useState(existing !== null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectivePrefix = prefixTouched ? prefix : suggestPrefix(name);
  const prefixChanged = existing !== null && effectivePrefix !== existing.prefix;

  async function save() {
    const invalid = validatePrefix(effectivePrefix);
    if (!name.trim()) {
      setError('Project name is required.');
      return;
    }
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        await app.updateProject(existing.id, { name, prefix: effectivePrefix });
      } else {
        await app.addProject(name, effectivePrefix);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="error-overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        <h2>{existing ? 'Project settings' : 'New project'}</h2>

        <label>Name</label>
        <input
          type="text"
          value={name}
          autoFocus={!app.isMobile}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Quarter Three Research"
        />

        <label>Reference prefix (1–6 letters/digits — you will handwrite this)</label>
        <input
          type="text"
          value={effectivePrefix}
          maxLength={6}
          onChange={(e) => {
            setPrefixTouched(true);
            setPrefix(e.target.value.toUpperCase());
          }}
          placeholder="Q3"
        />
        <p className="muted">
          Reference IDs shown as {effectivePrefix || '…'}-1, {effectivePrefix || '…'}-2, … — the
          prefix is what disambiguates notebooks across projects.
        </p>

        {prefixChanged && (
          <div className="warning-box">
            Changing the prefix from <strong>{existing?.prefix}</strong> to{' '}
            <strong>{effectivePrefix}</strong> means references already handwritten as{' '}
            {existing?.prefix}-… will no longer match a known project prefix. Numbers themselves are
            unchanged. Only proceed if you have not transcribed {existing?.prefix}-… anywhere.
          </div>
        )}

        {error && <div className="warning-box">{error}</div>}

        <div className="dialog-actions">
          {existing && existing.archived_at === null && (
            <button
              type="button"
              className="btn"
              onClick={() => void app.archiveProject(existing.id, true).then(onClose)}
              title="Hide from the dropdown. Prefixed queries still resolve."
            >
              Archive
            </button>
          )}
          {existing && existing.archived_at !== null && (
            <button
              type="button"
              className="btn"
              onClick={() => void app.archiveProject(existing.id, false).then(onClose)}
            >
              Un-archive
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {existing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
