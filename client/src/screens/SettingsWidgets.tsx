import { useEffect, useState, type ReactNode } from 'react';

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bubble set-group">
      <h3 className="set-title">{title}</h3>
      {children}
    </div>
  );
}

export function NumRow({ label, value, step, min, max, suffix, onChange }: {
  label: string; value: number; step: number; min: number; max: number; suffix?: string; onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n * 100) / 100));
  return (
    <div className="set-row">
      <span className="set-label">{label}</span>
      <span className="set-ctl">
        <button className="step-btn sm" aria-label={`${label} minus`} onClick={() => onChange(clamp(value - step))}>−</button>
        <span className="num set-val">{value}{suffix}</span>
        <button className="step-btn sm" aria-label={`${label} plus`} onClick={() => onChange(clamp(value + step))}>+</button>
      </span>
    </div>
  );
}

export function Pills<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <div className="set-block">
      <div className="set-label">{label}</div>
      <div className="template-row">
        {options.map(([v, name]) => (
          <button key={String(v)} className={`pill${value === v ? ' on' : ''}`} aria-pressed={value === v} onClick={() => onChange(v)}>{name}</button>
        ))}
      </div>
    </div>
  );
}

/** Turns "15, 17.5 20" into [15, 17.5, 20]: positive numbers only, ascending, no repeats. Null if nothing usable. */
export function parseNumberList(text: string): number[] | null {
  const nums = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (!nums.length || nums.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return [...new Set(nums)].sort((a, b) => a - b);
}

/**
 * An editable list of numbers (a dumbbell ladder, rep steps). Typing is free; the list is checked and saved when the field
 * loses focus, and a bad entry puts the saved list back.
 */
export function NumList({ label, hint, value, onChange }: { label: string; hint?: string; value: number[]; onChange: (v: number[]) => void }) {
  const shown = value.join(', ');
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => setText(shown), [shown]);
  const id = `list-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="set-block">
      <label className="set-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="text-in"
        inputMode="decimal"
        value={text}
        aria-invalid={bad}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = parseNumberList(text);
          if (!parsed) {
            setBad(true);
            setText(shown);
            return;
          }
          setBad(false);
          setText(parsed.join(', '));
          if (parsed.join() !== value.join()) onChange(parsed);
        }}
      />
      <div className="small">{bad ? 'Enter numbers separated by commas, like 15, 17.5, 20.' : hint ?? 'Separate with commas, smallest first.'}</div>
    </div>
  );
}
