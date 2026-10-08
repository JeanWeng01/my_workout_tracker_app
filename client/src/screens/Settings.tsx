import { useRef, useState, type ReactNode } from 'react';
import { loadEverything, restartLinear, restoreBackup, saveSettings, switchPhase } from '../data/store';
import { getSyncToken, setSyncToken, syncNow, useSyncLine, useSyncStatus } from '../data/sync';
import type { Program } from '../data/useProgram';
import {
  ALL_LIFTS, LIFT_NAME, MAIN_LIFTS, backupFilename, buildCsv, computeTrainingMaxes, csvFilename, makeBackup,
  roundToPlates, validateBackup, type Backup, type Lift, type MainLift, type Settings,
} from '../engine';
import { AboutRules } from './AboutRules';
import { shareOrDownload } from './fileio';
import { Mantra } from './Mantra';
import { Group, NumRow, Pills } from './SettingsWidgets';
import { ShoulderGroups, TrackGroup } from './ShoulderSettings';

type View = 'main' | 'switch' | 'restart' | 'about';

const PLATE_CHOICES = [45, 35, 25, 10, 5, 2.5];

export function SettingsScreen({ program, onBack }: { program: Program; onBack: () => void }) {
  const [view, setView] = useState<View>('main');
  const s = program.settings;
  const set = (patch: Partial<Settings>) => void saveSettings({ ...s, ...patch });
  const [token, setToken] = useState(getSyncToken());
  const [msg, setMsg] = useState<string | null>(null);
  const syncLine = useSyncLine();
  const syncKind = useSyncStatus().kind;

  if (view === 'about') return <Sub title="About the rules" onBack={() => setView('main')}><div className="bubble set-group"><AboutRules /></div></Sub>;
  if (view === 'switch') return <SwitchPhase program={program} onBack={() => setView('main')} />;
  if (view === 'restart') return <RestartLinear program={program} onBack={() => setView('main')} />;

  return (
    <div className="page">
      <Mantra />
      <div className="section">
        <button className="btn-link" style={{ paddingLeft: 0 }} onClick={onBack}>← Home</button>
        <h2 style={{ margin: '4px 0' }}>Settings</h2>
        <div className="small">Changes apply to workouts you log from now on. Past workouts keep the weights you actually lifted.</div>
      </div>

      <Group title="Lifting">
        <div className="set-row"><span className="set-label">Unit</span><span className="set-val">lb</span></div>
        {ALL_LIFTS.map((l) => (
          <NumRow key={l} label={`${LIFT_NAME[l]} bar`} value={s.barWeights[l]} step={5} min={15} max={65} onChange={(n) => set({ barWeights: { ...s.barWeights, [l]: n } })} />
        ))}
        <div className="set-block">
          <div className="set-label">Plates I own</div>
          <div className="template-row">
            {PLATE_CHOICES.map((p) => {
              const on = s.platesOwned.includes(p);
              return (
                <button key={p} className={`pill${on ? ' on' : ''}`} aria-pressed={on}
                  onClick={() => set({ platesOwned: on ? s.platesOwned.filter((x) => x !== p) : [...s.platesOwned, p].sort((a, b) => b - a) })}>
                  {p}
                </button>
              );
            })}
          </div>
        </div>
        <div className="set-row">
          <span className="set-label">I own 1.25 lb microplates</span>
          <button className={`pill${s.microplates ? ' on' : ''}`} aria-pressed={s.microplates} onClick={() => set({ microplates: !s.microplates })}>{s.microplates ? 'On' : 'Off'}</button>
        </div>
      </Group>

      <Group title="5x5 (Linear Phase)">
        <NumRow label="Retries before deload" value={s.retriesBeforeDeload} step={1} min={2} max={5} onChange={(n) => set({ retriesBeforeDeload: n })} />
        <NumRow label="Deload amount" value={Math.round(s.deloadPercent * 100)} step={5} min={5} max={20} suffix="%" onChange={(n) => set({ deloadPercent: n / 100 })} />
        <Pills label="Layout" value={s.linearLayout} onChange={(v) => set({ linearLayout: v })}
          options={[['stronglifts', 'StrongLifts (default)'], ['deadlift_every_session', 'Deadlift every session']]} />
      </Group>

      <Group title="5/3/1">
        <NumRow label="Training max %" value={Math.round(s.tmPercent * 100)} step={5} min={80} max={90} suffix="%" onChange={(n) => set({ tmPercent: n / 100 })} />
        <Pills label="Lifts per session" value={s.liftsPerSession} onChange={(v) => set({ liftsPerSession: v })} options={[[1, 'One'], [2, 'Two']]} />
        <Pills label="Extra work" value={s.template} onChange={(v) => set({ template: v })} options={[['minimalist', 'None'], ['fsl', 'FSL 5×5'], ['bbb', 'BBB 5×10']]} />
        <NumRow label="BBB % of TM" value={Math.round(s.bbbPercent * 100)} step={5} min={40} max={60} suffix="%" onChange={(n) => set({ bbbPercent: n / 100 })} />
        <Pills label="7th week deload style" value={s.deloadStyle} onChange={(v) => set({ deloadStyle: v })} options={[['forever', 'Forever deload'], ['light', 'Light deload']]} />
      </Group>

      <ShoulderGroups program={program} set={set} />

      <Group title="Rest timer">
        <NumRow label="After warm-up sets" value={s.restSeconds.warmup} step={15} min={0} max={600} suffix="s" onChange={(n) => set({ restSeconds: { ...s.restSeconds, warmup: n } })} />
        <NumRow label="After work sets" value={s.restSeconds.work} step={15} min={0} max={600} suffix="s" onChange={(n) => set({ restSeconds: { ...s.restSeconds, work: n } })} />
        <NumRow label="After extra sets" value={s.restSeconds.supplemental} step={15} min={0} max={600} suffix="s" onChange={(n) => set({ restSeconds: { ...s.restSeconds, supplemental: n } })} />
      </Group>

      <Group title="Program">
        <div className="set-row">
          <span className="set-label">Current phase</span>
          <span className="set-val">{program.state.phase === 'linear' ? 'Linear' : '5/3/1'}</span>
        </div>
        <button className="btn-link" onClick={() => setView('switch')}>
          {program.state.phase === 'linear' ? 'Switch to 5/3/1…' : 'Switch back to linear…'}
        </button>
        <button className="btn-link" onClick={() => setView('restart')}>Restart linear phase…</button>
      </Group>

      <TrackGroup program={program} />

      <Group title="Sync">
        <label className="set-label" htmlFor="tok">Sync token</label>
        <input id="tok" className="text-in" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste your token" />
        <button className="btn-link" style={{ paddingLeft: 0 }} onClick={() => { setSyncToken(token.trim()); setMsg('Token saved on this phone.'); void syncNow(); }}>Save token</button>
        <div className="small" role="status">{syncLine}</div>
        <button className="btn-link" style={{ paddingLeft: 0 }} disabled={syncKind === 'syncing'} onClick={() => void syncNow()}>Sync now</button>
      </Group>

      <DataGroup program={program} setMsg={setMsg} />
      {msg && <div className="bubble set-group" role="status" style={{ fontWeight: 700 }}>{msg}</div>}

      <div className="section"><button className="btn-link" style={{ paddingLeft: 0 }} onClick={() => setView('about')}>About the rules</button></div>
    </div>
  );
}

