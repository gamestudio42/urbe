import { BALANCE, type BuildingRecord, type Speed } from '@city/shared';
import type { World } from '@city/simulation';
import { Application, Container, Graphics } from 'pixi.js';
import {
  AnimationLayer,
  type AnimationStats,
  type HubSample,
  type VehicleSample,
} from './animation/AnimationLayer';
import { Camera } from './camera';
import {
  buildObjects,
  drawGround,
  drawOverlay,
  drawRoads,
  drawWires,
  type ChunkArea,
  type DrawContext,
  type OverlayMode,
} from './chunkDraw';
import { prefersReducedMotion } from '../motion';
import { HEIGHT_STEP, pickTile, tileCenter, tileQuad, vertexToScreen, type Point } from './iso';
import { SpriteFactory } from './sprites';
import { TouchGestures, type TouchEffect } from './touchGestures';

export const CHUNK_SIZE = 16;
const REDRAW_BUDGET = 12;
/** Menu background camera: zoom, seconds per loop and loop radius as a fraction of the map. */
const ATTRACT_ZOOM = 0.9;
const ATTRACT_PERIOD_S = 150;
const ATTRACT_RADIUS = 0.16;
/** Start of the loop, also the fixed view when the system asks for reduced motion. */
const ATTRACT_START = 0.6;

function layer<T extends Container>(container: T, label: string): T {
  container.label = label;
  return container;
}

interface Chunk {
  area: ChunkArea;
  root: Container;
  ground: Graphics;
  water: Container;
  /** Animated boats, under the road layer so they slip beneath a bridge deck. */
  boats: Container;
  roads: Graphics;
  overlay: Graphics;
  vehicles: Container;
  objects: Container;
  wires: Graphics;
  bounds: { x: number; y: number; width: number; height: number };
  dirty: boolean;
  overlayDirty: boolean;
  hasFire: boolean;
}

export interface HighlightTile {
  x: number;
  y: number;
  state: 'ok' | 'bad' | 'neutral';
}

const HIGHLIGHT_COLORS = {
  ok: { fill: 0x60e070, stroke: 0xa0ffb0 },
  bad: { fill: 0xe05050, stroke: 0xff9090 },
  neutral: { fill: 0xc0c8d0, stroke: 0xe8eef6 },
} as const;

export interface RendererInput {
  /** Called with tile coordinates (or null) on left-button events and on a touch tap. */
  onPointer?(kind: 'down' | 'move' | 'up', tile: Point | null, event: PointerEvent): void;
  onHover?(tile: Point | null): void;
  onCamera?(): void;
}

