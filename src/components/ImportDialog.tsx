import { useState } from 'react';
import { useApp } from '../state/app';
import {
  importAsNewProject,
  mergeIntoProject,
  parseImportFile,
  replaceProject,
  type ImportMode,
  type ParsedImport,
} from '../backup/importer';
import { guardWrite } from '../ui/errorBus';

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>('new-project');
  const [targetId, setTargetId] = useState<string>('');
  const [typedName, setTypedName] = useState('');
  const [mergeAck, setMergeAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function onFile(file: File) {
    setParseError(null);
    setParsed(null);
    try {
      setParsed(await parseImportFile(file));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    }
  }

  const target = app.activeProjects.find((p) => p.id === targetId);
  const canRun =
    parsed !== null &&
    !busy &&
    (mode === 'new-project' ||
      (mode === 'replace' && target && typedName.trim() === target.name) ||
      (mode === 'merge' && target && mergeAck));

  async function run() {
    if (!parsed) return;
    setBusy(true);
    try {
      if (mode === 'new-project') {
        const project = await guardWrite(() => importAsNewProject(parsed));
        app.selectProject(project.id);
        setDone(
          `Imported “${project.name}” as a new project — every reference ID and the prefix ${project.prefix} preserved exactly.`,
        );
      } else if (mode === 'replace' && target) {
        await guardWrite(() => replaceProject(parsed, target.id));
        setDone(`Replaced the contents of “${target.name}”.`);
      } else if (mode === 'merge' && target) {
        const { renumbered } = await guardWrite(() => mergeIntoProject(parsed, target.id));
        setDone(
          `Merged ${renumbered.length} insights into “${target.name}” with NEW reference numbers ` +
            `(${renumbered[0]?.to}–${renumbered[renumbered.length - 1]?.to}).`,
        );
      }
      await app.refresh();
    } catch {
      // errors already surfaced by guardWrite
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="error-overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        <h2>Import project</h2>

        {done ? (
          <>
            <p>{done}</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <label>Export file (.json or .zip)</label>
            <input
              type="file"
              accept=".json,.zip,application/json,application/zip"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            {parseError && <div className="warning-box">{parseError}</div>}

            {parsed && (
              <>
                <p className="muted">
                  “{parsed.file.project.name}” · prefix {parsed.file.project.prefix} ·{' '}
                  {parsed.insights.length} insights · exported {parsed.file.exported_at}
                  {parsed.file.images ? ' · zip checksums verified ✓' : ''}
                </p>

                <label>Import mode</label>
                <div style={{ display: 'grid', gap: 8 }}>
                  <label style={{ margin: 0, color: 'inherit' }}>
                    <input
                      type="radio"
                      checked={mode === 'new-project'}
                      onChange={() => setMode('new-project')}
                    />{' '}
                    <strong>Import as new project</strong> (recommended — the device-hop path).
                    Preserves every reference ID and the prefix exactly; notebook pointers keep
                    resolving.
                  </label>
                  <label style={{ margin: 0, color: 'inherit' }}>
                    <input
                      type="radio"
                      checked={mode === 'replace'}
                      onChange={() => setMode('replace')}
                    />{' '}
                    <strong>Replace an existing project</strong> (destructive). Overwrites the
                    target's contents with this file's.
                  </label>
                  <label style={{ margin: 0, color: 'inherit' }}>
                    <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} />{' '}
                    <strong>Merge into an existing project</strong> (renumbering — use with care).
                  </label>
                </div>

                {(mode === 'replace' || mode === 'merge') && (
                  <>
                    <label>Target project</label>
                    <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                      <option value="">Choose…</option>
                      {app.activeProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.prefix})
                        </option>
                      ))}
                    </select>
                  </>
                )}

                {mode === 'replace' && target && (
                  <>
                    <div className="warning-box">
                      This permanently overwrites everything in “{target.name}”. Type the project
                      name to confirm.
                    </div>
                    <input
                      type="text"
                      placeholder={target.name}
                      value={typedName}
                      onChange={(e) => setTypedName(e.target.value)}
                    />
                  </>
                )}

                {mode === 'merge' && (
                  <>
                    <div className="warning-box">
                      Imported insights will receive <strong>new</strong> reference numbers. Any
                      notebook entries pointing at their original numbers will{' '}
                      <strong>NO LONGER resolve</strong>. Only appropriate for deliberately
                      consolidating projects.
                    </div>
                    <label style={{ color: 'inherit' }}>
                      <input
                        type="checkbox"
                        checked={mergeAck}
                        onChange={(e) => setMergeAck(e.target.checked)}
                      />{' '}
                      I understand the original reference numbers will stop resolving.
                    </label>
                  </>
                )}
              </>
            )}

            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${mode === 'new-project' ? 'btn-primary' : 'btn-danger'}`}
                disabled={!canRun}
                onClick={() => void run()}
              >
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
