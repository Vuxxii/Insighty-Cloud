import 'fake-indexeddb/auto';

let counter = 0;

/** Fresh, isolated database name per call so tests never share state. */
export function freshDbName(): string {
  counter += 1;
  return `insightyyy-test-${Date.now()}-${counter}`;
}
