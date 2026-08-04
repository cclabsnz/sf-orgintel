import type { CouplingGraph, CouplingGraphEdge } from '@cclabsnz/sf-core';
import {
  coverageHeadline,
  edgeConfidence,
  summariseCoverage,
} from '../../../src/map/graph/coverage.js';

const edge = (confidences: Array<'high' | 'approximate'>): CouplingGraphEdge => ({
  from: 'Account',
  to: 'Contact',
  weight: confidences.length,
  operations: ['read'],
  components: confidences.map((c, i) => ({ type: 'ApexClass', name: `C${i}`, confidence: c })),
});

const graph = (edges: CouplingGraphEdge[]): CouplingGraph =>
  ({ version: 1, provenance: {}, nodes: [], edges }) as unknown as CouplingGraph;

describe('edgeConfidence', () => {
  it('is high only when every component is exact', () => {
    expect(edgeConfidence(edge(['high', 'high']))).toBe('high');
  });

  it('is approximate when no component is exact', () => {
    expect(edgeConfidence(edge(['approximate', 'approximate']))).toBe('approximate');
  });

  it('is mixed — not high — when one exact component sits among approximate ones', () => {
    // The previous rule called this 'high' because *some* component was exact, which lends
    // the weakest evidence the authority of the strongest. Nine guesses and one fact is not
    // a fact.
    expect(edgeConfidence(edge(['high', 'approximate', 'approximate']))).toBe('mixed');
  });

  it('treats an edge with no components as approximate rather than exact', () => {
    expect(edgeConfidence(edge([]))).toBe('approximate');
  });
});

describe('summariseCoverage', () => {
  it('counts component references, not distinct components', () => {
    const s = summariseCoverage(graph([edge(['high', 'approximate']), edge(['approximate'])]));
    expect(s).toMatchObject({
      totalComponents: 3,
      highComponents: 1,
      approximateComponents: 2,
      totalEdges: 2,
    });
    expect(s.approximateShare).toBeCloseTo(2 / 3);
  });

  it('classifies each edge exactly once', () => {
    const s = summariseCoverage(
      graph([edge(['high']), edge(['high', 'approximate']), edge(['approximate'])]),
    );
    expect(s.edgesByConfidence).toEqual({ high: 1, mixed: 1, approximate: 1 });
    const total = Object.values(s.edgesByConfidence).reduce((a, b) => a + b, 0);
    expect(total).toBe(s.totalEdges);
  });

  it('reports the share of edges resting entirely on approximation', () => {
    const s = summariseCoverage(graph([edge(['approximate']), edge(['approximate']), edge(['high'])]));
    expect(s.whollyApproximateShare).toBeCloseTo(2 / 3);
  });

  it('does not divide by zero on an empty graph', () => {
    const s = summariseCoverage(graph([]));
    expect(s).toMatchObject({ approximateShare: 0, whollyApproximateShare: 0, totalEdges: 0 });
  });
});

describe('coverageHeadline', () => {
  it('says so plainly when most evidence is inferred', () => {
    const s = summariseCoverage(graph([edge(['approximate', 'approximate', 'high'])]));
    expect(coverageHeadline(s)).toMatch(/67% of coupling evidence is approximate/);
    expect(coverageHeadline(s)).toMatch(/leads, not facts/);
  });

  it('claims exactness only when everything is exact', () => {
    expect(coverageHeadline(summariseCoverage(graph([edge(['high'])])))).toMatch(
      /Every coupling is backed by exact evidence/,
    );
  });

  it('does not imply coverage when there is no evidence at all', () => {
    expect(coverageHeadline(summariseCoverage(graph([])))).toBe('No coupling evidence was collected.');
  });
});
