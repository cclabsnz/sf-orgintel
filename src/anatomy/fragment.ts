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
  type GraphUnavailable,
} from '@cclabsnz/sf-core';
import type {
  Product,
  Persona,
  Channel,
  Capabilities,
  Identity,
  IntegrationEdge,
  ChainHop,
  Unavailable,
} from './types.js';

/**
 * The collectors' output, shaped for `buildAnatomyFragment`. Deliberately the same six
 * populations `runAnatomy` assembles into `AnatomyArtifact` (minus `version`, `provenance` and
 * `coverage`, which the fragment's own envelope replaces) plus the two capture-time facts every
 * fragment needs. `capabilities.platformEvents` and `capabilities.namedCredentials` are read by
 * this type but never emitted: both are already derivable from the merged graph (4.2), and
 * emitting them here would duplicate a fact another producer already states.
 *
 * `channelKeys` and `ssoConfigKeys` are not artifact fields: `Channel` and `SsoConfig` are frozen
 * as part of `anatomy.json`, so the unique key each needs to build a collision-safe node id
 * (`Site.SiteName`, `SamlSsoConfig.DeveloperName`) travels here directly from the collector
 * instead, the way `workflowRulesFor` is threaded past `map/fragment.ts`'s published shapes.
 * `channelKeys[i]` names `channels[i]`; `ssoConfigKeys[i]` names `identity.ssoConfigs[i]`. Both
 * are the same length as the array they key, in the same order, because their collectors sort
 * both arrays together as pairs (see channels.ts/identity.ts).
 */
