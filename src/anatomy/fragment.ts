// The anatomy fragment: sf-orgintel's other half of one canonical org graph.
//
// `intel anatomy` keeps its own collectors and its own `AnatomyArtifact` shape unchanged -- that
// artifact is still the command's output. What this module adds is a second rendering of the
// same facts, in the schema sf-orgviz also writes, so the two commands describe one org rather
// than two.
//
// The constraint that shapes everything here: this fragment emits no kind another producer
// owns. No `obj.*`, no `profile.*`, no `org.root` nodes -- those belong to sf-orgviz, and the
// merge (`mergeGraphs`) rejects a fragment that emits a kind belonging to another producer, which
// would fail every node in the fragment and return no merged graph at all. Facts about those
// nodes travel as `AttributeContribution`s instead (CONVERGENCE_SPEC.md 3.3).
//
// Three rulings, recorded in CONVERGENCE_SPEC.md 4.2, shape the disposition below:
//   - A persona is not an entity. `sf-orgviz` already emits `profile.<Name>`; `licence`,
//     `activeUsers` and `landingApp` are measurements about that node, not a new one.
//   - A product is derived, not observed: nothing in the org declares one, `buildPrefixRegistry`
//     mines it from component name prefixes. Every `product` node therefore carries
//     `provenance.source: 'derived'` and a rule naming the mining.
//   - A channel is a site, today: the collector populates only `type: 'site'`; the other
//     variants are simply absent from this population, not fabricated as empty.
//
// The fragment carries no `obj.*`/`profile.*`/`org.root` nodes on purpose, which means it does
// not validate standalone: `validateGraph` reports unresolved endpoints for every contribution
// and cross-producer edge until this is merged with an extraction that supplies those nodes.
// That is the designed normal case (CONVERGENCE_SPEC.md 3.1-3.2), not a defect to fix here.
import {
  layerOfKind,
  levelOfKind,
  SUPPORTED_GRAPH_SCHEMA_VERSION,
  type CanonicalGraph,
  type GraphNode,
  type GraphEdge,
  type GraphProvenance,
  type AttributeContribution,
} from '@cclabsnz/sf-core';
import type { Product, Persona, Channel, Capabilities, Identity, IntegrationEdge } from './types.js';

/**
 * The collectors' output, shaped for `buildAnatomyFragment`. Deliberately the same six
 * populations `runAnatomy` assembles into `AnatomyArtifact` (minus `version`, `provenance` and
 * `coverage`, which the fragment's own envelope replaces) plus the two capture-time facts every
 * fragment needs. `capabilities.platformEvents` and `capabilities.namedCredentials` are read by
 * this type but never emitted: both are already derivable from the merged graph (4.2), and
 * emitting them here would duplicate a fact another producer already states.
 */
export interface AnatomyFragmentInput {
  products: Product[];
  personas: Persona[];
  channels: Channel[];
  capabilities: Capabilities;
  identity: Identity;
  edges: IntegrationEdge[];
  capturedAt: string;
  orgId: string;
}

const PRODUCER = 'orgintel' as const;

/** Names the inference `product` nodes encode, for their required `derived.rule`. */
const PRODUCT_RULE = 'anatomy.products.prefix-registry';

/**
 * Names the inference an integration edge encodes when it is expressed at product granularity.
 * The edge only exists because `attributeEdges` traced a calling component back to a product by
 * prefix match -- the class-level fact has no node of its own in this fragment -- so the edge
 * itself is the derived artifact, not a directly observed link between two nodes.
 */
const EDGE_ATTRIBUTION_RULE = 'anatomy.edges.prefix-attribution';

