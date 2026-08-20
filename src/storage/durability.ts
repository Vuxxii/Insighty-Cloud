import { updateMeta } from '../db/db';

export type PersistState = 'protected' | 'at-risk' | 'unknown';

export interface QuotaStatus {
  usage: number;
  quota: number;
  ratio: number;
  /** 80%+ of quota: warn (PRD §2.2). */
  warn: boolean;
  /** 95%+ of quota: block new captures with an explicit error (PRD §2.2). */
  block: boolean;
}

export function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIOS;
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** Requested on first project creation (PRD §2.2); result surfaced in the UI. */
export async function requestPersistence(): Promise<PersistState> {
  try {
    if (!navigator.storage?.persist) return 'unknown';
    const granted = await navigator.storage.persist();
    await updateMeta({ storage_persisted: granted });
    return granted ? 'protected' : 'at-risk';
  } catch {
    return 'unknown';
  }
}

export async function checkPersistence(): Promise<PersistState> {
  try {
    if (!navigator.storage?.persisted) return 'unknown';
    return (await navigator.storage.persisted()) ? 'protected' : 'at-risk';
  } catch {
    return 'unknown';
  }
}

export async function checkQuota(): Promise<QuotaStatus | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const ratio = quota > 0 ? usage / quota : 0;
    return { usage, quota, ratio, warn: ratio >= 0.8, block: ratio >= 0.95 };
  } catch {
    return null;
  }
}

/** Safari/iOS At-risk copy is a durability feature, not UX polish (PRD §2.2). */
export function atRiskMessage(): string {
  if (isIOSSafari() && !isStandalone()) {
    return (
      'On iPhone/iPad, add Insightyyy to your Home Screen — Safari can delete this ' +
      'library after 7 days of disuse otherwise.'
    );
  }
  return (
    'The browser has not granted persistent storage. Your library could be evicted ' +
    'under storage pressure — export a backup and keep using the app to earn persistence.'
  );
}
