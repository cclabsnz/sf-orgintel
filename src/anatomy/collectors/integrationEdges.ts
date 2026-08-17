// Every source of outbound-call evidence in one place.
//
// Apex bodies come through the Tooling API rather than source retrieve: retrieve returns only
// a fraction of classes on a real org because the rest live in managed and unlocked packages,
// while Tooling returns bodies for unlocked-package classes retrieve refuses.
//
// OmniStudio is read through the ordinary Data API. Tooling rejects OmniProcess outright.
import type { IntelContext } from '../../lib/wire.js';
import type { IntegrationEdge, Unavailable } from '../types.js';
import type { RemoteActionRef } from '../attribute.js';

export interface IntegrationEdgeInput {
  direct: IntegrationEdge[];
  remoteActions: RemoteActionRef[];
  apexCallouts: Map<string, string[]>;
  apexBodiesScanned: number;
  apexBodiesUnreadable: number;
  omniElementsScanned: number;
  /**
   * Distinct Integration Procedure names reached by a scanned element on its active version,
   * not distinct OmniProcess ids. `OmniProcess` rows are versions: several versions can share
   * one procedure name, and only one is active at a time, so counting ids overstates how many
   * procedures actually carry integration evidence.
   */
  omniProceduresWithIntegrationElements: number;
  /**
   * Elements that exist on a superseded (inactive) Integration Procedure version. Excluded
   * from `omniElementsScanned` and from edges: a version that is not active does not run, and
   * reporting its evidence as current would describe the org as it used to be, not as it is.
   * Counted rather than dropped silently, per the same rule that keeps a scanned-but-empty
   * element in the artifact instead of discarding it.
   */
  omniElementsSkippedSuperseded: number;
  /** DeveloperName of every NamedCredential, sorted. Feeds `endpointOnly` detection. */
  namedCredentials: string[];
  /** SiteName of every RemoteProxy (Remote Site Setting), sorted. Feeds `endpointOnly` detection. */
  remoteProxies: string[];
}

/** `callout:<name>` is the only confirmed outbound reference obtainable from a body. */
export function extractCallouts(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/callout:([A-Za-z0-9_]+)/g)) out.add(m[1]);
  return [...out].sort();
}

/** A REST Action element carries its credential as a plain field. No parsing required. */
export function extractRestActionCredential(config: string | null): string | null {
  if (!config) return null;
  try {
    const parsed = JSON.parse(config) as { namedCredential?: unknown };
    return typeof parsed.namedCredential === 'string' && parsed.namedCredential.length > 0
      ? parsed.namedCredential
      : null;
  } catch {
    return null;
  }
}

function remoteClassOf(config: string | null): string | null {
  if (!config) return null;
  try {
    const parsed = JSON.parse(config) as { remoteClass?: unknown };
    return typeof parsed.remoteClass === 'string' && parsed.remoteClass.length > 0 ? parsed.remoteClass : null;
  } catch {
    return null;
  }
}

