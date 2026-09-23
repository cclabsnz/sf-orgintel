// Adapts the graph fragment (`buildMapFragment`'s output) into the shape the map report and
// strata viewer already read off `CouplingGraph`. Spec section 4/5: the renderers took their
// nodes and edges from a second in-memory model of facts the fragment already carries, and this
// closes that gap without changing what either renderer prints.
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
  // The brief's spec types this `string`; `Layer` (still a string at runtime, `roleOf`'s own
  // return type) is used instead because `string` here widens `CouplingGraphNode.layer`'s
  // `ObjectLayer` down to `string` wherever a caller reads `CouplingGraph | CouplingView`,
  // which then fails `computeStrataLayout`'s `StrataObject.layer: Layer` downstream. See
  // task-1-report.md.
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
 */
export function couplingViewOf(fragment: CanonicalGraph): CouplingView {
  const nodes: CouplingViewNode[] = (fragment.contributions ?? [])
    .filter((c) => c.nodeId.startsWith(OBJ_PREFIX))
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
