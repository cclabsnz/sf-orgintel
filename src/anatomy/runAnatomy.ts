// src/anatomy/runAnatomy.ts
// Assembles the artifact. Collectors run first and independently, then the pure functions
// turn their raw output into products and attributed edges. Nothing here throws: an org that
// yields little produces a small, honest artifact rather than a failed command.
import type { IntelContext } from '../lib/wire.js';
import type { AnatomyArtifact } from './types.js';
import { buildPrefixRegistry } from './prefixRegistry.js';
import { attributeEdges, resolveChains } from './attribute.js';
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

  // Component names for the registry: the classes we could read plus their callers.
  const componentNames = [...evidence.apexCallouts.keys()].sort();
  const registry = buildPrefixRegistry(componentNames, sources);

  const chained = resolveChains(evidence.remoteActions, evidence.apexCallouts);
  const edges = attributeEdges([...evidence.direct, ...chained], registry).sort(
    (a, b) =>
      String(a.endpoint).localeCompare(String(b.endpoint)) ||
      String(a.via[0]?.name).localeCompare(String(b.via[0]?.name)),
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
      notes: notes.slice().sort(),
    },
  };
}
