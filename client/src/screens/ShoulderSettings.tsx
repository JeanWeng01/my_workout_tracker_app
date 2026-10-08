import { useState } from 'react';
import { changeTrack, resumeLift } from '../data/store';
import type { Program } from '../data/useProgram';
import { computeTrainingMaxes, fmtWeight, LIFT_NAME, MAIN_LIFTS, REHAB_OF, type ExerciseId, type MainLift, type Settings, type Track } from '../engine';
import { Group, NumList, NumRow, Pills } from './SettingsWidgets';

type Patch = (p: Partial<Settings>) => void;

const TRACKED_CHOICES: [ExerciseId, string][] = [
  ['db_floor_press', 'DB floor press'],
  ['seated_db_ohp', 'Seated DB OHP'],
  ['bench', 'Bench'],
  ['ohp', 'OHP'],
  ['row', 'Row'],
  ['squat', 'Squat'],
  ['deadlift', 'Deadlift'],
];

const TRACK_NAME: Record<Track, string> = { rehab: 'Shoulder rehab (dumbbells)', linear: 'Barbell, linear', '531': '5/3/1' };

/** Shoulder check, rehab ladders and accessories. Everything here is a setting, not hard-coded. */
export function ShoulderGroups({ program, set }: { program: Program; set: Patch }) {
  const s = program.settings;
  const sh = s.shoulder;
  const setShoulder = (p: Partial<Settings['shoulder']>) => set({ shoulder: { ...sh, ...p } });
  const setRehab = (p: Partial<Settings['rehab']>) => set({ rehab: { ...s.rehab, ...p } });
  const setAcc = (p: Partial<Settings['accessories']>) => set({ accessories: { ...s.accessories, ...p } });

  return (
    <>
      <Group title="Shoulder check">
        <div className="set-row">
          <span className="set-label">Shoulder tracking</span>
          <button className={`pill${sh.tracking ? ' on' : ''}`} aria-pressed={sh.tracking} onClick={() => setShoulder({ tracking: !sh.tracking })}>
            {sh.tracking ? 'On' : 'Off'}
          </button>
        </div>
        <div className="set-block">
          <div className="set-label">Lifts that get a shoulder rating</div>
          <div className="template-row">
            {TRACKED_CHOICES.map(([id, name]) => {
              const on = sh.tracked.includes(id);
              return (
                <button
                  key={id}
                  className={`pill${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => setShoulder({ tracked: on ? sh.tracked.filter((x) => x !== id) : [...sh.tracked, id] })}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
        <NumRow label="Green up to" value={sh.greenMax} step={1} min={0} max={Math.min(8, sh.amberMax - 1)} onChange={(n) => setShoulder({ greenMax: n })} />
        <NumRow label="Amber up to" value={sh.amberMax} step={1} min={sh.greenMax + 1} max={9} onChange={(n) => setShoulder({ amberMax: n })} />
        <div className="small">
          Green 0–{sh.greenMax} (OK), amber {sh.greenMax + 1}–{sh.amberMax} (Caution), red {sh.amberMax + 1}+ or &quot;sharp / pinching&quot; (Stop).
        </div>
      </Group>

      <Group title="Shoulder rehab (dumbbells)">
        <NumRow label="Sets" value={s.rehab.sets} step={1} min={1} max={6} onChange={(n) => setRehab({ sets: n })} />
        <NumList label="Rep steps" value={s.rehab.repSteps} onChange={(v) => setRehab({ repSteps: v })} hint="Reps climb in this order before the weight goes up." />
        <NumList
          label="DB floor press ladder (lb per hand)"
          value={s.rehab.ladders.db_floor_press}
          onChange={(v) => setRehab({ ladders: { ...s.rehab.ladders, db_floor_press: v } })}
          hint="Match your gym's dumbbell rack. Edits change what comes next, never your history."
        />
        <NumList
          label="Seated DB OHP ladder (lb per hand)"
          value={s.rehab.ladders.seated_db_ohp}
          onChange={(v) => setRehab({ ladders: { ...s.rehab.ladders, seated_db_ohp: v } })}
        />
        <NumRow label="Bench returns at" value={s.rehab.returnWeights.bench} step={5} min={45} max={225} suffix=" lb" onChange={(n) => setRehab({ returnWeights: { ...s.rehab.returnWeights, bench: n } })} />
        <NumRow label="OHP returns at" value={s.rehab.returnWeights.ohp} step={5} min={45} max={225} suffix=" lb" onChange={(n) => setRehab({ returnWeights: { ...s.rehab.returnWeights, ohp: n } })} />
      </Group>

      <Group title="Shoulder accessories">
        <NumRow label="Sets while on rehab" value={s.accessories.rehabSets} step={1} min={1} max={5} onChange={(n) => setAcc({ rehabSets: n })} />
        <NumRow label="Sets for maintenance" value={s.accessories.maintenanceSets} step={1} min={1} max={5} onChange={(n) => setAcc({ maintenanceSets: n })} />
        <NumList label="Rep steps" value={s.accessories.repSteps} onChange={(v) => setAcc({ repSteps: v })} />
        <NumList
          label="Side-lying external rotation ladder (lb)"
          value={s.accessories.ladders.side_lying_er}
          onChange={(v) => setAcc({ ladders: { ...s.accessories.ladders, side_lying_er: v } })}
        />
        <NumList
          label="Scaption ladder (lb)"
          value={s.accessories.ladders.db_scaption}
          onChange={(v) => setAcc({ ladders: { ...s.accessories.ladders, db_scaption: v } })}
        />
      </Group>
    </>
  );
}

/** Per-lift track override (either direction) and resuming paused lifts. */
export function TrackGroup({ program }: { program: Program }) {
  const { state, settings, sessions } = program;
  const [pending, setPending] = useState<{ lift: MainLift; to: Track } | null>(null);
  const paused = MAIN_LIFTS.filter((l) => state.paused[l]);

  const optionsFor = (lift: MainLift): [Track, string][] => {
    const out: [Track, string][] = [];
    if (lift === 'bench' || lift === 'ohp') out.push(['rehab', 'Shoulder rehab']);
    out.push(['linear', 'Barbell']);
    if (state.phase === '531') out.push(['531', '5/3/1']);
    return out;
  };

  /** What the change will start at, shown before confirming and sent as the starting weight. */
  const startFor = (lift: MainLift, to: Track): number => {
    if (to === 'rehab') return settings.rehab.ladders[REHAB_OF[lift as 'bench' | 'ohp']][0];
    if (to === 'linear') return lift === 'bench' || lift === 'ohp' ? settings.rehab.returnWeights[lift] : state.linear[lift].weight;
    return computeTrainingMaxes(settings, sessions)[lift];
  };

  const describe = (lift: MainLift, to: Track): string => {
    const name = LIFT_NAME[lift];
    const w = startFor(lift, to);
    if (to === 'rehab') return `Move ${name} to shoulder rehab? It starts at 2 × ${fmtWeight(w)} lb for ${settings.rehab.sets} × ${settings.rehab.repSteps[0]}. Your barbell history stays.`;
    if (to === 'linear') return `Put ${name} on the barbell at ${w} lb, starting fresh linear progression?`;
    return `Put ${name} on 5/3/1 with a training max of ${w}?`;
  };

  return (
    <Group title="Lift tracks">
      {MAIN_LIFTS.map((lift) => (
        <Pills
          key={lift}
          label={`${LIFT_NAME[lift]}: ${TRACK_NAME[state.track[lift]]}${state.paused[lift] ? ' · paused' : ''}`}
          value={state.track[lift]}
          options={optionsFor(lift)}
          onChange={(to) => to !== state.track[lift] && setPending({ lift, to })}
        />
      ))}
      {pending && (
        <div className="banner" role="alertdialog">
          <div>
            <div>{describe(pending.lift, pending.to)}</div>
            <div className="banner-actions">
              <button
                className="banner-btn"
                onClick={async () => {
                  await changeTrack(pending.lift, pending.to, startFor(pending.lift, pending.to));
                  setPending(null);
                }}
              >
                Confirm
              </button>
              <button className="banner-btn" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {paused.map((lift) => (
        <div className="set-row" key={lift}>
          <span className="set-label">{LIFT_NAME[lift]} is paused</span>
          <button className="pill" onClick={() => void resumeLift(lift)}>Resume</button>
        </div>
      ))}
    </Group>
  );
}