function Sub({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="page">
      <Mantra />
      <div className="section">
        <button className="btn-link" style={{ paddingLeft: 0 }} onClick={onBack}>← Settings</button>
        <h2 style={{ margin: '4px 0' }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function DataGroup({ program, setMsg }: { program: Program; setMsg: (m: string | null) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const exportCsv = async () => {
    const { settings, sessions, decisions } = await loadEverything();
    await shareOrDownload(csvFilename(), 'text/csv', buildCsv(settings, sessions, decisions));
    setMsg('CSV exported.');
  };
  const downloadBackup = async () => {
    const { settings, sessions, decisions } = await loadEverything();
    await shareOrDownload(backupFilename(), 'application/json', JSON.stringify(makeBackup(settings, sessions, decisions), null, 2));
    setMsg('Backup saved.');
  };
  const onFile = async (f: File | undefined) => {
    setErrors([]);
    setPending(null);
    if (!f) return;
    let raw: unknown;
    try {
      raw = JSON.parse(await f.text());
    } catch {
      return setErrors(['That file is not valid JSON.']);
    }
    const r = validateBackup(raw);
    if (r.ok) setPending(r.data);
    else setErrors(r.errors);
  };

  return (
    <Group title="Your data">
      <button className="btn-link" onClick={() => void exportCsv()}>Export CSV</button>
      <button className="btn-link" onClick={() => void downloadBackup()}>Download backup (JSON)</button>
      <button className="btn-link" onClick={() => file.current?.click()}>Restore from backup (JSON)…</button>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      {errors.length > 0 && (
        <div className="banner" role="alert"><div>Nothing was changed. This backup can&apos;t be used:<ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul></div></div>
      )}
      {pending && (
        <div className="banner" role="alertdialog">
          <div>
            <div>Restoring replaces everything on this phone with {pending.sessions.filter((x) => x.finishedAt && !x.deleted).length} workouts from {new Date(pending.exportedAt).toLocaleDateString()}. Current data on this phone ({program.sessions.filter((x) => x.finishedAt && !x.deleted).length} workouts) will be overwritten.</div>
            <div className="banner-actions">
              <button className="banner-btn" onClick={async () => { await restoreBackup(pending); setPending(null); setMsg('Backup restored.'); }}>Replace my data</button>
              <button className="banner-btn" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </Group>
  );
}

function SwitchPhase({ program, onBack }: { program: Program; onBack: () => void }) {
  const to = program.state.phase === 'linear' ? '531' : 'linear';
  const proposed = computeTrainingMaxes(program.settings, program.sessions);
  const [tms, setTms] = useState<Record<MainLift, number>>(proposed);
  const step = program.settings.microplates ? 2.5 : 5;

  return (
    <Sub title={to === '531' ? 'Switch to 5/3/1' : 'Switch back to linear'} onBack={onBack}>
      <div className="bubble set-group">
        {to === '531' ? (
          <>
            <p style={{ marginTop: 0 }}>Your training maxes, from your best recent sets. Adjust any of them before switching.</p>
            {MAIN_LIFTS.map((l) => (
              <NumRow key={l} label={LIFT_NAME[l]} value={tms[l]} step={step} min={program.settings.barWeights[l]} max={1000} onChange={(n) => setTms({ ...tms, [l]: n })} />
            ))}
          </>
        ) : (
          <p style={{ marginTop: 0 }}>Back to linear progression, picking up where each lift left off. Your 5/3/1 history is kept.</p>
        )}
        <button className="btn" onClick={async () => { await switchPhase(to, to === '531' ? tms : undefined); onBack(); }}>
          {to === '531' ? 'Switch to 5/3/1' : 'Switch to linear'}
        </button>
        <button className="btn-link" onClick={onBack}>Cancel</button>
      </div>
    </Sub>
  );
}

function RestartLinear({ program, onBack }: { program: Program; onBack: () => void }) {
  const s = program.settings;
  const initial = {} as Record<Lift, number>;
  for (const l of ALL_LIFTS) initial[l] = roundToPlates(program.state.linear[l].weight * 0.6, s, l, 'down');
  const [w, setW] = useState(initial);
  const step = s.microplates ? 2.5 : 5;

  return (
    <Sub title="Restart linear phase" onBack={onBack}>
      <div className="bubble set-group">
        <p style={{ marginTop: 0 }}>New starting weights, prefilled at 60% of your last working weights. All your history is kept.</p>
        {ALL_LIFTS.map((l) => (
          <NumRow key={l} label={LIFT_NAME[l]} value={w[l]} step={step} min={s.barWeights[l]} max={1000} onChange={(n) => setW({ ...w, [l]: n })} />
        ))}
        <button className="btn" onClick={async () => { await restartLinear(w); onBack(); }}>Restart linear phase</button>
        <button className="btn-link" onClick={onBack}>Cancel</button>
      </div>
    </Sub>
  );
}
