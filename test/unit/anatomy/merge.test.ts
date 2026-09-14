// The point of the fragment. Everything else checks its shape; this checks that it composes.
//
// The anatomy fragment references at least four id shapes that belong to sf-orgviz, not one:
// `profile.*` and `org.root` from its contributions, `obj.*` from its `changeDataCapture`
// contributions, and `ncred.*` from its `integrates` edge targets. A stub extraction built from
// only one of those collections (say, contributions alone, or edges alone) would leave the other
// shape's node missing, and the merge would fail with GRAPH_EDGE_ENDPOINT_UNRESOLVED or an
// unresolved contribution -- a fragment bug that isn't one, caused by an incomplete stub. So this
// derives the extraction's node list from every id the fragment references, across contributions
// AND edges, minus the ids the fragment already declares as its own nodes, matching what a real
// `sf orgviz extract` would actually have captured.
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
import { buildAnatomyFragment } from '../../../src/anatomy/fragment.js';
import { input } from './fixtures/input.js';

/** The four id shapes sf-orgviz owns that this fragment references, and how to build a node. */
const KIND_BY_PREFIX: Record<string, GraphNodeKind> = {
  obj: 'sobject',
  profile: 'profile',
  org: 'org',
  ncred: 'namedCredential',
};

/**
 * Every id the fragment references -- via contributions' `nodeId` and via edges' `from`/`to` --
 * that the fragment itself does not declare as a node. Those belong to the other producer, and
 * are exactly what an `sf orgviz extract` would need to supply for the merge to resolve. Derived
 * programmatically, not hardcoded, so it cannot drift from the fragment it stubs for.
 */
function idsOwnedByOtherProducer(fragment: CanonicalGraph): string[] {
  const ownIds = new Set(fragment.nodes.map((n) => n.id));
  const referenced = new Set<string>();
  for (const c of fragment.contributions ?? []) referenced.add(c.nodeId);
  for (const e of fragment.edges) {
    referenced.add(e.from);
    referenced.add(e.to);
  }
  return [...referenced].filter((id) => !ownIds.has(id)).sort();
}

function kindOf(id: string): GraphNodeKind {
  const prefix = id.slice(0, id.indexOf('.'));
  const kind = KIND_BY_PREFIX[prefix];
  if (!kind) throw new Error(`merge.test.ts's extraction stub has no kind mapping for id ${id}`);
  return kind;
}

/** Stands in for an `sf orgviz extract`: the nodes this fragment's contributions and edges reference. */
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

describe('the anatomy fragment in a merge', () => {
  it('merges with an extraction into one graph that validates clean', () => {
    const fragment = buildAnatomyFragment(input());
    const ids = idsOwnedByOtherProducer(fragment);
    const result = mergeGraphs([extraction(ids, fragment.capturedAt, fragment.orgId), fragment]);
    // Asserted before anything that would dereference `result.graph`: a merge failure must show
    // up as a finding here, not as a confusing TypeError on a null graph further down.
    expect(result.findings).toEqual([]);
    expect(validateGraph(result.graph!)).toEqual([]);
  });

  it('lands persona measurements on the profile node, namespaced under orgintel', () => {
    const fragment = buildAnatomyFragment(input());
    const ids = idsOwnedByOtherProducer(fragment);
    const { graph, findings } = mergeGraphs([
      extraction(ids, fragment.capturedAt, fragment.orgId),
      fragment,
    ]);
    expect(findings).toEqual([]);
    const admin = graph!.nodes.find((n) => n.id === 'profile.SystemAdministrator')!;
    // Namespaced, so "who asserted this" stays answerable. Spec 3.3 -- the design's central
    // claim. A test asserting the un-namespaced path would pass while that property was broken.
    expect(admin.attrs.orgintel).toMatchObject({ activeUsers: 5 });
    expect(admin.attrs).not.toHaveProperty('activeUsers');
  });

  it('lands org-wide counts on org.root, namespaced under orgintel', () => {
    const fragment = buildAnatomyFragment(input());
    const ids = idsOwnedByOtherProducer(fragment);
    const { graph, findings } = mergeGraphs([
      extraction(ids, fragment.capturedAt, fragment.orgId),
      fragment,
    ]);
    expect(findings).toEqual([]);
    const root = graph!.nodes.find((n) => n.id === 'org.root')!;
    expect(root.attrs.orgintel).toMatchObject({ lwc: 12, flows: 6 });
    expect(root.attrs).not.toHaveProperty('lwc');
  });

  it('lands the changeDataCapture contribution on the object node it names', () => {
    const fragment = buildAnatomyFragment(input());
    const ids = idsOwnedByOtherProducer(fragment);
    const { graph, findings } = mergeGraphs([
      extraction(ids, fragment.capturedAt, fragment.orgId),
      fragment,
    ]);
    expect(findings).toEqual([]);
    const account = graph!.nodes.find((n) => n.id === 'obj.Account')!;
    expect(account.attrs.orgintel).toMatchObject({ changeDataCapture: true });
    expect(account.attrs.role).toBe(roleOf('Account'));
  });

  it('still merges clean when two issuer-less SSO configs would have collided under the old id formula', () => {
    // Finding 1's acceptance: two distinct-keyed, issuer-less configs must not just get distinct
    // node ids (fragment.test.ts already pins that) -- the graph they land in must actually
    // merge, since a real `MERGE_ID_COLLISION` returns `graph: null` for the whole thing.
    const base = input();
    const fragment = buildAnatomyFragment({
      ...base,
      identity: {
        ...base.identity,
        ssoConfigs: [
          { type: 'saml', issuer: null, identityMapping: null, userProvisioning: false },
          { type: 'saml', issuer: null, identityMapping: null, userProvisioning: false },
        ],
      },
      ssoConfigKeys: ['Internal_IdP', 'Experience_Cloud_IdP'],
    });
    const ids = idsOwnedByOtherProducer(fragment);
    const result = mergeGraphs([extraction(ids, fragment.capturedAt, fragment.orgId), fragment]);
    expect(result.findings).toEqual([]);
    expect(validateGraph(result.graph!)).toEqual([]);
    expect(result.graph!.nodes.filter((n) => n.kind === 'ssoConfig')).toHaveLength(2);
  });

  it('still merges clean when two unnamed sites would have collided under the old id formula', () => {
    const base = input();
    const fragment = buildAnatomyFragment({
      ...base,
      channels: [
        { type: 'site', name: 'unknown', status: 'Active' },
        { type: 'site', name: 'unknown', status: 'Active' },
      ],
      channelKeys: ['First_Unnamed_Site', 'Second_Unnamed_Site'],
    });
    const ids = idsOwnedByOtherProducer(fragment);
    const result = mergeGraphs([extraction(ids, fragment.capturedAt, fragment.orgId), fragment]);
    expect(result.findings).toEqual([]);
    expect(validateGraph(result.graph!)).toEqual([]);
    expect(result.graph!.nodes.filter((n) => n.kind === 'site')).toHaveLength(2);
  });

  it('reports an unresolved edge endpoint when the extraction is absent', () => {
    // The fragment is deliberately not standalone-valid: its `integrates` edges point at
    // named credentials it never declares, and its contributions point at objects, profiles and
    // the org root it never declares either, because those kinds belong to sf-orgviz. This pins
    // that the failure stays the legible one -- a named unresolved endpoint -- rather than
    // becoming something obscure.
    const findings = validateGraph(buildAnatomyFragment(input()));
    expect(findings.map((f) => f.code)).toContain(GRAPH_RULES.EDGE_ENDPOINT_UNRESOLVED);
  });
});
