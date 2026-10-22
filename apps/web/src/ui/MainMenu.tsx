import { DIFFICULTIES, type Difficulty, type TerrainOptions } from '@city/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStrings } from '../i18n';
import type { GameSession } from '../state/session';
import { useStore } from '../state/store';
import { LocaleSelect } from './LocaleSelect';
import { Logo } from './Logo';
import { StudioMark } from './StudioMark';

const SIZES = [64, 96, 128] as const;

function randomSeed(): string {
  return Math.floor(Math.random() * 1_000_000).toString(36);
}

export function MainMenu({ session, extra }: { session: GameSession; extra?: ReactNode }) {
  const t = useStrings(session.ui);
  const m = t.menu;
  const [name, setName] = useState<string>(m.defaultCityName);
  const defaultName = useRef(m.defaultCityName);
  useEffect(() => {
    if (name === defaultName.current || name.trim() === '') setName(m.defaultCityName);
    defaultName.current = m.defaultCityName;
  }, [m.defaultCityName, name]);
  const [seed, setSeed] = useState(randomSeed);
  const [size, setSize] = useState<number>(128);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [terrain, setTerrain] = useState<TerrainOptions>({
    water: 0.14,
    hills: 0.5,
    forest: 0.35,
    rivers: 1,
  });
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      await session.startCity({
        name: name.trim() || m.defaultCityName,
        seed: seed.trim() || randomSeed(),
        size,
        difficulty,
        terrain,
      });
    } finally {
      setBusy(false);
    }
  };

  const slider = (key: 'water' | 'hills' | 'forest', label: string, max: number) => (
    <label className="field slider-field">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={0.01}
        value={terrain[key]}
        data-testid={`terrain-${key}`}
        onChange={(e) => setTerrain({ ...terrain, [key]: Number(e.target.value) })}
      />
    </label>
  );

  return (
    <div className="main-menu" data-testid="main-menu">
      <div className="menu-chrome">
        <StudioMark placement="menu" />
        <div className="menu-chrome-actions">
          <LocaleSelect session={session} className="menu-locale" />
          <SoundToggle session={session} />
        </div>
      </div>
      <div className="menu-card">
        <h1 className="menu-title">
          <Logo />
        </h1>
        <p className="muted">{m.subtitle}</p>
        <form
          className="menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <label className="field">
            <span>{m.cityName}</span>
            <input
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              data-testid="city-name-input"
            />
          </label>
          <label className="field">
            <span>{m.seed}</span>
            <span className="row">
              <input
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                data-testid="seed-input"
              />
              <button type="button" className="button" onClick={() => setSeed(randomSeed())}>
                {m.randomSeed}
              </button>
            </span>
          </label>
          <div className="field-row">
            <label className="field">
              <span>{m.mapSize}</span>
              <select
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                data-testid="size-select"
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {m.sizes[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{m.difficulty}</span>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                data-testid="difficulty-select"
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {m.difficulties[d]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="terrain-fields">
            <legend>{m.terrain}</legend>
            {slider('water', m.water, 0.4)}
            {slider('hills', m.hills, 1)}
            {slider('forest', m.forest, 0.8)}
            <label className="field slider-field">
              <span>{m.rivers}</span>
              <input
                type="range"
                min={0}
                max={3}
                step={1}
                value={terrain.rivers}
                onChange={(e) => setTerrain({ ...terrain, rivers: Number(e.target.value) })}
              />
            </label>
          </fieldset>
          <div className="menu-actions">
            <button
              type="submit"
              className="button primary"
              disabled={busy}
              data-testid="start-city"
            >
              {m.start}
            </button>
          </div>
        </form>
        {extra}
        <p className="muted small">{m.credits}</p>
      </div>
    </div>
  );
}

/** Speaker button: the menu has no system panel and the M shortcut only works in game. */
function SoundToggle({ session }: { session: GameSession }) {
  const t = useStrings(session.ui);
  const muted = useStore(session.ui, (s) => s.muted);
  const label = muted ? t.menu.soundOff : t.menu.soundOn;
  return (
    <button
      type="button"
      className="button menu-sound"
      onClick={() => session.setMuted(!muted)}
      title={label}
      aria-label={label}
      aria-pressed={!muted}
      data-testid="menu-sound"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
        {muted ? (
          <path
            d="M16 9l5 6M21 9l-5 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : (
          <path
            d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
        )}
      </svg>
    </button>
  );
}
