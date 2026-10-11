import type { RestClient } from '@cclabsnz/sf-core';

export interface SObjectDescribeLite {
  name: string;
  label: string;
  custom: boolean;
  queryable: boolean;
  /**
   * Carried from the same global describe for object-role classification (OBJECT_ROLES_SPEC).
   * Optional: absent means the response did not say, never false.
   */
  associateParentEntity?: string | null;
  layoutable?: boolean;
  triggerable?: boolean;
  customSetting?: boolean;
}

export interface SObjectCatalog {
  has(name: string): boolean;
  isQueryable(name: string): boolean;
  get(name: string): SObjectDescribeLite | undefined;
  all(): SObjectDescribeLite[];
}

interface DescribeGlobalResponse {
  sobjects?: Array<{
    name: string;
    label: string;
    custom: boolean;
    queryable: boolean;
    associateParentEntity?: string | null;
    layoutable?: boolean;
    triggerable?: boolean;
    customSetting?: boolean;
  }>;
}

/** Build a catalog from a plain list — the pure core, used directly in tests. */
export function buildCatalog(list: SObjectDescribeLite[]): SObjectCatalog {
  const byName = new Map<string, SObjectDescribeLite>();
  for (const s of list) byName.set(s.name, s);
  return {
    has: (name) => byName.has(name),
    isQueryable: (name) => byName.get(name)?.queryable ?? false,
    get: (name) => byName.get(name),
    all: () => [...byName.values()],
  };
}

/** Fetch the org's global sObject list once (a single describe call). */
export async function fetchSObjectCatalog(rest: RestClient): Promise<SObjectCatalog> {
  const resp = await rest.get<DescribeGlobalResponse>('/sobjects/');
  return buildCatalog(
    (resp.sobjects ?? []).map((s) => ({
      name: s.name,
      label: s.label,
      custom: s.custom,
      queryable: s.queryable,
      associateParentEntity: s.associateParentEntity,
      layoutable: s.layoutable,
      triggerable: s.triggerable,
      customSetting: s.customSetting,
    })),
  );
}

/**
 * Key standard objects to inspect for history tracking — the business-process-bearing
 * objects present in every edition. Custom objects are discovered from the catalog.
 */
export const KEY_STANDARD_OBJECTS: readonly string[] = [
  'Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'Contract', 'Order',
  'Campaign', 'Asset', 'Product2', 'Quote', 'Solution', 'User',
];

/** History companion object name for a given object (Account -> AccountHistory, Foo__c -> Foo__History). */
export function historyObjectName(object: string, custom: boolean): string {
  if (custom) return object.replace(/__c$/i, '') + '__History';
  return object + 'History';
}

/** Custom objects worth inspecting: queryable, `__c`, excluding system companion tables. */
export function customBusinessObjects(catalog: SObjectCatalog): SObjectDescribeLite[] {
  return catalog
    .all()
    .filter(
      (s) =>
        s.custom &&
        s.queryable &&
        /__c$/i.test(s.name) &&
        !/__(History|Share|Feed|Tag|ChangeEvent)$/i.test(s.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
