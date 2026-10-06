import { useState } from 'react';
import type { Program } from '../data/useProgram';
import { LIFT_NAME } from '../engine';
import { useSyncLine } from '../data/sync';
import { Calendar } from './Calendar';
import { Mantra } from './Mantra';
import { schemeLabel, weightSummary } from './format';

function CalendarIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

interface HomeProps {
  program: Program;
  onStart: () => void;
  onSettings: () => void;
  onOpenSession: (id: string) => void;
  notice: string | null;
  onDismissNotice: () => void;
}

export function Home({ program, onStart, onSettings, onOpenSession, notice, onDismissNotice }: HomeProps) {
  const [calOpen, setCalOpen] = useState(false);
  const syncLine = useSyncLine();
  const { plan, state, draft, sessions } = program;
  // The most recent attempt was left unfinished and nothing was finished since.
  const latest = [...sessions]
    .filter((s) => !s.deleted && (s.finishedAt || s.abandonedAt))
    .sort((a, b) => ((a.finishedAt ?? a.abandonedAt!) < (b.finishedAt ?? b.abandonedAt!) ? -1 : 1))
    .pop();
  const redo = !draft && !!latest && !latest.finishedAt;
  const alerts = plan.alerts;

  return (
    <div className="home">
      <Mantra>
        <button className="icon-btn" aria-label="Workout calendar" aria-expanded={calOpen} onClick={() => setCalOpen(!calOpen)}><CalendarIcon /></button>
      </Mantra>

      {calOpen && <Calendar sessions={program.sessions} onOpen={onOpenSession} />}
      {notice && (
        <div className="bubble notice" role="status">
          {notice} <button className="btn-link" onClick={onDismissNotice}>OK</button>
        </div>
      )}

      <main className="home-main">
        <div className="bubble">
          <h2 className="bubble-title">{plan.label}</h2>
          {redo && <div className="small" style={{ marginBottom: 8 }}>Last workout was left unfinished. Starting it over from the top.</div>}
          {plan.lifts.map((l) => (
            <div className="next-lift" key={l.lift}>
              <span>{LIFT_NAME[l.lift]} {schemeLabel(l)}</span>
              <span className="num">{weightSummary(l)}</span>
            </div>
          ))}
          <div style={{ height: 16 }} />
          <button className="btn" onClick={onStart}>{draft ? 'Resume workout' : 'Start workout'}</button>
          {alerts.length > 0 && (
            <div className="bubble-alerts">
              {alerts.map((a) => <div className="small" key={a.lift + a.kind}>⚠ {a.message}</div>)}
            </div>
          )}
        </div>
      </main>

      <footer className="home-foot">
        <div className="foot-row">
          <span>Phase: {state.phase === 'linear' ? 'Linear' : '5/3/1'}</span>
          <button className="btn-link" onClick={onSettings}>Settings</button>
        </div>
        <div className="sync-line">{syncLine}</div>
      </footer>
    </div>
  );
}
