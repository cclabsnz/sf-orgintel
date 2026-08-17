import { layoutBands } from '../../../src/anatomy/view/bandLayout.js';
import type { BandContent } from '../../../src/anatomy/view/bands.js';

const band = (id: string, n: number, metrics: number[] = []): BandContent =>
  ({
    id: id as BandContent['id'],
    title: id,
    emptiness: n === 0 ? 'empty' : 'populated',
    note: null,
    tiles: Array.from({ length: n }, (_, i) => ({
      id: `${id}-${i}`, label: `${id}-${i}`, sublabel: null,
      metric: metrics[i] ?? 1, fill: null, unavailable: false,
    })),
  });

describe('layoutBands', () => {
  it('places every band and never drops one', () => {
    const out = layoutBands([band('users', 2), band('products', 0), band('ops', 1)]);
    expect(out.bands.map((b) => b.id)).toEqual(['users', 'products', 'ops']);
  });

  it('gives an empty band height so it renders as a visible empty row', () => {
    // A band collapsed to zero height is indistinguishable from a band that was never drawn.
    const [, products] = layoutBands([band('users', 2), band('products', 0)]).bands;
    expect(products.height).toBeGreaterThan(0);
    expect(products.tiles).toEqual([]);
  });

  it('stacks bands without overlap, in order', () => {
    const out = layoutBands([band('users', 3), band('products', 2), band('ops', 1)]);
    for (let i = 1; i < out.bands.length; i++) {
      const prev = out.bands[i - 1];
      expect(out.bands[i].y).toBeGreaterThanOrEqual(prev.y + prev.height);
    }
  });

  it('keeps every tile inside the canvas', () => {
    const out = layoutBands([band('users', 25)], { width: 900 });
    for (const t of out.bands[0].tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(out.width);
    }
  });

  it('wraps tiles onto further rows rather than overflowing', () => {
    const out = layoutBands([band('users', 40)], { width: 600 });
    const rows = new Set(out.bands[0].tiles.map((t) => t.y));
    expect(rows.size).toBeGreaterThan(1);
  });

  it('scales tile width by metric, with a floor so a tiny value stays visible', () => {
    const out = layoutBands([band('products', 2, [100, 1])]);
    const [big, small] = out.bands[0].tiles;
    expect(big.w).toBeGreaterThan(small.w);
    expect(small.w).toBeGreaterThan(0);
  });

  it('does not divide by zero when every metric is zero', () => {
    const out = layoutBands([band('products', 3, [0, 0, 0])]);
    for (const t of out.bands[0].tiles) expect(Number.isFinite(t.w)).toBe(true);
  });

  it('is deterministic for the same input', () => {
    const input = [band('users', 5, [3, 1, 4, 1, 5])];
    expect(layoutBands(input)).toEqual(layoutBands(input));
  });
});
