import { describe, expect, it } from 'vitest';
import { makeBackup, validateBackup } from './backup';
import { finishedOnDate, localeWeekStart, monthGrid } from './calendar';
import { buildCsv, csvField } from './csv';
import { linearLift, ok, skipped, Timeline, waveLift } from './testkit';

const BOM = '﻿';
const rowsOf = (csv: string) => csv.slice(1).split('\r\n').filter(Boolean);

describe('CSV export', () => {
  it('quotes per RFC 4180', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(5)).toBe('5');
    expect(csvField(null)).toBe('');
  });

  it('has a BOM, the header, CRLF, one row per set, finished sessions only', () => {
    const t = new Timeline();
    t.log([linearLift('squat', 65, [5, 5, 5, 4, -1]), skipped('bench')]);
    const draft = t.log([linearLift('squat', 70, ok())]);
    draft.finishedAt = null;
    const csv = buildCsv(t.settings, t.sessions, t.decisions);
    expect(csv.startsWith(BOM + 'date,session_id,session_label,program_phase,lift,scheme,')).toBe(true);
    const rows = rowsOf(csv);
    expect(rows).toHaveLength(1 + 5); // header + 5 squat sets; bench skipped; draft excluded
    const cols = rows[4].split(',');
    expect(cols[6]).toBe('4'); // set_number
    expect(cols[7]).toBe('work');
    expect(cols[11]).toBe('4'); // actual reps
    expect(cols[12]).toBe('FALSE'); // completed
    const untouched = rows[5].split(',');
    expect(untouched[10]).toBe('');
    expect(untouched[11]).toBe('');
  });

  it('includes warm-ups only if tapped', () => {
    const t = new Timeline();
    const lift = linearLift('squat', 100, ok());
    lift.sets.unshift({ type: 'warmup', targetWeight: 45, targetReps: 5, weight: 45, reps: 5, done: true });
    lift.sets.unshift({ type: 'warmup', targetWeight: 70, targetReps: 3, weight: 70, reps: 0, done: false });
    t.log([lift]);
    const rows = rowsOf(buildCsv(t.settings, t.sessions, t.decisions));
    expect(rows).toHaveLength(1 + 1 + 5);
    expect(rows[1].split(',')[7]).toBe('warmup');
  });

  it('5/3/1 rows carry TM, cycle, wave week, AMRAP flag and e1RM', () => {
    const t = new Timeline();
    t.log([linearLift('squat', 65, ok())]);
    t.decide({ kind: 'phase_switch', to: '531', auto: false, tms: { squat: 100, bench: 100, deadlift: 100, ohp: 100 } });
    t.log([waveLift('squat', 1, 85, 7)], '531');
    const amrap = rowsOf(buildCsv(t.settings, t.sessions, t.decisions)).map((r) => r.split(',')).find((c) => c[7] === 'amrap')!;
    expect(amrap[3]).toBe('531');
    expect(amrap[13]).toBe('TRUE');
    expect(amrap[14]).toBe('100'); // training max
    expect(amrap[15]).toBe('1'); // cycle
    expect(amrap[16]).toBe('1'); // wave week
    expect(amrap[17]).toBe(String(Math.round(85 * (1 + 7 / 30) * 10) / 10));
  });
});

describe('backup validation', () => {
  const t = new Timeline();
  t.log([linearLift('squat', 65, ok())]);
  const good = () => JSON.parse(JSON.stringify(makeBackup(t.settings, t.sessions, t.decisions)));

  it('accepts a real backup after a JSON round trip', () => {
    expect(validateBackup(good()).ok).toBe(true);
  });

  it('leaves drafts out of a backup', () => {
    const t2 = new Timeline();
    t2.log([linearLift('squat', 65, ok())]).finishedAt = null;
    expect(makeBackup(t2.settings, t2.sessions, []).sessions).toHaveLength(0);
  });

  it('keeps unfinished (yellow) sessions', () => {
    const t2 = new Timeline();
    const s = t2.log([linearLift('squat', 65, ok())]);
    s.finishedAt = null;
    s.abandonedAt = '2026-01-02T00:00:00Z';
    expect(makeBackup(t2.settings, t2.sessions, []).sessions).toHaveLength(1);
  });

  it('rejects junk and says what is wrong', () => {
    expect(validateBackup('nope').ok).toBe(false);
    expect(validateBackup({}).ok).toBe(false);
    const b = good();
    b.app = 'other';
    expect(validateBackup(b).ok).toBe(false);
    const b2 = good();
    b2.sessions[0].lifts[0].sets[0].reps = 'five';
    const r = validateBackup(b2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/Session 1, lift 1, set 1/);
    const b3 = good();
    b3.schemaVersion = 99;
    expect(validateBackup(b3).ok).toBe(false);
    const b4 = good();
    b4.sessions[0].date = 'yesterday';
    expect(validateBackup(b4).ok).toBe(false);
    const b5 = good();
    delete b5.settings.barWeights.row;
    expect(validateBackup(b5).ok).toBe(false);
  });
});

describe('calendar grid', () => {
  it('October 2026 with a Sunday start: Oct 1 is a Thursday', () => {
    const g = monthGrid(2026, 9, 0);
    expect(g[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat().filter(Boolean)).toHaveLength(31);
    expect(g[g.length - 1].includes('2026-10-31')).toBe(true);
  });

  it('respects a Monday week start and leap years', () => {
    expect(monthGrid(2026, 9, 1)[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(monthGrid(2028, 1, 0).flat().filter(Boolean)).toHaveLength(29);
  });

  it('reads the locale week start', () => {
    expect(localeWeekStart('en-US')).toBe(0);
    expect(localeWeekStart('en-GB')).toBe(1);
  });

  it('lists finished sessions on a date, in order', () => {
    const t = new Timeline();
    const a = t.log([linearLift('squat', 65, ok())], 'linear', 0);
    const b = t.log([linearLift('squat', 70, ok())], 'linear', 0);
    expect(finishedOnDate(t.sessions, a.date).map((s) => s.id)).toEqual([a.id, b.id]);
    expect(finishedOnDate(t.sessions, '2030-01-01')).toEqual([]);
  });
});
