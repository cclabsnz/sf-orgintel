/**
 * Salesforce's order of execution, encoded.
 *
 * Everywhere else this tool infers sequence from evidence: if A only reads an object and B writes
 * it, B probably runs first. That inference is worth having but it is a guess. The order of
 * execution is not a guess — the platform documents it and guarantees it. A before-save flow runs
 * before an Apex before trigger, which runs before validation, which runs before after triggers,
 * on every save, in every org, without exception.
 *
 * So where two components touch the same object and land in different phases, the order between
 * them is a fact rather than an inference, and should be reported as one.
 *
 * Ordinals encode position within a transaction. Two phases sharing an ordinal are deliberately
 * unordered: `before-save-flow` and `before-delete-flow` both run first, but in different kinds of
 * transaction, so there is no order between them to report. `null` means the phase sits outside the
 * save transaction entirely.
 */
export type Phase =
  | 'before-save-flow'
  | 'before-delete-flow'
  | 'before-trigger'
  | 'validation'
  | 'after-trigger'
  | 'assignment'
  | 'workflow'
  | 'after-save-flow'
  | 'rollup'
  | 'async'
  | 'user-initiated'
  | 'invocable';

interface PhaseSpec {
  /** Position in the transaction; null for work that is not part of one. */
  ordinal: number | null;
  description: string;
}

const SPECS: Readonly<Record<Phase, PhaseSpec>> = {
  'before-save-flow': { ordinal: 10, description: 'Before-save record-triggered flow' },
  'before-delete-flow': { ordinal: 10, description: 'Before-delete record-triggered flow' },
  'before-trigger': { ordinal: 20, description: 'Apex before trigger' },
  validation: { ordinal: 30, description: 'Validation and duplicate rules' },
  'after-trigger': { ordinal: 40, description: 'Apex after trigger' },
  assignment: { ordinal: 50, description: 'Assignment and auto-response rules' },
  workflow: { ordinal: 60, description: 'Workflow rules and field updates' },
  'after-save-flow': { ordinal: 70, description: 'After-save record-triggered flow' },
  rollup: { ordinal: 80, description: 'Roll-up summary and criteria-based sharing' },
  async: { ordinal: 90, description: 'After commit: async, scheduled and platform-event work' },
  'user-initiated': { ordinal: null, description: 'Run by a person, outside any save' },
  invocable: { ordinal: null, description: 'Called by other automation; inherits its caller phase' },
};

/** Every phase, in the order the platform runs them. */
export const PHASES: readonly Phase[] = (Object.keys(SPECS) as Phase[]).sort(
  (a, b) => (SPECS[a].ordinal ?? Infinity) - (SPECS[b].ordinal ?? Infinity),
);

export function describePhase(phase: Phase): string {
  return SPECS[phase].description;
}

export interface FlowPhaseInput {
  /** `Flow.Start.triggerType` — RecordBeforeSave, RecordAfterSave, Scheduled, PlatformEvent… */
  triggerType: string | null;
  /** `Flow.ProcessType` — Flow for screen flows, AutoLaunchedFlow otherwise. */
  processType: string | null;
}

const FLOW_TRIGGER_PHASES: Readonly<Record<string, Phase>> = {
  RecordBeforeSave: 'before-save-flow',
  RecordAfterSave: 'after-save-flow',
  RecordBeforeDelete: 'before-delete-flow',
  RecordAfterDelete: 'async',
  Scheduled: 'async',
  PlatformEvent: 'async',
};

export function phaseOfFlow({ triggerType, processType }: FlowPhaseInput): Phase {
  if (triggerType) {
    const known = FLOW_TRIGGER_PHASES[triggerType];
    if (known) return known;
    // An unrecognised trigger type is still trigger-driven, but we cannot say when it runs.
    return 'invocable';
  }
  // A screen flow is a person clicking through steps — it is not inside anyone's save.
  return processType === 'Flow' ? 'user-initiated' : 'invocable';
}

/**
 * Read the phase straight out of the trigger declaration.
 *
 * `trigger Name on Object (before insert, after update)` states its own phases, so no inference is
 * needed. A trigger declaring both runs at the earlier of the two.
 */
const TRIGGER_EVENTS = /\btrigger\s+\w+\s+on\s+\w+\s*\(([^)]*)\)/i;

export function phaseOfTrigger(body: string | null): Phase {
  const events = body?.match(TRIGGER_EVENTS)?.[1];
  // Managed triggers report a hidden body. After is both commoner and the safer assumption: it
  // sequences the trigger later, so we never claim something ran earlier than it may have.
  if (!events) return 'after-trigger';
  return /\bbefore\b/i.test(events) ? 'before-trigger' : 'after-trigger';
}

/**
 * Negative when `a` is guaranteed to run before `b`, positive for the reverse, zero when the
 * platform guarantees nothing — same phase, different transaction kinds, or work that sits outside
 * the save order. Zero means "unordered", never "simultaneous".
 */
export function comparePhases(a: Phase, b: Phase): number {
  const x = SPECS[a].ordinal;
  const y = SPECS[b].ordinal;
  if (x === null || y === null) return 0;
  return x - y;
}
