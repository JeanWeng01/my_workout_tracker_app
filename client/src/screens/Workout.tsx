import { useRef, useState } from 'react';
import { changeSeventhWeek, exitWorkout, finishWorkout, needsUntouchedChoice, deleteSession, respondToAlert, setTemplate, updateDraft, updateSession } from '../data/store';
import type { Program } from '../data/useProgram';
import {
  addExtraSet, effectivePlates, isPR, LIFT_NAME, platesPerSide, roundingIncrement, setSetValues, setSkipped,
  setWorkingWeight, stepReps, toggleSet, type LoggedLift, type LoggedSet, type MainLift, type Session, type SevenType, type Template,
} from '../engine';
import { CheckButton } from './CheckButton';
import { Mantra } from './Mantra';
import { RestTimer, type Rest } from './RestTimer';
import { SetEditor } from './SetEditor';

type StartRest = (seconds: number) => void;
type Edit = { si: number } | null;

const SEVEN_LABEL: Record<SevenType, string> = { tm_test: 'TM test', deload_forever: 'Deload', deload_light: 'Light deload' };
const TEMPLATES: [Template, string][] = [['minimalist', 'None'], ['fsl', 'FSL 5×5'], ['bbb', 'BBB 5×10']];
const vibrate =() => navigator.vibrate?.(10);
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

