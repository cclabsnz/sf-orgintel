import { describe, it, expect } from '@jest/globals';
import {
  PHASES,
  phaseOfFlow,
  phaseOfTrigger,
  comparePhases,
  describePhase,
} from '../../../src/map/graph/executionOrder.js';

/**
 * Salesforce runs a documented, deterministic order of operations on every save: before-save
 * flows, before triggers, validation, after triggers, assignment and workflow rules,
 * after-save flows, then everything asynchronous after commit.
 *
 * That matters because it converts inference into fact. Elsewhere this tool says "A probably
 * happens before B" from read/write asymmetry; here the platform *guarantees* that a
 * before-save flow ran before an after-save flow touching the same record. Ordering evidence
 * that the platform documents should never be presented as a guess.
 */
describe('phaseOfFlow', () => {
  it.each([
    ['RecordBeforeSave', 'before-save-flow'],
    ['RecordAfterSave', 'after-save-flow'],
    ['RecordBeforeDelete', 'before-delete-flow'],
    ['Scheduled', 'async'],
    ['PlatformEvent', 'async'],
  ])('maps trigger type %s to %s', (triggerType, expected) => {
    expect(phaseOfFlow({ triggerType, processType: 'AutoLaunchedFlow' })).toBe(expected);
  });

  it('treats a screen flow as user-initiated, outside the save order entirely', () => {
    // A person walking through a screen flow is not part of any record's save transaction.
    expect(phaseOfFlow({ triggerType: null, processType: 'Flow' })).toBe('user-initiated');
  });

  it('treats an autolaunched flow with no trigger as invocable', () => {
    expect(phaseOfFlow({ triggerType: null, processType: 'AutoLaunchedFlow' })).toBe('invocable');
  });
});

describe('phaseOfTrigger', () => {
  it('reads before and after from the trigger declaration', () => {
    expect(phaseOfTrigger('trigger T on Account (before insert, before update) { }')).toBe('before-trigger');
    expect(phaseOfTrigger('trigger T on Account (after insert) { }')).toBe('after-trigger');
  });

  it('reports the earliest phase when a trigger declares both', () => {
    // A trigger handling before and after runs first at its earliest point.
    expect(phaseOfTrigger('trigger T on Account (before insert, after update) { }')).toBe('before-trigger');
  });

  it('falls back to after-trigger when the declaration cannot be read', () => {
    // Managed triggers report a hidden body; after is the commoner case and the safer guess,
    // and the caller can tell it was a fallback because the body was absent.
    expect(phaseOfTrigger(null)).toBe('after-trigger');
    expect(phaseOfTrigger('(hidden)')).toBe('after-trigger');
  });
});

describe('comparePhases', () => {
  it('orders the save transaction as Salesforce documents it', () => {
    const order = [
      'before-save-flow', 'before-trigger', 'after-trigger',
      'assignment', 'workflow', 'after-save-flow', 'async',
    ] as const;

    for (let i = 1; i < order.length; i++) {
      expect(comparePhases(order[i - 1], order[i])).toBeLessThan(0);
    }
  });

  it('is zero for the same phase, so equal evidence stays unordered', () => {
    expect(comparePhases('after-trigger', 'after-trigger')).toBe(0);
  });

  it('orders the delete transaction too', () => {
    // Deleting runs its own sequence: before-delete flow, then before delete triggers.
    expect(comparePhases('before-delete-flow', 'before-trigger')).toBeLessThan(0);
    expect(comparePhases('before-delete-flow', 'async')).toBeLessThan(0);
  });

  it('leaves the save and delete paths unordered against each other', () => {
    // Both run first, but in different kinds of transaction. Claiming an order between them
    // would be inventing a guarantee the platform does not make.
    expect(comparePhases('before-save-flow', 'before-delete-flow')).toBe(0);
  });

  it('places user-initiated outside the save order rather than inside it', () => {
    // A screen flow is not part of a save transaction; ordering it against one would be a lie.
    expect(comparePhases('user-initiated', 'before-trigger')).toBe(0);
    expect(comparePhases('before-trigger', 'user-initiated')).toBe(0);
  });
});

describe('PHASES', () => {
  it('describes every phase it can report', () => {
    for (const p of PHASES) expect(describePhase(p)).toBeTruthy();
  });

  it('has no duplicates', () => {
    expect(new Set(PHASES).size).toBe(PHASES.length);
  });
});
