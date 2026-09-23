// Cross-checks the two halves a single `intel anatomy` run produces: the artifact and the
// fragment. Both come out of one `runAnatomy()` call over one collected set of facts, so this is
// what would catch a later change that derives one of them differently.
//
// 1.0 retired `anatomy.json`, so only the fragment is written now -- but the artifact is still
// built, still feeds View A's bands, and this is still what holds the two to the same facts.
import { describe, it, expect } from '@jest/globals';
import { runResult } from './fixtures/input.js';

describe('runAnatomy: artifact and fragment agree', () => {
  it('emits a site.<name> node for every site channel in the artifact, and no others', async () => {
    const { artifact, fragment } = await runResult();
    const siteNodeNames = fragment.nodes.filter((n) => n.kind === 'site').map((n) => n.label).sort();
    const artifactSiteNames = artifact.channels
      .filter((c) => c.type === 'site')
      .map((c) => c.name)
      .sort();
    expect(siteNodeNames).toEqual(artifactSiteNames);
  });

  it('emits a product.<key> node for every product in the artifact, and no others', async () => {
    const { artifact, fragment } = await runResult();
    const productKeys = fragment.nodes
      .filter((n) => n.kind === 'product')
      .map((n) => n.id.replace(/^product\./, ''))
      .sort();
    const artifactProductKeys = artifact.products.map((p) => p.key).sort();
    expect(productKeys).toEqual(artifactProductKeys);
  });

  it('contributes org.root counts equal to the artifact capabilities they describe', async () => {
    const { artifact, fragment } = await runResult();
    const orgRoot = fragment.contributions?.find((c) => c.nodeId === 'org.root');
    expect(orgRoot).toBeDefined();
    expect(orgRoot!.attrs).toMatchObject({
      flows: artifact.capabilities.flows,
      apexClasses: artifact.capabilities.apexClasses,
      apexTriggers: artifact.capabilities.apexTriggers,
      lwc: artifact.capabilities.lwc,
      aura: artifact.capabilities.aura,
      externalDataSources: artifact.capabilities.externalDataSources,
      remoteSites: artifact.capabilities.remoteSites,
      eventRelayConfigured: artifact.capabilities.eventRelayConfigured,
      loginsByType: artifact.identity.loginsByType,
    });
  });
});
