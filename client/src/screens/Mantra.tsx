import type { ReactNode } from 'react';

export function Mantra({ children }: { children?: ReactNode }) {
  return (
    <div className="mantra-band">
      {children}
      <h1 className="mantra">
        <span>Ego lifts</span>
        <span>are for idiots</span>
      </h1>
    </div>
  );
}