export interface AnatomyFragmentInput {
  products: Product[];
  personas: Persona[];
  channels: Channel[];
  channelKeys: string[];
  capabilities: Capabilities;
  identity: Identity;
  ssoConfigKeys: string[];
  edges: IntegrationEdge[];
  /**
   * What the collectors could not read, exactly as they recorded it in
   * `artifact.coverage.unavailable`.
   *
   * Load-bearing, not decoration. `collectCapabilities` returns `0` from a refused
   * `COUNT(Id)` and records the refusal only in this list; the fragment then contributes that
   * `0` to `org.root` as `flows`/`apexClasses`/`apexTriggers`. Spec 2.1 invites a consumer to
   * subtract `intel map`'s `analysed` from that census to get a coverage gap, so without the
   * refusal travelling alongside, a refused census yields a silent, unmarked zero and the
   * consumer computes a negative gap with nothing in the graph explaining why.
   *
   * These entries are merged with the fragment's own locally derived ones below rather than
   * replacing them: the two describe different things being absent (a read the org refused
   * versus a population this schema cannot express yet), and both belong in
   * `coverage.unavailable`. `Unavailable` and `GraphUnavailable` are structurally identical,
   * including the reason union, so nothing is translated or lost on the way across.
   */
  unavailable: Unavailable[];
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

/**
 * The object a Change Data Capture event name publishes for, per the platform's own naming
 * convention (Change Data Capture Developer Guide): a standard object's change event is its name
 * with `ChangeEvent` appended (`Account` -> `AccountChangeEvent`); a custom object's replaces the
 * trailing `__c` with `__ChangeEvent` (`Order__c` -> `Order__ChangeEvent`, not
 * `Order__cChangeEvent`). `collectCapabilities`'s `changeDataCapture` already holds the event name
 * (`SelectedEntity` from `PlatformEventChannelMember`), not the object -- contributing straight to
 * `obj.<entity>` targets a node no producer emits (`obj.AccountChangeEvent`) and states a
 * tautology (`changeDataCapture: true` on the change-event object itself) instead of the fact
 * §4.2 actually asks for: that `Account` publishes change events. Returns null for a name that
 * fits neither shape, rather than guessing at an object this fragment cannot name.
 */
function objectForChangeEvent(changeEventName: string): string | null {
  if (changeEventName.endsWith('__ChangeEvent')) {
    return changeEventName.slice(0, -'__ChangeEvent'.length) + '__c';
  }
  if (changeEventName.endsWith('ChangeEvent')) {
    return changeEventName.slice(0, -'ChangeEvent'.length);
  }
  return null;
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
  // Seeded with what the collectors could not read, then extended below with what this
  // assembly itself had to decline. A refused capability count contributes a 0 to org.root,
  // and that 0 is only distinguishable from a measured zero because its refusal is here.
  const unavailable: GraphUnavailable[] = input.unavailable.map((u) => ({
    scope: u.scope,
    reason: u.reason,
    detail: u.detail,
  }));

  // channels (type 'site') -> site.<SiteName> nodes, metadata provenance. Keyed on
  // `channelKeys` (`Site.SiteName`, the site's unique technical name), not on `channel.name`
  // (`Site.Name`, the label): the label is user-editable, not guaranteed unique, and two unnamed
  // sites both default to the identical literal 'unknown' -- either would put a duplicate id in
  // the same graph `mergeGraphs` refuses whole (`MERGE_ID_COLLISION`, `graph: null`), which loses
  // every node in every fragment being merged, not just the duplicate. Falls back to the label
  // only if the key itself is unavailable. The other three Channel variants (app/console/api) are
  // never populated by the collector today, so nothing is emitted for them here. Counted below
  // rather than silently dropped: "absence is data" (spec section 3.2) applies to this fragment's
  // own coverage just as much as to the artifact's.
  let nonSiteChannels = 0;
  let siteIdCollisions = 0;
  const seenSiteIds = new Set<string>();
  for (let i = 0; i < input.channels.length; i++) {
    const channel = input.channels[i];
    if (channel.type !== 'site') {
      nonSiteChannels += 1;
      continue;
    }
    const key = input.channelKeys[i] || channel.name;
    const id = `site.${key}`;
    // Never two nodes sharing an id: if the key still collides (an empty `SiteName` on more than
    // one row, or a genuine duplicate), the second site is collapsed into the first node rather
    // than emitted as a second one, and the collapse is recorded below, not silently dropped.
    if (seenSiteIds.has(id)) {
      siteIdCollisions += 1;
      continue;
    }
    seenSiteIds.add(id);
    nodes.push({
      id,
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

  // identity.ssoConfigs -> ssoConfig.<DeveloperName> nodes, metadata provenance. Keyed on
  // `ssoConfigKeys` (`SamlSsoConfig.DeveloperName`), not on `sso.issuer ?? sso.type`: `issuer` is
  // absent on plenty of real configs (every issuer-less config would then collapse onto the
  // single id `ssoConfig.saml`), and two SAML configs legitimately pointing at the same IdP -- an
  // internal one plus an Experience Cloud one -- would collapse onto one id even with an issuer
  // present. Either puts a duplicate id in the graph `mergeGraphs` refuses whole
  // (`MERGE_ID_COLLISION`, `graph: null`). Falls back to `issuer`/`type` only if the key itself is
  // unavailable.
  let ssoConfigIdCollisions = 0;
  const seenSsoConfigIds = new Set<string>();
  for (let i = 0; i < input.identity.ssoConfigs.length; i++) {
    const sso = input.identity.ssoConfigs[i];
    const key = input.ssoConfigKeys[i] || sso.issuer || sso.type;
    const id = `ssoConfig.${key}`;
    // Never two nodes sharing an id: see the identical rule in the channels loop above.
    if (seenSsoConfigIds.has(id)) {
      ssoConfigIdCollisions += 1;
      continue;
    }
    seenSsoConfigIds.add(id);
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

  // capabilities.changeDataCapture -> contributions on the obj.<Object> nodes sf-orgviz already
  // emits. A property of an object, recorded on the object, not a list living nowhere. The value
  // this collection actually carries is the *change event name* (`SelectedEntity` from
  // `PlatformEventChannelMember`, e.g. `AccountChangeEvent`), not the object -- contributing to
  // `obj.${entity}` directly targets a node no producer emits and states a tautology
  // (`changeDataCapture: true` on the change-event object) instead of the fact (CDC is on for
  // `Account`) this is meant to record. `objectForChangeEvent` maps the name back to its base
  // object first. A name matching neither the standard nor the custom shape cannot be mapped, and
  // is counted below rather than guessed at or silently dropped.
  let unrecognizedChangeEvents = 0;
  for (const entity of [...input.capabilities.changeDataCapture].sort(compare)) {
    const object = objectForChangeEvent(entity);
    if (object === null) {
      unrecognizedChangeEvents += 1;
      continue;
    }
    contributions.push({ nodeId: `obj.${object}`, attrs: { changeDataCapture: true } });
  }

  // capabilities scalars, eventRelayConfigured and identity.loginsByType describe the org rather
  // than any entity in it, so they land as one contribution on org.root (CONVERGENCE_SPEC.md
  // 3.3, 4.2). platformEvents and namedCredentials are deliberately excluded, and -- unlike every
  // other declined population in this file -- that exclusion gets no `coverage.unavailable` entry
  // of its own. That asymmetry is a decision, not an oversight: both are already derivable from
  // the merged graph (every `__e` platform event is already an `obj.*` node, and sf-orgviz
  // extracts every named credential), so this is not a fact going unrecorded, it is a fact
  // recorded exactly once, by the producer that already states it -- emitting it again here would
  // duplicate, not restore, coverage. The seven counts stay measurements, not a query over the
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
  // expressible under a kind some producer owns, and each exclusion is counted, not silently
  // dropped (spec section 3.2 -- absence is data):
  //   - `from`, once attributed, is a product key -- exactly the node this fragment already
  //     emits as `product.<key>`. An edge with no attribution (`from === null`) has no node to
  //     anchor it on this side.
  //   - A via chain naming a RemoteProxy has no owned kind at all, and an edge with no
  //     NamedCredential hop has no id to name its target with -- neither is something this schema
  //     can resolve today (CONVERGENCE_SPEC.md 4.2, "Integration edges join nodes that already
  //     exist, when the destination resolves to one"; carrying these through is what the
  //     end-state projection that section describes would still need).
  //   - The target id must come from a `NamedCredential` hop's `name` -- the DeveloperName
  //     sf-orgviz keys its `ncred.<DeveloperName>` nodes on (src/extract/landscape.ts). It must
  //     NOT come from `edge.endpoint`: that field carries whatever string was found at the call
  //     site (frequently a URL for `apexCallout`/`remoteActionChain` detections), which is real
  //     evidence worth keeping in `attrs`, but is not the id the owning producer writes. Using it
  //     as an id would build an edge that can never resolve, on every real run, rather than one
  //     that resolves once merged with an extraction -- the difference between the designed
  //     "unresolved until merged" state and a permanently broken one.
  // The edge itself is `derived`, not `metadata`: it only exists at product granularity because
  // `attributeEdges` traced the calling component back to a product by prefix match, and this
  // fragment emits no node for the component itself.
  //
  // Several `IntegrationEdge`s commonly collapse onto the same `from`/`to`/`kind` -- a product
  // with forty Apex classes all calling one credential produces forty raw edges between the same
  // two nodes, differing only in which class made the call and what literal it called with.
  // Nothing downstream de-duplicates a `CanonicalGraph`'s edges, so emitting all forty verbatim
  // would leave forty identical-looking edges in the merged graph. Grouped here by
  // `from|to|kind` instead, with the evidence that would otherwise be lost in the collapse carried
  // forward as sets rather than a single value: `endpoints` (every distinct endpoint literal seen,
  // sorted), `via` (every distinct hop chain seen, deduplicated and sorted), `detections` and
  // `attributions` (every distinct value of each seen). A group of one still gets this shape, so
  // "one edge" and "one edge that happens to have been alone" read identically.
  interface EdgeEvidenceGroup {
    from: string;
    to: string;
    endpoints: Set<string>;
    viaChains: Map<string, Array<{ type: ChainHop['type']; name: string }>>;
    detections: Set<string>;
    attributions: Set<string>;
  }
  const edgeGroups = new Map<string, EdgeEvidenceGroup>();
  let unattributedEdges = 0;
  let remoteProxyEdges = 0;
  let unresolvedTargetEdges = 0;
  for (const edge of input.edges) {
    if (edge.from === null) {
      unattributedEdges += 1;
      continue;
    }
    if (edge.via.some((hop) => hop.type === 'RemoteProxy')) {
      remoteProxyEdges += 1;
      continue;
    }
    const ncredHop = edge.via.find((hop) => hop.type === 'NamedCredential');
    if (!ncredHop) {
      unresolvedTargetEdges += 1;
      continue;
    }
    const from = `product.${edge.from}`;
    const to = `ncred.${ncredHop.name}`;
    const groupKey = `${from}|${to}|integrates`;
    let group = edgeGroups.get(groupKey);
    if (!group) {
      group = { from, to, endpoints: new Set(), viaChains: new Map(), detections: new Set(), attributions: new Set() };
      edgeGroups.set(groupKey, group);
    }
    if (edge.endpoint !== null) group.endpoints.add(edge.endpoint);
    const hops = edge.via.map((hop) => ({ type: hop.type, name: hop.name }));
    group.viaChains.set(JSON.stringify(hops), hops);
    group.detections.add(edge.detection);
    group.attributions.add(edge.attribution);
  }
  for (const group of edgeGroups.values()) {
    edges.push({
      from: group.from,
      to: group.to,
      kind: 'integrates',
      attrs: {
        endpoints: [...group.endpoints].sort(compare),
        via: [...group.viaChains.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
        detections: [...group.detections].sort(compare),
        attributions: [...group.attributions].sort(compare),
      },
      provenance: derivedEdge,
    });
  }

  if (nonSiteChannels > 0) {
    unavailable.push({
      scope: 'anatomy.channels.nonSite',
      reason: 'deferred',
      detail: `${nonSiteChannels} channel(s) of a type other than 'site' were not emitted as nodes; the collector does not yet populate app/console/api channels.`,
    });
  }
  if (siteIdCollisions > 0) {
    unavailable.push({
      scope: 'anatomy.channels.idCollision',
      reason: 'deferred',
      detail: `${siteIdCollisions} site(s) resolved to an id already used by another site (an empty or duplicate SiteName) and were collapsed into one node rather than emitted as a second node sharing that id.`,
    });
  }
  if (ssoConfigIdCollisions > 0) {
    unavailable.push({
      scope: 'anatomy.identity.ssoConfigIdCollision',
      reason: 'deferred',
      detail: `${ssoConfigIdCollisions} SSO config(s) resolved to an id already used by another config (an empty or duplicate DeveloperName) and were collapsed into one node rather than emitted as a second node sharing that id.`,
    });
  }
  if (unrecognizedChangeEvents > 0) {
    unavailable.push({
      scope: 'anatomy.capabilities.changeDataCaptureUnrecognized',
      reason: 'deferred',
      detail: `${unrecognizedChangeEvents} change data capture entity/entities did not match either change-event naming shape (standard '<Object>ChangeEvent' or custom '<Object>__ChangeEvent'), so no object node could be identified for them.`,
    });
  }
  if (unattributedEdges > 0) {
    unavailable.push({
      scope: 'anatomy.edges.unattributed',
      reason: 'deferred',
      detail: `${unattributedEdges} integration edge(s) had no product attribution and were left out; there is no node to anchor them to.`,
    });
  }
  if (remoteProxyEdges > 0) {
    unavailable.push({
      scope: 'anatomy.edges.remoteProxy',
      reason: 'deferred',
      detail: `${remoteProxyEdges} integration edge(s) named a RemoteProxy (Remote Site Setting) destination and were left out; that entity has no owned graph kind yet.`,
    });
  }
  if (unresolvedTargetEdges > 0) {
    unavailable.push({
      scope: 'anatomy.edges.unresolvedTarget',
      reason: 'deferred',
      detail: `${unresolvedTargetEdges} integration edge(s) were attributed to a product but named no NamedCredential hop, so no node id could be formed for the destination.`,
    });
  }

  nodes.sort((a, b) => compare(a.id, b.id));
  edges.sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to) || compare(a.kind, b.kind));
  contributions.sort((a, b) => compare(a.nodeId, b.nodeId));
  // Scope, then reason, then detail -- the same total order `runAnatomy` puts the artifact's
  // own `coverage.unavailable` in. Scope alone stopped being a unique key once the collectors'
  // entries joined this list, and two entries sharing one would otherwise order by whichever
  // arrived first.
  unavailable.sort(
    (a, b) => compare(a.scope, b.scope) || compare(a.reason, b.reason) || compare(a.detail, b.detail),
  );

  return {
    schemaVersion: SUPPORTED_GRAPH_SCHEMA_VERSION,
    capturedAt: input.capturedAt,
    orgId: input.orgId,
    nodes,
    edges,
    coverage: { notes: [], unavailable },
    producer: PRODUCER,
    contributions,
  };
}
