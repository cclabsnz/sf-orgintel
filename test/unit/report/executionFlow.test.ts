import { describe, it, expect } from '@jest/globals';
import { computeFlowLayout } from '../../../src/report/executionFlow.js';
import type { ObjectTimeline } from '../../../src/map/graph/timeline.js';

/**
 * The save sequence is a process, so it should be drawn as one. A table of phases states the same
 * facts but hides the thing that matters most: that these steps run one after another, and that
 * inside some of them nothing is ordered at all.
 *
 * Layout is separated from the SVG so the geometry can be asserted rather than eyeballed.
 */
const timeline = (entries: ObjectTimeline['entries']): ObjectTimeline => ({
  object: 'Case',
  entries,
  componentCount: entries.reduce((s, e) => s + e.components.length, 0),
  unorderedPhases: entries.filter((e) => !e.ordered).length,
});

const entry = (phase: string, names: string[], ordered = names.length === 1): ObjectTimeline['entries'][number] =>
  ({
    phase: phase as ObjectTimeline['entries'][number]['phase'],
    description: `${phase} description`,
    components: names.map((name) => ({ type: 'Flow' as const, name, namespace: null })),
    ordered,
  });

describe('computeFlowLayout', () => {
  it('stacks stages down the page in platform order', () => {
    const layout = computeFlowLayout(
      timeline([entry('before-save-flow', ['A']), entry('before-trigger', ['B']), entry('after-save-flow', ['C'])]),
    );

    expect(layout.stages.map((s) => s.phase)).toEqual(['before-save-flow', 'before-trigger', 'after-save-flow']);
    for (let i = 1; i < layout.stages.length; i++) {
      expect(layout.stages[i].y).toBeGreaterThan(layout.stages[i - 1].y);
    }
  });

  it('gives a stage enough height for every component it holds', () => {
    const layout = computeFlowLayout(timeline([entry('before-save-flow', ['A', 'B', 'C', 'D', 'E'])]));
    const stage = layout.stages[0];

    expect(stage.height).toBeGreaterThanOrEqual(stage.components.length * 20);
    // And no component may be drawn outside its own stage.
    for (const c of stage.components) {
      expect(c.y).toBeGreaterThanOrEqual(stage.y);
      expect(c.y).toBeLessThanOrEqual(stage.y + stage.height);
    }
  });

  it('never overlaps two stages', () => {
    const layout = computeFlowLayout(
      timeline([entry('before-save-flow', ['A', 'B', 'C']), entry('after-trigger', ['D']), entry('after-save-flow', ['E', 'F'])]),
    );

    for (let i = 1; i < layout.stages.length; i++) {
      const prev = layout.stages[i - 1];
      expect(layout.stages[i].y).toBeGreaterThanOrEqual(prev.y + prev.height);
    }
  });

  it('marks a stage whose internal order the platform does not define', () => {
    const layout = computeFlowLayout(
      timeline([entry('before-save-flow', ['A', 'B'], false), entry('before-trigger', ['C'], true)]),
    );

    expect(layout.stages[0].ordered).toBe(false);
    expect(layout.stages[1].ordered).toBe(true);
  });

  it('connects consecutive stages, and only consecutive ones', () => {
    const layout = computeFlowLayout(
      timeline([entry('before-save-flow', ['A']), entry('before-trigger', ['B']), entry('after-save-flow', ['C'])]),
    );

    // Two arrows for three stages — a flow, not a star.
    expect(layout.connectors).toHaveLength(2);
    for (const c of layout.connectors) expect(c.toY).toBeGreaterThan(c.fromY);
  });

  it('grows the canvas to fit its content', () => {
    const small = computeFlowLayout(timeline([entry('before-save-flow', ['A'])]));
    const large = computeFlowLayout(
      timeline([entry('before-save-flow', ['A', 'B', 'C', 'D']), entry('after-save-flow', ['E', 'F', 'G'])]),
    );

    expect(large.height).toBeGreaterThan(small.height);
    const last = large.stages[large.stages.length - 1];
    expect(large.height).toBeGreaterThanOrEqual(last.y + last.height);
  });

  it('handles an object with a single automation', () => {
    const layout = computeFlowLayout(timeline([entry('after-save-flow', ['Only'])]));

    expect(layout.stages).toHaveLength(1);
    expect(layout.connectors).toHaveLength(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('handles an empty timeline without producing a canvas', () => {
    const layout = computeFlowLayout(timeline([]));

    expect(layout.stages).toEqual([]);
    expect(layout.connectors).toEqual([]);
  });
});
