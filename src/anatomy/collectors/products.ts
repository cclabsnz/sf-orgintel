// Sources the prefix registry matches against. Each read is independent: a permission gap on
// one must not blank the others, because a half-populated registry is still useful and a
// crashed command is not.
import type { IntelContext } from '../../lib/wire.js';

export interface RegistrySourceNames {
  apps: string[];
  packages: string[];
  recordTypes: string[];
  /**
   * The population the prefix registry's frequency floor is calibrated against: every
   * org-authored Apex class and Flow, not just the subset that happens to make outbound
   * calls. Feeding the registry a narrower population (for example, only classes with a
   * callout) would bias `products` toward whatever makes outbound calls and silently drop
   * everything else.
   */
  componentNames: string[];
}

async function safe<T>(label: string, notes: string[], fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    notes.push(`${label} could not be read: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

export async function collectProducts(ctx: IntelContext, notes: string[]): Promise<RegistrySourceNames> {
  // NOTE: ToolingClient.query resolves to T[] directly. It has no `.records` and no
  // `.totalSize`, unlike SoqlClient.query which returns a QueryResult.
  const apps = await safe('CustomApplication', notes, async () =>
    (await ctx.tooling.query<{ DeveloperName: string }>(
      'SELECT DeveloperName FROM CustomApplication WHERE NamespacePrefix = null',
    )).map((r) => r.DeveloperName),
  );

  const packages = await safe('InstalledSubscriberPackage', notes, async () =>
    (await ctx.tooling.query<{ SubscriberPackage: { NamespacePrefix: string | null } }>(
      'SELECT SubscriberPackage.NamespacePrefix FROM InstalledSubscriberPackage',
    )).map((r) => r.SubscriberPackage?.NamespacePrefix ?? '').filter((s) => s.length > 0),
  );

  const recordTypes = await safe('RecordType', notes, async () =>
    (await ctx.soql.queryAll<{ DeveloperName: string }>(
      "SELECT DeveloperName FROM RecordType WHERE SobjectType IN ('Case','Account')",
    )).map((r) => r.DeveloperName),
  );

  const apexClassNames = await safe('ApexClass', notes, async () =>
    (await ctx.tooling.query<{ Name: string }>(
      'SELECT Name FROM ApexClass WHERE NamespacePrefix = null',
    )).map((r) => r.Name),
  );

  const flowNames = await safe('FlowDefinition', notes, async () =>
    (await ctx.tooling.query<{ DeveloperName: string }>(
      'SELECT DeveloperName FROM FlowDefinition WHERE NamespacePrefix = null',
    )).map((r) => r.DeveloperName),
  );

  const componentNames = [...apexClassNames, ...flowNames].sort();

  return {
    apps: apps.sort(),
    packages: packages.sort(),
    recordTypes: recordTypes.sort(),
    componentNames,
  };
}
