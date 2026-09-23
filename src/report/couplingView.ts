// Adapts the graph fragment (`buildMapFragment`'s output) into the shape the map report and
// strata viewer used to read off `CouplingGraph`. The renderers took their nodes and edges from
// a second in-memory model of facts the fragment already carries; 1.0 deleted that model, and
// this adapter is what lets the renderers go on printing exactly what they printed before --
// pinned byte for byte by test/unit/report/renderGolden.test.ts.
import type {
  CanonicalGraph,
  CouplingComponentRef,
  CouplingDirection,
  CouplingOperation,
} from '@cclabsnz/sf-core';
import { roleOf, type Layer } from '../map/graph/layers.js';

/** The subset of CouplingGraphNode the renderers actually read, sourced from the fragment. */
export interface CouplingViewNode {
  object: string;
  // Typed `Layer` (`roleOf`'s own return type, a string union) rather than the bare `string` it
  // would be tempting to use here. `string` would widen `CouplingGraphNode.layer`'s `ObjectLayer`
  // down to `string` wherever a caller reads a value typed `CouplingGraph | CouplingView`, which
  // then fails to satisfy `computeStrataLayout`'s `StrataObject.layer: Layer` downstream -- a
  // type error in the strata viewer, reported from a call site nowhere near this line.
  layer: Layer;
  automationCounts: { flows: number; triggers: number; approvals: number };
  recordCount90d: number;
}

/** Shaped exactly like CouplingGraphEdge, so edgeConfidence and the table need no changes. */
export interface CouplingViewEdge {
  from: string;
  to: string;
  weight: number;
  operations: CouplingOperation[];
  components: CouplingComponentRef[];
  direction?: CouplingDirection;
}

export interface CouplingView {
  nodes: CouplingViewNode[];
  edges: CouplingViewEdge[];
}

const OBJ_PREFIX = 'obj.';

/** `obj.Account` -> `Account`, which is what the renderers display and what `roleOf` expects. */
function stripObjPrefix(nodeId: string): string {
  return nodeId.startsWith(OBJ_PREFIX) ? nodeId.slice(OBJ_PREFIX.length) : nodeId;
}

/** The shape `buildMapFragment` gives an `obj.*` contribution's attrs. */
interface ObjectContributionAttrs {
  recordCount90d: number;
  automationCounts: { flows: number; triggers: number; approvals: number; workflowRules: number };
}

/** The shape `buildMapFragment` gives a `couples` edge's attrs. */
interface CouplesEdgeAttrs {
  weight: number;
  operations: CouplingOperation[];
  components: CouplingComponentRef[];
  direction?: CouplingDirection;
}

/**
 * Adapt the fragment into what the map report and strata viewer read. Node order is the
 * contributions' order (`buildMapFragment` already sorts it by codepoint, `org.root` excluded by
 * the `obj.` filter); edge order is the fragment's own, unchanged by the `couples` filter.
 *
 * Nodes are restricted to objects that appear in a `couples` edge, which is the population the
 * deleted `CouplingGraph` carried: `buildNodes(edges, info)` collected exactly the `from`/`to`
 * of its edges. The fragment contributes one `obj.*` entry per KNOWN object -- on a real org,
 * the whole sObject catalog, since `runMap` passes `catalog.all()` as `knownObjects` -- so the
 * `obj.` prefix alone is a far wider set, and the report's `Objects` figure and its layer table
 * both read `nodes` unfiltered. The participant set is derived from this fragment's own
 * `couples` edges rather than from `knownObjects` or any other outside input, so the adapter
 * stays a pure function of its argument.
 */
export function couplingViewOf(fragment: CanonicalGraph): CouplingView {
  const coupled = new Set<string>();
  for (const e of fragment.edges) {
    if (e.kind !== 'couples') continue;
    coupled.add(stripObjPrefix(e.from));
    coupled.add(stripObjPrefix(e.to));
  }

  const nodes: CouplingViewNode[] = (fragment.contributions ?? [])
    .filter((c) => c.nodeId.startsWith(OBJ_PREFIX) && coupled.has(stripObjPrefix(c.nodeId)))
    .map((c) => {
      const object = stripObjPrefix(c.nodeId);
      const attrs = c.attrs as unknown as ObjectContributionAttrs;
      return {
        object,
        layer: roleOf(object),
        automationCounts: {
          flows: attrs.automationCounts.flows,
          triggers: attrs.automationCounts.triggers,
          approvals: attrs.automationCounts.approvals,
        },
        recordCount90d: attrs.recordCount90d,
      };
    });

  const edges: CouplingViewEdge[] = fragment.edges
    .filter((e) => e.kind === 'couples')
    .map((e) => {
      const attrs = e.attrs as unknown as CouplesEdgeAttrs;
      return {
        from: stripObjPrefix(e.from),
        to: stripObjPrefix(e.to),
        weight: attrs.weight,
        operations: attrs.operations,
        components: attrs.components,
        // Absent rather than undefined-but-present, preserving the fragment's own distinction
        // between "no directional evidence" and "known undirected".
        ...(attrs.direction ? { direction: attrs.direction } : {}),
      };
    });

  return { nodes, edges };
}
