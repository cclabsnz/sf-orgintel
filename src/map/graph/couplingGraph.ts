// Edge aggregation for the coupling analysis. 1.0 retired `coupling-graph.json` and the
// `CouplingGraph` document assembled around these edges; what survives here is the merge itself,
// because it is the analysis, not the artifact. `mergeEdges`'s output is what `buildMapFragment`
// turns into the fragment's `couples` edges, and `CouplingGraphEdge` remains its element type --
// a published edge shape this still conforms to, not a document this still emits.
import type { CouplingGraphEdge, CouplingComponentRef, CouplingOperation } from '@cclabsnz/sf-core';
import type { RawEdge, CouplingDirection } from '../types.js';

/**
 * The per-object facts the fragment's `obj.*` contributions are built from. Once also carried a
 * `custom` flag, which existed only for the `CouplingGraphNode` records `buildNodes` wrapped into
 * `coupling-graph.json`; 1.0 deleted that writer and with it the flag's only reader, so the
 * catalog lookup and `__c` regex that computed it are gone too. Only what a contribution actually
 * states belongs here.
 */
export interface NodeInfo {
  automationCounts: { flows: number; triggers: number; approvals: number };
  recordCount90d: number;
}

/** Aggregate raw per-component edges into undirected object-pair edges, ranked by weight. */
export function mergeEdges(raw: RawEdge[]): CouplingGraphEdge[] {
  interface Agg {
    from: string;
    to: string;
    operations: Set<CouplingOperation>;
    components: Map<string, CouplingComponentRef>;
    /** Directional evidence seen in each sense of the canonical pair. */
    forward: boolean;
    reverse: boolean;
  }
  const map = new Map<string, Agg>();

  for (const e of raw) {
    if (e.a === e.b) continue;
    const [from, to] = e.a <= e.b ? [e.a, e.b] : [e.b, e.a];
    const key = `${from}\u0001${to}`;
    let agg = map.get(key);
    if (!agg) {
      agg = { from, to, operations: new Set(), components: new Map(), forward: false, reverse: false };
      map.set(key, agg);
    }
    for (const op of e.operations) agg.operations.add(op);
    // Record which way round the directional evidence ran, against the canonical pair.
    if (e.directed) {
      if (e.a === agg.from) agg.forward = true;
      else agg.reverse = true;
    }
    const ckey = `${e.component.type}\u0001${e.component.name}`;
    const existing = agg.components.get(ckey);
    // Keep the highest-confidence witness of each contributing component.
    if (!existing || (existing.confidence === 'approximate' && e.component.confidence === 'high')) {
      agg.components.set(ckey, {
        type: e.component.type,
        name: e.component.name,
        confidence: e.component.confidence,
      });
    }
  }

  const edges: CouplingGraphEdge[] = [...map.values()].map((a) => ({
    from: a.from,
    to: a.to,
    // Absent rather than a placeholder when nothing directional contributed — "we do not know"
    // must not read as "undirected".
    ...(a.forward || a.reverse
      ? { direction: (a.forward && a.reverse ? 'both' : a.forward ? 'from-to' : 'to-from') as CouplingDirection }
      : {}),
    weight: a.components.size,
    operations: [...a.operations].sort(),
    components: [...a.components.values()].sort(
      (x, y) => x.type.localeCompare(y.type) || x.name.localeCompare(y.name),
    ),
  }));

  edges.sort(
    (x, y) => y.weight - x.weight || x.from.localeCompare(y.from) || x.to.localeCompare(y.to),
  );
  return edges;
}

/**
 * Every object that appears in an edge, in codepoint order.
 *
 * This replaces `buildNodes`, which built the same object list wrapped in full
 * `CouplingGraphNode` records. Those records existed to be serialised into `coupling-graph.json`;
 * the only part the pipeline itself ever used was the object names and their layer, and the layer
 * comes from `roleOf` at every reading site. So the node assembly went with the artifact and the
 * list it was derived from stayed. Same objects, same order.
 */
export function edgeObjects(edges: readonly CouplingGraphEdge[]): string[] {
  const objects = new Set<string>();
  for (const e of edges) {
    objects.add(e.from);
    objects.add(e.to);
  }
  return [...objects].sort();
}
