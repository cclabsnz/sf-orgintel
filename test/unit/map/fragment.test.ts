// The fragment is sf-orgintel's half of one canonical graph: the automation it parsed, and the
// couplings that parsing established. It deliberately does not carry the objects those couplings
// join -- sf-orgviz owns `sobject`, and a fragment emitting a kind it does not own is refused by
// the merge. See sf-orgviz/docs/CONVERGENCE_SPEC.md sections 1.1 and 3.2.
import { describe, it, expect } from '@jest/globals';
import { ownerOfKind, isKnownGraphKind, layerOfKind, levelOfKind, type GraphNodeKind } from '@cclabsnz/sf-core';
import { buildMapFragment, type FragmentInput } from '../../../src/map/fragment.js';
import type { ApexClassInput, ApexTriggerInput } from '../../../src/map/apex/apexTypes.js';

// One org, described once. `test/unit/map/fixtures/input.ts` is a new shared helper holding the
// `FragmentInput` built from the same Flow XML fixtures and the same AcctContactSync class that
// test/unit/map/assemble.test.ts and the golden suite use, so all three suites describe the same
// org rather than three subtly different ones. Extract it from assemble.test.ts's existing
// `assemble()` helper; it needs the `edges` that `mergeEdges` produced, plus `capturedAt:
// '2026-01-01T00:00:00Z'` and `orgId: 'org1'` fixed so the determinism test means something.
//
// Deliberately NOT extended with an ApexTriggerInput here: this fixture also backs
// assemble.test.ts's `artifacts()` and the golden suite (golden.test.ts), so adding a trigger
// would change coupling-graph.golden.json and turn a frozen, deliberately-pinned test red. The
// trigger path gets its own small local fixture below instead.
import { input, artifacts, knownObjects, apexClasses } from './fixtures/input.js';

const fragment = () => buildMapFragment(input());

describe('buildMapFragment', () => {
  it('names sf-orgintel as its producer', () => {
    // Without this the merge's ownership rule fails every node: it compares owner === producer,
    // and an unnamed fragment matches nothing.
    expect(fragment().producer).toBe('orgintel');
  });

  it('emits only kinds sf-orgintel owns', () => {
    for (const n of fragment().nodes) {
      expect(isKnownGraphKind(n.kind)).toBe(true);
      expect(ownerOfKind(n.kind as GraphNodeKind)).toBe('orgintel');
    }
  });

  it('carries no object nodes, because sf-orgviz owns them', () => {
    expect(fragment().nodes.filter((n) => n.id.startsWith('obj.'))).toEqual([]);
  });

  it('joins object pairs with a couples edge carrying the coupling evidence', () => {
    const couples = fragment().edges.filter((e) => e.kind === 'couples');
    expect(couples.length).toBeGreaterThan(0);
    for (const e of couples) {
      expect(e.from.startsWith('obj.')).toBe(true);
      expect(e.to.startsWith('obj.')).toBe(true);
      expect(typeof e.attrs.weight).toBe('number');
      expect(Array.isArray(e.attrs.operations)).toBe(true);
      expect(Array.isArray(e.attrs.components)).toBe(true);
    }
  });

  it('contributes the measurements it took, rather than inventing nodes to hold them', () => {
    // recordCount90d and automationCounts are facts about an object node sf-orgviz owns. A
    // measurement needs a measurer, so they travel as namespaced contributions. Spec 3.3.
    const c = fragment().contributions ?? [];
    expect(c.length).toBeGreaterThan(0);
    for (const entry of c) {
      expect(entry.nodeId.startsWith('obj.')).toBe(true);
      expect(entry.attrs).toHaveProperty('recordCount90d');
      expect(entry.attrs).toHaveProperty('automationCounts');
    }
  });

  it('emits nodes, edges and contributions in a fixed order', () => {
    // Not two runs compared: identical inputs iterate identically in one process, so that would
    // pass with every sort removed. This asserts the ordering itself, and fails if one goes.
    const f = fragment();
    const ids = f.nodes.map((n) => n.id);
    expect(ids).toEqual([...ids].sort());
    const keys = f.edges.map((e) => `${e.from}|${e.to}|${e.kind}`);
    expect(keys).toEqual([...keys].sort());
    const contribs = (f.contributions ?? []).map((c) => c.nodeId);
    expect(contribs).toEqual([...contribs].sort());
  });

  it('is deterministic — the same input twice gives identical bytes', () => {
    // This only catches true nondeterminism (a stray Date.now()/Math.random()/Map-iteration
    // leak) -- it reruns the same input in the same process, so V8 iterates identical structures
    // identically even with every sort removed. The ordering itself is asserted separately above.
    expect(JSON.stringify(buildMapFragment(input()))).toBe(JSON.stringify(buildMapFragment(input())));
  });

  it('describes exactly the couplings the coupling graph describes', () => {
    // The two artifacts are rendered from one in-memory edge set, and this is what holds them to
    // it. If a later change derives one of them differently, this fails before a consumer sees
    // two files from one run disagreeing about the same org.
    const { couplingGraph } = artifacts(); // the golden suite's helper
    const couples = buildMapFragment(input()).edges.filter((e) => e.kind === 'couples');
    const fromGraph = couplingGraph.edges.map((e) => `${e.from}|${e.to}|${e.weight}`).sort();
    const fromFragment = couples
      .map((e) => `${e.from.replace(/^obj\./, '')}|${e.to.replace(/^obj\./, '')}|${String(e.attrs.weight)}`)
      .sort();
    expect(fromFragment).toEqual(fromGraph);
  });
});

