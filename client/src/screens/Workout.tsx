import { useEffect, useState } from 'react';
import { deleteSession, exitWorkout, finishWorkout, needsUntouchedChoice, setTemplate, updateDraft, updateSession } from '../data/store';
import type { Program } from '../data/useProgram';
import { hasUntouchedMainWork, isWorkoutComplete, liftsNeedingRating, setNotes, setPain, skipPain, type PainRating, type Session, type Template } from '../engine';
import { LiftCard } from './LiftCard';
import { Mantra } from './Mantra';
import { RatingPrompt } from './RatingPrompt';
import { RestTimer, type Rest } from './RestTimer';

const TEMPLATES: [Template, string][] = [['minimalist', 'None'], ['fsl', 'FSL 5×5'], ['bbb', 'BBB 5×10']];

/** Keep the screen awake while a workout is open. Fails silently where the browser doesn't support it. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const request = async () => {
      try {
        const l = (await navigator.wakeLock?.request('screen')) ?? null;
        if (stopped) void l?.release().catch(() => {});
        else lock = l;
      } catch {
        // Not supported, or the browser said no (low battery...): nothing to do.
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!lock || lock.released)) void request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

export function Workout({ session, program, onExit }: { session: Session; program: Program; onExit: (graduated?: boolean) => void }) {
  const [rest, setRest] = useState<Rest | null>(null);
  const [asking, setAsking] = useState<'finish' | 'leave' | null>(null);
  const startRest = (seconds: number) => setRest({ endsAt: Date.now() + seconds * 1000 });
  const linear = session.phase === 'linear';
  const past = session.finishedAt !== null;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState(session.notes ?? '');
  const [celebrate, setCelebrate] = useState(false);
  const [held, setHeld] = useState(false); // "Not yet" pressed: don't auto-finish until a set changes
  const [ratingQueue, setRatingQueue] = useState<number[] | null>(null);
  const [finishRequested, setFinishRequested] = useState(false);
  // Lifts answered in the prompt just now; counted as done at once, without waiting for the database to catch up.
  const [answered, setAnswered] = useState<number[]>([]);
  const shoulder = program.settings.shoulder;

  useWakeLock(!past);

  const finish = async () => {
    const r = await finishWorkout(session.id);
    onExit(r.graduated);
  };
  const leaveUnfinished = async () => {
    await exitWorkout(session.id);
    onExit();
  };

  // Tracked lifts that were performed but not rated yet. They are asked about before the workout can finish.
  const needing = past ? [] : liftsNeedingRating(session, shoulder).filter((i) => !answered.includes(i));

  // Every set green: (rate the shoulder if needed, then) show the popup for 2 seconds and finish on its own.
  const complete = !past && isWorkoutComplete(session);
  useEffect(() => {
    if (!complete) {
      setCelebrate(false);
      setHeld(false);
      setAnswered([]);
      return;
    }
    if (held) return;
    if (needing.length > 0) {
      if (!ratingQueue) setRatingQueue(needing);
      return;
    }
    if (ratingQueue) return; // the prompt is still open
    setCelebrate(true);
    const id = setTimeout(() => void finish(), 2000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, held, needing.length, ratingQueue]);

  const proceedFinish = () => (needsUntouchedChoice(session) ? setAsking('finish') : void finish());
  const onFinishTap = () => {
    if (needing.length > 0) {
      setFinishRequested(true);
      setRatingQueue(needing);
    } else {
      proceedFinish();
    }
  };
  useEffect(() => {
    if (finishRequested && !ratingQueue && needing.length === 0) {
      setFinishRequested(false);
      proceedFinish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishRequested, ratingQueue, needing.length]);

  const saveNote = (text: string) => {
    setNoteText(text);
    void (past ? updateSession : updateDraft)(session.id, (x) => setNotes(x, text));
  };
  const noteBox = noteOpen && (
    <div style={{ marginTop: 8 }}>
      <label className="small" htmlFor="workout-note">Note for this workout</label>
      <textarea
        id="workout-note"
        className="note-in"
        rows={4}
        maxLength={2000}
        value={noteText}
        placeholder="How it felt, pain, sleep, anything..."
        onChange={(e) => saveNote(e.target.value)}
      />
    </div>
  );
  const noteLink = (
    <button className="btn-link" aria-expanded={noteOpen} onClick={() => setNoteOpen(!noteOpen)}>{noteText.trim() ? 'Note •' : 'Note'}</button>
  );

  const onlyAccessoriesLeft = !hasUntouchedMainWork(session);

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
              <div className="link-row">
                <button className="btn-link" style={{ paddingLeft: 0 }} onClick={() => setConfirmDelete(true)}>Delete workout</button>
                {noteLink}
              </div>
              {noteBox}
            </>
          )}
        </div>
      ) : (
        <div className="section">
          {asking === 'finish' && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                {onlyAccessoriesLeft
                  ? 'Some shoulder work is untouched. Count it as missed, or leave this workout unfinished and redo it from the start?'
                  : 'Some sets are untouched. Count them as missed reps, or leave this workout unfinished and redo it from the start?'}
              </div>
              <button className="btn" onClick={() => void finish()}>{onlyAccessoriesLeft ? 'Count as missed' : 'Count as missed reps'}</button>
              <div style={{ height: 8 }} />
              <button className="btn" onClick={() => setAsking('leave')}>Leave unfinished</button>
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
              <div className="link-row">
                <button className="btn-link" style={{ paddingLeft: 0 }} onClick={() => setAsking('leave')}>Can't finish today</button>
                {noteLink}
              </div>
              {noteBox}
            </>
          )}
        </div>
      )}
      <div className="bottom-mantra">My muscles are A-OK, but I invest in bulletproof joints.</div>

      {ratingQueue && (
        <RatingPrompt
          session={session}
          queue={ratingQueue}
          shoulder={shoulder}
          onRate={(li, p: PainRating | null) => void updateDraft(session.id, (s) => setPain(s, li, p))}
          onSkip={(li) => void updateDraft(session.id, (s) => skipPain(s, li))}
          onAnswered={(li) => setAnswered((a) => [...a, li])}
          onDone={() => {
            setRatingQueue(null);
            if (!finishRequested) setHeld(false);
          }}
        />
      )}

      {celebrate && (
        <div className="sheet-backdrop celebrate-wrap" role="status" aria-live="polite">
          <div className="celebrate">
            <div className="celebrate-text">Workout complete! 🎉</div>
            <button className="btn-link" onClick={() => { setCelebrate(false); setHeld(true); }}>Not yet</button>
          </div>
        </div>
      )}

      {rest && <RestTimer rest={rest} onHide={() => setRest(null)} />}
    </div>
  );
}
