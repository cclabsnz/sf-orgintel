// src/anatomy/runAnatomy.ts
// Assembles the artifact. Collectors run first and independently, then the pure functions
// turn their raw output into products and attributed edges. Nothing here throws: an org that
// yields little produces a small, honest artifact rather than a failed command.
import type { IntelContext } from '../lib/wire.js';
import type { AnatomyArtifact } from './types.js';
import { buildPrefixRegistry } from './prefixRegistry.js';
import { addEndpointOnlyEdges, attributeEdges, resolveChains } from './attribute.js';
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

export async function runAnatomy(
  ctx: IntelContext,
  provenance: AnatomyProvenance,
): Promise<AnatomyArtifact> {
  const notes: string[] = [];

  const sources = await collectProducts(ctx, notes);
  const personas = await collectPersonas(ctx, notes);
  const channels = await collectChannels(ctx, notes);
  const capabilities = await collectCapabilities(ctx, notes);
  const identity = await collectIdentity(ctx, notes);
  const evidence = await collectIntegrationEdges(ctx, notes);

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

  return {
    version: 1,
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
      omniProceduresTotal: evidence.omniProceduresTotal,
      prefixesUnresolved: registry.unresolved,
      // Collectors run sequentially, so `notes` is already deterministic. Insertion order is
      // kept, not alphabetised: it is the order failures occurred in, which is diagnostic
      // information an alphabetical sort would discard for no determinism benefit.
      notes,
    },
  };
}
