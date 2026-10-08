import { useState } from 'react';
import { setTrainingMax } from '../data/store';
import type { Program } from '../data/useProgram';
import { LIFT_SHORT, MAIN_LIFTS, type MainLift } from '../engine';
import { Mantra } from './Mantra';

/** Shown once, right after the finish that graduates the program to 5/3/1. */
export function Congrats({ program, onDone }: { program: Program; onDone: () => void }) {
  const [adjusting, setAdjusting] = useState(false);
  const tms = program.state.wave;
  // Only lifts that actually switched get a training max; the ones still on shoulder rehab say so.
  const switched = MAIN_LIFTS.filter((l) => program.state.track[l] === '531');
  const onRehab = MAIN_LIFTS.filter((l) => program.state.track[l] === 'rehab');
  const step = program.settings.microplates ? 2.5 : 5;

  const change = (lift: MainLift, delta: number) =>
    void setTrainingMax(lift, Math.max(program.settings.barWeights[lift], tms[lift].tm + delta));

  return (
    <div className="page">
      <Mantra />
      <div className="bubble" style={{ margin: "8px auto" }}>
        <h2 style={{ margin: '8px 0' }}>Linear progression complete.</h2>
        <p>
          You&apos;ve hit your first real strength wall, which means you&apos;re no longer a beginner. Starting next session,
          you&apos;re on 5/3/1.
        </p>
        <div className="label">Your training maxes:</div>
        {adjusting ? (
          switched.map((l) => (
            <div className="weight-edit" key={l}>
              <span style={{ width: 90, fontWeight: 700 }}>{LIFT_SHORT[l]}</span>
              <button className="step-btn" aria-label={`Lower ${LIFT_SHORT[l]} training max`} onClick={() => change(l, -step)}>−</button>
              <span className="weight-big num" style={{ fontSize: 32 }}>{tms[l].tm}</span>
              <button className="step-btn" aria-label={`Raise ${LIFT_SHORT[l]} training max`} onClick={() => change(l, step)}>+</button>
            </div>
          ))
        ) : (
          <p className="num" style={{ fontWeight: 800, fontSize: 22 }}>
            {switched.map((l) => `${LIFT_SHORT[l]} ${tms[l].tm}`).join(' · ')}
          </p>
        )}
        {onRehab.map((l) => (
          <p className="small" key={l}>{LIFT_SHORT[l]}: still on shoulder rehab</p>
        ))}
        <button className="btn-link" style={{ paddingLeft: 0 }} onClick={() => setAdjusting(!adjusting)}>
          {adjusting ? 'Done adjusting' : 'Adjust training maxes'}
        </button>
        <button className="btn" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
