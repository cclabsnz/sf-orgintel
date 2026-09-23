// Cross-checks the two halves a single `intel anatomy` run produces: the artifact and the
// fragment. Both come out of one `runAnatomy()` call over one collected set of facts, so this is
// what catches a later change that derives one of them differently and lets the pair disagree
// about the same org.
//
// RELATIVE, NOT ABSOLUTE, and the distinction matters. Every assertion here compares one half
// against the other, and both halves come from the same collector run -- so a collector that
// silently returns nothing empties both sides at once and all three tests below pass on
// `[] === []`. This suite cannot tell a consistent org from a consistently empty one. What can
// is golden.test.ts, which compares the artifact against frozen bytes. Do not treat this file as
// a substitute for it.
//
// 1.0 retired `anatomy.json`, so only the fragment is written now -- but the artifact is still
// built, still returned by `run()` as the `--json` payload, still feeds View A's bands, and this
// is still what holds the two halves to the same facts.
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
