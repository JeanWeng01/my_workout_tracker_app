import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Decision, Session, Settings } from '../engine';
import { db } from './db';

// ---------- device-local sync state (never part of a backup) ----------

const TOKEN_KEY = 'bulletproof.syncToken';
const CURSOR_KEY = 'bulletproof.syncCursor';
const LAST_OK_KEY = 'bulletproof.lastSyncedAt';

const read = (k: string): string => {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};
const write = (k: string, v: string) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    // Private mode etc.: the value just won't persist.
  }
};

export const getSyncToken = () => read(TOKEN_KEY);

/** Small non-cryptographic fingerprint, so a changed token starts from a full pull. */
function fingerprint(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function setSyncToken(t: string): void {
  const prev = getSyncToken();
  write(TOKEN_KEY, t);
  if (t !== prev) write(CURSOR_KEY, ''); // a different token means a different server store: pull everything
}

function getCursor(): string | null {
  try {
    const c = JSON.parse(read(CURSOR_KEY) || 'null') as { since: string; fp: string } | null;
    return c && c.fp === fingerprint(getSyncToken()) ? c.since : null;
  } catch {
    return null;
  }
}
const setCursor = (since: string) => write(CURSOR_KEY, JSON.stringify({ since, fp: fingerprint(getSyncToken()) }));

// ---------- status ----------

export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'syncing' }
  | { kind: 'no-token' }
  | { kind: 'offline' }
  | { kind: 'unauthorized' }
  | { kind: 'error'; detail: string }
  | { kind: 'ok' };

let status: SyncStatus = getSyncToken() ? { kind: 'idle' } : { kind: 'no-token' };
const listeners = new Set<() => void>();
function setStatus(s: SyncStatus) {
  status = s;
  listeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
  );
}

export const lastSyncedAt = (): number | null => {
  const v = Number(read(LAST_OK_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
};

export function relativeTime(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function describeStatus(s: SyncStatus, lastOk: number | null, now: number): string {
  switch (s.kind) {
    case 'syncing': return 'Syncing…';
    case 'no-token': return 'Sync token missing';
    case 'offline': return 'Not synced: offline';
    case 'unauthorized': return 'Not synced: sync token rejected';
    case 'error': return `Not synced: ${s.detail}`;
    case 'ok': return lastOk ? `Synced ${relativeTime(lastOk, now)}` : 'Synced';
    case 'idle': return lastOk ? `Synced ${relativeTime(lastOk, now)}` : 'Not synced yet';
  }
}

/** Status text that refreshes itself. */
export function useSyncLine(): string {
  const s = useSyncStatus();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return describeStatus(s, lastSyncedAt(), s.kind === 'ok' ? Math.max(now, Date.now() - 1) : now);
}

// ---------- the sync itself ----------

type Rec = { id: string; updatedAt: string; dirty?: 0 | 1 };
type Kind = 'sessions' | 'decisions';

interface PullBody {
  serverTime: string;
  settings: Settings[];
  sessions: Session[];
  decisions: Decision[];
}

class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${getSyncToken()}`, 'content-type': 'application/json' },
  });
  if (!res.ok) throw new HttpError(res.status);
  return (await res.json()) as T;
}

const strip = <T extends Rec>({ dirty: _dirty, ...rest }: T) => rest;

/** Overlap so a record committed just before the cursor is still fetched; merging is idempotent. */
const OVERLAP_MS = 60_000;

async function push(): Promise<void> {
  const sessions = (await db.sessions.where('dirty').equals(1).toArray()).filter((s) => s.finishedAt !== null || s.abandonedAt || s.deleted);
  const decisions = await db.decisions.where('dirty').equals(1).toArray();
  const settingsRow = await db.settings.get('settings');
  const settings = settingsRow && settingsRow.dirty === 1 ? settingsRow : null;
  if (!sessions.length && !decisions.length && !settings) return;

  await api('/api/sync', {
    method: 'POST',
    body: JSON.stringify({
      settings: settings ? strip(settings) : null,
      sessions: sessions.map(strip),
      decisions: decisions.map(strip),
    }),
  });

  // Clear the flag only if the record wasn't edited again while the request was in flight.
  await db.transaction('rw', db.sessions, db.decisions, db.settings, async () => {
    for (const s of sessions) {
      const cur = await db.sessions.get(s.id);
      if (cur && cur.updatedAt === s.updatedAt) await db.sessions.put({ ...cur, dirty: 0 });
    }
    for (const d of decisions) {
      const cur = await db.decisions.get(d.id);
      if (cur && cur.updatedAt === d.updatedAt) await db.decisions.put({ ...cur, dirty: 0 });
    }
    if (settings) {
      const cur = await db.settings.get('settings');
      if (cur && cur.updatedAt === settings.updatedAt) await db.settings.put({ ...cur, dirty: 0 });
    }
  });
}

/** Last write wins per record: take the remote one only if it is strictly newer than ours. */
async function mergeKind<T extends Rec>(kind: Kind | 'settings', incoming: T[]): Promise<void> {
  if (!incoming.length) return;
  const table = db[kind] as unknown as { get(id: string): Promise<(T & Rec) | undefined>; put(v: T & Rec): Promise<unknown> };
  for (const remote of incoming) {
    const local = await table.get(remote.id);
    if (local && local.updatedAt >= remote.updatedAt) continue;
    await table.put({ ...remote, dirty: 0 });
  }
}

async function pull(): Promise<void> {
  const cursor = getCursor();
  const since = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : '';
  const body = await api<PullBody>(`/api/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  await db.transaction('rw', db.sessions, db.decisions, db.settings, async () => {
    await mergeKind('settings', body.settings);
    await mergeKind('sessions', body.sessions);
    await mergeKind('decisions', body.decisions);
  });
  setCursor(body.serverTime);
}

let running: Promise<void> | null = null;
let again = false;

/**
 * Push dirty records, then pull what changed. A first sync with this token pulls first, so a
 * fresh phone restores the real data instead of pushing blank defaults over it.
 */
export function syncNow(): Promise<void> {
  if (!getSyncToken()) {
    setStatus({ kind: 'no-token' });
    return Promise.resolve();
  }
  if (running) {
    again = true; // something changed mid-sync: go once more afterwards
    return running;
  }
  setStatus({ kind: 'syncing' });
  running = (async () => {
    try {
      if (getCursor() === null) {
        await pull();
        await push();
      } else {
        await push();
        await pull();
      }
      write(LAST_OK_KEY, String(Date.now()));
      setStatus({ kind: 'ok' });
    } catch (e) {
      if (e instanceof HttpError) {
        setStatus(e.status === 401 ? { kind: 'unauthorized' } : { kind: 'error', detail: `server error ${e.status}` });
      } else {
        setStatus({ kind: 'offline' }); // fetch rejected: no network, or the server is unreachable
      }
    } finally {
      running = null;
      if (again) {
        again = false;
        void syncNow();
      }
    }
  })();
  return running;
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Called after every local change worth backing up. Debounced so a burst becomes one sync. */
export function scheduleSync(delayMs = 1500): void {
  if (!getSyncToken()) return;
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delayMs);
}

/** Sync on app open, when the network returns, and when the app comes back to the foreground. */
export function startAutoSync(): () => void {
  void syncNow();
  const onOnline = () => void syncNow();
  const onVisible = () => document.visibilityState === 'visible' && void syncNow();
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
