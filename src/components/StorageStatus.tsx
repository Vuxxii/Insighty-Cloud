import { useApp } from '../state/app';
import { atRiskMessage } from '../storage/durability';

/** Protected / At-risk indicator, always visible near the brand stamp (PRD §2.2, §5). */
export function StorageStatus() {
  const { persistState, quota } = useApp();
  const label =
    persistState === 'protected' ? 'Protected' : persistState === 'at-risk' ? 'At risk' : 'Storage';
  const title =
    persistState === 'protected'
      ? 'Persistent storage granted — the browser will not evict this library.'
      : persistState === 'at-risk'
        ? atRiskMessage()
        : 'Persistence state unknown in this browser.';
  const pct = quota && quota.quota > 0 ? ` · ${Math.round(quota.ratio * 100)}% used` : '';
  return (
    <span className={`storage-status ${persistState}`} title={title}>
      <span className="dot" />
      {label}
      {pct}
    </span>
  );
}
