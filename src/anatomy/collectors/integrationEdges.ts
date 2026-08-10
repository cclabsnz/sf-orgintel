// Every source of outbound-call evidence in one place.
//
// Apex bodies come through the Tooling API rather than source retrieve: retrieve returns only
// a fraction of classes on a real org because the rest live in managed and unlocked packages,
// while Tooling returns bodies for unlocked-package classes retrieve refuses.
//
// OmniStudio is read through the ordinary Data API. Tooling rejects OmniProcess outright.
import type { IntelContext } from '../../lib/wire.js';
import type { IntegrationEdge } from '../types.js';
import type { RemoteActionRef } from '../attribute.js';

export interface IntegrationEdgeInput {
  direct: IntegrationEdge[];
  remoteActions: RemoteActionRef[];
  apexCallouts: Map<string, string[]>;
  apexBodiesScanned: number;
  apexBodiesUnreadable: number;
  omniElementsScanned: number;
  omniProceduresTotal: number;
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
    notes.push(`Apex bodies could not be read: ${e instanceof Error ? e.message : String(e)}`);
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
    notes.push(`Named credentials could not be read: ${e instanceof Error ? e.message : String(e)}`);
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
    notes.push(`Remote site settings could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }

  const remoteActions: RemoteActionRef[] = [];
  let omniElementsScanned = 0;
  let omniProceduresTotal = 0;
  try {
    const rows = await ctx.soql.queryAll<{
      Type: string;
      PropertySetConfig: string | null;
      OmniProcess?: { Name?: string };
    }>(
      "SELECT Type, PropertySetConfig, OmniProcess.Name FROM OmniProcessElement " +
        "WHERE OmniProcess.OmniProcessType = 'Integration Procedure' " +
        "AND Type IN ('REST Action', 'Remote Action') ORDER BY Id",
    );
    omniElementsScanned = rows.length;
    const procedures = new Set<string>();
    for (const r of rows) {
      const owner = r.OmniProcess?.Name ?? 'unknown';
      procedures.add(owner);
      // SOQL string comparison is case-insensitive, so the `IN ('REST Action', 'Remote Action')`
      // filter matches what the platform actually stores: `Rest Action`, not `REST Action`. A
      // case-sensitive `===` against the literal from the filter is false for every row, so
      // every REST Action fell into the Remote Action branch, found no remoteClass, and vanished
      // while still being counted in omniElementsScanned as if it had been examined. Normalise
      // once and branch on the lowercase form instead of trusting the filter's casing.
      const type = String(r.Type ?? '').toLowerCase();
      if (type === 'rest action') {
        const credential = extractRestActionCredential(r.PropertySetConfig);
        if (credential) {
          direct.push({
            endpoint: credential,
            from: null,
            via: [{ type: 'OmniProcess', name: owner }],
            detection: 'namedCredential',
            attribution: 'unattributed',
          });
        }
      } else if (type === 'remote action') {
        const remoteClass = remoteClassOf(r.PropertySetConfig);
        if (remoteClass) remoteActions.push({ omniProcess: owner, remoteClass });
      } else {
        notes.push(`OmniProcessElement returned an unexpected Type: ${String(r.Type)}`);
      }
    }
    omniProceduresTotal = procedures.size;
  } catch (e) {
    notes.push(`OmniStudio integration elements could not be read: ${e instanceof Error ? e.message : String(e)}`);
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
    omniProceduresTotal,
    namedCredentials,
    remoteProxies,
  };
}
