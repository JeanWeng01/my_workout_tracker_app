/** Green-circle-with-a-check "complete" button. Grey until the set is done. */
export function CheckButton({ done, label, onClick }: { done: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`check${done ? ' on' : ''}`} aria-pressed={done} aria-label={label} onClick={onClick}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10.5" fill="currentColor" className="check-fill" />
        <path d="M7 12.5l3.2 3.2L17 8.8" stroke={done ? '#fff' : 'currentColor'} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
