import { ZONE_LABEL, zoneOfRating, type PainRating, type ShoulderSettings } from '../engine';

/**
 * One 0–10 rating per lift per session, plus a "Sharp / pinching" toggle. The selected chip takes the zone's colour, and the
 * zone's name sits next to the label, so colour is never the only signal.
 */
export function ShoulderRow({ pain, shoulder, onChange }: { pain: PainRating | undefined; shoulder: ShoulderSettings; onChange: (p: PainRating | null) => void }) {
  const zone = pain ? zoneOfRating(pain, shoulder) : null;
  return (
    <div className="shoulder">
      <div className="shoulder-head">
        <span className="set-label">Shoulder</span>
        {zone && <span className={`zone zone-${zone}`}>{ZONE_LABEL[zone]}</span>}
      </div>
      <div className="rating-chips" role="group" aria-label="Shoulder rating, 0 to 10">
        {Array.from({ length: 11 }, (_, n) => {
          const on = pain?.rating === n;
          const z = zoneOfRating({ rating: n, sharp: false }, shoulder);
          return (
            <button
              key={n}
              className={`rate z-${z}${on ? ' on' : ''}`}
              aria-pressed={on}
              aria-label={`Shoulder ${n}`}
              onClick={() => onChange(on ? null : { rating: n, sharp: pain?.sharp ?? false })}
            >
              {n}
            </button>
          );
        })}
      </div>
      <button
        className={`pill sharp${pain?.sharp ? ' on' : ''}`}
        aria-pressed={pain?.sharp ?? false}
        disabled={!pain}
        onClick={() => pain && onChange({ ...pain, sharp: !pain.sharp })}
      >
        Sharp / pinching
      </button>
    </div>
  );
}
