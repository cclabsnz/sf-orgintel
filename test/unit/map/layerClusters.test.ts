import { describe, it, expect } from '@jest/globals';
import { clusterByLayer } from '../../../src/map/graph/clusters.js';
import type { GraphEdgeLite } from '../../../src/map/graph/clusters.js';

/**
 * Clustering the whole graph at once produces domains that mix a business object with a logger
 * table and a permission record, because Apex references those constantly and they couple to
 * everything. Such a "domain" describes nothing a consultant can act on.
 *
 * Clustering within each layer keeps every object — nothing is filtered — while ensuring a
 * domain is a set of objects that actually belong to the same kind of thing.
 */
const e = (from: string, to: string, weight = 1): GraphEdgeLite => ({ from, to, weight });
const flat = (): number => 1;

const nodes = [
  { object: 'Account', layer: 'business' as const },
  { object: 'Case', layer: 'business' as const },
  { object: 'Invoice__c', layer: 'business' as const },
  { object: 'Payment__c', layer: 'business' as const },
  { object: 'User', layer: 'security' as const },
  { object: 'Profile', layer: 'security' as const },
  { object: 'LogEntry__c', layer: 'observability' as const },
];

// Two business groups, plus infrastructure coupled to everything.
const edges = [
  e('Account', 'Case', 8),
  e('Invoice__c', 'Payment__c', 8),
  e('Account', 'User', 9), e('Case', 'User', 9), e('Invoice__c', 'User', 9),
  e('User', 'Profile', 5),
  e('LogEntry__c', 'User', 4), e('LogEntry__c', 'Account', 4),
];

describe('clusterByLayer', () => {
  const clusters = clusterByLayer(nodes, edges, flat);

  it('never mixes layers within a domain', () => {
    for (const c of clusters) {
      const layers = new Set(c.objects.map((o) => nodes.find((n) => n.object === o)!.layer));
      expect(layers.size).toBe(1);
    }
  });

  it('keeps every object — clustering is not filtering', () => {
    const placed = clusters.flatMap((c) => c.objects).sort();
    expect(placed).toEqual(nodes.map((n) => n.object).sort());
  });

  it('tags each domain with the layer it belongs to', () => {
    for (const c of clusters) {
      expect(c.layer).toBe(nodes.find((n) => n.object === c.objects[0])!.layer);
    }
  });

  it('separates business groups that infrastructure coupling would otherwise fuse', () => {
    // Account/Case and Invoice/Payment are only joined via User, which is a different layer.
    const business = clusters.filter((c) => c.layer === 'business');
    expect(business.length).toBeGreaterThan(1);
    const withAccount = business.find((c) => c.objects.includes('Account'))!;
    expect(withAccount.objects).not.toContain('Invoice__c');
  });

  it('numbers domains uniquely across layers', () => {
    const ids = clusters.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is deterministic regardless of input order', () => {
    const a = clusterByLayer(nodes, edges, flat);
    const b = clusterByLayer([...nodes].reverse(), [...edges].reverse(), flat);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('handles an empty graph', () => {
    expect(clusterByLayer([], [], flat)).toEqual([]);
  });
});
