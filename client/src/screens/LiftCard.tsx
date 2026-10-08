import { useRef, useState } from 'react';
import { respondToAlert, changeSeventhWeek, updateDraft, updateSession } from '../data/store';
import type { Program } from '../data/useProgram';
import {
  ACCESSORY_CUE,
  ACCESSORY_NAME,
  accessoriesRevealed,
  addExtraSet,
  effectivePlates,
  fmtWeight,
  isLinearScheme,
  isPR,
  isRehabExercise,
  isTracked,
  LIFT_NAME,
  nextAbove,
  platesPerSide,
  prevBelow,
  roundingIncrement,
  setPain,
  setSetValues,
  setWorkingWeight,
  stepReps,
  toggleSet,
  type Alert,
  type LoggedLift,
  type LoggedSet,
  type MainLift,
  type Session,
  type SetExercise,
  type SevenType,
} from '../engine';
import { CheckButton } from './CheckButton';
import { SetEditor } from './SetEditor';
import { ShoulderRow } from './ShoulderRow';

type StartRest = (seconds: number) => void;

export const SEVEN_LABEL: Record<SevenType, string> = { tm_test: 'TM test', deload_forever: 'Deload', deload_light: 'Light deload' };
const vibrate = () => navigator.vibrate?.(10);
const isWork = (x: LoggedSet) => x.type === 'work' || x.type === 'amrap';

function Chip({ set, label, small, onTap, onLong }: { set: LoggedSet; label: string; small?: boolean; onTap: () => void; onLong: () => void }) {
  const timer = useRef<number | undefined>(undefined);
  const fired = useRef(false);
  const down = () => {
    fired.current = false;
    timer.current = window.setTimeout(() => {
      fired.current = true;
      onLong();
    }, 500);
  };
  const up = () => window.clearTimeout(timer.current);
  return (
    <button
      className={`chip${set.done ? ' done' : ''}${small ? ' small' : ''}`}
      aria-label={label}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (!fired.current) onTap();
      }}
    >
      {set.done ? set.reps : set.targetReps}
    </button>
  );
}

