import { useRef, useState } from 'react';
import { dayStatuses, finishedOnDate, localeWeekStart, monthGrid, totalWorkouts, type Session } from '../engine';

const pad = (n: number) => String(n).padStart(2, '0');

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Day label for screen readers, e.g. "October 6, 1 workout". */
function dayLabel(date: string, status: 'finished' | 'unfinished' | undefined, count: number): string {
  const d = new Date(`${date}T12:00:00`);
  const base = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  if (status === 'finished') return `${base}, ${count} workout${count === 1 ? '' : 's'}`;
  if (status === 'unfinished') return `${base}, workout unfinished`;
  return base;
}

export function Calendar({ sessions, onOpen }: { sessions: Session[]; onOpen: (id: string) => void }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [pick, setPick] = useState<Session[] | null>(null);
  const touchX = useRef<number | null>(null);

  const weekStart = localeWeekStart();
  const statuses = dayStatuses(sessions);
  const today = localToday();
  const weeks = monthGrid(cursor.y, cursor.m, weekStart);
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekdayNames = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2023, 0, 1 + ((weekStart + i) % 7))).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' }),
  );

  const move = (delta: number) => {
    setPick(null);
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  const tapDay = (date: string) => {
    if (statuses.get(date) !== 'finished') return; // empty and yellow days do nothing
    const list = finishedOnDate(sessions, date);
    if (list.length === 1) onOpen(list[0].id);
    else setPick(list);
  };

  return (
    <div
      className="bubble cal"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 60) move(dx < 0 ? 1 : -1);
      }}
    >
      <div className="cal-head">
        <button className="cal-nav" aria-label="Previous month" onClick={() => move(-1)}>‹</button>
        <div className="cal-month">{monthName}</div>
        <button className="cal-nav" aria-label="Next month" onClick={() => move(1)}>›</button>
      </div>
      <div className="cal-grid cal-week" aria-hidden="true">
        {weekdayNames.map((n, i) => <div key={i}>{n}</div>)}
      </div>
      {weeks.map((w, wi) => (
        <div className="cal-grid" key={wi}>
          {w.map((date, di) => {
            if (!date) return <div key={di} />;
            const status = statuses.get(date);
            const count = finishedOnDate(sessions, date).length;
            const day = Number(date.slice(8));
            return (
              <button
                key={di}
                className={`cal-day${status ? ` ${status}` : ''}${date === today ? ' today' : ''}`}
                aria-label={dayLabel(date, status, count)}
                disabled={status !== 'finished'}
                onClick={() => tapDay(date)}
              >
                <span className="cal-num">{day}</span>
                {status === 'finished' && <span className="cal-mark" aria-hidden="true">✓</span>}
                {status === 'unfinished' && <span className="cal-mark" aria-hidden="true">–</span>}
              </button>
            );
          })}
        </div>
      ))}
      {pick && (
        <div className="cal-pick">
          <div className="small">Which workout?</div>
          {pick.map((s) => <button key={s.id} className="btn-link" onClick={() => onOpen(s.id)}>{s.label}</button>)}
        </div>
      )}
      <div className="cal-total">Total workouts: {totalWorkouts(sessions)}</div>
    </div>
  );
}
