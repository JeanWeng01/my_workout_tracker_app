import { estimate1RM } from './rounding';
import { deriveState, finishedSessions } from './state';
import type { Decision, Session, Settings } from './types';

export const CSV_COLUMNS = [
  'date', 'session_id', 'session_label', 'program_phase', 'lift', 'scheme',
  'set_number', 'set_type', 'target_weight_lb', 'target_reps',
  'actual_weight_lb', 'actual_reps', 'completed', 'is_amrap',
  'training_max_lb', 'cycle', 'wave_week', 'e1rm_lb', 'notes',
] as const;

/** RFC 4180: quote fields containing a comma, quote or line break; double inner quotes. */
export function csvField(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvFilename(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `bulletproof_export_${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.csv`;
}

/**
 * One row per set, finished sessions only, UTF-8 with BOM, CRLF line ends.
 * Warm-ups appear only if they were tapped. The training max is the one in force before the session.
 */
export function buildCsv(settings: Settings, sessions: Session[], decisions: Decision[]): string {
  const ordered = finishedSessions(sessions);
  const lines: string[] = [CSV_COLUMNS.join(',')];

  ordered.forEach((s, idx) => {
    const before = deriveState(settings, ordered.slice(0, idx), decisions);
    let noteWritten = false;
    for (const l of s.lifts) {
      if (l.skipped) continue;
      const is531 = s.phase === '531' && l.lift !== 'row';
      const ws = is531 ? before.wave[l.lift as 'squat' | 'bench' | 'deadlift' | 'ohp'] : null;
      const seventh = l.scheme.startsWith('7th_');
      const cycle = ws && !seventh ? Math.floor((ws.step % 7) / 3) + 1 : '';
      const waveWeek = ws && !seventh ? (l.waveWeek ?? '') : '';
      let n = 0;
      for (const set of l.sets) {
        if (set.type === 'warmup' && !set.done) continue;
        n += 1;
        // The workout's note goes on the first row of the session only, so it isn't repeated on every set.
        const note = s.notes && !noteWritten ? s.notes : '';
        const e1 = set.done && set.type !== 'warmup' && set.type !== 'supplemental' ? estimate1RM(set.weight, set.reps) : 0;
        if (note) noteWritten = true;
        lines.push(
          [
            s.date, s.id, s.label, s.phase, l.lift, l.scheme,
            n, set.type, set.targetWeight, set.targetReps,
            set.done ? set.weight : '', set.done ? set.reps : '',
            set.done && set.reps >= set.targetReps ? 'TRUE' : 'FALSE',
            set.type === 'amrap' ? 'TRUE' : 'FALSE',
            ws ? ws.tm : '', cycle, waveWeek, e1 ? Math.round(e1 * 10) / 10 : '', note,
          ].map(csvField).join(','),
        );
      }
    }
  });
  return String.fromCharCode(0xfeff) + lines.join('\r\n') + '\r\n';
}
