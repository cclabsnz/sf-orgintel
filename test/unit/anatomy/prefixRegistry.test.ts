import { buildPrefixRegistry } from '../../../src/anatomy/prefixRegistry.js';

const names = (spec: Record<string, number>): string[] =>
  Object.entries(spec).flatMap(([prefix, n]) =>
    Array.from({ length: n }, (_, i) => `${prefix}_Thing${i}`),
  );

describe('buildPrefixRegistry', () => {
  it('promotes a frequent candidate that matches an app', () => {
    const r = buildPrefixRegistry(names({ ACME: 40 }), { apps: ['ACME_Console'], packages: [], recordTypes: [] });
    expect(r.products.map((p) => p.key)).toEqual(['ACME']);
    expect(r.byPrefix.get('ACME')).toBe('ACME');
    expect(r.unresolved).toEqual([]);
  });

  it('never creates a product from frequency alone', () => {
    // The failure this rule exists for: on a real org the single largest prefix matched
    // no application, and promoting it would have invented a product that does not exist.
    const r = buildPrefixRegistry(names({ ZZZ: 500 }), { apps: [], packages: [], recordTypes: [] });
    expect(r.products).toEqual([]);
    expect(r.unresolved).toEqual(['ZZZ']);
  });

  it('drops utility namespaces before matching, so they cannot resolve spuriously', () => {
    // 'Log' matched an unrelated application on a real org and would have become a product.
    const r = buildPrefixRegistry(names({ Log: 60, Logger: 30 }), {
      apps: ['Logistics_App'],
      packages: [],
      recordTypes: [],
    });
    expect(r.products).toEqual([]);
    expect(r.unresolved).toEqual([]);
  });

  it('merges a candidate that is a prefix of another', () => {
    const r = buildPrefixRegistry(names({ ACME: 30, ACMEX: 20 }), {
      apps: ['ACME_Console'],
      packages: [],
      recordTypes: [],
    });
    expect(r.products.map((p) => p.key)).toEqual(['ACME']);
    expect(r.products[0].componentCount).toBe(50);
  });

  it('accepts a package or a record type as a source, not only an app', () => {
    const byPackage = buildPrefixRegistry(names({ BETA: 20 }), { apps: [], packages: ['BETA'], recordTypes: [] });
    expect(byPackage.products[0]).toMatchObject({ key: 'BETA', source: 'package' });

    const byRt = buildPrefixRegistry(names({ GAMMA: 20 }), { apps: [], packages: [], recordTypes: ['GAMMA_Request'] });
    expect(byRt.products[0]).toMatchObject({ key: 'GAMMA', source: 'recordType' });
  });

  it('ignores candidates below the floor', () => {
    const r = buildPrefixRegistry(names({ TINY: 2, BIG: 200 }), {
      apps: ['TINY_App', 'BIG_App'],
      packages: [],
      recordTypes: [],
    });
    expect(r.products.map((p) => p.key)).toEqual(['BIG']);
  });

  it('is deterministic and sorted', () => {
    const src = { apps: ['B_App', 'A_App'], packages: [], recordTypes: [] };
    const one = buildPrefixRegistry(names({ B: 30, A: 30 }), src);
    const two = buildPrefixRegistry(names({ A: 30, B: 30 }), src);
    expect(one.products.map((p) => p.key)).toEqual(['A', 'B']);
    expect(one).toEqual(two);
  });

  it('returns empty structures for an org with no components', () => {
    const r = buildPrefixRegistry([], { apps: [], packages: [], recordTypes: [] });
    expect(r).toEqual({ byPrefix: new Map(), products: [], unresolved: [] });
  });
});
