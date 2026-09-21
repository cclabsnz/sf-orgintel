import { ApexRepository, FlowRepository, describeSalesforceError, mapWithConcurrency } from '@cclabsnz/sf-core';
import type { IntelContext } from '../lib/wire.js';
import type { OrgIntelCache } from '../lib/cache.js';
import { contentHash } from '../lib/cache.js';
import type { FlowSummary } from './flow/flowTypes.js';
import type { ApexClassInput, ApexTriggerInput, SymbolTableLike } from './apex/apexTypes.js';
import { summarizeFlow } from './flow/parseFlow.js';
import type { XmlObject } from './flow/xml.js';
import type { ObjectResolver } from '../discover/objectResolver.js';

export interface RetrieveFlowOptions {
  includeInactive?: boolean;
}

/**
 * What a retrieval listed versus what it could analyse. Both numbers are already known at
 * retrieval time; neither costs an extra org read.
 *
 * This is `intel map`'s own denominator, NOT the org-wide census `intel anatomy` reports.
 * The two measure different SObjects and will legitimately disagree:
 *   - `listed` here is the row count of what THIS user's session could read from
 *     `FlowDefinitionView` / `ApexClass` / `ApexTrigger` through the Tooling and data APIs.
 *   - `intel anatomy`'s `capabilities.flows` is `SELECT COUNT(Id) FROM FlowDefinition`
 *     (src/anatomy/collectors/capabilities.ts), a different object with different row
 *     visibility rules.
 * Neither is a defective version of the other, and neither should be substituted for the
 * other. Spec 2 and 2.1.
 */
export interface RetrievalCensus {
  /**
   * Everything the org returned for this kind to THIS user, on this run.
   *
   * Optional on purpose, and the single most load-bearing decision in this type. When the
   * listing read is refused there is no denominator, and `0` is not the answer: it asserts
   * the org contains none of this kind, and alongside `analysed: 0` it further asserts that
   * all of them were analysed. Absent means "not measured", which is the truth on every
   * catch path, and it is what every downstream optional (`MapRunResult.flowsListed?`,
   * `MapReportInput.flowsListed?`, `MapCommandResult.flowsListed?`) and `analysedOf`'s
   * undefined branch in src/report/mapReport.ts were built to carry. Leave it unset rather
   * than defaulting it anywhere.
   */
  listed?: number;
  /**
   * What was actually parsed and therefore reached the graph -- never simply "what was
   * listed". A flow whose metadata could not be read, or whose XML would not parse, is
   * listed but not analysed; so is an Apex class with neither a body nor a SymbolTable, and
   * a trigger whose object could not be resolved. Each such drop is noted, so the gap
   * between the two numbers is always explained somewhere in the run's notes.
   */
  analysed: number;
}

export interface FlowRetrieval {
  summaries: FlowSummary[];
  census: RetrievalCensus;
}

export interface ApexRetrieval {
  classes: ApexClassInput[];
  triggers: ApexTriggerInput[];
  classCensus: RetrievalCensus;
  triggerCensus: RetrievalCensus;
}

/** Concurrent Tooling requests in flight while fetching flow metadata. */
const FLOW_CONCURRENCY = 8;

/**
 * Retrieve flow definitions and summarise each, via the core `FlowRepository` (which owns the
 * standard-vs-Tooling routing and the one-row-per-query rule for `Flow.Metadata`). Summaries
 * are cached per flow version id, so re-runs only re-analyse changed flows.
 */
export async function retrieveFlows(
  ctx: IntelContext,
  opts: RetrieveFlowOptions,
  notes: string[],
  cache?: OrgIntelCache,
): Promise<FlowRetrieval> {
  const flows = new FlowRepository(ctx.soql, ctx.tooling);

  let definitions;
  try {
    definitions = await flows.listDefinitions();
  } catch (e) {
    notes.push(`FlowDefinitionView is not queryable; flow coupling skipped. (${describeSalesforceError(e)})`);
    // No `listed`. The read was refused, so nothing was counted; reporting 0 here would
    // render as "0 of 0" -- the org has no flows, and we analysed all of them -- which is a
    // stronger and more wrong claim than the bare, uninformative 0 that `analysed` alone gives.
    return { summaries: [], census: { analysed: 0 } };
  }

  const { versions, managedSkipped } = FlowRepository.selectVersions(definitions, opts);
  if (managedSkipped > 0) {
    notes.push(`${managedSkipped} managed-package flow(s) skipped: metadata is not readable for managed flows.`);
  }

  // Serve cache hits first, then fetch only the misses. `Flow.Metadata` cannot be batched,
  // so bulk reads rely on bounded concurrency.
  const summaries: FlowSummary[] = [];
  const misses = versions.filter((v) => {
    const hit = cache?.get<FlowSummary>('flow', contentHash(v.id)) ?? null;
    if (hit) summaries.push(hit);
    return !hit;
  });

  await mapWithConcurrency(misses, FLOW_CONCURRENCY, async (v) => {
    let metadata: unknown;
    try {
      metadata = await flows.fetchMetadata(v.id);
    } catch (e) {
      notes.push(`Flow ${v.apiName} metadata was unavailable; skipped. (${describeSalesforceError(e)})`);
      return;
    }
    if (!metadata) {
      notes.push(`Flow ${v.apiName} returned no metadata; skipped.`);
      return;
    }
    try {
      const summary = summarizeFlow(metadata as XmlObject, v.apiName);
      summaries.push(summary);
      cache?.set('flow', contentHash(v.id), summary);
    } catch (e) {
      notes.push(`Flow ${v.apiName} could not be parsed; skipped. (${describeSalesforceError(e)})`);
    }
  });

  // Deterministic regardless of cache-hit and completion ordering.
  notes.sort();
  summaries.sort((a, b) => a.apiName.localeCompare(b.apiName));
  return { summaries, census: { listed: definitions.length, analysed: summaries.length } };
}

