// Object roles applied to the coupling analysis. docs/OBJECT_ROLES_SPEC.md section 2.3.
//
// The classifier itself is sf-core's `classifyObject`, a pure function over platform facts; this
// module is what `intel map` does with its answers. Companions fold into their parent before pairs
// are formed, only pairs between business objects stay couplings, and every other pair is kept as
// context -- a business object's dependence on the permission model is a finding in its own right
// and must not vanish with the noise it used to be mixed into.
import {
  classifyObject,
  type CouplingGraphEdge,
  type CouplingOperation,
  type ObjectFacts,
  type ObjectRole,
  type ObjectRoleDecision,
  type PlatformTargets,
} from '@cclabsnz/sf-core';
import type { RawEdge } from '../types.js';

export interface ObjectRoles {
  decide(object: string): ObjectRoleDecision;
}

/** Decisions memoised per object, so every consumer of one run sees the same answer. */
export function buildObjectRoles(facts: ReadonlyMap<string, ObjectFacts>, targets: PlatformTargets): ObjectRoles {
  const memo = new Map<string, ObjectRoleDecision>();
  return {
    decide(object) {
      let d = memo.get(object);
      if (!d) {
        d = classifyObject(object, facts.get(object), targets);
        memo.set(object, d);
      }
      return d;
    },
  };
}

/** No roles known: every object is unclassified, so nothing folds and every pair stays a coupling. */
export const NO_ROLES: ObjectRoles = buildObjectRoles(new Map(), { actors: new Set(), qualifiers: new Set() });

function parentOf(object: string, roles: ObjectRoles): string {
  const d = roles.decide(object);
  return d.role === 'companion' && d.parent ? d.parent : object;
}

/**
 * Renames each companion endpoint to its parent. A pair that becomes the parent with itself is
 * left for `mergeEdges` to drop, and a component touching both the parent and its companion is
 * counted once, because `mergeEdges` already keys contributions by component.
 */
export function foldCompanions(raw: readonly RawEdge[], roles: ObjectRoles): RawEdge[] {
  return raw.map((e) => ({ ...e, a: parentOf(e.a, roles), b: parentOf(e.b, roles) }));
}

/** Unclassified counts as possibly business: nothing leaves the couplings without evidence. */
export function isCouplingRole(role: ObjectRole): boolean {
  return role === 'entity' || role === 'unclassified';
}

/** A pair where at least one side is known not to be business data, labelled with both roles. */
export interface ContextEdge extends CouplingGraphEdge {
  roles: [ObjectRole, ObjectRole];
}

export function splitCouplings(
  edges: readonly CouplingGraphEdge[],
  roles: ObjectRoles,
): { couplings: CouplingGraphEdge[]; context: ContextEdge[] } {
  const couplings: CouplingGraphEdge[] = [];
  const context: ContextEdge[] = [];
  for (const e of edges) {
    const a = roles.decide(e.from).role;
    const b = roles.decide(e.to).role;
    if (isCouplingRole(a) && isCouplingRole(b)) couplings.push(e);
    else context.push({ ...e, roles: [a, b] });
  }
  return { couplings, context };
}

/** Unions per-component touches into what production automation does to each object. */
export function operationsByObject(
  perComponent: Iterable<ReadonlyMap<string, ReadonlySet<CouplingOperation>>>,
): Map<string, Set<CouplingOperation>> {
  const out = new Map<string, Set<CouplingOperation>>();
  for (const touches of perComponent) {
    for (const [object, ops] of touches) {
      const set = out.get(object) ?? new Set<CouplingOperation>();
      for (const op of ops) set.add(op);
      out.set(object, set);
    }
  }
  return out;
}
