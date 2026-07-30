import { describe, it, expect } from '@jest/globals';
import { extractProcessChains } from '../../../src/map/graph/chains.js';
import type { CouplingGraphEdge } from '@cclabsnz/sf-core';

/**
 * A directed edge says "when A changes, B is touched". Chaining those gives the first thing in
 * this tool that looks like a business process rather than an association: A → B → C.
 *
 * Only directional edges participate. An undirected coupling means we do not know the order,
 * and guessing one would manufacture a process that may not exist.
 */
const edge = (
  from: string,
  to: string,
  weight: number,
  direction?: 'from-to' | 'to-from' | 'both',
): CouplingGraphEdge => ({
  from, to, weight,
  operations: ['update'],
  components: [{ type: 'Flow', name: `${from}_${to}`, confidence: 'high' }],
  ...(direction ? { direction } : {}),
});

describe('extractProcessChains', () => {
  it('follows direction through a multi-step chain', () => {
    const chains = extractProcessChains([
      edge('Lead', 'Opportunity', 5, 'from-to'),
      edge('Opportunity', 'Order', 4, 'from-to'),
      edge('Invoice__c', 'Order', 3, 'to-from'), // Order -> Invoice__c
    ]);

    expect(chains[0].steps).toEqual(['Lead', 'Opportunity', 'Order', 'Invoice__c']);
    expect(chains[0].weight).toBe(12);
  });

  it('ignores couplings with no directional evidence', () => {
    // Order is unknown, so inventing one would manufacture a process.
    const chains = extractProcessChains([
      edge('Lead', 'Opportunity', 5),
      edge('Opportunity', 'Order', 4),
    ]);

    expect(chains).toEqual([]);
  });

  it('needs at least two steps to be a process rather than a pair', () => {
    const chains = extractProcessChains([edge('Case', 'Account', 9, 'from-to')]);

    expect(chains).toEqual([]);
  });

  it('terminates on a cycle instead of looping forever', () => {
    const chains = extractProcessChains([
      edge('A', 'B', 1, 'from-to'),
      edge('B', 'C', 1, 'from-to'),
      edge('C', 'A', 1, 'from-to'),
    ]);

    expect(chains.length).toBeGreaterThan(0);
    for (const c of chains) expect(new Set(c.steps).size).toBe(c.steps.length);
  });

  it('does not report a chain that is contained in a longer one', () => {
    const chains = extractProcessChains([
      edge('A', 'B', 3, 'from-to'),
      edge('B', 'C', 3, 'from-to'),
      edge('C', 'D', 3, 'from-to'),
    ]);

    expect(chains).toHaveLength(1);
    expect(chains[0].steps).toEqual(['A', 'B', 'C', 'D']);
  });

  it('ranks heavier processes first', () => {
    const chains = extractProcessChains([
      edge('A', 'B', 1, 'from-to'), edge('B', 'C', 1, 'from-to'),
      edge('X', 'Y', 9, 'from-to'), edge('Y', 'Z', 9, 'from-to'),
    ]);

    expect(chains[0].steps[0]).toBe('X');
    expect(chains[0].weight).toBeGreaterThan(chains[1].weight);
  });

  it('traverses a bidirectional coupling either way', () => {
    const chains = extractProcessChains([
      edge('A', 'B', 2, 'from-to'),
      edge('B', 'C', 2, 'both'),
    ]);

    expect(chains[0].steps).toEqual(['A', 'B', 'C']);
  });

  it('is deterministic regardless of edge order', () => {
    const edges = [
      edge('A', 'B', 3, 'from-to'), edge('B', 'C', 2, 'from-to'), edge('P', 'Q', 5, 'from-to'), edge('Q', 'R', 5, 'from-to'),
    ];

    expect(JSON.stringify(extractProcessChains(edges)))
      .toBe(JSON.stringify(extractProcessChains([...edges].reverse())));
  });

  it('carries the weakest confidence along the chain', () => {
    const chains = extractProcessChains([
      { ...edge('A', 'B', 2, 'from-to'), components: [{ type: 'Flow', name: 'F', confidence: 'high' }] },
      { ...edge('B', 'C', 2, 'from-to'), components: [{ type: 'ApexClass', name: 'C', confidence: 'approximate' }] },
    ]);

    // A chain is only as trustworthy as its weakest link.
    expect(chains[0].confidence).toBe('approximate');
  });
});