export async function collectIntegrationEdges(
  ctx: IntelContext,
  notes: string[],
  unavailable: Unavailable[],
): Promise<IntegrationEdgeInput> {
  const direct: IntegrationEdge[] = [];
  const apexCallouts = new Map<string, string[]>();
  let apexBodiesScanned = 0;
  let apexBodiesUnreadable = 0;

  try {
    // ToolingClient.query resolves to T[] directly; there is no `.records` wrapper.
    const rows = await ctx.tooling.query<{ Name: string; Body: string | null }>(
      'SELECT Id, Name, Body FROM ApexClass WHERE NamespacePrefix = null ORDER BY Id',
    );
    for (const r of rows) {
      if (typeof r.Body !== 'string' || r.Body.length === 0) {
        apexBodiesUnreadable += 1;
        continue;
      }
      apexBodiesScanned += 1;
      const found = extractCallouts(r.Body);
      if (found.length > 0) {
        apexCallouts.set(r.Name, found);
        // A callout is real evidence of an outbound call on its own: it must not depend on an
        // OmniStudio Remote Action happening to name this class, or a callout in a class
        // nobody in OmniStudio calls is found, counted in apexBodiesScanned, and then dropped.
        for (const endpoint of found) {
          direct.push({
            endpoint,
            from: null,
            via: [{ type: 'ApexClass', name: r.Name }],
            detection: 'apexCallout',
            attribution: 'unattributed',
          });
        }
      }
    }
  } catch (e) {
    const detail = `Apex bodies could not be read: ${e instanceof Error ? e.message : String(e)}`;
    notes.push(detail);
    unavailable.push({ scope: 'edges.apexBodies', reason: 'failed', detail });
  }

  // `NamespacePrefix = null` above is correct (managed bodies are hidden from Tooling), but
  // that exclusion is invisible in apexBodiesUnreadable, which only counts org-authored classes
  // that failed to read. Left unstated, a reader sees apexBodiesUnreadable: 0 and concludes Apex
  // coverage was total, when namespaced classes were never in scope at all. Count them and say
  // so, so the exclusion cannot be mistaken for completeness.
  try {
    const rows = await ctx.tooling.query<{ expr0?: number }>(
      'SELECT COUNT(Id) FROM ApexClass WHERE NamespacePrefix != null',
    );
    const namespacedApexClasses = Number(rows[0]?.expr0 ?? 0);
    if (namespacedApexClasses > 0) {
      notes.push(
        `${namespacedApexClasses} namespaced (managed package) Apex class(es) were not examined; ` +
          'only org-authored bodies are scanned for callouts.',
      );
    }
  } catch (e) {
    const detail = `Namespaced Apex class count unavailable: ${e instanceof Error ? e.message : String(e)}`;
    notes.push(detail);
    unavailable.push({ scope: 'edges.apexBodies', reason: 'failed', detail });
  }

  // NamedCredential and RemoteProxy are Tooling-only objects, same as the counts in
  // collectCapabilities. Read here (not there) because these need the names, not a count, to
  // find endpoints that exist but that no other edge already reaches.
  let namedCredentials: string[] = [];
  try {
    const rows = await ctx.tooling.query<{ DeveloperName?: string }>(
      'SELECT DeveloperName FROM NamedCredential ORDER BY DeveloperName',
    );
    namedCredentials = rows
      .map((r) => r.DeveloperName)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .sort();
  } catch (e) {
    const detail = `Named credentials could not be read: ${e instanceof Error ? e.message : String(e)}`;
    notes.push(detail);
    unavailable.push({ scope: 'edges.namedCredentials', reason: 'failed', detail });
  }

  let remoteProxies: string[] = [];
  try {
    const rows = await ctx.tooling.query<{ SiteName?: string }>(
      'SELECT SiteName FROM RemoteProxy ORDER BY SiteName',
    );
    remoteProxies = rows
      .map((r) => r.SiteName)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .sort();
  } catch (e) {
    const detail = `Remote site settings could not be read: ${e instanceof Error ? e.message : String(e)}`;
    notes.push(detail);
    unavailable.push({ scope: 'edges.remoteProxies', reason: 'failed', detail });
  }

  const remoteActions: RemoteActionRef[] = [];
  let omniElementsScanned = 0;
  let omniProceduresWithIntegrationElements = 0;
  let omniElementsSkippedSuperseded = 0;
  try {
    // `OmniProcess` rows are versions, not procedures: a procedure that has been edited twice
    // has three OmniProcess rows and one active one. Measured on a live org, elements matching
    // this query broke down as 141 total across 92 distinct OmniProcess ids and only 30
    // distinct procedure names, but just 16 of those versions were active; 25 elements sat on
    // an active version and 116 sat on versions nobody runs anymore. Restricting to
    // `IsActive = true` here keeps the artifact describing the org as it is now, not as it was
    // several edits ago.
    const rows = await ctx.soql.queryAll<{
      Type: string;
      PropertySetConfig: string | null;
      OmniProcess?: { Id?: string; Name?: string };
    }>(
      "SELECT Type, PropertySetConfig, OmniProcess.Id, OmniProcess.Name FROM OmniProcessElement " +
        "WHERE OmniProcess.OmniProcessType = 'Integration Procedure' " +
        "AND OmniProcess.IsActive = true " +
        "AND Type IN ('REST Action', 'Remote Action', 'Integration Procedure Action') ORDER BY Id",
    );
    omniElementsScanned = rows.length;
    const procedureNames = new Set<string>();
    let integrationProcedureActionCount = 0;
    for (const r of rows) {
      const owner = r.OmniProcess?.Name ?? 'unknown';
      // Two rows with no OmniProcess.Name would both fall back to the literal 'unknown' and
      // collapse into one counted procedure even though they are distinct procedures. The
      // OmniProcess.Id is unique per row, so it is used only as a fallback key here, keeping
      // 'unknown' as the display label on the via hop above where a shared placeholder is fine.
      procedureNames.add(r.OmniProcess?.Name ?? `unknown:${r.OmniProcess?.Id ?? ''}`);
      // SOQL string comparison is case-insensitive, so the `IN ('REST Action', 'Remote Action')`
      // filter matches what the platform actually stores: `Rest Action`, not `REST Action`. A
      // case-sensitive `===` against the literal from the filter is false for every row, so
      // every REST Action fell into the Remote Action branch, found no remoteClass, and vanished
      // while still being counted in omniElementsScanned as if it had been examined. Normalise
      // once and branch on the lowercase form instead of trusting the filter's casing.
      const type = String(r.Type ?? '').toLowerCase();
      if (type === 'rest action') {
        // A REST Action with no namedCredential in its config is real evidence that was
        // examined and found to carry nothing usable. Reporting it as scanned while discarding
        // it silently is the one failure this artifact must never commit, so the element is
        // still emitted as an edge, with endpoint: null and its via hop intact, rather than
        // dropped.
        //
        // detection must not stay `namedCredential` here: that value's own definition is "names
        // the endpoint", and this element does not. Labelling a credential-less element that way
        // asserts a specific fact (a named credential was found) that is false. Of the four
        // detection values, `endpointOnly` is the only one that does not claim a resolution
        // mechanism succeeded; it already carries the same shape of fact for a RemoteProxy that
        // exists with no code path found to it, i.e. one side of an integration relationship is
        // confirmed (here, that a REST Action element exists) and the other (its endpoint) is
        // not. Generalising it to this case rather than inventing a fifth value keeps the axis a
        // closed, honest set: proven-but-incomplete evidence, not a specific untrue claim.
        const credential = extractRestActionCredential(r.PropertySetConfig);
        direct.push({
          endpoint: credential,
          from: null,
          via: [{ type: 'OmniProcess', name: owner }],
          detection: credential ? 'namedCredential' : 'endpointOnly',
          attribution: 'unattributed',
        });
      } else if (type === 'remote action') {
        const remoteClass = remoteClassOf(r.PropertySetConfig);
        if (remoteClass) {
          remoteActions.push({ omniProcess: owner, remoteClass });
        } else {
          // Same principle as above, applied to the other element type: a Remote Action with
          // no remoteClass to chain through still reached out. resolveChains records the
          // equivalent case (a named class with no readable body) as endpoint: null with
          // `remoteActionChain`; do the same here so the two "we found nothing further" paths
          // agree, even though only the OmniProcess hop is known.
          direct.push({
            endpoint: null,
            from: null,
            via: [{ type: 'OmniProcess', name: owner }],
            detection: 'remoteActionChain',
            attribution: 'unattributed',
          });
        }
      } else if (type === 'integration procedure action') {
        // These chain one Integration Procedure to another and carry no endpoint of their own.
        // Counted in omniElementsScanned already; tallied here for a single summary note below
        // rather than invented as edges or silently dropped.
        integrationProcedureActionCount += 1;
      } else {
        notes.push(`OmniProcessElement returned an unexpected Type: ${String(r.Type)}`);
      }
    }
    omniProceduresWithIntegrationElements = procedureNames.size;
    if (integrationProcedureActionCount > 0) {
      notes.push(
        `${integrationProcedureActionCount} Integration Procedure Action element(s) chain one Integration ` +
          'Procedure to another and carry no endpoint; not represented as edges.',
      );
    }

    // Same principle as the namespaced-Apex count above: narrowing the scan above to active
    // versions is correct, but doing it silently would trade one honesty failure (reporting
    // dead integrations as live) for another (undercounting coverage without saying so).
    // Count what was excluded and say so, rather than letting a smaller omniElementsScanned
    // read as if the org simply had less OmniStudio.
    const supersededRows = await ctx.soql.queryAll<{ expr0?: number }>(
      "SELECT COUNT(Id) FROM OmniProcessElement " +
        "WHERE OmniProcess.OmniProcessType = 'Integration Procedure' " +
        "AND OmniProcess.IsActive != true " +
        "AND Type IN ('REST Action', 'Remote Action', 'Integration Procedure Action')",
    );
    omniElementsSkippedSuperseded = Number(supersededRows[0]?.expr0 ?? 0);
    if (omniElementsSkippedSuperseded > 0) {
      notes.push(
        `${omniElementsSkippedSuperseded} OmniStudio integration element(s) sit on superseded ` +
          '(inactive) Integration Procedure versions and were excluded; only the active version ' +
          'of each procedure is scanned.',
      );
    }
  } catch (e) {
    const detail = `OmniStudio integration elements could not be read: ${e instanceof Error ? e.message : String(e)}`;
    notes.push(detail);
    unavailable.push({ scope: 'edges.omniStudio', reason: 'failed', detail });
  }

  direct.sort((a, b) => String(a.endpoint).localeCompare(String(b.endpoint)));
  remoteActions.sort((a, b) => a.omniProcess.localeCompare(b.omniProcess) || a.remoteClass.localeCompare(b.remoteClass));

  return {
    direct,
    remoteActions,
    apexCallouts,
    apexBodiesScanned,
    apexBodiesUnreadable,
    omniElementsScanned,
    omniProceduresWithIntegrationElements,
    omniElementsSkippedSuperseded,
    namedCredentials,
    remoteProxies,
  };
}
