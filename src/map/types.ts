import type { CouplingOperation, CouplingConfidence, CouplingDirection } from '@cclabsnz/sf-core';

export type { CouplingOperation, CouplingConfidence, CouplingDirection };

export interface ComponentRef {
  type: 'Flow' | 'ApexClass' | 'ApexTrigger';
  name: string;
  confidence: CouplingConfidence;
  namespace?: string | null;
}

/** An un-aggregated coupling contribution between two objects from a single component. */
export interface RawEdge {
  a: string;
  b: string;
  operations: CouplingOperation[];
  component: ComponentRef;
  /**
   * True when `a` acts on `b` — a record-triggered flow or an Apex trigger, where `a` is the
   * trigger object. This is process order, and it is the only signal in the graph that
   * distinguishes "these are coupled" from "this happens, then that happens".
   */
  directed?: boolean;
}
