// R6 — shared loading placeholder: pulsing bars instead of a bare "…".
export function SkeletonBlock({ lines = 3 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-2" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-3 rounded bg-muted"
          style={{ width: `${85 - i * 15}%` }}
        />
      ))}
    </div>
  );
}
