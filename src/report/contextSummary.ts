// What the business objects depend on, read off the fragment's `uses` edges. OBJECT_ROLES_SPEC 2.3.
//
// Pairs with an actor, a record type, setup, configuration, an event or reference data stopped
// being couplings. They are still the measurement behind findings like "the business model is
// wired into the permission model", so the report states them by role instead of dropping them.
import type { CanonicalGraph } from '@cclabsnz/sf-core';

export interface ContextRow {
  /** The non-business role, e.g. `actor`, `qualifier`, `setup`. */
  role: string;
  /** Pairs with an object in this role. */
  pairs: number;
  /** Total weight of those pairs. */
  weight: number;
  /** The objects in this role, heaviest first. */
  objects: string[];
}

const BUSINESS = new Set(['entity', 'unclassified']);

export function contextRowsOf(fragment: CanonicalGraph): ContextRow[] {
  const byRole = new Map<string, { pairs: number; weight: number; objects: Map<string, number> }>();
  for (const e of fragment.edges) {
    if (e.kind !== 'uses') continue;
    const roles = e.attrs.roles as { from?: string; to?: string } | undefined;
    const weight = typeof e.attrs.weight === 'number' ? e.attrs.weight : 1;
    // A pair between two non-business objects counts once under each role it involves.
    for (const [role, id] of [
      [roles?.from, e.from],
      [roles?.to, e.to],
    ] as const) {
      if (!role || BUSINESS.has(role)) continue;
      const row = byRole.get(role) ?? { pairs: 0, weight: 0, objects: new Map<string, number>() };
      row.pairs++;
      row.weight += weight;
      const object = id.replace(/^obj\./, '');
      row.objects.set(object, (row.objects.get(object) ?? 0) + weight);
      byRole.set(role, row);
    }
  }
  const byWeightThenName = <T extends [string, number]>(a: T, b: T) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return [...byRole.entries()]
    .map(([role, r]) => ({
      role,
      pairs: r.pairs,
      weight: r.weight,
      objects: [...r.objects.entries()].sort(byWeightThenName).map(([o]) => o),
    }))
    .sort((a, b) => b.weight - a.weight || (a.role < b.role ? -1 : a.role > b.role ? 1 : 0));
}
