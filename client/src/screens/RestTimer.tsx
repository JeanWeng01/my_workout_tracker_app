import { useEffect, useState } from 'react';

export interface Rest {
  /** Epoch ms when the rest ends. Wall-clock based, so it survives a locked screen. */
  endsAt: number;
}

const HIDE_AFTER_MS = 8000;

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Silent countdown bar: no buttons, no sound. Says "Ready" at zero, then tucks itself away. */
export function RestTimer({ rest, onHide }: { rest: Rest; onHide: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = rest.endsAt - now;
  const done = left <= 0;

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(onHide, HIDE_AFTER_MS);
    return () => clearTimeout(id);
  }, [done, onHide]);

  return (
    <div className="rest-bar" role="timer" aria-live="off">
      <div className="small" style={{ color: 'inherit' }}>Rest</div>
      <div className="rest-time num">{done ? 'Ready' : fmt(left)}</div>
    </div>
  );
}
