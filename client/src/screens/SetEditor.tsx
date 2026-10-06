import { useState } from 'react';

interface Props {
  title: string;
  weight: number;
  reps: number;
  weightStep: number;
  /** Reps-only picker (AMRAP). */
  repsOnly?: boolean;
  onSave: (v: { weight: number; reps: number }) => void;
  onCancel: () => void;
}

function Stepper({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (n: number) => void }) {
  return (
    <div className="stepper">
      <div className="label">{label}</div>
      <div className="stepper-row">
        <button className="step-btn" aria-label={`${label} minus`} onClick={() => onChange(Math.max(0, value - step))}>−</button>
        <span className="step-val num">{value}</span>
        <button className="step-btn" aria-label={`${label} plus`} onClick={() => onChange(value + step)}>+</button>
      </div>
    </div>
  );
}

/** Big number picker: AMRAP reps, or long-press edit of one set's weight and reps. */
export function SetEditor({ title, weight, reps, weightStep, repsOnly, onSave, onCancel }: Props) {
  const [w, setW] = useState(weight);
  const [r, setR] = useState(reps);
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet">
        <div style={{ fontWeight: 700 }}>{title}</div>
        {!repsOnly && <Stepper label="Weight" value={w} step={weightStep} onChange={setW} />}
        <Stepper label="Reps" value={r} step={1} onChange={setR} />
        <button className="btn" onClick={() => onSave({ weight: w, reps: r })}>Done</button>
        <button className="btn-link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
