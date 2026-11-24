import { useStrings } from '../i18n';
import { useCoarsePointer } from '../pointer';
import type { GameSession } from '../state/session';
import { useStore } from '../state/store';

/** Paused state: a soft vignette and a badge. Purely visual, the map stays interactive. */
export function PauseOverlay({ session }: { session: GameSession }) {
  const t = useStrings(session.ui);
  const coarse = useCoarsePointer();
  const paused = useStore(session.ui, (s) => s.speed === 0);
  if (!paused) return null;
  return (
    <div className="pause-overlay" data-testid="pause-overlay" aria-live="polite">
      <div className="paused-banner" role="status">
        <strong>{t.hud.paused}</strong>
        <span>{coarse ? t.hud.pausedHintTouch : t.hud.pausedHint}</span>
      </div>
    </div>
  );
}
