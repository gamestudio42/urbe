/** Movement below this, in CSS pixels, is a tap. Past it, one finger pans the camera. */
export const TAP_SLOP_PX = 12;

export type TouchEffect =
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'zoom'; factor: number; x: number; y: number; dx: number; dy: number }
  | { type: 'tap'; x: number; y: number };

interface Sample {
  id: number;
  x: number;
  y: number;
}

/**
 * Touch gestures for the map. One finger pans after it leaves the tap slop; a finger that
 * stays inside the slop is a tap (place or select). Two fingers pinch-zoom around their
 * midpoint and drag that midpoint. Mouse and pen pointers never enter this tracker, so
 * desktop dragging is unchanged.
 */
export class TouchGestures {
  private readonly points = new Map<number, Sample>();
  private mode: 'idle' | 'pending' | 'pan' | 'pinch' = 'idle';
  private primaryId = -1;
  private originX = 0;
  private originY = 0;
  private lastX = 0;
  private lastY = 0;
  private pinchDistance = 0;
  private pinchX = 0;
  private pinchY = 0;
  /** A pan or pinch already happened, so lifting the last finger must not place a tile. */
  private consumed = false;

  down(id: number, x: number, y: number): TouchEffect | null {
    this.points.set(id, { id, x, y });
    if (this.points.size === 1) {
      this.mode = 'pending';
      this.primaryId = id;
      this.originX = x;
      this.originY = y;
      this.lastX = x;
      this.lastY = y;
      this.consumed = false;
      return null;
    }
    if (this.points.size >= 2) {
      this.beginPinch();
      return null;
    }
    return null;
  }

  move(id: number, x: number, y: number): TouchEffect | null {
    const point = this.points.get(id);
    if (!point) return null;
    point.x = x;
    point.y = y;
    if (this.mode === 'pending' && id === this.primaryId) {
      const dx = x - this.originX;
      const dy = y - this.originY;
      const distance = Math.hypot(dx, dy);
      if (distance < TAP_SLOP_PX) return null;
      this.mode = 'pan';
      this.consumed = true;
      this.lastX = x;
      this.lastY = y;
      // Drop the slop itself so recognising the drag does not jump the map.
      const scale = (distance - TAP_SLOP_PX) / distance;
      return { type: 'pan', dx: dx * scale, dy: dy * scale };
    }
    if (this.mode === 'pan' && id === this.primaryId) {
      const dx = x - this.lastX;
      const dy = y - this.lastY;
      this.lastX = x;
      this.lastY = y;
      if (dx === 0 && dy === 0) return null;
      return { type: 'pan', dx, dy };
    }
    if (this.mode === 'pinch' && this.points.size >= 2) return this.pinchMove();
    return null;
  }

  up(id: number): TouchEffect | null {
    if (!this.points.has(id)) return null;
    this.points.delete(id);
    if (this.points.size === 0) {
      const tap =
        this.mode === 'pending' && id === this.primaryId && !this.consumed
          ? ({ type: 'tap', x: this.originX, y: this.originY } as const)
          : null;
      this.reset();
      return tap;
    }
    if (this.points.size === 1) {
      const rest = this.points.values().next().value;
      if (!rest) return null;
      // The leftover finger keeps panning and must not become a tap.
      this.mode = 'pan';
      this.primaryId = rest.id;
      this.lastX = rest.x;
      this.lastY = rest.y;
      this.consumed = true;
      return null;
    }
    this.beginPinch();
    return null;
  }

  cancel(id: number): void {
    this.points.delete(id);
    if (this.points.size === 0) {
      this.reset();
      return;
    }
    if (this.points.size === 1) {
      const rest = this.points.values().next().value;
      if (!rest) return;
      this.mode = 'pan';
      this.primaryId = rest.id;
      this.lastX = rest.x;
      this.lastY = rest.y;
      this.consumed = true;
      return;
    }
    this.beginPinch();
  }

  reset(): void {
    this.points.clear();
    this.mode = 'idle';
    this.primaryId = -1;
    this.consumed = false;
  }

  private beginPinch(): void {
    const pair = firstTwo(this.points);
    if (!pair) return;
    this.mode = 'pinch';
    this.consumed = true;
    this.pinchDistance = distance(pair[0], pair[1]);
    this.pinchX = (pair[0].x + pair[1].x) / 2;
    this.pinchY = (pair[0].y + pair[1].y) / 2;
  }

  private pinchMove(): TouchEffect | null {
    const pair = firstTwo(this.points);
    if (!pair) return null;
    const next = distance(pair[0], pair[1]);
    const x = (pair[0].x + pair[1].x) / 2;
    const y = (pair[0].y + pair[1].y) / 2;
    const raw = this.pinchDistance > 0 ? next / this.pinchDistance : 1;
    const factor = Math.min(2, Math.max(0.5, raw));
    const dx = x - this.pinchX;
    const dy = y - this.pinchY;
    this.pinchDistance = next;
    this.pinchX = x;
    this.pinchY = y;
    if (factor === 1 && dx === 0 && dy === 0) return null;
    return { type: 'zoom', factor, x, y, dx, dy };
  }
}

function distance(a: Sample, b: Sample): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function firstTwo(points: Map<number, Sample>): [Sample, Sample] | null {
  const values = points.values();
  const a = values.next().value;
  const b = values.next().value;
  if (!a || !b) return null;
  return [a, b];
}
