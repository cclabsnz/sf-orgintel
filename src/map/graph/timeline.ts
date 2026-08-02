import { PHASES, phaseOfFlow, phaseOfTrigger, describePhase, type Phase } from './executionOrder.js';

export interface TimelineComponent {
  type: 'Flow' | 'ApexTrigger';
  name: string;
  namespace?: string | null;
}

export interface TimelineEntry {
  phase: Phase;
  description: string;
  components: TimelineComponent[];
  /**
   * False when the platform runs more than one component here without guaranteeing which goes
   * first. Two Apex triggers on the same object and phase are the textbook case.
   */
  ordered: boolean;
}

export interface ObjectTimeline {
  object: string;
  /** Populated phases only, in the order the platform runs them. */
  entries: TimelineEntry[];
  componentCount: number;
  /** How many phases hold work whose internal order is undefined. */
  unorderedPhases: number;
}

export interface TimelineInput {
  triggers: readonly { name: string; object: string; body: string | null; namespace?: string | null }[];
  flows: readonly {
    apiName: string;
    processType: string;
    namespace?: string | null;
    start: { triggerType: string | null; triggerObject: string | null };
  }[];
}

/**
 * What runs when a record is saved, in the order the platform runs it.
 *
 * The order of execution is a guarantee about a single transaction, so it orders automation on the
 * same object and nothing further. It deliberately says nothing about a chain: when a trigger on
 * one object writes another and that object's automation fires, the second run is a nested
 * execution with its own full sequence, not a later phase of the first. Extending the guarantee
 * across objects would be inventing one.
 *
 * The phases where the platform guarantees nothing are reported as carefully as the ones where it
 * does. Two Apex triggers on the same object and phase run in an undefined order; an org relying
 * on one of them running first is relying on an accident, and that is worth naming.
 */
export function objectTimelines(input: TimelineInput): ObjectTimeline[] {
  const byObject = new Map<string, Map<Phase, TimelineComponent[]>>();

  const place = (object: string, phase: Phase, component: TimelineComponent): void => {
    let phases = byObject.get(object);
    if (!phases) byObject.set(object, (phases = new Map()));
    const list = phases.get(phase);
    if (list) list.push(component);
    else phases.set(phase, [component]);
  };

  for (const t of input.triggers) {
    place(t.object, phaseOfTrigger(t.body), { type: 'ApexTrigger', name: t.name, namespace: t.namespace ?? null });
  }

  for (const f of input.flows) {
    // No trigger object means the flow belongs to no object's save sequence — a screen flow is
    // run by a person and an invocable flow inherits whatever called it.
    if (!f.start.triggerObject) continue;
    const phase = phaseOfFlow({ triggerType: f.start.triggerType, processType: f.processType });
    place(f.start.triggerObject, phase, { type: 'Flow', name: f.apiName, namespace: f.namespace ?? null });
  }

  const timelines: ObjectTimeline[] = [];
  for (const [object, phases] of byObject) {
    const entries: TimelineEntry[] = [];
    let componentCount = 0;
    let unorderedPhases = 0;

    for (const phase of PHASES) {
      const components = phases.get(phase);
      if (!components) continue;
      components.sort((a, b) => a.name.localeCompare(b.name));
      const ordered = components.length === 1;
      if (!ordered) unorderedPhases++;
      componentCount += components.length;
      entries.push({ phase, description: describePhase(phase), components, ordered });
    }

    timelines.push({ object, entries, componentCount, unorderedPhases });
  }

  return timelines.sort(
    (a, b) => b.componentCount - a.componentCount || a.object.localeCompare(b.object),
  );
}
