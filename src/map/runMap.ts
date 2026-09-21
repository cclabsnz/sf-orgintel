import type { EvidenceTier, CouplingGraph, LandscapeManifest, CanonicalGraph } from '@cclabsnz/sf-core';
import type { IntelContext } from '../lib/wire.js';
import type { OrgIntelCache } from '../lib/cache.js';
import type { Cluster } from './graph/clusters.js';
import type { Point } from './graph/layout.js';
import { fetchSObjectCatalog, buildCatalog, type SObjectCatalog } from '../probe/sobjectCatalog.js';
import { countRows } from '../probe/query.js';
import { buildObjectResolver } from '../discover/objectResolver.js';
import { buildAutomationIndex } from '../discover/automation.js';
import { retrieveFlows, retrieveApex } from './retrieve.js';
import { deriveFlowEdges } from './flow/flowEdges.js';
import { deriveApexEdges } from './apex/apexEdges.js';
import { mergeEdges, type NodeInfo } from './graph/couplingGraph.js';
import { assembleCouplingArtifacts } from './assemble.js';
import { buildMapFragment } from './fragment.js';
import type { ObjectTimeline } from './graph/timeline.js';

export interface MapProvenanceInput {
  generatedAt: string;
  toolVersion: string;
  orgId: string;
  /** Null when no `intel probe` has graded this org — never defaulted. */
  evidenceTier: EvidenceTier | null;
}

export interface MapOptions {
  includeInactive?: boolean;
  topLayout?: number;
  targetDomainSize?: number;
  cache?: OrgIntelCache;
  maxNodeCounts?: number;
}

export interface MapRunResult {
  couplingGraph: CouplingGraph;
  manifest: LandscapeManifest;
  /** sf-orgintel's half of the canonical org graph — the same facts, sf-orgviz's schema. */
  fragment: CanonicalGraph;
  clusters: Cluster[];
  layout: Map<string, Point>;
  /** Per-object save sequences, ordered by Salesforce's documented order of execution. */
  timelines: ObjectTimeline[];
  flowsAnalyzed: number;
  apexClassesAnalyzed: number;
  apexTriggersAnalyzed: number;
  /**
   * How many the listing read returned to THIS user on this run, not how many were parsed, and
   * not how many exist. From the same `RetrievalCensus` the fragment's `analysed` side reads.
   *
   * Absent when the listing read was refused. Absent is not zero: a refused read has measured
   * nothing, and rendering it as `0` would claim the org contains none of this kind while
   * simultaneously claiming full coverage of it. Every consumer must preserve the distinction --
   * `analysedOf` in src/report/mapReport.ts drops the denominator entirely when it is absent,
   * and `buildMapCommandResult` leaves the `--json` field off rather than emitting `0`.
   *
   * These are NOT `intel anatomy`'s org-wide census, and must never be reconciled against it as
   * if they were the same measurement. `flowsListed` counts `FlowDefinitionView` rows;
   * `intel anatomy` reports `SELECT COUNT(Id) FROM FlowDefinition`. Different SObjects, different
   * visibility, legitimately different totals for one org. See `RetrievalCensus` in retrieve.ts.
   */
  flowsListed?: number;
  apexClassesListed?: number;
  apexTriggersListed?: number;
  notes: string[];
}