describe('buildMapFragment: trigger nodes', () => {
  // A small local fixture, not the shared one -- see the note above `import { input }`. One
  // trigger on `Case` referencing `Account` (already in the shared fixture's known-object
  // universe via its couples edges), so the self-exclusion branch below is actually reached: the
  // trigger touches a second object, not just its own.
  const trigger: ApexTriggerInput = {
    name: 'CaseTrigger',
    namespace: null,
    object: 'Case',
    body: null,
    symbolTable: { externalReferences: [{ name: 'Account' }] },
  };

  const withTrigger = (): FragmentInput => ({ ...input(), apexTriggers: [trigger] });

  it('emits a trigger.<Name> node with layer/level from the kind table', () => {
    const f = buildMapFragment(withTrigger());
    const node = f.nodes.find((n) => n.id === 'trigger.CaseTrigger');
    expect(node).toBeDefined();
    expect(node?.kind).toBe('trigger');
    expect(node?.layer).toBe(layerOfKind('trigger'));
    expect(node?.level).toBe(levelOfKind('trigger'));
  });

  it('excludes a touches edge to its own trigger object, matching deriveApexEdges', () => {
    // deriveApexEdges (src/map/apex/apexEdges.ts) skips `obj === trig.object` when building
    // coupling edges from a trigger, because the trigger's action on its own object is
    // contextual (which DML event fired it) rather than something this input shape states.
    // buildMapFragment mirrors that same exclusion for touches edges.
    const f = buildMapFragment(withTrigger());
    const selfTouch = f.edges.find((e) => e.from === 'trigger.CaseTrigger' && e.to === 'obj.Case');
    expect(selfTouch).toBeUndefined();
    const otherTouch = f.edges.find((e) => e.from === 'trigger.CaseTrigger' && e.to === 'obj.Account');
    expect(otherTouch).toBeDefined();
    expect(otherTouch?.kind).toBe('touches');
  });

  it('leaves the shared fixture, and hence the golden suite, unaffected', () => {
    // withTrigger() spreads a fresh input() and only overrides apexTriggers, so the shared
    // fixture object itself is never mutated. This re-confirms the base fragment stays
    // trigger-free -- the same fact assemble.test.ts and golden.test.ts depend on via artifacts().
    expect(fragment().nodes.some((n) => n.kind === 'trigger')).toBe(false);
  });
});

