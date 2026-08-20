import { useEffect, useState } from 'react';
import { onAppError, type AppError } from '../ui/errorBus';
import { useApp } from '../state/app';
import { atRiskMessage, isIOSSafari, isStandalone } from '../storage/durability';

/** Blocking write-failure dialog + non-blocking error banner (invariant 3). */
export function ErrorSurface() {
  const [blocking, setBlocking] = useState<AppError | null>(null);
  const [toast, setToast] = useState<AppError | null>(null);

  useEffect(
    () =>
      onAppError((error) => {
        if (error.blocking) setBlocking(error);
        else setToast(error);
      }),
    [],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      {toast && (
        <div className="banner warn" role="alert">
          <strong>{toast.title}.</strong> {toast.detail}
          <button type="button" className="btn btn-ghost" onClick={() => setToast(null)}>
            Dismiss
          </button>
        </div>
      )}
      {blocking && (
        <div className="error-overlay" role="alertdialog" aria-modal="true">
          <div className="dialog error-dialog">
            <h2>{blocking.title}</h2>
            <p>{blocking.detail}</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={() => setBlocking(null)}>
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Backup-staleness reminder (PRD §2.2/§2.4), quota warning, iOS install push. */
export function Banners() {
  const app = useApp();
  const [dismissedBackup, setDismissedBackup] = useState(false);
  const [dismissedInstall, setDismissedInstall] = useState(false);

  const showInstall =
    isIOSSafari() && !isStandalone() && !dismissedInstall && app.persistState !== 'protected';

  return (
    <>
      {app.quota?.warn && (
        <div className="banner warn">
          Storage is {Math.round(app.quota.ratio * 100)}% full
          {app.quota.block ? ' — new captures are blocked until space is freed.' : ' — consider exporting and pruning.'}
        </div>
      )}
      {showInstall && (
        <div className="banner warn">
          {atRiskMessage()}
          <button type="button" className="btn btn-ghost" onClick={() => setDismissedInstall(true)}>
            Later
          </button>
        </div>
      )}
      {app.backupStale && !dismissedBackup && (
        <div className="banner warn">
          Your newest insights are more than 7 days newer than your last export — back up now.
          <button type="button" className="btn" onClick={() => void app.exportActiveProject()}>
            Export now
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setDismissedBackup(true)}>
            Later
          </button>
        </div>
      )}
    </>
  );
}

/** Documented shortcut set, surfaced via `?` (PRD §5.1). */
export function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="error-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <table className="shortcut-table">
          <tbody>
            <tr>
              <td>
                <kbd>/</kbd>
              </td>
              <td>Focus the Command Bar</td>
            </tr>
            <tr>
              <td>
                <kbd>Esc</kbd>
              </td>
              <td>Clear the Command Bar, back to the Capture Zone</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
              </td>
              <td>Submit the capture</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl</kbd>+<kbd>E</kbd>
              </td>
              <td>Export the active project</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl</kbd>+<kbd>P</kbd>
              </td>
              <td>PDF view (browser print)</td>
            </tr>
            <tr>
              <td>
                <kbd>?</kbd>
              </td>
              <td>This overlay</td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          Pasting an image anywhere always lands in the Capture Zone, regardless of focus.
        </p>
        <p className="muted">
          In the Capture Zone, a line starting with <kbd>//</kbd> becomes a link block:{' '}
          <kbd>// url optional title</kbd> — no mouse needed.
        </p>
        <p className="muted">
          <kbd>@word</kbd> anywhere in a capture sets the source and pins it for future captures.
          Unpin with the 📌 toggle or by clearing the source field.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
