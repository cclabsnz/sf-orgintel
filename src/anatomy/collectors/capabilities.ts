// What the platform is being used for. Counts, not judgements. An absent capability is
// recorded as absent rather than left out, because a missing key reads as "not checked".
import type { IntelContext } from '../../lib/wire.js';
import type { Capabilities } from '../types.js';

/**
 * Count via a COUNT(Id) aggregate rather than COUNT().
 *
 * ToolingClient.query resolves to T[] and drops the QueryResult wrapper, so `totalSize` is
 * not available through it. COUNT(Id) returns a single row carrying `expr0`, which survives
 * that. Several of the objects counted here (LightningComponentBundle, AuraDefinitionBundle,
 * RemoteProxy) are Tooling-only, so the data API is not an alternative.
 */
/**
 * Whether an error means "this sObject does not exist on this org", the platform's own shape
 * for a genuinely absent feature, and nothing looser. A licence-gated refusal can also mention
 * "not supported" in its message, and that is a failed read, not an absent feature: treating
 * both the same way turns a refusal into a false "there is none".
 */
function isAbsentSObjectError(message: string): boolean {
  return /INVALID_TYPE/i.test(message) || /sObject type '[^']*' is not supported/i.test(message);
}

async function count(ctx: IntelContext, notes: string[], label: string, soql: string): Promise<number> {
  try {
    const rows = await ctx.tooling.query<{ expr0?: number }>(soql);
    return Number(rows[0]?.expr0 ?? 0);
  } catch (e) {
    notes.push(`${label} count unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

export async function collectCapabilities(ctx: IntelContext, notes: string[]): Promise<Capabilities> {
  const platformEvents: string[] = [];
  const changeDataCapture: string[] = [];
  try {
    const all = await ctx.rest.get<{ sobjects?: Array<{ name?: string }> }>('/sobjects/');
    for (const s of all.sobjects ?? []) {
      const name = s.name ?? '';
      if (name.endsWith('__e')) platformEvents.push(name);
      else if (name.endsWith('ChangeEvent')) changeDataCapture.push(name);
    }
  } catch (e) {
    notes.push(`sObject list unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }

  let eventRelayConfigured = false;
  try {
    eventRelayConfigured = ((await ctx.soql.query('SELECT Id FROM EventRelayConfig LIMIT 1')).totalSize ?? 0) > 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A missing sObject type means the feature is genuinely absent on this org. Absence
    // is the finding there, so no note. Anything else, including a licence-gated refusal
    // whose message happens to contain the words "not supported" without actually being
    // the platform's absent-sObject shape, is a failed read, not an absent feature, and
    // must say so: otherwise a refused read is indistinguishable from a real "there is
    // none" in the artifact. Matched narrowly against the two shapes the platform actually
    // uses for a genuinely missing sObject: the INVALID_TYPE error code, or a message of
    // the form "sObject type '...' is not supported".
    if (!isAbsentSObjectError(message)) {
      notes.push(`EventRelayConfig read unavailable: ${message}`);
    }
  }

  return {
    apexClasses: await count(ctx, notes, 'ApexClass', 'SELECT COUNT(Id) FROM ApexClass'),
    apexTriggers: await count(ctx, notes, 'ApexTrigger', 'SELECT COUNT(Id) FROM ApexTrigger'),
    flows: await count(ctx, notes, 'FlowDefinition', 'SELECT COUNT(Id) FROM FlowDefinition'),
    lwc: await count(ctx, notes, 'LightningComponentBundle', 'SELECT COUNT(Id) FROM LightningComponentBundle'),
    aura: await count(ctx, notes, 'AuraDefinitionBundle', 'SELECT COUNT(Id) FROM AuraDefinitionBundle'),
    namedCredentials: await count(ctx, notes, 'NamedCredential', 'SELECT COUNT(Id) FROM NamedCredential'),
    externalDataSources: await count(ctx, notes, 'ExternalDataSource', 'SELECT COUNT(Id) FROM ExternalDataSource'),
    remoteSites: await count(ctx, notes, 'RemoteProxy', 'SELECT COUNT(Id) FROM RemoteProxy'),
    platformEvents: platformEvents.sort(),
    changeDataCapture: changeDataCapture.sort(),
    eventRelayConfigured,
  };
}