function AlertBanner({ alert }: { alert: Alert }) {
  return (
    <div className="banner" role="status">
      <div>
        <div><span aria-hidden>⚠ </span>{alert.message}</div>
        {alert.severity === 'action' && (
          <div className="banner-actions">
            <button className="banner-btn" onClick={() => void respondToAlert(alert, 'accept')}>{alert.acceptLabel ?? 'Accept'}</button>
            <button className="banner-btn" onClick={() => void respondToAlert(alert, 'keep')}>{alert.keepLabel ?? 'Try again next workout'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function LiftCard({ session, li, program, onRest }: { session: Session; li: number; program: Program; onRest: StartRest }) {
  const log: LoggedLift = session.lifts[li];
  const lift = log.lift;
  const [open, setOpen] = useState(false);
  const [warmOpen, setWarmOpen] = useState(false);
  const [edit, setEdit] = useState<{ si: number } | null>(null);
  const settings = program.settings;
  const past = session.finishedAt !== null;
  const act = (fn: (s: Session) => Session) => void (past ? updateSession(session.id, fn) : updateDraft(session.id, fn));

  const rehab = isRehabExercise(lift);
  const barbell = !rehab;
  const planned = past ? undefined : program.plan.lifts.find((p) => p.lift === lift);
  const alerts = planned?.alerts ?? [];
  const hasAlert = alerts.length > 0;

  const idx = log.sets.map((s, i) => ({ s, i }));
  const warm = idx.filter(({ s }) => s.type === 'warmup' || s.type === 'prep');
  const work = idx.filter(({ s }) => isWork(s));
  const supp = idx.filter(({ s }) => s.type === 'supplemental');
  const accSets = idx.filter(({ s }) => s.type === 'accessory');
  const revealed = accSets.length > 0 && accessoriesRevealed(log);
  const working = work.length ? Math.min(...work.map(({ s }) => s.weight)) : 0;
  const bar = barbell ? settings.barWeights[lift] : 0;
  const plates = barbell ? platesPerSide(working, bar, effectivePlates(settings)) : [];
  const step = roundingIncrement(settings);
  const barbellLinear = barbell && isLinearScheme(log.scheme);
  const perSetWeights = new Set(work.map(({ s }) => s.weight)).size > 1;
  const allDone = work.length > 0 && work.every(({ s }) => s.done);
  const ladder = rehab ? settings.rehab.ladders[lift] : [];
  const workReps = work[0]?.s.targetReps ?? 0;
  const tracked = isTracked(lift, settings.shoulder) && !log.skipped;

  const restFor = (s: LoggedSet): number | null =>
    s.type === 'prep' ? null : s.type === 'warmup' ? settings.restSeconds.warmup : s.type === 'supplemental' || s.type === 'accessory' ? settings.restSeconds.supplemental : settings.restSeconds.work;

  const complete = (si: number) => {
    const set = log.sets[si];
    if (!set.done && set.type === 'amrap') return setEdit({ si }); // AMRAP: pick reps first
    act((s) => toggleSet(s, li, si));
    if (!set.done && !past) {
      vibrate();
      const secs = restFor(set);
      if (secs !== null) onRest(secs);
    }
  };

  const chipTap = (si: number) => {
    const set = log.sets[si];
    if (set.type === 'amrap' && set.done) return setEdit({ si });
    act((s) => stepReps(s, li, si));
  };

  const editing = edit ? log.sets[edit.si] : null;
  const weightLabel = (w: number) => (rehab ? `2 × ${fmtWeight(w)} lb` : String(w));

  // Group the shoulder accessories by exercise, keeping their order.
  const accGroups = (['side_lying_er', 'db_scaption'] as SetExercise[])
    .map((ex) => ({ ex, sets: accSets.filter(({ s }) => s.exercise === ex) }))
    .filter((g) => g.sets.length > 0);

  return (
    <div className="card">
      <button className="card-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          <div className="card-name">
            {LIFT_NAME[lift]}{hasAlert ? ' ⚠' : ''}{allDone ? ' ✓' : ''}{log.paused ? ' (paused)' : log.skipped ? ' (skipped)' : ''}
          </div>
          <div className="small">
            {log.paused
              ? 'Paused'
              : rehab
                ? `${work.length} × ${workReps}`
                : planned
                  ? planned.scheme.replace('x', '×').replace('7th_', '7th week · ')
                  : log.scheme}
          </div>
        </span>
        {!log.paused && <span className={`card-weight${rehab ? ' dumbbell' : ''}`}>{weightLabel(working)}</span>}
      </button>

      {open && (
        <div className="card-body">
          {alerts.map((a) => <AlertBanner key={a.kind + a.message} alert={a} />)}
          {alerts.some((a) => a.severity === 'action') && <div className="small" style={{ marginBottom: 8 }}>Answer first: accepting changes today&apos;s weights.</div>}

          {log.paused ? (
            <div className="small">Paused after two red shoulder ratings. Resume it in Settings → Lift tracks when you&apos;re ready.</div>
          ) : log.skipped ? null : (
            <>
              {warm.length > 0 ? (
                <div className="warmups">
                  <button className="btn-link" aria-expanded={warmOpen} onClick={() => setWarmOpen(!warmOpen)} style={{ paddingLeft: 0 }}>
                    Warm-up ({warm.length} sets) {warmOpen ? '▴' : '▾'}
                  </button>
                  {warmOpen && warm.map(({ s, i }) => (
                    <div className="warm-row" key={i}>
                      {s.type === 'prep' ? (
                        <span>
                          <span className="num warm-text">{ACCESSORY_NAME[s.exercise!]} × {s.targetReps}</span>
                          <div className="small">{ACCESSORY_CUE[s.exercise!]}</div>
                        </span>
                      ) : (
                        <span className="num warm-text">{s.weight} × {s.targetReps}</span>
                      )}
                      <CheckButton done={s.done} label={s.type === 'prep' ? `Complete ${ACCESSORY_NAME[s.exercise!]}` : `Complete warm-up: ${s.weight} for ${s.targetReps}`} onClick={() => complete(i)} />
                    </div>
                  ))}
                </div>
              ) : (
                barbell && <div className="small">Warm-up: none (the empty bar is the warm-up)</div>
              )}

              {planned?.sevenType && !log.sets.some((x) => x.done) && (
                <div className="small" style={{ margin: '4px 0' }}>
                  7th week: <b>{SEVEN_LABEL[planned.sevenType]}</b>. Change to:{' '}
                  {(Object.keys(SEVEN_LABEL) as SevenType[])
                    .filter((t) => t !== planned.sevenType)
                    .map((t) => (
                      <button key={t} className="btn-link" onClick={() => void changeSeventhWeek(lift as MainLift, t)}>{SEVEN_LABEL[t]}</button>
                    ))}
                </div>
              )}

              {rehab && (
                <>
                  <div className="weight-edit">
                    <button className="step-btn" aria-label="Lower dumbbell weight" onClick={() => act((s) => setWorkingWeight(s, li, prevBelow(ladder, working) ?? working))}>−</button>
                    <span className="weight-big num dumbbell">2 × {fmtWeight(working)} lb</span>
                    <button className="step-btn" aria-label="Raise dumbbell weight" onClick={() => act((s) => setWorkingWeight(s, li, nextAbove(ladder, working) ?? working))}>+</button>
                  </div>
                  <div className="small">Lower for 3 s</div>
                </>
              )}

              {barbellLinear && (
                <div className="weight-edit">
                  <button className="step-btn" aria-label="Lower working weight" onClick={() => act((s) => setWorkingWeight(s, li, Math.max(bar, working - step)))}>−</button>
                  <span className="weight-big num">{working}</span>
                  <button className="step-btn" aria-label="Raise working weight" onClick={() => act((s) => setWorkingWeight(s, li, working + step))}>+</button>
                </div>
              )}
              {barbell && <div className="small">{working <= bar ? 'empty bar' : `per side: ${plates.join(' + ') || '—'}`}</div>}

              <div className="chips">
                {work.map(({ s, i }) => (
                  <div className="set" key={i}>
                    {perSetWeights && <span className="small num">{s.weight}</span>}
                    <Chip set={s} label={`Set: ${s.done ? s.reps : s.targetReps} reps at ${s.weight}`} onTap={() => chipTap(i)} onLong={() => setEdit({ si: i })} />
                    <CheckButton done={s.done} label={`Complete set ${s.weight} for ${s.targetReps}`} onClick={() => complete(i)} />
                    {s.type === 'amrap' && s.done && barbell && isPR(program.sessions, lift as MainLift, s.weight, s.reps, session.id) && <span className="pr">PR</span>}
                  </div>
                ))}
              </div>

              {supp.length > 0 && (
                <>
                  <div className="small">Supplemental · {supp[0].s.weight} × {supp[0].s.targetReps}</div>
                  <div className="chips">
                    {supp.map(({ s, i }) => (
                      <div className="set" key={i}>
                        <Chip small set={s} label={`Supplemental set: ${s.done ? s.reps : s.targetReps} reps`} onTap={() => chipTap(i)} onLong={() => setEdit({ si: i })} />
                        <CheckButton done={s.done} label="Complete supplemental set" onClick={() => complete(i)} />
                      </div>
                    ))}
                  </div>
                </>
              )}

              {tracked && settings.shoulder.tracking && (
                <ShoulderRow pain={log.pain} shoulder={settings.shoulder} onChange={(p) => act((s) => setPain(s, li, p))} />
              )}

              {revealed &&
                accGroups.map((g) => (
                  <div className="acc" key={g.ex}>
                    <div className="small acc-title">
                      {ACCESSORY_NAME[g.ex]} · {fmtWeight(g.sets[0].s.weight)} lb
                    </div>
                    <div className="small">{ACCESSORY_CUE[g.ex]}</div>
                    <div className="chips">
                      {g.sets.map(({ s, i }) => (
                        <div className="set" key={i}>
                          <Chip small set={s} label={`${ACCESSORY_NAME[g.ex]}: ${s.done ? s.reps : s.targetReps} reps`} onTap={() => chipTap(i)} onLong={() => setEdit({ si: i })} />
                          <CheckButton done={s.done} label={`Complete ${ACCESSORY_NAME[g.ex]} set`} onClick={() => complete(i)} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

              <div>
                {barbell && <button className="btn-link" onClick={() => act((s) => addExtraSet(s, li))}>+ Extra set</button>}
              </div>
            </>
          )}
        </div>
      )}

      {edit && editing && (
        <SetEditor
          title={`${editing.exercise ? ACCESSORY_NAME[editing.exercise] : LIFT_NAME[lift]} · ${editing.type === 'amrap' ? 'AMRAP reps' : 'Edit set'}`}
          weight={editing.weight}
          reps={editing.done ? editing.reps : (editing.minReps ?? editing.targetReps)}
          weightStep={rehab || editing.exercise ? 2.5 : step}
          repsOnly={editing.type === 'amrap' && !editing.done}
          onCancel={() => setEdit(null)}
          onSave={(v) => {
            act((s) => setSetValues(s, li, edit.si, editing.type === 'amrap' && !editing.done ? { reps: v.reps } : v));
            if (!editing.done && !past) {
              vibrate();
              const secs = restFor(editing);
              if (secs !== null) onRest(secs);
            }
            setEdit(null);
          }}
        />
      )}
    </div>
  );
}