function LiftCard({ session, li, program, onRest }: { session: Session; li: number; program: Program; onRest: StartRest }) {
  const log: LoggedLift = session.lifts[li];
  const lift = log.lift;
  const [open, setOpen] = useState(false);
  const [warmOpen, setWarmOpen] = useState(false);
  const [edit, setEdit] = useState<Edit>(null);
  const settings = program.settings;
  const past = session.finishedAt !== null;
  const act = (fn: (s: Session) => Session) => void (past ? updateSession(session.id, fn) : updateDraft(session.id, fn));

  const planned = past ? undefined : program.plan.lifts.find((p) => p.lift === lift);
  const alerts = planned?.alerts ?? [];
  const actionable = alerts.filter((a) => a.severity === 'action');
  const hasAlert = alerts.length > 0;

  const idx = log.sets.map((s, i) => ({ s, i }));
  const warm = idx.filter(({ s }) => s.type === 'warmup');
  const work = idx.filter(({ s }) => isWork(s));
  const supp = idx.filter(({ s }) => s.type === 'supplemental');
  const working = work.length ? Math.min(...work.map(({ s }) => s.weight)) : 0;
  const bar = settings.barWeights[lift];
  const plates = platesPerSide(working, bar, effectivePlates(settings));
  const step = roundingIncrement(settings);
  const linear = session.phase === 'linear';
  const perSetWeights = new Set(work.map(({ s }) => s.weight)).size > 1;
  const allDone = work.length > 0 && work.every(({ s }) => s.done);

  const complete = (si: number) => {
    const set = log.sets[si];
    if (!set.done && set.type === 'amrap') return setEdit({ si }); // AMRAP: pick reps first
    act((s) => toggleSet(s, li, si));
    if (!set.done && !past) {
      vibrate();
      onRest(set.type === 'warmup' ? settings.restSeconds.warmup : set.type === 'supplemental' ? settings.restSeconds.supplemental : settings.restSeconds.work);
    }
  };

  const chipTap = (si: number) => {
    const set = log.sets[si];
    if (set.type === 'amrap' && set.done) return setEdit({ si });
    act((s) => stepReps(s, li, si));
  };

  const editing = edit ? log.sets[edit.si] : null;

  return (
    <div className="card">
      <button className="card-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          <div className="card-name">{LIFT_NAME[lift]}{hasAlert ? ' ⚠' : ''}{allDone ? ' ✓' : ''}{log.skipped ? ' (skipped)' : ''}</div>
          <div className="small">{planned ? planned.scheme.replace('x', '×').replace('7th_', '7th week · ') : log.scheme}</div>
        </span>
        <span className="card-weight">{working}</span>
      </button>

      {open && (
        <div className="card-body">
          {alerts.map((a) => (
            <div className="banner" key={a.kind} role="status">
              <div>
                <div><span aria-hidden>⚠ </span>{a.message}</div>
                {a.severity === 'action' && (
                  <div className="banner-actions">
                    <button className="banner-btn" onClick={() => void respondToAlert(a, 'accept')}>Accept</button>
                    <button className="banner-btn" onClick={() => void respondToAlert(a, 'keep')}>Try again next workout</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {actionable.length > 0 && <div className="small" style={{ marginBottom: 8 }}>Answer first: accepting changes today&apos;s weights.</div>}

          {log.skipped ? (
            <button className="btn-link" onClick={() => act((s) => setSkipped(s, li, false))}>Undo skip</button>
          ) : (
            <>
              {warm.length > 0 ? (
                <div className="warmups">
                  <button className="btn-link" aria-expanded={warmOpen} onClick={() => setWarmOpen(!warmOpen)} style={{ paddingLeft: 0 }}>
                    Warm-up ({warm.length} sets) {warmOpen ? '▴' : '▾'}
                  </button>
                  {warmOpen && warm.map(({ s, i }) => (
                    <div className="warm-row" key={i}>
                      <span className="num warm-text">{s.weight} × {s.targetReps}</span>
                      <CheckButton done={s.done} label={`Complete warm-up: ${s.weight} for ${s.targetReps}`} onClick={() => complete(i)} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="small">Warm-up: none (the empty bar is the warm-up)</div>
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

              {linear && (
                <div className="weight-edit">
                  <button className="step-btn" aria-label="Lower working weight" onClick={() => act((s) => setWorkingWeight(s, li, Math.max(bar, working - step)))}>−</button>
                  <span className="weight-big num">{working}</span>
                  <button className="step-btn" aria-label="Raise working weight" onClick={() => act((s) => setWorkingWeight(s, li, working + step))}>+</button>
                </div>
              )}
              <div className="small">{working <= bar ? 'empty bar' : `per side: ${plates.join(' + ') || '—'}`}</div>

              <div className="chips">
                {work.map(({ s, i }) => (
                  <div className="set" key={i}>
                    {perSetWeights && <span className="small num">{s.weight}</span>}
                    <Chip set={s} label={`Set: ${s.done ? s.reps : s.targetReps} reps at ${s.weight}`} onTap={() => chipTap(i)} onLong={() => setEdit({ si: i })} />
                    <CheckButton done={s.done} label={`Complete set ${s.weight} for ${s.targetReps}`} onClick={() => complete(i)} />
                    {s.type === 'amrap' && s.done && isPR(program.sessions, lift, s.weight, s.reps, session.id) && <span className="pr">PR</span>}
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

              <div>
                <button className="btn-link" onClick={() => act((s) => addExtraSet(s, li))}>+ Extra set</button>
                {linear && <button className="btn-link" onClick={() => act((s) => setSkipped(s, li, true))}>Skip lift</button>}
              </div>
            </>
          )}
        </div>
      )}

      {edit && editing && (
        <SetEditor
          title={`${LIFT_NAME[lift]} · ${editing.type === 'amrap' ? 'AMRAP reps' : 'Edit set'}`}
          weight={editing.weight}
          reps={editing.done ? editing.reps : (editing.minReps ?? editing.targetReps)}
          weightStep={step}
          repsOnly={editing.type === 'amrap' && !editing.done}
          onCancel={() => setEdit(null)}
          onSave={(v) => {
            act((s) => setSetValues(s, li, edit.si, editing.type === 'amrap' && !editing.done ? { reps: v.reps } : v));
            if (!editing.done && !past) {
              vibrate();
              onRest(settings.restSeconds.work);
            }
            setEdit(null);
          }}
        />
      )}
    </div>
  );
}

export function Workout({ session, program, onExit }: { session: Session; program: Program; onExit: (graduated?: boolean) => void }) {
  const [rest, setRest] = useState<Rest | null>(null);
  const [asking, setAsking] = useState<'finish' | 'leave' | null>(null);
  const startRest: StartRest = (seconds) => setRest({ endsAt: Date.now() + seconds * 1000 });
  const linear = session.phase === 'linear';
  const past = session.finishedAt !== null;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const finish = async (mode: 'missed' | 'skip') => {
    const r = await finishWorkout(session.id, mode);
    onExit(r.graduated);
  };
  const leaveUnfinished = async () => {
    await exitWorkout(session.id);
    onExit();
  };
  const onFinishTap = () => (needsUntouchedChoice(session) ? setAsking('finish') : void finish('missed'));

  return (
    <div className="page" style={{ paddingBottom: rest ? 120 : 48 }}>
      <Mantra />
      <div className="section">
        <button className="btn-link" style={{ paddingLeft: 0 }} onClick={() => onExit()}>{past ? '← Back' : '← Home (workout stays open)'}</button>
        <div style={{ fontWeight: 700 }}>{session.label}</div>
        <div className="small">{new Date(session.date + 'T12:00:00').toLocaleDateString()}</div>
      </div>

      {!linear && !past && (
        <div className="section" style={{ paddingTop: 0 }}>
          <div className="label">Extra work (applies from your next workout)</div>
          <div className="template-row">
            {TEMPLATES.map(([t, name]) => (
              <button
                key={t}
                className={`pill${program.settings.template === t ? ' on' : ''}`}
                aria-pressed={program.settings.template === t}
                onClick={() => void setTemplate(t)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {session.lifts.map((_, li) => <LiftCard key={li} session={session} li={li} program={program} onRest={startRest} />)}

      {past ? (
        <div className="section">
          <div className="small" style={{ marginBottom: 8 }}>Edits save as you go, and your next weights update from your history.</div>
          {confirmDelete ? (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Delete this workout? It stops counting toward your progression.</div>
              <button className="btn" onClick={async () => { await deleteSession(session.id); onExit(); }}>Delete workout</button>
              <button className="btn-link" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          ) : (
            <>
              <button className="btn" onClick={() => onExit()}>Done</button>
              <button className="btn-link" style={{ paddingLeft: 0 }} onClick={() => setConfirmDelete(true)}>Delete workout</button>
            </>
          )}
        </div>
      ) : (
      <div className="section">
        {asking === 'finish' && (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              {linear ? 'Count untouched sets as missed reps, or skip those lifts?' : 'Some main sets are untouched. Count them as missed reps, or leave this workout unfinished and redo it from the start?'}
            </div>
            <button className="btn" onClick={() => void finish('missed')}>Count as missed reps</button>
            <div style={{ height: 8 }} />
            {linear ? (
              <button className="btn" onClick={() => void finish('skip')}>Skip those lifts</button>
            ) : (
              <button className="btn" onClick={() => setAsking('leave')}>Leave unfinished</button>
            )}
            <button className="btn-link" onClick={() => setAsking(null)}>Back</button>
          </div>
        )}
        {asking === 'leave' && (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Leave this workout unfinished? It shows as a yellow day. Next time you redo it from the start, and nothing from today counts.</div>
            <button className="btn" onClick={() => void leaveUnfinished()}>Leave unfinished</button>
            <button className="btn-link" onClick={() => setAsking(null)}>Back</button>
          </div>
        )}
        {asking === null && (
          <>
            <button className="btn" onClick={onFinishTap}>Finish workout</button>
            <button className="btn-link" style={{ paddingLeft: 0 }} onClick={() => setAsking('leave')}>Can't finish today</button>
          </>
        )}
      </div>
      )}
      <div className="bottom-mantra">My muscles are A-OK, but I invest in bulletproof joints.</div>

      {rest && <RestTimer rest={rest} onHide={() => setRest(null)} />}
    </div>
  );
}
