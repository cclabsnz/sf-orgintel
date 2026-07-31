import { describe, it, expect } from '@jest/globals';
import { detailAt, DETAIL_TIERS } from '../../../src/map/graph/detail.js';

/**
 * Semantic zoom: zooming does not merely enlarge the picture, it changes what the picture
 * shows. Zoomed out, a reader wants the shape of the org — bands and counts. Zoomed in, they
 * want the objects and what couples them. Drawing everything at every zoom is what made the
 * flat graph unreadable in the first place.
 *
 * The tier selection is pure so it can be asserted; only the pan and zoom plumbing is left to
 * the browser.
 */
const nodes = Array.from({ length: 60 }, (_, i) => ({
  object: `Obj${String(i).padStart(2, '0')}`,
  layer: 'business' as const,
  degree: 60 - i, // Obj00 is the most connected
}));

describe('detailAt', () => {
  it('shows only bands and counts when zoomed out', () => {
    const d = detailAt(0.4, nodes);

    expect(d.tier).toBe('landscape');
    expect(d.objects).toHaveLength(0);
    expect(d.showLabels).toBe(false);
    expect(d.showEdges).toBe(false);
  });

  it('shows the most connected objects at middle zoom, without labels', () => {
    const d = detailAt(1, nodes);

    expect(d.tier).toBe('domains');
    expect(d.objects.length).toBeGreaterThan(0);
    expect(d.objects.length).toBeLessThan(nodes.length);
    expect(d.showLabels).toBe(false);
    // The ones kept are the most connected, not an arbitrary slice.
    expect(d.objects[0].object).toBe('Obj00');
  });

  it('shows everything with labels when zoomed in', () => {
    const d = detailAt(2.5, nodes);

    expect(d.tier).toBe('objects');
    expect(d.objects).toHaveLength(nodes.length);
    expect(d.showLabels).toBe(true);
    expect(d.showEdges).toBe(true);
  });

  it('reveals strictly more as zoom increases', () => {
    const counts = [0.3, 0.8, 1.2, 2, 3].map((z) => detailAt(z, nodes).objects.length);

    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
  });

  it('never hides an object the reader has selected', () => {
    // Selecting something and then zooming out must not make it vanish — that would break the
    // one interaction a reader relies on to follow a thread.
    const d = detailAt(0.4, nodes, { selected: 'Obj59' });

    expect(d.objects.map((o) => o.object)).toContain('Obj59');
  });

  it('describes every tier it can return', () => {
    const tiers = new Set([0.2, 1, 3].map((z) => detailAt(z, nodes).tier));

    for (const t of tiers) expect(DETAIL_TIERS[t]).toBeTruthy();
  });

  it('handles an empty graph at any zoom', () => {
    for (const z of [0.1, 1, 5]) expect(detailAt(z, []).objects).toEqual([]);
  });
});
