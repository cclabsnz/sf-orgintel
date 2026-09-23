import type { CouplingGraphEdge } from '@cclabsnz/sf-core';
import type { FlowSummary } from './flow/flowTypes.js';
import type { ApexClassInput, ApexTriggerInput } from './apex/apexTypes.js';
import { deriveFlowEdges } from './flow/flowEdges.js';
import { deriveApexEdges } from './apex/apexEdges.js';
import { mergeEdges, edgeObjects, type NodeInfo } from './graph/couplingGraph.js';
import { clusterByLayer, type LayerCluster } from './graph/clusters.js';
import { roleOf } from './graph/layers.js';
import { computeLayout, type Point } from './graph/layout.js';
import { objectTimelines, type ObjectTimeline } from './graph/timeline.js';

export interface AssembleInput {
  flowSummaries: FlowSummary[];
  apexClasses: ApexClassInput[];
  apexTriggers: ApexTriggerInput[];
  knownObjects: Set<string>;
  nodeInfo: (object: string) => NodeInfo;
  /** Number of top-ranked nodes to lay out for the visual (default 20). */
  topLayout?: number;
  /** Largest domain to hand a consultant; clustering resolution tunes to fit (default 25). */
  targetDomainSize?: number;
  notes?: string[];
}

export interface MapArtifacts {
  /**
   * The merged, aggregated object-pair couplings -- the analysis itself. Until 1.0 these were
   * also wrapped in a `CouplingGraph` document and written to `coupling-graph.json`; the document
   * is retired and the edges are handed straight to `buildMapFragment` instead.
   */
  edges: CouplingGraphEdge[];
  clusters: LayerCluster[];
  layout: Map<string, Point>;
  /** Per-object save sequences, ordered by Salesforce's documented order of execution. */
  timelines: ObjectTimeline[];
  notes: string[];
}

/** Pure assembly: flow + apex edges -> merged couplings, clusters, layout, and timelines. */
export function assembleCouplingArtifacts(input: AssembleInput): MapArtifacts {
  const notes = [...(input.notes ?? [])];

  const flow = deriveFlowEdges(input.flowSummaries);
  if (flow.missingSubflows.length > 0) {
    notes.push(`Subflows referenced but not retrieved (touches not inherited): ${flow.missingSubflows.join(', ')}.`);
  }
  const apexEdges = deriveApexEdges(input.apexClasses, input.apexTriggers, input.knownObjects);

  const edges = mergeEdges([...flow.edges, ...apexEdges]);
  const nodeNames = edgeObjects(edges);

  // Weighted-degree + automation score, for cluster anchors and layout ranking.
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + e.weight);
    degree.set(e.to, (degree.get(e.to) ?? 0) + e.weight);
  }
  const score = (o: string): number => {
    const d = degree.get(o) ?? 0;
    const a = input.nodeInfo(o).automationCounts;
    return d + a.flows + a.triggers + a.approvals;
  };

  // Cluster within each architectural layer. Clustering the whole graph at once produces
  // domains that mix a business object with a logger table, because infrastructure couples to
  // almost everything — and worse, it fuses genuinely separate business groups by routing them
  // through a shared identity object.
  const clusters = clusterByLayer(
    nodeNames.map((object) => ({ object, layer: roleOf(object) })),
    edges,
    score,
    { targetDomainSize: input.targetDomainSize },
  );

  // Lay out the top-ranked nodes for the report picture only. A viewer that needs a coordinate
  // for every object in every domain — not just the ones that fit in the report's top-N view —
  // resolves the navigation view instead (src/map/view/resolve.ts), which lays each level out
  // completely and in its own space.
  const topLayout = input.topLayout ?? 20;
  const topNodes = [...nodeNames].sort((a, b) => score(b) - score(a) || a.localeCompare(b)).slice(0, topLayout);
  const topSet = new Set(topNodes);
  const layoutEdges = edges.filter((e) => topSet.has(e.from) && topSet.has(e.to));
  const layout = computeLayout(topNodes, layoutEdges);

  // What runs on each object when it saves, in the order the platform guarantees. This is the one
  // piece of sequencing in the whole map that is documented rather than inferred.
  const timelines = objectTimelines({ triggers: input.apexTriggers, flows: input.flowSummaries });
  const contended = timelines.filter((t) => t.unorderedPhases > 0).length;
  if (contended > 0) {
    notes.push(
      `${contended} object(s) run more than one automation in the same execution phase; Salesforce does not define which goes first.`,
    );
  }

  return { edges, clusters, layout, timelines, notes };
}
