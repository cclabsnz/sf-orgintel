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
} from '@cclabsnz/sf-core';
import { buildMapFragment } from '../../../src/map/fragment.js';
import { input } from './fixtures/input.js';

/** Every `obj.*` endpoint the fragment's edges reference, touches and couples alike. */
function objectsReferencedBy(fragment: CanonicalGraph): string[] {
  return [
    ...new Set(
      fragment.edges.flatMap((e) => [e.from, e.to]).filter((id) => id.startsWith('obj.')),
    ),
  ]
    .map((id) => id.slice('obj.'.length))
    .sort();
}

/** Stands in for an `sf orgviz extract`: the object nodes this fragment's edges point at. */
function extraction(objects: string[], capturedAt: string, orgId: string): CanonicalGraph {
  return {
    schemaVersion: SUPPORTED_GRAPH_SCHEMA_VERSION,
    capturedAt,
    orgId,
    producer: 'orgviz',
    nodes: objects.map((name) => ({
      id: `obj.${name}`,
      kind: 'sobject',
      layer: layerOfKind('sobject'),
      level: levelOfKind('sobject'),
      parent: null,
      label: name,
      attrs: { role: roleOf(name) },
      provenance: { source: 'metadata', capturedAt },
    })),
    edges: [],
    coverage: { notes: [], unavailable: [] },
  };
}

describe('the map fragment in a merge', () => {
  it('merges with an extraction into one graph that validates clean', () => {
    const fragment = buildMapFragment(input());
    const objects = objectsReferencedBy(fragment);
    const result = mergeGraphs([extraction(objects, fragment.capturedAt, fragment.orgId), fragment]);
    expect(result.findings).toEqual([]);
    expect(validateGraph(result.graph)).toEqual([]);
  });

  it('lands its measurements on the objects the other tool owns', () => {
    const fragment = buildMapFragment(input());
    const objects = objectsReferencedBy(fragment);
    const { graph, report } = mergeGraphs([extraction(objects, fragment.capturedAt, fragment.orgId), fragment]);
    expect(report.contributionsApplied).toBeGreaterThan(0);
    const account = graph!.nodes.find((n) => n.id === 'obj.Account')!;
    // Namespaced, so "who asserted this" stays answerable. Spec 3.3.
    expect(account.attrs.orgintel).toHaveProperty('recordCount90d');
    expect(account.attrs.role).toBe(roleOf('Account'));
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
