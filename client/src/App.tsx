import { useEffect, useState } from 'react';
import { startAutoSync } from './data/sync';
import { reconcileDraft, startOver, startWorkout } from './data/store';
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

  // An installed web app keeps showing the old version until it reloads. When a newer version takes over in the background,
  // reload as soon as we are on Home (never mid-workout; drafts autosave anyway), so a deploy shows up on the next open.
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return; // first ever visit: nothing to replace
    const onChange = () => setUpdateReady(true);
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange);
  }, []);
  useEffect(() => {
    if (updateReady && screen.kind === 'home' && !congrats) window.location.reload();
  }, [updateReady, screen.kind, congrats]);

  if (!program) return null;

  const home = () => setScreen({ kind: 'home' });

  if (congrats) return <Congrats program={program} onDone={() => setCongrats(false)} />;

  if (screen.kind === 'settings') return <SettingsScreen program={program} onBack={home} />;

  if (screen.kind === 'past') {
    const past = program.sessions.find((s) => s.id === screen.id && !s.deleted);
    const leave = (graduated?: boolean) => {
      if (planSignature(program) !== screen.planBefore || program.state.revertedAutoSwitch) setNotice('Plan updated from your history edit.');
      home();
      void reconcileDraft(); // an edited, recovered or deleted workout changes what any workout in progress should be
      if (graduated) setCongrats(true); // recovering an unfinished workout can be the one that graduates the program
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
      onStartOver={() => (program.draft ? startOver(program.draft.id) : Promise.resolve())}
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
