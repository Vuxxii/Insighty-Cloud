import { useEffect, useState } from 'react';
import { useApp } from '../state/app';

/** The prefixed ref display after capture — what the user transcribes into the
 * notebook. Large and unambiguous (PRD §3.A), legible at arm's length (§3.A.2). */
export function SuccessRef() {
  const { lastCapture } = useApp();
  const [, forceTick] = useState(0);

  // Re-render once the Quick Edit window lapses so the hint disappears on time.
  useEffect(() => {
    if (!lastCapture) return;
    const t = setInterval(() => forceTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [lastCapture]);

  if (!lastCapture) return null;
  const quickEditOpen = Date.now() < lastCapture.until;

  return (
    <div className="success-ref" aria-live="polite">
      <div className="hint">Saved — write this in your notebook:</div>
      <div className="ref">{lastCapture.prefixedRef}</div>
      {quickEditOpen && (
        <div className="hint">
          Quick Edit is available on this item for 5 minutes (or until your next capture).
        </div>
      )}
    </div>
  );
}