/**
 * Retrieve Apex classes and triggers via the core `ApexRepository`, which knows that only
 * `ApexClass` carries a `SymbolTable` column. Triggers fall back to body analysis.
 */
export async function retrieveApex(
  ctx: IntelContext,
  resolver: ObjectResolver,
  notes: string[],
  cache?: OrgIntelCache,
): Promise<ApexRetrieval> {
  const apex = new ApexRepository(ctx.tooling);
  let classes: ApexClassInput[] = [];
  let triggers: ApexTriggerInput[] = [];
  // Undefined, not 0: an unset denominator on the catch paths below. See `RetrievalCensus.listed`.
  let classesListed: number | undefined;
  let triggersListed: number | undefined;

  try {
    // Bodies are cheap to fetch but not to analyse, so the derived shape is memoised by a
    // hash of the source. A class whose body is withheld (managed package) is keyed by its
    // SymbolTable instead; one with neither is not cacheable and is passed through.
    const listed = await apex.listClasses();
    classesListed = listed.length;
    const resolved = await Promise.all(
      listed.map(async (c) => {
        const input: ApexClassInput = {
          name: c.name,
          namespace: c.namespace,
          body: c.body,
          symbolTable: (c.symbolTable as SymbolTableLike | null) ?? null,
        };
        const key = c.body ?? (c.symbolTable ? JSON.stringify(c.symbolTable) : null);
        if (!cache || key === null) return input;
        return cache.memoize('apex', key, () => input);
      }),
    );
    // A class with neither a body nor a SymbolTable cannot be analysed at all: `analyzeApex`
    // has nothing to regex and nothing to walk, so it yields no objects, contributes no
    // coupling edge and no `touches` edge to the fragment. The usual cause is managed-package
    // code, whose body the platform returns as the literal `(hidden)` (normalised to null by
    // sf-core's `usableApexBody`) and whose SymbolTable is frequently withheld too. Counting
    // those as analysed made `analysed` a copy of `listed` and "Apex classes: 412 of 412" a
    // tautology on every successful run, hiding exactly the half of the coverage gap spec 2
    // calls "the classes nobody could read". They are dropped from the analysed population the
    // same way an unresolvable trigger is, with one aggregated note rather than one per class:
    // a managed-heavy org has hundreds of them, and hundreds of near-identical lines would
    // drown the very report this is meant to qualify (same rule as the managed-flow note above).
    const unreadable = resolved.filter((c) => !c.body && !c.symbolTable);
    if (unreadable.length > 0) {
      notes.push(
        `${unreadable.length} Apex class(es) have neither a readable body nor a SymbolTable ` +
          '(typically managed-package code); excluded from coupling.',
      );
    }
    classes = resolved.filter((c) => !!c.body || !!c.symbolTable);
  } catch (e) {
    notes.push(`ApexClass is not queryable; class coupling skipped. (${describeSalesforceError(e)})`);
  }

  try {
    const listed = await apex.listTriggers();
    triggersListed = listed.length;
    const resolved = listed.map((t) => ({
      name: t.name,
      namespace: t.namespace,
      object: resolver.resolve(t.tableEnumOrId) ?? t.tableEnumOrId,
      body: t.body,
      symbolTable: null,
    }));
    // Deliberately NOT the class predicate above. A trigger whose body is withheld but whose
    // object resolves has still been analysed in the only sense that matters here: it reaches
    // the graph as a `trigger.<name>` node carrying the object it fires on, and it takes its
    // place in that object's order-of-execution timeline (`objectTimelines`). The object is
    // the analysable fact about a trigger; the body only adds the objects it goes on to touch.
    // A trigger whose object cannot be resolved has nowhere to sit in either structure, which
    // is why that, and only that, is the drop.
    for (const t of resolved) {
      if (!t.object) {
        notes.push(`Trigger ${t.name} has no resolvable object; excluded from coupling.`);
      }
    }
    triggers = resolved.filter((t) => !!t.object);
  } catch (e) {
    notes.push(`ApexTrigger is not queryable; trigger coupling skipped. (${describeSalesforceError(e)})`);
  }

  return {
    classes,
    triggers,
    classCensus: { listed: classesListed, analysed: classes.length },
    triggerCensus: { listed: triggersListed, analysed: triggers.length },
  };
}
