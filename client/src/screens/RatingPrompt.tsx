import { useState } from 'react';
import { LIFT_NAME, type PainRating, type Session, type ShoulderSettings } from '../engine';
import { ShoulderRow } from './ShoulderRow';

/**
 * "Rate your shoulder for DB Floor Press?" for each tracked lift that has sets logged but no rating, one after another.
 * Shown when the last set goes green (before the workout completes itself) and when Finish workout is tapped.
 */
export function RatingPrompt({
  session,
  queue,
  shoulder,
  onRate,
  onSkip,
  onAnswered,
  onDone,
}: {
  session: Session;
  /** Lift indexes to ask about, fixed when the prompt opened. */
  queue: number[];
  shoulder: ShoulderSettings;
  onRate: (li: number, p: PainRating | null) => void;
  onSkip: (li: number) => void;
  /** The lift was rated or skipped and the prompt moved on. Lets the caller stop asking before the database catches up. */
  onAnswered: (li: number) => void;
  onDone: () => void;
}) {
  const [pos, setPos] = useState(0);
  const li = queue[pos];
  if (li === undefined) return null;
  const lift = session.lifts[li];
  const next = () => {
    onAnswered(li);
    if (pos + 1 >= queue.length) onDone();
    else setPos(pos + 1);
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Shoulder check">
      <div className="sheet">
        <div style={{ fontWeight: 700, fontSize: 20 }}>Rate your shoulder for {LIFT_NAME[lift.lift]}?</div>
        <ShoulderRow pain={lift.pain} shoulder={shoulder} onChange={(p) => onRate(li, p)} />
        <button className="btn" disabled={!lift.pain} onClick={next}>
          {pos + 1 >= queue.length ? 'Done' : 'Next'}
        </button>
        <button
          className="btn-link"
          onClick={() => {
            onSkip(li);
            next();
          }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
