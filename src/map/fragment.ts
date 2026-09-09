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
  capturedAt: string;
  orgId: string;
}

const PRODUCER = 'orgintel' as const;

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
 * The object universe this fragment already knows about, taken from the merged coupling edges.
 * Apex SymbolTable external references need a known-object filter to separate object names from
 * other symbols (classes, custom metadata types, ...) -- the same purpose `known` serves in
 * `deriveApexEdges`. The edge set is exactly the right source: every object that ever produced a
 * coupling is, by construction, an object one of these same components referenced.
 */
function knownObjectsFrom(edges: CouplingGraphEdge[]): Set<string> {
  const known = new Set<string>();
  for (const e of edges) {
    known.add(e.from);
    known.add(e.to);
  }
  return known;
}

function compare(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Pure assembly: parsed automation + merged couplings -> this producer's graph fragment. */
export function buildMapFragment(input: FragmentInput): CanonicalGraph {
  const provenance: GraphProvenance = { source: 'metadata', capturedAt: input.capturedAt };
  const known = knownObjectsFrom(input.edges);

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
      provenance,
    });
  }

  const contributions: AttributeContribution[] = [...known].sort(compare).map((object) => {
    const info = input.nodeInfo(object);
    return {
      nodeId: `obj.${object}`,
      attrs: { recordCount90d: info.recordCount90d, automationCounts: info.automationCounts },
    };
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
