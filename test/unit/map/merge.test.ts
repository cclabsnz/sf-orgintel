// The point of the fragment. Everything else checks its shape; this checks that it composes.
//
// The extraction stub below stands in for `sf orgviz extract`. The brief this test was drafted
// from derived its object list from the fragment's `couples` edges only -- but the fragment also
// emits `touches` edges from every component node (flow/apexClass/trigger) straight to the
// objects it references, and a component can touch an object that never ends up in a coupling
// pair. Deriving from `couples` alone would leave such an object out of the extraction, and the
// merge would then fail with GRAPH_EDGE_ENDPOINT_UNRESOLVED on a `touches` edge -- a fragment bug
// that isn't one, caused by an incomplete stub. So this derives the object list from every
// `obj.`-prefixed endpoint across ALL edges (touches and couples alike), matching what a real
// `sf-orgviz extract` would actually have captured.
//
// Task 3 adds a contribution to `org.root`, which is not an edge endpoint at all -- it is a
// nodeId the fragment's `contributions` reference directly. An extraction stub built from edges
// alone would leave `org.root` undeclared, and the merge would refuse the fragment with
// GRAPH_MERGE_CONTRIBUTION_UNRESOLVED. So the id list below is drawn from edges AND
// contributions, and the stub declares a node of the right kind for either prefix it finds.
import { describe, it, expect } from '@jest/globals';
import {
  mergeGraphs,
  validateGraph,
  roleOf,
  layerOfKind,
  levelOfKind,
  GRAPH_RULES,
  SUPPORTED_GRAPH_SCHEMA_VERSION,
  type CanonicalGraph,
  type GraphNode,
  type GraphNodeKind,
} from '@cclabsnz/sf-core';
import { buildMapFragment } from '../../../src/map/fragment.js';
import { input } from './fixtures/input.js';

/** The id shapes sf-orgviz owns that this fragment references, and how to build a node. */
const KIND_BY_PREFIX: Record<string, GraphNodeKind> = {
  obj: 'sobject',
  org: 'org',
};

/**
 * Every id the fragment references but does not declare as one of its own nodes -- via edge
 * endpoints (`obj.*`, touches and couples alike) and via contributions' `nodeId` (`org.root`).
 * Those belong to the other producer, and are exactly what an `sf orgviz extract` would need to
 * supply for the merge to resolve.
 */
function idsOwnedByOtherProducer(fragment: CanonicalGraph): string[] {
  const ownIds = new Set(fragment.nodes.map((n) => n.id));
  const referenced = new Set<string>();
  for (const e of fragment.edges) {
    referenced.add(e.from);
    referenced.add(e.to);
  }
  for (const c of fragment.contributions ?? []) referenced.add(c.nodeId);
  return [...referenced].filter((id) => !ownIds.has(id)).sort();
}

function kindOf(id: string): GraphNodeKind {
  const prefix = id.slice(0, id.indexOf('.'));
  const kind = KIND_BY_PREFIX[prefix];
  if (!kind) throw new Error(`merge.test.ts's extraction stub has no kind mapping for id ${id}`);
  return kind;
}

/** Stands in for an `sf orgviz extract`: the nodes this fragment's edges and contributions point at. */
function extraction(ids: string[], capturedAt: string, orgId: string): CanonicalGraph {
  const nodes: GraphNode[] = ids.map((id) => {
    const kind = kindOf(id);
    const name = id.slice(id.indexOf('.') + 1);
    const attrs: Record<string, unknown> = kind === 'sobject' ? { role: roleOf(name) } : {};
    return {
      id,
      kind,
      layer: layerOfKind(kind),
      level: levelOfKind(kind),
      parent: null,
      label: name,
      attrs,
      provenance: { source: 'metadata', capturedAt },
    };
  });
  return {
    schemaVersion: SUPPORTED_GRAPH_SCHEMA_VERSION,
    capturedAt,
    orgId,
    producer: 'orgviz',
    nodes,
    edges: [],
    coverage: { notes: [], unavailable: [] },
  };
}

describe('the map fragment in a merge', () => {
  it('merges with an extraction into one graph that validates clean', () => {
    const fragment = buildMapFragment(input());
    const ids = idsOwnedByOtherProducer(fragment);
    const result = mergeGraphs([extraction(ids, fragment.capturedAt, fragment.orgId), fragment]);
    expect(result.findings).toEqual([]);
    expect(validateGraph(result.graph)).toEqual([]);
  });

  it('lands its measurements on the objects the other tool owns', () => {
    const fragment = buildMapFragment(input());
    const ids = idsOwnedByOtherProducer(fragment);
    const { graph, report } = mergeGraphs([extraction(ids, fragment.capturedAt, fragment.orgId), fragment]);
    expect(report.contributionsApplied).toBeGreaterThan(0);
    const account = graph!.nodes.find((n) => n.id === 'obj.Account')!;
    // Namespaced, so "who asserted this" stays answerable. Spec 3.3.
    expect(account.attrs.orgintel).toHaveProperty('recordCount90d');
    expect(account.attrs.role).toBe(roleOf('Account'));
  });

  it('lands the analysed counts on org.root, namespaced under orgintel', () => {
    const fragment = buildMapFragment(input());
    const ids = idsOwnedByOtherProducer(fragment);
    const { graph, findings } = mergeGraphs([extraction(ids, fragment.capturedAt, fragment.orgId), fragment]);
    expect(findings).toEqual([]);
    const root = graph!.nodes.find((n) => n.id === 'org.root')!;
    // Namespaced, so "who asserted this" stays answerable, same as the object contributions
    // above -- and so the census intel anatomy contributes to this node (unnamespaced today,
    // or under its own namespace) is never overwritten by this fragment's number.
    expect(root.attrs.orgintel).toMatchObject({ analysed: { flows: 2, apexClasses: 1, apexTriggers: 0 } });
    expect(root.attrs).not.toHaveProperty('analysed');
  });

  it('reports every endpoint as unresolved when the extraction is absent', () => {
    // The fragment is deliberately not standalone-valid: its coupling and touches edges point at
    // objects it never declares, because `sobject` belongs to the other producer. This pins that
    // the failure is the legible one -- a named unresolved endpoint per edge -- rather than
    // something obscure.
    const findings = validateGraph(buildMapFragment(input()));
    expect(findings.map((f) => f.code)).toContain(GRAPH_RULES.EDGE_ENDPOINT_UNRESOLVED);
  });
});