/** Retrieve flows + apex, build the coupling graph and landscape manifest. Read-only. */
export async function runMap(
  ctx: IntelContext,
  provenance: MapProvenanceInput,
  opts: MapOptions = {},
): Promise<MapRunResult> {
  const notes: string[] = [];
  const maxNodeCounts = opts.maxNodeCounts ?? 100;

  let catalog: SObjectCatalog;
  try {
    catalog = await fetchSObjectCatalog(ctx.rest);
  } catch {
    catalog = buildCatalog([]);
  }
  const known = new Set(catalog.all().map((s) => s.name));

  const resolver = await buildObjectResolver(ctx.tooling);
  const automation = await buildAutomationIndex(ctx.soql, ctx.tooling, resolver, catalog);
  notes.push(...automation.notes);

  const { summaries: flows, census: flowCensus } = await retrieveFlows(
    ctx,
    { includeInactive: opts.includeInactive },
    notes,
    opts.cache,
  );
  const { classes, triggers, classCensus, triggerCensus } = await retrieveApex(ctx, resolver, notes, opts.cache);

  // One derivation of "how much did this run analyse", used by both the fragment contribution
  // and the returned result. See the comment at its use site below.
  const analysed = {
    flows: flowCensus.analysed,
    apexClasses: classCensus.analysed,
    apexTriggers: triggerCensus.analysed,
  };

  // Determine the object set that will appear in the graph, then fetch 90-day counts for it.
  const preEdges = mergeEdges([
    ...deriveFlowEdges(flows).edges,
    ...deriveApexEdges(classes, triggers, known),
  ]);
  const objectSet = new Set<string>();
  for (const e of preEdges) {
    objectSet.add(e.from);
    objectSet.add(e.to);
  }
  const recordCounts = await fetchRecordCounts(ctx, [...objectSet], maxNodeCounts, notes);

  const nodeInfo = (object: string): NodeInfo => {
    const c = automation.countsFor(object);
    return {
      custom: catalog.get(object)?.custom ?? /__c$/i.test(object),
      automationCounts: { flows: c.flows, triggers: c.triggers, approvals: c.approvals },
      recordCount90d: recordCounts.get(object) ?? 0,
    };
  };
  const labelOf = (object: string): string => catalog.get(object)?.label ?? object;

  const artifacts = assembleCouplingArtifacts({
    flowSummaries: flows,
    apexClasses: classes,
    apexTriggers: triggers,
    knownObjects: known,
    nodeInfo,
    labelOf,
    topLayout: opts.topLayout,
    targetDomainSize: opts.targetDomainSize,
    notes,
    couplingProvenance: {
      tool: 'orgintel',
      toolVersion: provenance.toolVersion,
      generatedAt: provenance.generatedAt,
      orgId: provenance.orgId,
      evidenceTier: provenance.evidenceTier,
    },
    manifestProvenance: {
      tool: 'orgintel',
      toolVersion: provenance.toolVersion,
      generatedAt: provenance.generatedAt,
      orgId: provenance.orgId,
    },
  });

  // Rendered from the same merged edges as couplingGraph (artifacts.couplingGraph.edges is
  // mergeEdges's output), plus the same raw flow/apex inputs and nodeInfo -- so the fragment and
  // the coupling graph a single run writes cannot describe different couplings for this org.
  const fragment = buildMapFragment({
    edges: artifacts.couplingGraph.edges,
    flowSummaries: flows,
    apexClasses: classes,
    apexTriggers: triggers,
    nodeInfo,
    // The same catalog-backed set assembleCouplingArtifacts got above, not something re-derived
    // from the coupling edges -- see fragment.ts's FragmentInput.knownObjects doc.
    knownObjects: known,
    workflowRulesFor: (object) => automation.countsFor(object).workflowRules,
    capturedAt: provenance.generatedAt,
    orgId: provenance.orgId,
    // The census is the one authority for these three, for the fragment and for the returned
    // result below alike. They used to be derived twice -- once from the census here, once from
    // `flows.length`/`classes.length` on the way out -- which was identical only by construction:
    // the moment the retrieval drops something it listed (an unreadable Apex class, an
    // unresolvable trigger), two independently derived "analysed" numbers are free to disagree,
    // and the HTML numerator and the graph's `analysed` contribution would describe one run
    // differently.
    analysed: analysed,
  });

  return {
    couplingGraph: artifacts.couplingGraph,
    manifest: artifacts.manifest,
    fragment,
    clusters: artifacts.clusters,
    layout: artifacts.layout,
    timelines: artifacts.timelines,
    flowsAnalyzed: analysed.flows,
    apexClassesAnalyzed: analysed.apexClasses,
    apexTriggersAnalyzed: analysed.apexTriggers,
    flowsListed: flowCensus.listed,
    apexClassesListed: classCensus.listed,
    apexTriggersListed: triggerCensus.listed,
    notes: artifacts.notes,
  };
}

async function fetchRecordCounts(
  ctx: IntelContext,
  objects: string[],
  cap: number,
  notes: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const sorted = [...objects].sort();
  const take = sorted.slice(0, cap);
  if (sorted.length > take.length) {
    notes.push(`Record counts computed for ${cap} of ${sorted.length} graph objects.`);
  }
  for (const o of take) {
    try {
      counts.set(o, await countRows(ctx.soql, o, 'CreatedDate = LAST_N_DAYS:90'));
    } catch {
      counts.set(o, 0);
    }
  }
  return counts;
}
