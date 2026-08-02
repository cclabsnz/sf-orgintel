import { describe, it, expect } from '@jest/globals';
import { objectTimelines } from '../../../src/map/graph/timeline.js';

/**
 * What actually runs when a record is saved, in the order the platform runs it.
 *
 * The order of execution guarantees sequence *within one transaction*, which means it applies to
 * automations firing on the same object. It deliberately does NOT apply along a chain: when a
 * trigger on A writes B and B's own automation then fires, that is a nested execution, not a later
 * phase of the same one. Claiming a guarantee there would be inventing one.
 *
 * The other half of the truth is where the platform guarantees nothing: two Apex triggers on the
 * same object in the same phase run in an undefined order. That is a genuine architectural risk
 * and is worth naming rather than papering over with an arbitrary sort.
 */
const trigger = (name: string, object: string, body: string): { name: string; object: string; body: string; namespace: null } =>
  ({ name, object, body, namespace: null });

const flow = (apiName: string, triggerObject: string | null, triggerType: string | null, processType = 'AutoLaunchedFlow') => ({
  apiName,
  processType,
  namespace: null,
  start: { triggerType, triggerObject, recordTriggerType: null },
});

describe('objectTimelines', () => {
  it('orders automation on one object by the documented order of execution', () => {
    const timelines = objectTimelines({
      triggers: [
        trigger('AccAfter', 'Account', 'trigger AccAfter on Account (after update) { }'),
        trigger('AccBefore', 'Account', 'trigger AccBefore on Account (before insert) { }'),
      ],
      flows: [
        flow('AccAfterFlow', 'Account', 'RecordAfterSave'),
        flow('AccBeforeFlow', 'Account', 'RecordBeforeSave'),
      ],
    });

    expect(timelines).toHaveLength(1);
    expect(timelines[0].object).toBe('Account');
    expect(timelines[0].entries.map((e) => e.phase)).toEqual([
      'before-save-flow',
      'before-trigger',
      'after-trigger',
      'after-save-flow',
    ]);
  });

  it('groups every component that runs in the same phase, in a stable order', () => {
    // Fed in reverse, and asserted without re-sorting — the platform gives no order inside a
    // phase, so this tool must impose a stable one rather than echo retrieval order.
    const timelines = objectTimelines({
      triggers: [
        trigger('Zulu', 'Case', 'trigger Zulu on Case (before update) { }'),
        trigger('Alpha', 'Case', 'trigger Alpha on Case (before update) { }'),
      ],
      flows: [],
    });

    const before = timelines[0].entries.find((e) => e.phase === 'before-trigger')!;
    expect(before.components.map((c) => c.name)).toEqual(['Alpha', 'Zulu']);
  });

  it('flags a phase holding more than one component as unordered', () => {
    // Salesforce does not guarantee the order of two Apex triggers on the same object and phase.
    // A reader who assumes one runs first is relying on something the platform never promised.
    const timelines = objectTimelines({
      triggers: [
        trigger('One', 'Case', 'trigger One on Case (before update) { }'),
        trigger('Two', 'Case', 'trigger Two on Case (before update) { }'),
      ],
      flows: [],
    });

    expect(timelines[0].entries.find((e) => e.phase === 'before-trigger')!.ordered).toBe(false);
    expect(timelines[0].unorderedPhases).toBe(1);
  });

  it('does not flag a phase holding a single component', () => {
    const timelines = objectTimelines({
      triggers: [trigger('Only', 'Case', 'trigger Only on Case (before update) { }')],
      flows: [],
    });

    expect(timelines[0].entries[0].ordered).toBe(true);
    expect(timelines[0].unorderedPhases).toBe(0);
  });

  it('ignores automation that is not tied to a saving object', () => {
    // A screen flow or an invocable flow has no trigger object, so it belongs to no object's
    // save sequence and must not be placed in one.
    const timelines = objectTimelines({
      triggers: [],
      flows: [flow('Screen', null, null, 'Flow'), flow('Invocable', null, null)],
    });

    expect(timelines).toEqual([]);
  });

  it('separates the delete sequence from the save sequence', () => {
    // A before-delete flow and a before-save flow on the same object never run in the same
    // transaction, so listing them as consecutive steps of one sequence would be wrong.
    const timelines = objectTimelines({
      triggers: [],
      flows: [flow('Del', 'Account', 'RecordBeforeDelete'), flow('Save', 'Account', 'RecordBeforeSave')],
    });

    const phases = timelines[0].entries.map((e) => e.phase);
    expect(phases).toContain('before-save-flow');
    expect(phases).toContain('before-delete-flow');
    // Sharing an ordinal must not collapse them into one entry.
    expect(timelines[0].entries.filter((e) => e.components.length > 0)).toHaveLength(2);
    // Nor may it be reported as an ambiguity — they are unordered because they never co-occur.
    expect(timelines[0].unorderedPhases).toBe(0);
  });

  it('ranks objects by how much automation they carry', () => {
    // Named so that load order and alphabetical order disagree — otherwise this passes against
    // a plain alphabetical sort and proves nothing about ranking.
    const timelines = objectTimelines({
      triggers: [trigger('Z1', 'Zebra', 'trigger Z1 on Zebra (before update) { }')],
      flows: [
        flow('Z2', 'Zebra', 'RecordAfterSave'),
        flow('Z3', 'Zebra', 'RecordBeforeSave'),
        flow('A1', 'Aardvark', 'RecordAfterSave'),
      ],
    });

    expect(timelines.map((t) => t.object)).toEqual(['Zebra', 'Aardvark']);
    expect(timelines[0].componentCount).toBe(3);
  });

  it('is deterministic regardless of input order', () => {
    const input = {
      triggers: [
        trigger('A', 'Case', 'trigger A on Case (before update) { }'),
        trigger('B', 'Case', 'trigger B on Case (after update) { }'),
      ],
      flows: [flow('F', 'Case', 'RecordAfterSave'), flow('G', 'Account', 'RecordBeforeSave')],
    };
    const reversed = { triggers: [...input.triggers].reverse(), flows: [...input.flows].reverse() };

    expect(JSON.stringify(objectTimelines(input))).toBe(JSON.stringify(objectTimelines(reversed)));
  });

  it('handles an org with no automation', () => {
    expect(objectTimelines({ triggers: [], flows: [] })).toEqual([]);
  });
});