describe('buildMapFragment: known objects come from the catalog, not the edges', () => {
  // A local fixture, not the shared one -- adding this class to fixtures/input.ts would change
  // coupling-graph.golden.json. `OpportunityAudit` references exactly one object, so
  // deriveApexEdges's pairwise loop (which needs at least two) never emits a coupling for it --
  // `Opportunity` forms no coupling pair anywhere in this org. Before task 1's fix, `known` was
  // built from the merged coupling edges, so `Opportunity` would never appear in it, the
  // SymbolTable intersection would come back empty, and the class would silently lose this
  // touches edge (and separately fall onto the regex fallback, which a null body also starves).
  const oppClass: ApexClassInput = {
    name: 'OpportunityAudit',
    namespace: null,
    body: null,
    symbolTable: { externalReferences: [{ name: 'Opportunity' }] },
  };

  const withOpportunity = (): FragmentInput => ({
    ...input(),
    knownObjects: new Set([...knownObjects(), 'Opportunity']),
    apexClasses: [...apexClasses(), oppClass],
  });

  it('still emits a touches edge for an object that forms no coupling pair', () => {
    const f = buildMapFragment(withOpportunity());
    const touch = f.edges.find((e) => e.from === 'apexClass.OpportunityAudit' && e.to === 'obj.Opportunity');
    expect(touch).toBeDefined();
    expect(touch?.kind).toBe('touches');
  });
});

describe('buildMapFragment: provenance', () => {
  it('marks touches edges as metadata and couples edges as derived with a rule', () => {
    const f = buildMapFragment(input());
    const touches = f.edges.filter((e) => e.kind === 'touches');
    const couples = f.edges.filter((e) => e.kind === 'couples');
    expect(touches.length).toBeGreaterThan(0);
    expect(couples.length).toBeGreaterThan(0);
    for (const e of touches) {
      expect(e.provenance.source).toBe('metadata');
    }
    for (const e of couples) {
      expect(e.provenance.source).toBe('derived');
      expect(typeof e.provenance.rule).toBe('string');
      expect(e.provenance.rule?.length).toBeGreaterThan(0);
    }
  });
});

describe('buildMapFragment: workflowRules in the contribution', () => {
  it('carries all four automationCounts fields, not just the three NodeInfo has', () => {
    const withWorkflowRules: FragmentInput = { ...input(), workflowRulesFor: (object) => (object === 'Account' ? 3 : 0) };
    const f = buildMapFragment(withWorkflowRules);
    const account = f.contributions?.find((c) => c.nodeId === 'obj.Account');
    expect(account).toBeDefined();
    const counts = account?.attrs.automationCounts as Record<string, number>;
    expect(counts).toEqual({ flows: 1, triggers: 1, approvals: 0, workflowRules: 3 });
  });
});

describe('buildMapFragment: ordering is codepoint, not locale', () => {
  // `AccountService` vs `Account_Service` sort differently under localeCompare (ICU treats `_`
  // as a low-weight, near-ignorable separator) than under codepoint order (`_` is 0x5F, after
  // all uppercase letters, so `AccountService` < `Account_Service`). A local fixture, since
  // adding these class names to the shared fixture would change the golden coupling graph.
  it('orders apexClass nodes by codepoint even when locale order would disagree', () => {
    const a: ApexClassInput = { name: 'AccountService', namespace: null, body: null, symbolTable: null };
    const b: ApexClassInput = { name: 'Account_Service', namespace: null, body: null, symbolTable: null };
    const withBoth: FragmentInput = { ...input(), apexClasses: [a, b] };
    const ids = buildMapFragment(withBoth).nodes.map((n) => n.id);
    const iA = ids.indexOf('apexClass.AccountService');
    const iB = ids.indexOf('apexClass.Account_Service');
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iB).toBeGreaterThanOrEqual(0);
    // Under localeCompare this pair sorts the other way round -- a regression to localeCompare
    // would flip this.
    expect(iA).toBeLessThan(iB);
  });
});
