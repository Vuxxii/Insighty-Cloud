import { useEffect, useState } from 'react';
import { useApp } from '../state/app';
import { verifyLibrary, type VerifyReport } from '../verify/verifyLibrary';
import { describeRefList } from '../search/parser';

function formatBytes(n: number): string {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

/** On-demand, read-only integrity check (PRD §3.F). Never repairs silently. */
export function VerifyDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!app.activeProject) return;
    verifyLibrary(app.activeProject.id, undefined, undefined, (done, total) =>
      setProgress([done, total]),
    )
      .then(setReport)
      .catch((err) => setError(String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clean = report && report.missingRefs.length === 0 && report.undecodableImages.length === 0;

  return (
    <div className="error-overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        <h2>Verify Library — {app.activeProject?.name}</h2>

        {!report && !error && (
          <p className="muted">
            Checking {progress[0]}/{progress[1]} insights…
          </p>
        )}
        {error && <div className="warning-box">{error}</div>}

        {report && (
          <div className="verify-report">
            {clean ? (
              <p className="ok-line">
                ✓ Clean bill: every reference from 1 to {report.currentSeq} is present or explicitly
                tombstoned, and all {report.totals.images} image
                {report.totals.images === 1 ? '' : 's'} decode.
              </p>
            ) : (
              <>
                {report.missingRefs.length > 0 && (
                  <p className="issue">
                    ⚠ MISSING references: #{describeRefList(report.missingRefs)} — these numbers
                    were assigned but no insight (or tombstone) exists. If any of them are written
                    in a notebook, that content is lost. Restore from your most recent export.
                  </p>
                )}
                {report.undecodableImages.map((img) => (
                  <p className="issue" key={`${img.ref_id}-${img.blockIndex}`}>
                    ⚠ Image in {report.prefix}-{img.ref_id} (block {img.blockIndex + 1}) does not
                    decode: {img.reason}
                  </p>
                ))}
              </>
            )}
            <p className="muted">
              {report.totals.insights} rows · {report.totals.active} active ·{' '}
              {report.totals.deleted} deleted · {report.totals.purged} purged ·{' '}
              {report.totals.images} images ({formatBytes(report.totals.bytes)})
            </p>
            <p className="muted">
              Last export:{' '}
              {report.lastExportAt
                ? `${new Date(report.lastExportAt).toLocaleString()} (${report.exportAgeDays} day${report.exportAgeDays === 1 ? '' : 's'} ago)`
                : 'never — export a backup now.'}
            </p>
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
