# AGENTS.md

Guidance for AI agents and humans working on this repository.

## Mission

Build Urbe, an original isometric city builder inspired by the mechanics of classic city
simulators, playable in the browser. The player creates conditions; the simulator decides the outcome.

## Golden rules

1. The simulation (`packages/simulation`) is pure TypeScript: no DOM, no Node APIs, no
   wall-clock time, no `Math.random`, no transcendental `Math` functions. Lint and type check
   enforce this.
2. React components never contain economic or growth rules. They send commands and read state.
3. The renderer never mutates simulation state.
4. Every random decision uses the engine RNG, in a deterministic order.
5. Constants belong in `packages/shared/src/balance/balance.ts`, formulas in
   `docs/simulation-spec.md`, and their provenance in `docs/mechanics-matrix.md`.
6. Do not copy code, sprites, sounds or names from SimCity, Micropolis (GPLv3) or OpenSC2K.
   Study them in `references/` (git-ignored) and write independent code.
7. Code, comments, technical docs, commit messages and pull requests (title and
   body) are in English. Player-facing text lives in `apps/web/src/i18n/`
   (`en`, `pt-BR`, `es`, `fr`, `de`). English is the type source.
   The first visit follows the browser language (or English); the choice is persisted
   in `localStorage.cityBuilder.locale`.

## Commands

```sh
pnpm install          # install dependencies
pnpm dev              # dev server on http://localhost:5173
pnpm lint             # ESLint
pnpm typecheck        # tsc for every package
pnpm test             # unit + integration tests (Vitest)
pnpm test:simulation  # long scenario tests (Vitest)
pnpm test:e2e         # Playwright (builds and serves the app)
pnpm build            # production build of apps/web
pnpm desktop          # Electron window; separate BASE_PATH=./ build, Pages unchanged
pnpm sim --preset balanced --months 120 --seeds 1,2,3   # headless JSON reports
pnpm sim --list       # simulation presets
pnpm bench            # tick timing benchmark (128×128 grid city); --strict fails on budgets
pnpm check            # lint + typecheck + test + test:simulation + build
```

Reports go to `reports/` (git-ignored). `docs/balancing.md` holds the reference results; after
changing a rule or constant, rerun the presets and the benchmark and update it.

Docker: `docker compose up` serves the dev build on port 5173.

## Work loop

1. Read the phase in `docs/roadmap.md` and the relevant section of `docs/simulation-spec.md`.
2. Inspect the existing code before adding new modules.
3. Make a small, testable change.
4. Run `pnpm check`; for UI changes also run `pnpm test:e2e`.
5. Run a headless report (`pnpm sim`) when the change touches the simulation and compare the
   key metrics with the previous run.
6. Fix regressions before moving on.
7. Commit with a descriptive English message (conventional commits: `feat:`, `fix:`, `test:`...).
   Open pull requests in English (title and body).
8. Update docs when a rule or constant changes.

Never declare a feature done just because it compiles.

## Layout

```
apps/desktop/   Electron shell. Serves apps/desktop/www over urbe://app. No city rules.
snap/           snapcraft.yaml, desktop entry, icon, and the store banner
apps/web/src/
  renderer/   Pixi isometric renderer, camera, picking, procedural sprites, overlays,
              animation/ (cosmetic cars, smoke, water glints, fire engines)
  tools/      Tool definitions and the pointer-to-command controller
  ui/         React screens and panels: boot screen, logo, menu, HUD, pause overlay,
              toolbar, minimap, budget, charts, overlays, inspector ("why is it not
              growing"), tutorial, toasts
  state/      GameSession (UI store, panels, tutorial), CityClient (worker bridge +
              mirror world), debug hooks used by Playwright
  worker/     Web Worker host for the engine
  audio/      Synthesized WebAudio sound effects and procedural music: composer.ts
              (pure bar generator) and music.ts (scheduler and voices); no audio files
  i18n/       Player catalogs (en type source, pt-BR, es, fr, de), resolveLocale,
              useStrings, money/number formatters
packages/simulation/src/
  world/ terrain/ commands/ systems/ persistence/ scenarios/ rng/
  scenarios/presets.ts  scripted cities for `pnpm sim` and `pnpm bench`
  engine.ts      orchestration and the tick pipeline (month staged over four ticks)
  time.ts        calendar and monthStage()
  diagnostics.ts diagnoseTile(), shared by the engine and the UI inspector
  report.ts      collectMetrics() for scenario and headless reports
packages/shared/src/
  types/ commands/ balance/ schemas/ protocol/ util/
tests/{unit,scenarios,e2e,helpers}
tools/{headless-sim.ts,benchmark.ts,desktop-smoke.ts}
```

UI conventions: every interactive element that tests touch has a `data-testid`; E2E helpers in
`tests/e2e/helpers.ts` start a city through the main menu and hide the tutorial unless asked.
The UI only reads the mirror world and `CityStats`; anything that needs a rule (diagnostics,
previews) calls a pure function exported by `@city/simulation`.

## Definition of done

- Behaviour covered by tests at the right layer (unit for rules, scenario for emergent effects).
- `pnpm check` green, E2E green for UI changes.
- No new dependency without a written reason in the commit message.
- Docs updated.
