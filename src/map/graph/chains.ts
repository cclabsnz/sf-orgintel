import type { CouplingGraphEdge, CouplingConfidence } from '@cclabsnz/sf-core';

export interface ProcessChain {
  /** Objects in the order the automation touches them. */
  steps: string[];
  /** Summed coupling weight along the chain. */
  weight: number;
  /** The weakest link's confidence — a chain is only as trustworthy as its weakest step. */
  confidence: CouplingConfidence;
}

interface DirectedStep {
  to: string;
  weight: number;
  confidence: CouplingConfidence;
}

/** A process needs at least two steps; a single pair is a coupling, not a process. */
const MIN_STEPS = 3;

/**
 * Chain directional couplings into candidate business processes.
 *
 * A directed edge says "when A changes, B is touched"; following those gives the first output
 * in this tool shaped like a process rather than an association — `Lead -> Opportunity -> Order`.
 *
 * Only directional edges participate. An undirected coupling means the order is unknown, and
 * choosing one would manufacture a process that may not exist — the opposite of what an
 * evidence tool should do.
 *
 * Chains grow greedily, always taking the heaviest available continuation, which keeps this
 * linear rather than enumerating exponentially many paths. Revisits are refused, so a cycle
 * terminates instead of looping.
 */
export function extractProcessChains(edges: readonly CouplingGraphEdge[]): ProcessChain[] {
  const next = new Map<string, DirectedStep[]>();
  const hasIncoming = new Set<string>();

  const link = (from: string, to: string, e: CouplingGraphEdge): void => {
    const confidence: CouplingConfidence = e.components.some((c) => c.confidence === 'approximate')
      ? 'approximate'
      : 'high';
    if (!next.has(from)) next.set(from, []);
    next.get(from)!.push({ to, weight: e.weight, confidence });
    hasIncoming.add(to);
  };

  for (const e of edges) {
    if (!e.direction) continue;
    if (e.direction === 'from-to' || e.direction === 'both') link(e.from, e.to, e);
    if (e.direction === 'to-from' || e.direction === 'both') link(e.to, e.from, e);
  }

  // Heaviest continuation first, name as tie-break, so growth is deterministic.
  for (const steps of next.values()) {
    steps.sort((a, b) => b.weight - a.weight || a.to.localeCompare(b.to));
  }

  // Prefer starting where nothing flows in — those are the true beginnings of a process.
  const starts = [...next.keys()].sort();
  const sources = starts.filter((s) => !hasIncoming.has(s));
  const seeds = sources.length > 0 ? [...sources, ...starts] : starts;

  const chains: ProcessChain[] = [];
  for (const seed of seeds) {
    const chain = grow(seed, next);
    if (chain.steps.length >= MIN_STEPS) chains.push(chain);
  }

  return rankAndDedupe(chains);
}

/** Walk forward from `seed`, always taking the heaviest unvisited continuation. */
function grow(seed: string, next: Map<string, DirectedStep[]>): ProcessChain {
  const steps = [seed];
  const seen = new Set([seed]);
  let weight = 0;
  let confidence: CouplingConfidence = 'high';

  for (;;) {
    const options = next.get(steps[steps.length - 1]);
    const step = options?.find((o) => !seen.has(o.to));
    if (!step) break;
    steps.push(step.to);
    seen.add(step.to);
    weight += step.weight;
    if (step.confidence === 'approximate') confidence = 'approximate';
  }

  return { steps, weight, confidence };
}

/** Drop chains wholly contained in a longer one, then rank by weight. */
function rankAndDedupe(chains: ProcessChain[]): ProcessChain[] {
  const ordered = [...chains].sort(
    (a, b) => b.steps.length - a.steps.length || b.weight - a.weight || a.steps[0].localeCompare(b.steps[0]),
  );

  const kept: ProcessChain[] = [];
  for (const c of ordered) {
    const joined = c.steps.join(' ');
    if (kept.some((k) => k.steps.join(' ').includes(joined))) continue;
    kept.push(c);
  }

  return kept.sort(
    (a, b) => b.weight - a.weight || b.steps.length - a.steps.length || a.steps[0].localeCompare(b.steps[0]),
  );
}
