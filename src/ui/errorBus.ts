/**
 * Invariant 3: no silent write failures. Every QuotaExceededError, transaction abort,
 * or persistence failure is pushed here and rendered as a visible, blocking error —
 * the user must never transcribe a number for an insight that wasn't saved.
 */
export interface AppError {
  title: string;
  detail: string;
  blocking: boolean;
}

type Listener = (error: AppError) => void;

const listeners = new Set<Listener>();
let lastError: AppError | null = null;

export function onAppError(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportAppError(error: AppError): void {
  lastError = error;
  for (const listener of listeners) listener(error);
}

export function getLastError(): AppError | null {
  return lastError;
}

export function clearLastErrorForTest(): void {
  lastError = null;
}

function describeWriteError(err: unknown): AppError {
  const e = err as { name?: string; message?: string };
  if (e?.name === 'QuotaExceededError') {
    return {
      title: 'Storage is full — NOT saved',
      detail:
        'The browser refused the write because storage is full. Do NOT write this ' +
        'reference number in your notebook. Export a backup, free space, then retry.',
      blocking: true,
    };
  }
  if (e?.name === 'AbortError' || e?.name === 'TransactionInactiveError') {
    return {
      title: 'Save failed — NOT saved',
      detail:
        'The database transaction was aborted before completing. Nothing was written ' +
        'and no reference number was assigned. Retry the capture.',
      blocking: true,
    };
  }
  return {
    title: 'Save failed — NOT saved',
    detail: `The write did not complete: ${e?.message ?? String(err)}. No reference number was assigned.`,
    blocking: true,
  };
}

/** Wrap any write path: failures surface visibly AND still reject for the caller. */
export async function guardWrite<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    reportAppError(describeWriteError(err));
    throw err;
  }
}