/** PixiJS isometric renderer for the mirror world. Never mutates simulation state. */
export class GameRenderer {
  readonly app = new Application();
  readonly camera = new Camera();
  private readonly root = new Container();
  private readonly chunkLayer = new Container();
  private readonly highlight = new Graphics();
  private chunks: Chunk[] = [];
  private chunksPerSide = 0;
  private factory: SpriteFactory | null = null;
  private animation: AnimationLayer | null = null;
  private animationsEnabled = true;
  private simSpeed: Speed = 1;
  private world: World | null = null;
  private buildings: Map<number, BuildingRecord> = new Map();
  private overlay: OverlayMode = 'none';
  private underground = false;
  private grid = false;
  private animationFrame = 0;
  private animationTimer = 0;
  private highlightTiles: HighlightTile[] = [];
  private hoverTile: Point | null = null;
  private highlightDirty = false;
  private input: RendererInput = {};
  private panning: { x: number; y: number } | null = null;
  /** One-finger pan, tap, and two-finger pinch. Mouse pointers never reach it. */
  private readonly touches = new TouchGestures();
  private readonly listeners = new AbortController();
  private readonly keys = new Set<string>();
  /** Seconds into the menu camera loop, or null outside the menu. */
  private attract: { time: number; still: boolean } | null = null;
  private initialized = false;
  private destroyed = false;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: 0x1d2a38,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: 'webgl',
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    host.appendChild(this.app.canvas);
    this.app.canvas.classList.add('game-canvas');
    this.factory = new SpriteFactory(this.app.renderer);
    this.animation = new AnimationLayer(this.factory);
    this.animation.setEnabled(this.animationsEnabled);
    this.animation.setSpeed(this.simSpeed);
    this.root.addChild(this.chunkLayer, this.animation.smoke, this.animation.sky, this.highlight);
    this.app.stage.addChild(this.root);
    this.attachInput(this.app.canvas);
    this.app.ticker.add(() => this.frame());
    this.app.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('city:contextlost'));
    });
    this.initialized = true;
    if (this.world) this.setWorld(this.world, this.buildings);
  }

  setInput(input: RendererInput): void {
    this.input = input;
  }

  get fps(): number {
    return this.app.ticker?.FPS ?? 0;
  }

  /** Simulation speed, so animations freeze while paused and hurry at 2× and 3×. */
  setSimSpeed(speed: Speed): void {
    this.simSpeed = speed;
    this.animation?.setSpeed(speed);
  }

  setAnimations(on: boolean): void {
    this.animationsEnabled = on;
    this.animation?.setEnabled(on);
  }

  animationStats(): AnimationStats {
    return (
      this.animation?.stats() ?? { cars: 0, trucks: 0, puffs: 0, sparkles: 0, boats: 0, planes: 0 }
    );
  }

  vehicleSample(): VehicleSample[] {
    return this.animation?.sample() ?? [];
  }

  hubSample(): HubSample[] {
    return this.animation?.hubSample() ?? [];
  }

  /** Back-to-front labels of a map chunk. Tests lock boats under the road/bridge layer. */
  chunkStack(): string[] {
    const chunk = this.chunks[0];
    return chunk ? chunk.root.children.map((child) => child.label) : [];
  }

  reportFire(x: number, y: number): void {
    this.animation?.reportFire(x, y);
  }

  /**
   * Menu background mode: keyboard panning is ignored and the camera drifts slowly around the
   * map centre (held still when the system asks for reduced motion).
   */
  setAttract(on: boolean): void {
    if (on === (this.attract !== null)) return;
    if (on) {
      this.attract = { time: 0, still: prefersReducedMotion() };
      this.keys.clear();
      this.panning = null;
      this.touches.reset();
      this.setHover(null);
    } else {
      this.attract = null;
      this.camera.zoom = 1;
    }
  }

  get attractMode(): boolean {
    return this.attract !== null;
  }

  setWorld(world: World, buildings: Map<number, BuildingRecord>): void {
    this.world = world;
    this.buildings = buildings;
    if (!this.initialized) return;
    for (const c of this.chunks) c.root.destroy({ children: true });
    this.chunks = [];
    this.chunkLayer.removeChildren();
    this.chunksPerSide = Math.ceil(world.size / CHUNK_SIZE);
    const order: Chunk[] = [];
    for (let cy = 0; cy < this.chunksPerSide; cy++) {
      for (let cx = 0; cx < this.chunksPerSide; cx++) {
        const area = {
          x0: cx * CHUNK_SIZE,
          y0: cy * CHUNK_SIZE,
          x1: Math.min(world.size, (cx + 1) * CHUNK_SIZE),
          y1: Math.min(world.size, (cy + 1) * CHUNK_SIZE),
        };
        const chunk: Chunk = {
          area,
          root: new Container(),
          ground: layer(new Graphics(), 'ground'),
          water: layer(new Container(), 'water'),
          boats: layer(new Container({ sortableChildren: true }), 'boats'),
          roads: layer(new Graphics(), 'roads'),
          overlay: layer(new Graphics(), 'overlay'),
          vehicles: layer(new Container({ sortableChildren: true }), 'vehicles'),
          objects: layer(new Container(), 'objects'),
          wires: layer(new Graphics(), 'wires'),
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          dirty: true,
          overlayDirty: true,
          hasFire: false,
        };
        // Boats on a span sit under roads; boats in open water sit with the cars,
        // so a hull in front of a bridge is not painted under the deck. Cars stay
        // under objects so a building in front of a street hides them.
        chunk.root.addChild(
          chunk.ground,
          chunk.water,
          chunk.boats,
          chunk.roads,
          chunk.overlay,
          chunk.vehicles,
          chunk.objects,
          chunk.wires,
        );
        this.chunks.push(chunk);
        order.push(chunk);
      }
    }
    // Back-to-front by chunk diagonal.
    order.sort((a, b) => a.area.x0 + a.area.y0 - (b.area.x0 + b.area.y0) || a.area.x0 - b.area.x0);
    for (const c of order) this.chunkLayer.addChild(c.root);
    for (const c of this.chunks) this.computeBounds(c);
    this.animation?.setWorld(world, buildings, this.chunks, (x, y) => this.chunkAt(x, y));

    const left = vertexToScreen(0, world.size, 0);
    const right = vertexToScreen(world.size, 0, 0);
    const bottom = vertexToScreen(world.size, world.size, 0);
    this.camera.bounds = {
      minX: left.x,
      maxX: right.x,
      minY: -BALANCE.map.maxHeight * HEIGHT_STEP,
      maxY: bottom.y,
    };
    this.camera.viewWidth = this.app.screen.width;
    this.camera.viewHeight = this.app.screen.height;
    const centre = tileCenter(world, Math.floor(world.size / 2), Math.floor(world.size / 2));
    this.camera.zoom = 1;
    this.camera.centerOn(centre.x, centre.y);
    this.highlightDirty = true;
  }

  /** Marks chunks containing the given tiles for redraw (and their neighbours, for road joins). */
  invalidateTiles(indices: ArrayLike<number> | null): void {
    if (!this.world) return;
    if (indices === null) {
      for (const c of this.chunks) {
        c.dirty = true;
        c.overlayDirty = true;
        this.computeBounds(c);
      }
      return;
    }
    const size = this.world.size;
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k] as number;
      const x = i % size;
      const y = (i / size) | 0;
      this.markChunkAt(x, y);
      if (x % CHUNK_SIZE === 0) this.markChunkAt(x - 1, y);
      if (x % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunkAt(x + 1, y);
      if (y % CHUNK_SIZE === 0) this.markChunkAt(x, y - 1);
      if (y % CHUNK_SIZE === CHUNK_SIZE - 1) this.markChunkAt(x, y + 1);
    }
  }

  invalidateBuildings(changed: BuildingRecord[]): void {
    for (const b of changed) this.markChunkAt(b.x + b.w - 1, b.y + b.h - 1);
    this.animation?.buildingsChanged();
  }

  invalidateOverlay(): void {
    for (const c of this.chunks) c.overlayDirty = true;
  }

  setOverlay(mode: OverlayMode): void {
    if (mode === this.overlay) return;
    this.overlay = mode;
    for (const c of this.chunks) {
      c.overlayDirty = true;
      c.dirty = true;
    }
  }

  setUnderground(on: boolean): void {
    if (on === this.underground) return;
    this.underground = on;
    for (const c of this.chunks) c.dirty = true;
  }

  setGrid(on: boolean): void {
    if (on === this.grid) return;
    this.grid = on;
    for (const c of this.chunks) c.dirty = true;
  }

  setHighlight(tiles: HighlightTile[]): void {
    this.highlightTiles = tiles;
    this.highlightDirty = true;
  }

  /** Converts a client (CSS pixel) position to a tile. */
  pick(clientX: number, clientY: number): Point | null {
    if (!this.world) return null;
    const rect = this.app.canvas.getBoundingClientRect();
    const p = this.camera.screenToWorld(clientX - rect.left, clientY - rect.top);
    return pickTile(this.world, p.x, p.y, BALANCE.map.maxHeight);
  }

  /** Client (CSS pixel) position of a tile centre; used by E2E tests. */
  tileToClient(x: number, y: number): Point | null {
    if (!this.world) return null;
    const c = tileCenter(this.world, x, y);
    const s = this.camera.worldToScreen(c.x, c.y);
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: s.x + rect.left, y: s.y + rect.top };
  }

  centerOnTile(x: number, y: number): void {
    if (!this.world) return;
    const c = tileCenter(this.world, x, y);
    this.camera.centerOn(c.x, c.y);
    this.input.onCamera?.();
  }

  /** Tells listeners the camera moved after an external change (e.g. the minimap). */
  notifyCamera(): void {
    this.input.onCamera?.();
  }

  /** Map-space rectangle currently visible, in tile units, for the minimap. */
  visibleWorldRect(): { x: number; y: number; width: number; height: number } {
    return this.camera.visibleRect();
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.abort();
    if (this.initialized) this.app.destroy(true, { children: true });
  }

  private chunkAt(x: number, y: number): Chunk | null {
    if (!this.world || x < 0 || y < 0 || x >= this.world.size || y >= this.world.size) return null;
    return (
      this.chunks[Math.floor(y / CHUNK_SIZE) * this.chunksPerSide + Math.floor(x / CHUNK_SIZE)] ??
      null
    );
  }

  private markChunkAt(x: number, y: number): void {
    const c = this.chunkAt(x, y);
    if (c) {
      c.dirty = true;
      c.overlayDirty = true;
    }
  }

  private computeBounds(c: Chunk): void {
    if (!this.world) return;
    const { x0, y0, x1, y1 } = c.area;
    const left = vertexToScreen(x0, y1, 0);
    const right = vertexToScreen(x1, y0, 0);
    const top = vertexToScreen(x0, y0, 0);
    const bottom = vertexToScreen(x1, y1, 0);
    const margin = BALANCE.map.maxHeight * HEIGHT_STEP + 160;
    c.bounds = {
      x: left.x - 8,
      y: top.y - margin,
      width: right.x - left.x + 16,
      height: bottom.y - top.y + margin + 40,
    };
  }

  private context(): DrawContext | null {
    if (!this.world) return null;
    return {
      world: this.world,
      buildings: this.buildings,
      underground: this.underground,
      grid: this.grid,
      overlay: this.overlay,
      animationFrame: this.animationFrame,
    };
  }

  private frame(): void {
    const ctx = this.context();
    if (!ctx || !this.factory) return;
    this.camera.viewWidth = this.app.screen.width;
    this.camera.viewHeight = this.app.screen.height;
    if (this.attract) this.driftCamera(this.attract, ctx.world);
    else this.applyKeyboardPan();
    this.camera.apply(this.root, this.attract === null);

    this.animationTimer += this.app.ticker.deltaMS;
    if (this.animationTimer > 250) {
      this.animationTimer = 0;
      this.animationFrame++;
      for (const c of this.chunks) if (c.hasFire) c.dirty = true;
    }

    const view = this.camera.visibleRect();
    let budget = REDRAW_BUDGET;
    for (const c of this.chunks) {
      const visible = intersects(view, c.bounds);
      c.root.visible = visible;
      if (!visible) continue;
      if (c.dirty && budget > 0) {
        budget--;
        this.redrawChunk(c, ctx);
      }
      if (c.overlayDirty) {
        c.overlay.clear();
        drawOverlay(c.overlay, ctx, c.area);
        c.overlayDirty = false;
      }
    }
    this.animation?.update({
      deltaMS: this.app.ticker.deltaMS,
      view,
      zoom: this.camera.zoom,
      underground: this.underground,
      overlay: this.overlay !== 'none',
    });
    if (this.highlightDirty) this.drawHighlight();
  }

  private redrawChunk(c: Chunk, ctx: DrawContext): void {
    c.ground.clear();
    drawGround(c.ground, ctx, c.area);
    c.roads.clear();
    drawRoads(c.roads, ctx, c.area);
    buildObjects(c.objects, ctx, this.factory as SpriteFactory, c.area);
    c.wires.clear();
    drawWires(c.wires, ctx, c.area);
    this.animation?.rebuildWater(c);
    c.dirty = false;
    c.hasFire = false;
    const w = ctx.world;
    for (let y = c.area.y0; y < c.area.y1 && !c.hasFire; y++) {
      for (let x = c.area.x0; x < c.area.x1; x++) {
        if ((w.fire[w.index(x, y)] as number) > 0) {
          c.hasFire = true;
          break;
        }
      }
    }
  }

  private drawHighlight(): void {
    this.highlightDirty = false;
    const g = this.highlight;
    g.clear();
    const world = this.world;
    if (!world) return;
    for (const t of this.highlightTiles) {
      if (!world.inBounds(t.x, t.y)) continue;
      const q = tileQuad(world, t.x, t.y).flatMap((p) => [p.x, p.y]);
      const colors = HIGHLIGHT_COLORS[t.state];
      g.poly(q).fill({ color: colors.fill, alpha: t.state === 'neutral' ? 0.2 : 0.35 });
      g.poly(q).stroke({ width: 1.5, color: colors.stroke, alpha: 0.9 });
    }
    if (this.hoverTile && world.inBounds(this.hoverTile.x, this.hoverTile.y)) {
      const q = tileQuad(world, this.hoverTile.x, this.hoverTile.y);
      g.poly(q.flatMap((p) => [p.x, p.y])).stroke({ width: 2, color: 0xffffff, alpha: 0.95 });
    }
  }

  private setHover(tile: Point | null): void {
    const same =
      tile && this.hoverTile
        ? tile.x === this.hoverTile.x && tile.y === this.hoverTile.y
        : tile === this.hoverTile;
    if (same) return;
    this.hoverTile = tile;
    this.highlightDirty = true;
    this.input.onHover?.(tile);
  }

  private attachInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // The page must not scroll or zoom while a finger is on the map. `touch-action: none`
    // covers modern browsers; this listener covers older ones that still emit touch events.
    canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    for (const type of ['gesturestart', 'gesturechange']) {
      canvas.addEventListener(type, (event) => event.preventDefault(), { passive: false });
    }
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch') {
        this.panning = null;
        this.applyTouch(this.touches.down(e.pointerId, e.clientX, e.clientY), e);
        return;
      }
      this.touches.reset();
      if (e.button === 1 || e.button === 2 || (e.button === 0 && this.keys.has(' '))) {
        this.panning = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.button === 0) this.input.onPointer?.('down', this.pick(e.clientX, e.clientY), e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        this.applyTouch(this.touches.move(e.pointerId, e.clientX, e.clientY), e);
        return;
      }
      if (this.panning) {
        this.camera.pan(e.clientX - this.panning.x, e.clientY - this.panning.y);
        this.panning = { x: e.clientX, y: e.clientY };
        this.input.onCamera?.();
        return;
      }
      const tile = this.pick(e.clientX, e.clientY);
      this.setHover(tile);
      this.input.onPointer?.('move', tile, e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        this.applyTouch(this.touches.up(e.pointerId), e);
        return;
      }
      if (this.panning) {
        this.panning = null;
        return;
      }
      if (e.button === 0) this.input.onPointer?.('up', this.pick(e.clientX, e.clientY), e);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', (e) => {
      if (e.pointerType === 'touch') this.touches.cancel(e.pointerId);
      else this.panning = null;
    });
    canvas.addEventListener('pointerleave', () => this.setHover(null));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        this.camera.zoomAt(
          e.deltaY < 0 ? 1.15 : 1 / 1.15,
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
        this.input.onCamera?.();
      },
      { passive: false },
    );
    const signal = this.listeners.signal;
    window.addEventListener(
      'keydown',
      (e) => {
        if (isTyping(e) || e.ctrlKey || e.metaKey) return;
        this.keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      },
      { signal },
    );
    window.addEventListener(
      'keyup',
      (e) => this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key),
      {
        signal,
      },
    );
    window.addEventListener('blur', () => this.keys.clear(), { signal });
  }

  /**
   * Applies a touch gesture. A tap becomes a down+up on the same tile so tools place or
   * select; a drag pans and never paints. Pinch zoom keeps the midpoint under the fingers.
   */
  private applyTouch(effect: TouchEffect | null, event: PointerEvent): void {
    if (!effect) return;
    if (effect.type === 'pan') {
      this.camera.pan(effect.dx, effect.dy);
      this.input.onCamera?.();
      return;
    }
    if (effect.type === 'zoom') {
      const rect = this.app.canvas.getBoundingClientRect();
      if (effect.dx !== 0 || effect.dy !== 0) this.camera.pan(effect.dx, effect.dy);
      if (effect.factor !== 1) {
        this.camera.zoomAt(effect.factor, effect.x - rect.left, effect.y - rect.top);
      }
      this.input.onCamera?.();
      return;
    }
    const tile = this.pick(effect.x, effect.y);
    this.input.onPointer?.('down', tile, event);
    this.input.onPointer?.('up', tile, event);
  }

  private driftCamera(attract: { time: number; still: boolean }, world: World): void {
    if (!attract.still) attract.time += this.app.ticker.deltaMS / 1000;
    const angle = (ATTRACT_START + attract.time / ATTRACT_PERIOD_S) * Math.PI * 2;
    const half = world.size / 2;
    const radius = world.size * ATTRACT_RADIUS;
    const focus = vertexToScreen(
      half + radius * Math.cos(angle),
      half + radius * Math.sin(angle),
      0,
    );
    this.camera.zoom = ATTRACT_ZOOM;
    // Keep the focus right of centre so the menu card on the left does not cover it.
    const shift = this.camera.viewWidth > 900 ? (this.camera.viewWidth * 0.17) / ATTRACT_ZOOM : 0;
    this.camera.centerOn(focus.x - shift, focus.y);
  }

  private applyKeyboardPan(): void {
    if (this.keys.size === 0) return;
    const speed = (this.app.ticker.deltaMS / 1000) * 700;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('w') || this.keys.has('ArrowUp')) dy += speed;
    if (this.keys.has('s') || this.keys.has('ArrowDown')) dy -= speed;
    if (this.keys.has('a') || this.keys.has('ArrowLeft')) dx += speed;
    if (this.keys.has('d') || this.keys.has('ArrowRight')) dx -= speed;
    if (dx !== 0 || dy !== 0) {
      this.camera.pan(dx, dy);
      this.input.onCamera?.();
    }
  }
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}
