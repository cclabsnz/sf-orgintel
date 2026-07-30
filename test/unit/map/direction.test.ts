import { describe, it, expect } from '@jest/globals';
import { mergeEdges } from '../../../src/map/graph/couplingGraph.js';
import type { RawEdge } from '../../../src/map/types.js';

/**
 * A record-triggered flow or an Apex trigger says something a plain coupling does not: when a
 * Case changes, a WorkOrder is created. That is process order, and `mergeEdges` was discarding
 * it — it canonicalised each pair alphabetically, so Case→WorkOrder and WorkOrder→Case became
 * the same undirected edge.
 *
 * Direction is kept as evidence *about* the canonical pair rather than by abandoning the
 * canonical form: consumers that only care about coupling are unaffected, and consumers that
 * want process order can follow it.
 */
const flow = (name: string): RawEdge['component'] => ({ type: 'Flow', name, confidence: 'high' });
const apex = (name: string): RawEdge['component'] => ({ type: 'ApexClass', name, confidence: 'approximate' });

describe('mergeEdges direction', () => {
  it('records forward direction when the trigger sorts first', () => {
    const merged = mergeEdges([
      { a: 'Case', b: 'WorkOrder', operations: ['create'], component: flow('F1'), directed: true },
    ]);

    expect(merged[0].from).toBe('Case');
    expect(merged[0].to).toBe('WorkOrder');
    expect(merged[0].direction).toBe('from-to');
  });

  it('records reverse direction when the trigger sorts second', () => {
    // Canonical pair is Account|Order, but the process runs Order -> Account.
    const merged = mergeEdges([
      { a: 'Order', b: 'Account', operations: ['update'], component: flow('F2'), directed: true },
    ]);

    expect([merged[0].from, merged[0].to]).toEqual(['Account', 'Order']);
    expect(merged[0].direction).toBe('to-from');
  });

  it('reports both when evidence runs each way', () => {
    const merged = mergeEdges([
      { a: 'Case', b: 'WorkOrder', operations: ['create'], component: flow('F1'), directed: true },
      { a: 'WorkOrder', b: 'Case', operations: ['update'], component: flow('F2'), directed: true },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].direction).toBe('both');
  });

  it('leaves direction absent when no contributor was directional', () => {
    const merged = mergeEdges([
      { a: 'Case', b: 'WorkOrder', operations: ['read'], component: apex('C1') },
    ]);

    expect(merged[0].direction).toBeUndefined();
  });

  it('keeps directional evidence when an undirected contributor is also present', () => {
    // A trigger and a plain Apex reference describe the same pair; the trigger still knows
    // which way the process runs, and a co-occurrence must not erase that.
    const merged = mergeEdges([
      { a: 'Case', b: 'WorkOrder', operations: ['create'], component: flow('F1'), directed: true },
      { a: 'WorkOrder', b: 'Case', operations: ['read'], component: apex('C1') },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].direction).toBe('from-to');
    expect(merged[0].weight).toBe(2);
  });

  it('still aggregates the pair regardless of the order it was written', () => {
    const merged = mergeEdges([
      { a: 'WorkOrder', b: 'Case', operations: ['read'], component: apex('C1') },
      { a: 'Case', b: 'WorkOrder', operations: ['create'], component: flow('F1'), directed: true },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].from).toBe('Case');
  });
});
