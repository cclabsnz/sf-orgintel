import { describe, it, expect } from '@jest/globals';
import { deriveFlowEdges } from '../../../src/map/flow/flowEdges.js';
import type { FlowSummary } from '../../../src/map/flow/flowTypes.js';

/**
 * A screen or autolaunched flow has no trigger object, so its objects were coupled pairwise
 * with no direction. But such a flow still states one: looking up an Account and creating a
 * Case means data moves from the first to the second.
 *
 * This is where a user journey lives — the flow a person actually walks through — so leaving
 * it undirected discards the most human-readable process evidence in the org.
 */
function flow(over: Partial<FlowSummary>): FlowSummary {
  return {
    apiName: 'F', label: 'F', apiVersion: '62.0', processType: 'Flow', status: 'Active',
    namespace: null,
    start: { triggerType: null, triggerObject: null, recordTriggerType: null },
    initiator: 'human',
    recordLookups: [], recordCreates: [], recordUpdates: [], recordDeletes: [],
    actionCalls: [], subflows: [], screenCount: 1, decisionCount: 0, loopCount: 0,
    ...over,
  };
}
const ref = (object: string) => ({ name: 'n', object });

describe('deriveFlowEdges — untriggered flows', () => {
  it('directs from the object looked up to the object created', () => {
    const { edges } = deriveFlowEdges([
      flow({ recordLookups: [ref('Account')], recordCreates: [ref('Case')] }),
    ]);

    const e = edges.find((x) => x.a === 'Account' && x.b === 'Case')!;
    expect(e).toBeDefined();
    expect(e.directed).toBe(true);
  });

  it('directs the other way when the roles reverse', () => {
    const { edges } = deriveFlowEdges([
      flow({ recordLookups: [ref('Case')], recordUpdates: [ref('Account')] }),
    ]);

    const e = edges.find((x) => x.a === 'Case' && x.b === 'Account')!;
    expect(e).toBeDefined();
    expect(e.directed).toBe(true);
  });

  it('leaves two look-ups undirected', () => {
    const { edges } = deriveFlowEdges([
      flow({ recordLookups: [ref('Account'), ref('Case')] }),
    ]);

    expect(edges[0].directed).toBeFalsy();
  });

  it('leaves two writes undirected', () => {
    const { edges } = deriveFlowEdges([
      flow({ recordCreates: [ref('Account'), ref('Case')] }),
    ]);

    expect(edges[0].directed).toBeFalsy();
  });

  it('does not direct an object that is both read and written', () => {
    // Reading and updating the same object says nothing about order against another.
    const { edges } = deriveFlowEdges([
      flow({ recordLookups: [ref('Account')], recordUpdates: [ref('Account'), ref('Case')] }),
    ]);

    expect(edges.find((x) => (x.a === 'Account' && x.b === 'Case') || (x.a === 'Case' && x.b === 'Account'))!.directed).toBeFalsy();
  });

  it('still directs record-triggered flows from their trigger object', () => {
    const { edges } = deriveFlowEdges([
      flow({
        start: { triggerType: 'RecordAfterSave', triggerObject: 'Case', recordTriggerType: 'Create' },
        initiator: 'record-trigger',
        recordCreates: [ref('WorkOrder')],
      }),
    ]);

    const e = edges.find((x) => x.a === 'Case' && x.b === 'WorkOrder')!;
    expect(e.directed).toBe(true);
  });
});