/**
 * Codepoint order, not locale order. `localeCompare` is ICU/collation-dependent, so ordering by
 * it is not byte-stable across machines and disagrees with the merge's own ordering, which sorts
 * by codepoint. Mirrors `src/map/fragment.ts`.
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Pure assembly: the collectors' output -> this producer's graph fragment. */
export function buildAnatomyFragment(input: AnatomyFragmentInput): CanonicalGraph {
  const metadata: GraphProvenance = { source: 'metadata', capturedAt: input.capturedAt };
  const derivedProduct: GraphProvenance = {
    source: 'derived',
    rule: PRODUCT_RULE,
    capturedAt: input.capturedAt,
  };
  const derivedEdge: GraphProvenance = {
    source: 'derived',
    rule: EDGE_ATTRIBUTION_RULE,
    capturedAt: input.capturedAt,
  };

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const contributions: AttributeContribution[] = [];

  // channels (type 'site') -> site.<Name> nodes, metadata provenance. The other three Channel
  // variants (app/console/api) are never populated by the collector today, so nothing is
  // emitted for them here -- absence is recorded upstream in AnatomyCoverage, not fabricated as
  // an empty node.
  for (const channel of input.channels) {
    if (channel.type !== 'site') continue;
    nodes.push({
      id: `site.${channel.name}`,
      kind: 'site',
      layer: layerOfKind('site'),
      level: levelOfKind('site'),
      parent: null,
      label: channel.name,
      attrs: { status: channel.status },
      provenance: metadata,
    });
  }

  // products -> product.<key> nodes, derived provenance with a rule naming the mining. Never
  // `metadata`: no describe call or metadata record names a product, `buildPrefixRegistry` mines
  // it from component name prefixes.
  for (const product of input.products) {
    nodes.push({
      id: `product.${product.key}`,
      kind: 'product',
      layer: layerOfKind('product'),
      level: levelOfKind('product'),
      parent: null,
      label: product.label,
      attrs: {
        source: product.source,
        componentCount: product.componentCount,
        prefixes: [...product.prefixes].sort(compare),
      },
      provenance: derivedProduct,
    });
  }

  // identity.ssoConfigs -> ssoConfig.<issuer> nodes, metadata provenance. Falls back to the
  // config's type when the issuer is absent (a SamlSsoConfig or AuthProvider row is not
  // guaranteed to carry one), rather than collapsing every issuer-less config onto one id.
  for (const sso of input.identity.ssoConfigs) {
    const id = `ssoConfig.${sso.issuer ?? sso.type}`;
    nodes.push({
      id,
      kind: 'ssoConfig',
      layer: layerOfKind('ssoConfig'),
      level: levelOfKind('ssoConfig'),
      parent: null,
      label: sso.issuer ?? sso.type,
      attrs: {
        type: sso.type,
        identityMapping: sso.identityMapping,
        userProvisioning: sso.userProvisioning,
      },
      provenance: metadata,
    });
  }

  // personas -> contributions on the profile.<name> node sf-orgviz already emits. A persona is
  // not a new entity: the profile is the identity, licence/activeUsers/landingApp are
  // measurements about it (CONVERGENCE_SPEC.md 4.2).
  for (const persona of input.personas) {
    contributions.push({
      nodeId: `profile.${persona.profile}`,
      attrs: {
        licence: persona.licence,
        activeUsers: persona.activeUsers,
        landingApp: persona.landingApp,
      },
    });
  }

  // capabilities.changeDataCapture -> contributions on the obj.<Entity> nodes sf-orgviz already
  // emits. A property of an object, recorded on the object, not a list living nowhere.
  for (const entity of [...input.capabilities.changeDataCapture].sort(compare)) {
    contributions.push({ nodeId: `obj.${entity}`, attrs: { changeDataCapture: true } });
  }

  // capabilities scalars, eventRelayConfigured and identity.loginsByType describe the org rather
  // than any entity in it, so they land as one contribution on org.root (CONVERGENCE_SPEC.md
  // 3.3, 4.2). platformEvents and namedCredentials are deliberately excluded: both are already
  // derivable from the merged graph (every `__e` platform event is already an `obj.*` node, and
  // sf-orgviz extracts every named credential), so emitting them here would duplicate a fact
  // another producer already states. The seven counts stay measurements, not a query over the
  // graph: `intel map` only ever sees active flows and can lose ApexClass access entirely, so a
  // graph-derived count would silently understate what the org actually contains.
  contributions.push({
    nodeId: 'org.root',
    attrs: {
      flows: input.capabilities.flows,
      apexClasses: input.capabilities.apexClasses,
      apexTriggers: input.capabilities.apexTriggers,
      lwc: input.capabilities.lwc,
      aura: input.capabilities.aura,
      externalDataSources: input.capabilities.externalDataSources,
      remoteSites: input.capabilities.remoteSites,
      eventRelayConfigured: input.capabilities.eventRelayConfigured,
      loginsByType: input.identity.loginsByType,
    },
  });

  // edges (IntegrationEdge) -> graph edges between the nodes they already name, evidence
  // carried in attrs (CONVERGENCE_SPEC.md 4.2, 3.1). An edge is only emitted when both ends are
  // expressible under a kind some producer owns:
  //   - `from`, once attributed, is a product key -- exactly the node this fragment already
  //     emits as `product.<key>`. An edge with no attribution (`from === null`) has no node to
  //     anchor it on this side and is left out, same as an unresolved coupling elsewhere in this
  //     schema: it is not fabricated onto a node that does not exist.
  //   - `endpoint` is a NamedCredential-shaped destination unless the via chain names a
  //     RemoteProxy directly (the `endpointOnly` / RemoteProxy path in attribute.ts): a Remote
  //     Site Setting has no owned kind in the schema yet (that is future work, per
  //     CONVERGENCE_SPEC.md 4.2's non-goals), and labelling it `namedCredential.*` would assert a
  //     credentialed system that was never observed. Those edges are left out rather than
  //     mislabelled.
  // The edge itself is `derived`, not `metadata`: it only exists at product granularity because
  // `attributeEdges` traced the calling component back to a product by prefix match, and this
  // fragment emits no node for the component itself.
  for (const edge of input.edges) {
    if (edge.from === null || edge.endpoint === null) continue;
    if (edge.via.some((hop) => hop.type === 'RemoteProxy')) continue;
    edges.push({
      from: `product.${edge.from}`,
      to: `namedCredential.${edge.endpoint}`,
      kind: 'integrates',
      attrs: {
        detection: edge.detection,
        attribution: edge.attribution,
        via: edge.via.map((hop) => ({ type: hop.type, name: hop.name })),
      },
      provenance: derivedEdge,
    });
  }

  nodes.sort((a, b) => compare(a.id, b.id));
  edges.sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to) || compare(a.kind, b.kind));
  contributions.sort((a, b) => compare(a.nodeId, b.nodeId));

  return {
    schemaVersion: SUPPORTED_GRAPH_SCHEMA_VERSION,
    capturedAt: input.capturedAt,
    orgId: input.orgId,
    nodes,
    edges,
    coverage: { notes: [], unavailable: [] },
    producer: PRODUCER,
    contributions,
  };
}
