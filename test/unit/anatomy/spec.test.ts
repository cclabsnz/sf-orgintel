// The load-bearing test of Task 6: resolving ANATOMY_VIEW against an artifact must produce the
// same band membership buildBands produces from that same artifact. If the two disagree, the
// spec is wrong -- buildBands is what ships, and its output is inside the frozen anatomy.json
// (test/unit/anatomy/fixtures/anatomy.golden.json), so it is never adjusted to match the spec.
import { describe, it, expect } from '@jest/globals';
import { ANATOMY_VIEW, resolveAnatomyView } from '../../../src/anatomy/view/spec.js';
import { buildBands, type BandId } from '../../../src/anatomy/view/bands.js';
import { artifacts } from './fixtures/input.js';
import type { AnatomyArtifact } from '../../../src/anatomy/types.js';

const BAND_ORDER: BandId[] = ['users', 'channels', 'products', 'capabilities', 'integration', 'external', 'ops'];

describe('ANATOMY_VIEW', () => {
  it('names all seven bands, in the order buildBands uses today', () => {
    expect(ANATOMY_VIEW.bands.map((b) => b.id)).toEqual(BAND_ORDER);
  });

  it('gives every band a title and a match function selecting its kinds', () => {
    for (const band of ANATOMY_VIEW.bands) {
      expect(typeof band.title).toBe('string');
      expect(band.title.length).toBeGreaterThan(0);
      expect(typeof band.match).toBe('function');
    }
  });

  it(
    'resolves to the same band membership, emptiness, note and caveats buildBands produces, ' +
      'on the shared fixture',
    async () => {
      const artifact = await artifacts();
      const built = buildBands(artifact);
      const resolved = resolveAnatomyView(ANATOMY_VIEW, artifact);

      // Same seven bands, same order, on both sides.
      expect(resolved.map((b) => b.id)).toEqual(built.map((b) => b.id));

      for (const band of built) {
        const match = resolved.find((r) => r.id === band.id);
        expect(match).toBeDefined();
        // The property that matters: which items are in the band, not their labels/metrics --
        // this task turns membership into data, it does not change what a band renders.
        expect(match!.itemIds).toEqual(band.tiles.map((t) => t.id).sort());
        expect(match!.emptiness).toBe(band.emptiness);
        expect(match!.note).toBe(band.note);
        expect(match!.caveats).toEqual(band.caveats);
      }
    },
  );

  it('at least one band is genuinely populated on the fixture (guards against a vacuous pass)', async () => {
    const artifact = await artifacts();
    const resolved = resolveAnatomyView(ANATOMY_VIEW, artifact);
    expect(resolved.some((b) => b.itemIds.length > 0)).toBe(true);
  });

  it('preserves not-collected: a band whose facts nobody collected must not resolve to empty', async () => {
    const base = await artifacts();
    const artifact: AnatomyArtifact = {
      ...base,
      products: [],
      coverage: {
        ...base.coverage,
        unavailable: [
          { scope: 'products.apps', reason: 'failed', detail: 'CustomApplication could not be read: denied' },
          { scope: 'products.packages', reason: 'failed', detail: 'InstalledSubscriberPackage could not be read: denied' },
          { scope: 'products.recordTypes', reason: 'failed', detail: 'RecordType could not be read: denied' },
        ],
      },
    };

    const built = buildBands(artifact).find((b) => b.id === 'products')!;
    const resolved = resolveAnatomyView(ANATOMY_VIEW, artifact).find((b) => b.id === 'products')!;

    expect(built.emptiness).toBe('not-collected');
    expect(resolved.emptiness).toBe('not-collected');
    expect(resolved.itemIds).toEqual([]);
    expect(resolved.note).toBe(built.note);
  });

  it('still resolves empty (not not-collected) when a band is genuinely empty and fully collected', async () => {
    const base = await artifacts();
    const artifact: AnatomyArtifact = { ...base, products: [] };

    const built = buildBands(artifact).find((b) => b.id === 'products')!;
    const resolved = resolveAnatomyView(ANATOMY_VIEW, artifact).find((b) => b.id === 'products')!;

    expect(built.emptiness).toBe('empty');
    expect(resolved.emptiness).toBe('empty');
  });
});
