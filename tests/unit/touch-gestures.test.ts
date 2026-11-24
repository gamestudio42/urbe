import { describe, expect, it } from 'vitest';
import { TAP_SLOP_PX, TouchGestures } from '../../apps/web/src/renderer/touchGestures';

describe('TouchGestures', () => {
  it('treats a short press as a tap at the point where the finger landed', () => {
    const gestures = new TouchGestures();
    expect(gestures.down(1, 40, 50)).toBeNull();
    expect(gestures.move(1, 40 + TAP_SLOP_PX - 1, 52)).toBeNull();
    expect(gestures.up(1)).toEqual({ type: 'tap', x: 40, y: 50 });
  });

  it('pans once the finger leaves the tap slop and does not place on release', () => {
    const gestures = new TouchGestures();
    gestures.down(1, 0, 0);
    const first = gestures.move(1, 30, 0);
    expect(first).toEqual({ type: 'pan', dx: 30 - TAP_SLOP_PX, dy: 0 });
    expect(gestures.move(1, 45, 8)).toEqual({ type: 'pan', dx: 15, dy: 8 });
    expect(gestures.up(1)).toBeNull();
  });

  it('pinches around the midpoint and does not turn the gesture into a tap', () => {
    const gestures = new TouchGestures();
    gestures.down(1, 100, 100);
    expect(gestures.down(2, 180, 100)).toBeNull();
    const zoom = gestures.move(2, 220, 110);
    expect(zoom?.type).toBe('zoom');
    if (zoom?.type !== 'zoom') return;
    expect(zoom.factor).toBeGreaterThan(1);
    expect(zoom.x).toBe(160);
    expect(zoom.y).toBe(105);
    expect(zoom.dx).toBe(20);
    expect(zoom.dy).toBe(5);
    expect(gestures.up(2)).toBeNull();
    expect(gestures.up(1)).toBeNull();
  });

  it('zooms out when the fingers move together', () => {
    const gestures = new TouchGestures();
    gestures.down(1, 0, 0);
    gestures.down(2, 100, 0);
    const zoom = gestures.move(1, 25, 0);
    expect(zoom?.type).toBe('zoom');
    if (zoom?.type !== 'zoom') return;
    expect(zoom.factor).toBeLessThan(1);
  });

  it('drops a cancelled touch without a tap', () => {
    const gestures = new TouchGestures();
    gestures.down(1, 10, 10);
    gestures.cancel(1);
    expect(gestures.up(1)).toBeNull();
  });
});
