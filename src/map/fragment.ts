// The graph fragment: sf-orgintel's half of one canonical org graph.
//
// `intel map` keeps parsing Flow XML and Apex SymbolTables unchanged -- that analysis is the
// command. What this module adds is a second rendering of the same facts, in the schema
// sf-orgviz also writes, so the two tools describe one org rather than two.
//
// The fragment carries no `obj.*` nodes on purpose. `sobject` is a kind sf-orgviz owns, and the
// merge (`mergeGraphs`) rejects a fragment that emits a kind belonging to another producer -- so
// the `couples` edges below point at object ids this fragment never declares. That means the
// fragment does not validate standalone: `validateGraph` reports `GRAPH_EDGE_ENDPOINT_UNRESOLVED`
// for every such edge until this is merged with an extraction that supplies the object nodes.
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
  type CouplingGraphEdge,
} from '@cclabsnz/sf-core';
import type { FlowSummary } from './flow/flowTypes.js';
import type { ApexClassInput, ApexTriggerInput } from './apex/apexTypes.js';
import type { NodeInfo } from './graph/couplingGraph.js';
import type { CouplingOperation } from './types.js';
import { analyzeApex } from './apex/apexEdges.js';

export interface FragmentInput {
  /** The merged, already-aggregated object-pair edges (`mergeEdges`'s output). */
  edges: CouplingGraphEdge[];
  flowSummaries: FlowSummary[];
  apexClasses: ApexClassInput[];
  apexTriggers: ApexTriggerInput[];
  nodeInfo: (object: string) => NodeInfo;
  /**
   * The sobject catalog's object universe -- the same `known` set `runMap.ts` passes to
   * `assembleCouplingArtifacts`. This is NOT derived from `edges`: an object can be a real,
   * known sobject the SymbolTable references without ever forming a coupling pair (a class
   * touching exactly one object contributes no pairwise edge), and deriving `known` from edges
   * instead drops that object's `touches` edge here, and separately knocks `analyzeApex` off its
   * high-confidence SymbolTable branch onto the regex fallback in `apexEdges.ts`.
   */
  knownObjects: Set<string>;
  /** Workflow-rule count per object, from the automation index `runMap.ts` already built. Not
   * part of `NodeInfo`/`CouplingGraphNode.automationCounts` -- that shape is published and
   * frozen at three fields -- so this travels to the fragment's contribution separately. */
  workflowRulesFor: (object: string) => number;
  capturedAt: string;
  orgId: string;
  /** What this run actually parsed, for reconciliation against the census `intel anatomy`
   *  contributes to the same node. */
  analysed: {
    flows: number;
    apexClasses: number;
    apexTriggers: number;
  };
}

const PRODUCER = 'orgintel' as const;

/** Names the inference `couples` edges encode, for their required `derived.rule`. */
const COUPLES_RULE = 'map.coupling.pairwise-co-reference';

/** object -> operations a single component touches directly (no subflow/pairwise inference). */
type TouchMap = Map<string, Set<CouplingOperation>>;

function upsert(map: TouchMap, object: string, op: CouplingOperation): void {
  const set = map.get(object) ?? new Set<CouplingOperation>();
  set.add(op);
  map.set(object, set);
}

/**
 * A flow's own direct record references, unioned across duplicate elements on the same object.
 * Deliberately not the recursive subflow resolution `deriveFlowEdges` uses for coupling: this is
 * what the flow's own node touches, not what its process eventually reaches.
 */
function directFlowTouches(flow: FlowSummary): TouchMap {
  const map: TouchMap = new Map();
  for (const r of flow.recordLookups) upsert(map, r.object, 'read');
  for (const r of flow.recordCreates) upsert(map, r.object, 'create');
  for (const r of flow.recordUpdates) upsert(map, r.object, 'update');
  for (const r of flow.recordDeletes) upsert(map, r.object, 'delete');
  return map;
}

