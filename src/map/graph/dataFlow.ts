import type { CouplingOperation } from '@cclabsnz/sf-core';

const WRITES: ReadonlySet<CouplingOperation> = new Set(['create', 'update', 'delete']);

/** True when the object is only queried, never modified. */
export function readOnly(ops: ReadonlySet<CouplingOperation>): boolean {
  return ops.size > 0 && ![...ops].some((o) => WRITES.has(o));
}

/** True when the object is modified at all. */
export function written(ops: ReadonlySet<CouplingOperation>): boolean {
  return [...ops].some((o) => WRITES.has(o));
}

/**
 * Direction implied by one object being read and the other written: values come from what is
 * queried and land in what is inserted or updated.
 *
 * Shared by the Apex and Flow derivations because the inference is identical and the two
 * discarded it in identical ways — a component's per-object operations were unioned together
 * before the edge was built, so "read this, write that" became an undirected pair carrying
 * both verbs. Keeping one rule means the two cannot drift apart again.
 *
 * Two reads give no order. Two writes give no order either — nothing in the source says which
 * happened first — so both stay undirected rather than being guessed at. An object that is
 * both read and written is not read-only, so it yields no direction against anything.
 */
export function dataFlowBetween(
  a: string,
  aOps: ReadonlySet<CouplingOperation>,
  b: string,
  bOps: ReadonlySet<CouplingOperation>,
): { from: string; to: string } | null {
  if (readOnly(aOps) && written(bOps)) return { from: a, to: b };
  if (readOnly(bOps) && written(aOps)) return { from: b, to: a };
  return null;
}
