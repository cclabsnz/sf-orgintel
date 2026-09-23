// src/anatomy/runAnatomy.ts
// Assembles the artifact. Collectors run first and independently, then the pure functions
// turn their raw output into products and attributed edges. Nothing here throws: an org that
// yields little produces a small, honest artifact rather than a failed command.
import type { CanonicalGraph } from '@cclabsnz/sf-core';
import type { IntelContext } from '../lib/wire.js';
import type { AnatomyArtifact, Identity, Unavailable } from './types.js';
import { buildPrefixRegistry } from './prefixRegistry.js';
import { addEndpointOnlyEdges, attributeEdges, resolveChains } from './attribute.js';
import { buildAnatomyFragment } from './fragment.js';
import { collectProducts } from './collectors/products.js';
import { collectPersonas } from './collectors/personas.js';
import { collectChannels } from './collectors/channels.js';
import { collectCapabilities } from './collectors/capabilities.js';
import { collectIdentity } from './collectors/identity.js';
import { collectIntegrationEdges } from './collectors/integrationEdges.js';

export interface AnatomyProvenance {
  generatedAt: string;
  orgId: string;
  toolVersion: string;
  apiVersion: string;
}

export interface AnatomyRunResult {
  artifact: AnatomyArtifact;
  /**
   * sf-orgintel's half of the canonical org graph -- the same facts `artifact` carries, rendered
   * in sf-orgviz's schema. Built from `artifact`'s own fields (not from a second pass over
   * `ctx`), so the two cannot describe different products, channels or capability counts for one
   * run: there is only one place either could have come from.
   */
  fragment: CanonicalGraph;
}

export async function runAnatomy(
  ctx: IntelContext,
  provenance: AnatomyProvenance,
): Promise<AnatomyRunResult> {
  const notes: string[] = [];
  const unavailable: Unavailable[] = [];

  const sources = await collectProducts(ctx, notes, unavailable);
  const personas = await collectPersonas(ctx, notes, unavailable);
  const { channels, channelKeys } = await collectChannels(ctx, notes, unavailable);
  const capabilities = await collectCapabilities(ctx, notes, unavailable);
  const { ssoConfigs, ssoConfigKeys, loginsByType } = await collectIdentity(ctx, notes, unavailable);
  // The published `Identity` shape only -- `ssoConfigKeys` never joins it. Threaded to the
  // fragment separately below.
  const identity: Identity = { ssoConfigs, loginsByType };
  const evidence = await collectIntegrationEdges(ctx, notes, unavailable);

  // Component names for the registry: every org-authored Apex class and Flow, the population
  // the frequency floor is calibrated against. Not the (much narrower) set of classes that
  // happen to carry a callout: that would bias `products` toward whatever makes outbound
  // calls and drop every product that does not.
  const registry = buildPrefixRegistry(sources.componentNames, sources);

  const chained = resolveChains(evidence.remoteActions, evidence.apexCallouts);
  const withEndpoints = addEndpointOnlyEdges(
    [...evidence.direct, ...chained],
    evidence.namedCredentials,
    evidence.remoteProxies,
  );
  const edges = attributeEdges(withEndpoints, registry).sort(
    (a, b) =>
      String(a.endpoint).localeCompare(String(b.endpoint)) ||
      String(a.via[0]?.name).localeCompare(String(b.via[0]?.name)) ||
      a.via.map((h) => h.name).join('>').localeCompare(b.via.map((h) => h.name).join('>')) ||
      a.detection.localeCompare(b.detection) ||
      a.attribution.localeCompare(b.attribution),
  );

  const artifact: AnatomyArtifact = {
    version: 2,
    provenance,
    products: registry.products,
    personas,
    channels,
    capabilities,
    identity,
    edges,
    coverage: {
      apexBodiesScanned: evidence.apexBodiesScanned,
      apexBodiesUnreadable: evidence.apexBodiesUnreadable,
      omniElementsScanned: evidence.omniElementsScanned,
      omniProceduresWithIntegrationElements: evidence.omniProceduresWithIntegrationElements,
      omniElementsSkippedSuperseded: evidence.omniElementsSkippedSuperseded,
      prefixesUnresolved: registry.unresolved,
      // Collectors run sequentially, so `notes` is already deterministic. Insertion order is
      // kept, not alphabetised: it is the order failures occurred in, which is diagnostic
      // information an alphabetical sort would discard for no determinism benefit.
      notes,
      // Unlike `notes`, `unavailable` is data consumers key off (View A among them), so it is
      // sorted by scope, with reason and detail as tiebreakers, rather than left in collection
      // order.
      unavailable: [...unavailable].sort(
        (a, b) => a.scope.localeCompare(b.scope) || a.reason.localeCompare(b.reason) || a.detail.localeCompare(b.detail),
      ),
    },
  };

  // Built from `artifact`'s own fields, not from `sources`/`personas`/... a second time: the
  // fragment and the artifact a single run writes must be two renderings of one set of values,
  // not two independently-assembled ones that happen to agree today.
  const fragment = buildAnatomyFragment({
    products: artifact.products,
    personas: artifact.personas,
    channels: artifact.channels,
    // Not part of `artifact` -- `channelKeys`/`ssoConfigKeys` never join the published
    // `Channel`/`SsoConfig` shapes (see channels.ts/identity.ts), so they travel from the
    // collectors straight to the fragment rather than through the artifact's own fields.
    channelKeys,
    capabilities: artifact.capabilities,
    identity: artifact.identity,
    ssoConfigKeys,
    edges: artifact.edges,
    // The collectors' own refusals, taken from the artifact's already-sorted copy rather than
    // from the raw `unavailable` array, for the same reason every other field here comes from
    // `artifact`: one set of values, rendered twice. Without this a refused capability count
    // reaches `org.root` as an unmarked `0` that a consumer cannot tell from a measured one.
    unavailable: artifact.coverage.unavailable,
    capturedAt: provenance.generatedAt,
    orgId: provenance.orgId,
  });

  return { artifact, fragment };
}
