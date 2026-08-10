// src/anatomy/attribute.ts
// Pure. Everything here is a judgement about evidence, so it is kept away from IO and tested
// directly. Detection and attribution are separate axes: an edge can be proven and still
// have no known owner, which on a real org is the most common honest state.
import type { ChainHop, IntegrationEdge, PrefixRegistry } from './types.js';

export interface RemoteActionRef {
  omniProcess: string;
  remoteClass: string;
}

/**
 * Turn OmniStudio Remote Actions into edges. A Remote Action names an Apex class rather than
 * an endpoint, so the real path is procedure to class to callout. Both hops are recorded:
 * the procedure is the consumer, the class is where the call physically lives, and a reader
 * deciding who to talk to needs both.
 */
export function resolveChains(
  remoteActions: readonly RemoteActionRef[],
  apexCallouts: ReadonlyMap<string, readonly string[]>,
): IntegrationEdge[] {
  const out: IntegrationEdge[] = [];
  for (const ref of remoteActions) {
    const via: ChainHop[] = [
      { type: 'OmniProcess', name: ref.omniProcess },
      { type: 'ApexClass', name: ref.remoteClass },
    ];
    const endpoints = apexCallouts.get(ref.remoteClass) ?? [];
    if (endpoints.length === 0) {
      // Unreadable or callout-free class. The procedure still reached out; we cannot say where.
      out.push({ endpoint: null, from: null, via: [...via], detection: 'remoteActionChain', attribution: 'unattributed' });
      continue;
    }
    for (const endpoint of endpoints) {
      // Each sibling edge gets its own via array. Sharing one instance across edges emitted
      // for the same class would let a later mutation on one edge silently corrupt the rest.
      out.push({ endpoint, from: null, via: [...via], detection: 'remoteActionChain', attribution: 'unattributed' });
    }
  }
  return out;
}

/** Longest prefix wins, so ACMEX is not attributed to ACME when both are registered. */
function productFor(name: string, registry: PrefixRegistry): string | null {
  const upper = name.toUpperCase();
  let best: string | null = null;
  for (const [prefix, product] of registry.byPrefix) {
    if (upper.startsWith(prefix) && (best === null || prefix.length > best.length)) best = product;
  }
  return best;
}

/**
 * Attach an owner where one can be established. Hops are tried in order, so the consuming
 * artifact wins over the shared plumbing it calls. Never guesses: an edge with no resolvable
 * hop stays `unattributed` regardless of how firmly it was detected.
 */
export function attributeEdges(
  edges: readonly IntegrationEdge[],
  registry: PrefixRegistry,
): IntegrationEdge[] {
  return edges.map((e) => {
    for (const hop of e.via) {
      const product = productFor(hop.name, registry);
      // Clone via so the output never aliases the input's array; a shallow spread of e would
      // otherwise carry the same array reference straight through.
      if (product) return { ...e, from: product, attribution: 'prefixMatch', via: [...e.via] };
    }
    return { ...e, from: null, attribution: 'unattributed', via: [...e.via] };
  });
}
