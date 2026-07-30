import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { loadSchema } from '@cclabsnz/sf-core';
import type { CouplingGraph, LandscapeManifest, ProcessGraph } from '@cclabsnz/sf-core';
import { parseFlowXml } from '../../../src/map/flow/parseFlow.js';
import { assembleCouplingArtifacts } from '../../../src/map/assemble.js';

/**
 * Validates what the pipeline actually emits, not a hand-written document that happens to
 * match the schema.
 *
 * The previous version asserted two literals typed as CouplingGraph and LandscapeManifest.
 * Those prove the *types* line up with the schema and nothing about the emitters — the code
 * could have drifted arbitrarily and this file would still be green. Here the fixtures are
 * parsed, assembled and JSON round-tripped exactly as `intel map` does before writing to disk.
 *
 * Compile each schema once — Ajv rejects re-registering the same $id.
 */
const ajv = new Ajv({ strict: false, allErrors: true });
const validators = {
  coupling: ajv.compile(loadSchema('coupling-graph') as object),
  manifest: ajv.compile(loadSchema('landscape-manifest') as object),
  process: ajv.compile(loadSchema('process-graph') as object),
};

// Matches the sibling flow tests: import.meta is not populated under this jest config.
const FIXTURES = join(process.cwd(), 'test/unit/map/fixtures/flows');

/** Everything `intel map` does between reading flow metadata and writing the IR files. */
function emitFromFixtures() {
  const summaries = readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.flow-meta.xml'))
    .sort()
    .map((f) => parseFlowXml(readFileSync(join(FIXTURES, f), 'utf8'), f.replace('.flow-meta.xml', '')));

  const objects = new Set(
    summaries.flatMap((s) => [
      ...s.recordLookups, ...s.recordCreates, ...s.recordUpdates, ...s.recordDeletes,
    ].map((r) => r.object)),
  );

  const artifacts = assembleCouplingArtifacts({
    flowSummaries: summaries,
    apexClasses: [],
    apexTriggers: [],
    knownObjects: objects,
    nodeInfo: (o) => ({
      custom: /__c$/.test(o),
      automationCounts: { flows: 2, triggers: 1, approvals: 0 },
      recordCount90d: 1234,
    }),
    labelOf: (o) => o.replace(/__c$/, ''),
    couplingProvenance: {
      tool: 'orgintel', toolVersion: '0.1.0', generatedAt: '2026-07-30T00:00:00.000Z',
      orgId: '00Dxx0000000000EAA', evidenceTier: 'B',
    },
    manifestProvenance: {
      tool: 'orgintel', toolVersion: '0.1.0', generatedAt: '2026-07-30T00:00:00.000Z',
      orgId: '00Dxx0000000000EAA',
    },
  });

  // The IR is written with JSON.stringify, so validate what survives that — a Map, a Set or an
  // undefined would vanish silently here rather than in a consumer's parser.
  return {
    couplingGraph: JSON.parse(JSON.stringify(artifacts.couplingGraph)) as CouplingGraph,
    manifest: JSON.parse(JSON.stringify(artifacts.manifest)) as LandscapeManifest,
    raw: artifacts,
  };
}

describe('emitted IR validates against the published contracts', () => {
  const emitted = emitFromFixtures();

  it('produces a non-trivial graph, so the assertions below cannot pass vacuously', () => {
    expect(emitted.couplingGraph.nodes.length).toBeGreaterThan(1);
    expect(emitted.couplingGraph.edges.length).toBeGreaterThan(0);
    expect(emitted.raw.clusters.length).toBeGreaterThan(0);
    expect(emitted.manifest.levels.L0_landscape.clusters.length).toBeGreaterThan(0);
  });

  it('coupling-graph.json', () => {
    const ok = validators.coupling(emitted.couplingGraph);
    if (!ok) console.error(validators.coupling.errors);
    expect(ok).toBe(true);
  });

  it('landscape-manifest.json', () => {
    const ok = validators.manifest(emitted.manifest);
    if (!ok) console.error(validators.manifest.errors);
    expect(ok).toBe(true);
  });

  it('survives the JSON round trip without losing structure', () => {
    // Maps and Sets serialise to {} — a silent shape change a schema may not reject.
    expect(emitted.couplingGraph.nodes.length).toBe(emitted.raw.couplingGraph.nodes.length);
    expect(emitted.couplingGraph.edges.length).toBe(emitted.raw.couplingGraph.edges.length);
    const l1 = emitted.manifest.levels.L1_domain.perCluster;
    expect(l1.length).toBeGreaterThan(0);
    for (const c of l1) expect(Object.keys(c.layout).length).toBeGreaterThan(0);
  });

  it('every emitted edge carries the fields consumers rely on', () => {
    for (const edge of emitted.couplingGraph.edges) {
      expect(edge.weight).toBeGreaterThan(0);
      expect(edge.operations.length).toBeGreaterThan(0);
      expect(edge.components.length).toBeGreaterThan(0);
      for (const c of edge.components) expect(['high', 'approximate']).toContain(c.confidence);
    }
  });
});

describe('the contracts still reject malformed documents', () => {
  const { couplingGraph } = emitFromFixtures();

  it('rejects the wrong version', () => {
    expect(validators.coupling({ ...couplingGraph, version: 2 })).toBe(false);
  });

  it('rejects an unknown operation', () => {
    const bad = { ...couplingGraph, edges: [{ ...couplingGraph.edges[0], operations: ['frobnicate'] }] };
    expect(validators.coupling(bad)).toBe(false);
  });

  it('rejects a missing provenance field', () => {
    const prov = { ...couplingGraph.provenance } as Record<string, unknown>;
    delete prov.orgId;
    expect(validators.coupling({ ...couplingGraph, provenance: prov })).toBe(false);
  });

  it('process-graph is defined and valid for the reserved mining tier', () => {
    const processGraph: ProcessGraph = {
      version: 1,
      anchorObject: 'Case',
      provenance: { tool: 'orgintel', toolVersion: '0.1.0', generatedAt: '2026-07-30T00:00:00.000Z', orgId: '00Dxx0000000000EAA' },
      nodes: [{ id: 'n1', kind: 'state', label: 'New' }],
      edges: [{ from: 'n1', to: 'n1', trigger: 'manual' }],
    };
    expect(validators.process(processGraph)).toBe(true);
  });
});
