import type { CouplingGraph, CouplingGraphEdge } from '@cclabsnz/sf-core';

/**
 * How much of the coupling graph rests on exact evidence, and how much on approximation.
 *
 * Confidence was recorded per component and surfaced only in a per-edge chip. On a real org
 * roughly two thirds of components come from the body-regex fallback used when a class has no
 * SymbolTable, and nothing in the report said so. A reader saw a dense, authoritative-looking
 * graph with no way to know most of it was inferred from text.
 *
 * Coupling analysis is inherently partial — that is fine and unavoidable. Presenting it
 * without saying how partial is not.
 */

/** Confidence for a whole edge, derived from its components rather than asserted. */
export type EdgeConfidence = 'high' | 'mixed' | 'approximate';

export interface CoverageSummary {
  /** Component references across every edge; one component can appear on several edges. */
  totalComponents: number;
  highComponents: number;
  approximateComponents: number;
  /** Share of component references that are approximate, 0–1. */
  approximateShare: number;
  totalEdges: number;
  edgesByConfidence: Record<EdgeConfidence, number>;
  /** Share of edges resting entirely on approximation, 0–1. */
  whollyApproximateShare: number;
}

/**
 * Confidence for one edge.
 *
 * An edge used to be called 'high' when *any* component was high, so nine regex guesses plus
 * one SymbolTable hit read as exact. That flatters the weakest evidence with the strength of
 * the strongest. An edge is 'high' only when every component is high; anything in between is
 * 'mixed', which is a real state and worth naming rather than rounding in either direction.
 */
export function edgeConfidence(edge: CouplingGraphEdge): EdgeConfidence {
  if (edge.components.length === 0) return 'approximate';
  const high = edge.components.filter((c) => c.confidence === 'high').length;
  if (high === edge.components.length) return 'high';
  return high === 0 ? 'approximate' : 'mixed';
}

export function summariseCoverage(graph: CouplingGraph): CoverageSummary {
  const edgesByConfidence: Record<EdgeConfidence, number> = { high: 0, mixed: 0, approximate: 0 };
  let totalComponents = 0;
  let highComponents = 0;

  for (const edge of graph.edges) {
    edgesByConfidence[edgeConfidence(edge)] += 1;
    for (const c of edge.components) {
      totalComponents += 1;
      if (c.confidence === 'high') highComponents += 1;
    }
  }

  const approximateComponents = totalComponents - highComponents;
  return {
    totalComponents,
    highComponents,
    approximateComponents,
    approximateShare: totalComponents === 0 ? 0 : approximateComponents / totalComponents,
    totalEdges: graph.edges.length,
    edgesByConfidence,
    whollyApproximateShare:
      graph.edges.length === 0 ? 0 : edgesByConfidence.approximate / graph.edges.length,
  };
}

/**
 * A one-line reading of the summary, phrased so it cannot be mistaken for a quality score.
 * It describes what the evidence is, not how good the org is.
 */
export function coverageHeadline(s: CoverageSummary): string {
  if (s.totalComponents === 0) return 'No coupling evidence was collected.';
  const pct = Math.round(s.approximateShare * 100);
  if (pct === 0) return 'Every coupling is backed by exact evidence (Apex SymbolTable or Flow XML).';
  return (
    `${pct}% of coupling evidence is approximate: inferred by regex from Apex bodies that had ` +
    'no SymbolTable. Treat those couplings as leads, not facts.'
  );
}