/**
 * Codepoint order, not locale order. `localeCompare` is ICU/collation-dependent -- it orders
 * `Account_Service` against `AccountService` differently under different `LANG`/ICU data, which
 * would make this fragment not byte-stable across machines, and would disagree with the merge's
 * ordering, which sorts by codepoint.
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Pure assembly: parsed automation + merged couplings -> this producer's graph fragment. */
export function buildMapFragment(input: FragmentInput): CanonicalGraph {
  const provenance: GraphProvenance = { source: 'metadata', capturedAt: input.capturedAt };
  // `couples` edges are not metadata: they are pairwise co-reference inferences over the
  // metadata (plus a direction heuristic), so the schema's `derived` provenance -- and the rule
  // name it requires -- is the honest label. `touches` edges above stay `metadata`: those come
  // straight from a SymbolTable or Flow XML element, no inference step in between.
  const couplesProvenance: GraphProvenance = {
    source: 'derived',
    rule: COUPLES_RULE,
    capturedAt: input.capturedAt,
  };
  const known = input.knownObjects;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const flow of input.flowSummaries) {
    const id = `flow.${flow.apiName}`;
    nodes.push({
      id,
      kind: 'flow',
      layer: layerOfKind('flow'),
      level: levelOfKind('flow'),
      parent: null,
      label: flow.label,
      attrs: { processType: flow.processType, status: flow.status, initiator: flow.initiator },
      provenance,
    });
    for (const [object, ops] of directFlowTouches(flow)) {
      edges.push({
        from: id,
        to: `obj.${object}`,
        kind: 'touches',
        attrs: { operations: [...ops].sort(compare) },
        provenance,
      });
    }
  }

  for (const cls of input.apexClasses) {
    const id = `apexClass.${cls.name}`;
    nodes.push({
      id,
      kind: 'apexClass',
      layer: layerOfKind('apexClass'),
      level: levelOfKind('apexClass'),
      parent: null,
      label: cls.name,
      attrs: { namespace: cls.namespace },
      provenance,
    });
    const { objects } = analyzeApex(cls, known);
    for (const [object, ops] of objects) {
      edges.push({
        from: id,
        to: `obj.${object}`,
        kind: 'touches',
        attrs: { operations: [...ops].sort(compare) },
        provenance,
      });
    }
  }

  for (const trig of input.apexTriggers) {
    const id = `trigger.${trig.name}`;
    nodes.push({
      id,
      kind: 'trigger',
      layer: layerOfKind('trigger'),
      level: levelOfKind('trigger'),
      parent: null,
      label: trig.name,
      attrs: { namespace: trig.namespace, object: trig.object },
      provenance,
    });
    const { objects } = analyzeApex(trig, known);
    for (const [object, ops] of objects) {
      // Its own trigger object is excluded, matching deriveApexEdges: the trigger's operation on
      // the object it fires on is contextual (which DML events fired it), not something this
      // input shape states, and fabricating one would assert evidence we don't have.
      if (object === trig.object) continue;
      edges.push({
        from: id,
        to: `obj.${object}`,
        kind: 'touches',
        attrs: { operations: [...ops].sort(compare) },
        provenance,
      });
    }
  }

  for (const e of input.edges) {
    edges.push({
      from: `obj.${e.from}`,
      to: `obj.${e.to}`,
      kind: 'couples',
      attrs: {
        weight: e.weight,
        operations: e.operations,
        components: e.components,
        // Absent rather than null when nothing directional was found -- "we do not know" must
        // not read as "undirected" (the same distinction CouplingGraphEdge.direction preserves).
        ...(e.direction ? { direction: e.direction } : {}),
      },
      provenance: couplesProvenance,
    });
  }

  const contributions: AttributeContribution[] = [...known].sort(compare).map((object) => {
    const info = input.nodeInfo(object);
    return {
      nodeId: `obj.${object}`,
      attrs: {
        recordCount90d: info.recordCount90d,
        // automationCounts travels as a contribution in its entirety -- all four of flows,
        // triggers, approvals and workflowRules -- even though NodeInfo/CouplingGraphNode only
        // carry three: that shape is published and frozen, so the fourth number is threaded in
        // here rather than widened onto NodeInfo.
        automationCounts: { ...info.automationCounts, workflowRules: input.workflowRulesFor(object) },
      },
    };
  });

  contributions.push({
    nodeId: 'org.root',
    attrs: {
      // Deliberately NOT the org's totals: those are a census, and intel anatomy contributes
      // them to this same node from COUNT(Id) aggregates over the whole org. This is what this
      // run parsed. Keeping them distinct is the point -- the two numbers answer different
      // questions, and collapsing them would restate the weaker one as the stronger.
      analysed: {
        flows: input.analysed.flows,
        apexClasses: input.analysed.apexClasses,
        apexTriggers: input.analysed.apexTriggers,
      },
    },
  });

  nodes.sort((a, b) => compare(a.id, b.id));
  edges.sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to) || compare(a.kind, b.kind));

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
