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
