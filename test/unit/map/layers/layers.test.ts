import { describe, it, expect } from '@jest/globals';
import { layerOf, LAYERS, summariseLayers, crossLayerCoupling } from '../../../../src/map/graph/layers.js';

/**
 * A coupling graph of a real org is dominated by objects that carry no business process:
 * User, Profile, PermissionSet, logger tables, custom metadata. Deleting them loses a real
 * finding — on a production org, business↔security was the second-heaviest relationship in
 * the whole graph, ahead of every business-internal pair but one. Classifying into layers
 * keeps them and makes that relationship legible.
 */
describe('layerOf', () => {
  it.each([
    ['User', 'security'], ['Profile', 'security'], ['PermissionSetAssignment', 'security'],
    ['LoginHistory', 'security'], ['StaticResource', 'security'],
    ['LogEntry__c', 'observability'], ['LoggerSettings__c', 'observability'],
    ['NDMS_Mapping__mdt', 'configuration'],
    ['Order_Event__e', 'integration'],
    ['AccountShare', 'sharing'], ['CaseHistory', 'sharing'], ['OpportunityFeed', 'sharing'],
    ['ContentDocument', 'content'], ['EmailMessage', 'content'],
    ['Account', 'business'], ['CarePlan', 'business'], ['Invoice__c', 'business'],
  ])('classifies %s as %s', (object, expected) => {
    expect(layerOf(object)).toBe(expected);
  });

  it('defaults to business, so an unrecognised object is never hidden', () => {
    expect(layerOf('Totally_Unknown_Thing__c')).toBe('business');
  });

  it('does not mistake a business object for infrastructure by prefix alone', () => {
    // 'Contract' starts with 'Cont' like ContentDocument; 'Userlike' is not User.
    expect(layerOf('Contract')).toBe('business');
    expect(layerOf('UserStory__c')).toBe('business');
    expect(layerOf('EventBrite__c')).toBe('business');
  });

  it('orders layers from the business core outwards', () => {
    expect(LAYERS[LAYERS.indexOf('business')]).toBe('business');
    expect(LAYERS).toContain('security');
    expect(new Set(LAYERS).size).toBe(LAYERS.length);
  });
});

describe('summariseLayers', () => {
  it('counts every object exactly once, losing none', () => {
    const objects = ['Account', 'Case', 'User', 'Profile', 'LogEntry__c', 'Cfg__mdt'];

    const summary = summariseLayers(objects);

    expect(summary.reduce((n, l) => n + l.count, 0)).toBe(objects.length);
    expect(summary.find((l) => l.layer === 'business')?.count).toBe(2);
    expect(summary.find((l) => l.layer === 'security')?.count).toBe(2);
  });

  it('omits layers with no objects rather than reporting zeroes', () => {
    expect(summariseLayers(['Account']).map((l) => l.layer)).toEqual(['business']);
  });
});

describe('crossLayerCoupling', () => {
  const edges = [
    { from: 'Account', to: 'Case', weight: 5 },
    { from: 'Account', to: 'User', weight: 9 },
    { from: 'Case', to: 'User', weight: 3 },
    { from: 'LogEntry__c', to: 'User', weight: 4 },
  ];

  it('aggregates couplings by layer pair, heaviest first', () => {
    const pairs = crossLayerCoupling(edges);

    expect(pairs[0]).toEqual({ from: 'business', to: 'security', couplings: 2, weight: 12 });
    expect(pairs.find((p) => p.from === 'business' && p.to === 'business')).toEqual({
      from: 'business', to: 'business', couplings: 1, weight: 5,
    });
  });

  it('labels a within-layer relationship with the same layer on both sides', () => {
    const pairs = crossLayerCoupling([{ from: 'User', to: 'Profile', weight: 2 }]);

    expect(pairs).toEqual([{ from: 'security', to: 'security', couplings: 1, weight: 2 }]);
  });

  it('aggregates a pair regardless of which side the edge was written from', () => {
    // Apex references User from Account and Account from User; both are the same
    // business↔security relationship and must not split into two entries.
    const pairs = crossLayerCoupling([
      { from: 'Account', to: 'User', weight: 4 },
      { from: 'User', to: 'Case', weight: 6 },
    ]);

    expect(pairs).toEqual([{ from: 'business', to: 'security', couplings: 2, weight: 10 }]);
  });

  it('is deterministic regardless of input order', () => {
    const mixed = [...edges, { from: 'User', to: 'Contact', weight: 2 }];

    const a = crossLayerCoupling(mixed);
    const b = crossLayerCoupling([...mixed].reverse());

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
