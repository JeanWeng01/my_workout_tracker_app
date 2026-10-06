import Dexie, { type Table } from 'dexie';
import type { Decision, Session, Settings } from '../engine';

/** `dirty` marks records changed locally and waiting for sync (phase 6). Drafts never sync. */
type Stored<T> = T & { dirty?: 0 | 1 };

class BulletproofDB extends Dexie {
  settings!: Table<Stored<Settings>, string>;
  sessions!: Table<Stored<Session>, string>;
  decisions!: Table<Stored<Decision>, string>;

  constructor() {
    super('bulletproof');
    this.version(1).stores({
      settings: 'id',
      sessions: 'id, finishedAt, date, dirty',
      decisions: 'id, createdAt, afterSessionId, dirty',
    });
  }
}

export const db = new BulletproofDB();

/** Ask the browser not to evict our data. Safe to call repeatedly. */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Not fatal: the data still lives in IndexedDB.
  }
}
