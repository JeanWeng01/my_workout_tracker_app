import { useEffect, useState } from 'react';
import { startAutoSync } from './data/sync';
import { startWorkout } from './data/store';
import { useProgram, type Program } from './data/useProgram';
import { Congrats } from './screens/Congrats';
import { Home } from './screens/Home';
import { SettingsScreen } from './screens/Settings';
import { Workout } from './screens/Workout';

type Screen = { kind: 'home' } | { kind: 'workout' } | { kind: 'settings' } | { kind: 'past'; id: string; planBefore: string };

/** What the next workout will look like, to tell if a history edit changed it. */
const planSignature = (p: Program) =>
  JSON.stringify([p.state.phase, p.plan.lifts.map((l) => [l.lift, l.scheme, l.sets.map((s) => s.weight)])]);

export function App() {
  const program = useProgram();
  useEffect(() => startAutoSync(), []);
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [congrats, setCongrats] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!program) return null;

  const home = () => setScreen({ kind: 'home' });

  if (congrats) return <Congrats program={program} onDone={() => setCongrats(false)} />;

  if (screen.kind === 'settings') return <SettingsScreen program={program} onBack={home} />;

  if (screen.kind === 'past') {
    const past = program.sessions.find((s) => s.id === screen.id && !s.deleted);
    const leave = () => {
      if (planSignature(program) !== screen.planBefore || program.state.revertedAutoSwitch) setNotice('Plan updated from your history edit.');
      home();
    };
    if (!past) {
      leave();
      return null;
    }
    return <Workout session={past} program={program} onExit={leave} />;
  }

  const draft = program.draft;
  if (screen.kind === 'workout' && draft) {
    return (
      <Workout
        session={draft}
        program={program}
        onExit={(graduated) => {
          home();
          if (graduated) setCongrats(true);
        }}
      />
    );
  }

  return (
    <Home
      program={program}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      onSettings={() => setScreen({ kind: 'settings' })}
      onOpenSession={(id) => setScreen({ kind: 'past', id, planBefore: planSignature(program) })}
      onStart={async () => {
        try {
          await startWorkout();
          setScreen({ kind: 'workout' });
        } catch (e) {
          setNotice(`Couldn't start the workout: ${e instanceof Error ? e.message : String(e)}`);
        }
      }}
    />
  );
}
