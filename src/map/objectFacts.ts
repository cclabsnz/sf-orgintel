// The platform facts sf-core's `classifyObject` decides object roles from. OBJECT_ROLES_SPEC 3.
//
// Gathered for the coupled objects only, from three reads: the global describe the run has already
// fetched (parent entity, layout and trigger capability, custom-setting status), one
// EntityDefinition query for internal sharing models, and a few describes to read what the system
// fields point at. Each can be refused, and a refusal leaves those facts unread with a coverage
// entry; the classifier then answers `unclassified` where it needed them, rather than guessing.
import {
  describeSalesforceError,
  type CouplingOperation,
  type GraphUnavailable,
  type ObjectFacts,
  type PlatformTargets,
} from '@cclabsnz/sf-core';
import type { IntelContext } from '../lib/wire.js';
import type { SObjectCatalog } from '../probe/sobjectCatalog.js';

/**
 * An API name is letters, digits and underscores (a namespace and the __c-style suffixes included).
 * Names are matched against this instead of being escaped into the query: nothing that fails it can
 * be a real object, and refusing it means no quoting rule has to be complete for the query to be safe.
 */
const API_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** EntityDefinition rejects very long IN lists; this keeps each query comfortably short. */
const SHARING_BATCH = 100;

/**
 * How many objects to describe for the system-field targets. The targets are platform-wide, so a
 * few business objects settle them; more would only add reads. They are unioned, because
 * `OwnerId` points at Group as well as User only on objects that support queues.
 */
const SYSTEM_FIELD_SAMPLES = 3;

const ACTOR_FIELDS = new Set(['OwnerId', 'CreatedById', 'LastModifiedById']);
const QUALIFIER_FIELDS = new Set(['RecordTypeId']);

interface DescribeFields {
  fields?: Array<{ name?: string; referenceTo?: string[] | null }>;
}

export async function collectObjectFacts(
  ctx: IntelContext,
  catalog: SObjectCatalog,
  objects: readonly string[],
  productionOps: ReadonlyMap<string, ReadonlySet<CouplingOperation>>,
  notes: string[],
  unavailable: GraphUnavailable[],
): Promise<{ facts: Map<string, ObjectFacts>; targets: PlatformTargets }> {
  const sorted = [...new Set(objects)].sort();
  const facts = new Map<string, ObjectFacts>();
  for (const o of sorted) {
    const entry = catalog.get(o);
    const ops = productionOps.get(o);
    facts.set(o, {
      associateParentEntity: entry?.associateParentEntity ?? null,
      layoutable: entry?.layoutable,
      triggerable: entry?.triggerable,
      customSetting: entry?.customSetting,
      // Only an object production automation actually touches can be called read-only by it.
      ...(ops && ops.size > 0 ? { readOnlyInAutomation: [...ops].every((op) => op === 'read') } : {}),
    });
  }

  await collectSharingModels(ctx, sorted, facts, notes, unavailable);
  const targets = await collectTargets(ctx, catalog, sorted, notes, unavailable);
  return { facts, targets };
}

async function collectSharingModels(
  ctx: IntelContext,
  objects: readonly string[],
  facts: Map<string, ObjectFacts>,
  notes: string[],
  unavailable: GraphUnavailable[],
): Promise<void> {
  const queryable = objects.filter((o) => API_NAME.test(o));
  try {
    for (let i = 0; i < queryable.length; i += SHARING_BATCH) {
      const names = queryable
        .slice(i, i + SHARING_BATCH)
        .map((o) => `'${o}'`)
        .join(',');
      const rows = await ctx.tooling.query<{ QualifiedApiName: string; InternalSharingModel?: string | null }>(
        `SELECT QualifiedApiName, InternalSharingModel FROM EntityDefinition WHERE QualifiedApiName IN (${names})`,
      );
      for (const r of rows) {
        const f = facts.get(r.QualifiedApiName);
        if (f && r.InternalSharingModel) f.sharingModel = r.InternalSharingModel;
      }
    }
  } catch (e) {
    for (const f of facts.values()) delete f.sharingModel;
    const detail =
      'Sharing models could not be read, so no object is classified as reference data or as a ' +
      `detail of its parent. (${describeSalesforceError(e)})`;
    notes.push(detail);
    unavailable.push({ scope: 'map.objectRoles.sharingModel', reason: 'failed', detail });
  }
}

async function collectTargets(
  ctx: IntelContext,
  catalog: SObjectCatalog,
  objects: readonly string[],
  notes: string[],
  unavailable: GraphUnavailable[],
): Promise<PlatformTargets> {
  const actors = new Set<string>();
  const qualifiers = new Set<string>();
  // Business objects carry the system fields; setup objects often do not.
  const samples = objects
    .filter((o) => catalog.get(o)?.layoutable === true && catalog.get(o)?.triggerable === true)
    .slice(0, SYSTEM_FIELD_SAMPLES);

  let read = 0;
  let lastError: unknown = null;
  for (const o of samples) {
    try {
      const d = await ctx.rest.get<DescribeFields>(`/sobjects/${o}/describe/`);
      read++;
      for (const field of d.fields ?? []) {
        const into = ACTOR_FIELDS.has(field.name ?? '') ? actors : QUALIFIER_FIELDS.has(field.name ?? '') ? qualifiers : null;
        for (const t of field.referenceTo ?? []) into?.add(t);
      }
    } catch (e) {
      lastError = e;
    }
  }
  if (read === 0) {
    const detail =
      'The system fields could not be read, so no object is classified as an actor (owner, creator) ' +
      `or a qualifier (record type).${lastError ? ` (${describeSalesforceError(lastError)})` : ' No business object was available to describe.'}`;
    notes.push(detail);
    unavailable.push({ scope: 'map.objectRoles.systemFields', reason: lastError ? 'failed' : 'deferred', detail });
  }
  return { actors, qualifiers };
}
