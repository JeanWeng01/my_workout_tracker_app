import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time check of `Authorization: Bearer <token>` (both sides hashed, so lengths never leak). */
export function bearerMatches(header: string | undefined, token: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? '');
  const given = m ? m[1] : '';
  const a = digest(given);
  const b = digest(token);
  return timingSafeEqual(a, b) && given.length > 0;
}

/** Counts failed token attempts per caller; after `max` failures in `windowMs` the caller is turned away. */
export class FailureLimiter {
  private hits = new Map<string, { n: number; resetAt: number }>();
  constructor(private max: number, private windowMs: number) {}

  blocked(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h) return false;
    if (now > h.resetAt) {
      this.hits.delete(key);
      return false;
    }
    return h.n >= this.max;
  }

  fail(key: string, now = Date.now()): void {
    const h = this.hits.get(key);
    if (!h || now > h.resetAt) this.hits.set(key, { n: 1, resetAt: now + this.windowMs });
    else h.n += 1;
    if (this.hits.size > 10_000) this.hits.clear(); // never grow without bound
  }
}
