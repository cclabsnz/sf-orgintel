// What the platform is being used for. Counts, not judgements. An absent capability is
// recorded as absent rather than left out, because a missing key reads as "not checked".
import type { IntelContext } from '../../lib/wire.js';
import type { Capabilities, Unavailable } from '../types.js';

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

async function count(
  ctx: IntelContext,
  notes: string[],
  unavailable: Unavailable[],
  label: string,
  scope: string,
  soql: string,
): Promise<number> {
  try {
    const rows = await ctx.tooling.query<{ expr0?: number }>(soql);
    return Number(rows[0]?.expr0 ?? 0);
  } catch (e) {
    const detail = `${label} count unavailable: ${e instanceof Error ? e.message : String(e)}`;
    notes.push(detail);
    unavailable.push({ scope, reason: 'failed', detail });
    return 0;
  }
}

/**
 * Which entities this org actually turned Change Data Capture on for.
 *
 * The first version of this counted every sObject in the global describe whose name ended in
 * `ChangeEvent`. That is not a fact about the org at all: the platform exposes a change event
 * type for every object that *supports* CDC, so the number grows with the org's object count and
 * says nothing about whether a single change event is being published. It read 419 on an org
 * with CDC entirely switched off, and View A drew it as the largest tile in the Ops band.
 *
 * `PlatformEventChannelMember` is the object that carries the answer. Per the Tooling API
 * reference it represents "an entity selected for Change Data Capture notifications on a
 * standard or custom channel", so the one query covers both the Setup "Selected Entities" list
 * (channel `ChangeEvents`) and any custom `MyChannel__chn`. Measured across six real orgs, all
 * six returned zero rows, which is the honest reading the describe was hiding.
 *
 * `SelectedEntity` is the change event name, for example `AccountChangeEvent`. De-duplicated
 * because one entity can be a member of more than one channel, and sorted for determinism.
 */
async function collectChangeDataCapture(
  ctx: IntelContext,
  notes: string[],
  unavailable: Unavailable[],
): Promise<string[]> {
  try {
    const rows = await ctx.tooling.query<{ SelectedEntity?: string }>(
      'SELECT SelectedEntity FROM PlatformEventChannelMember',
    );
    const entities = new Set<string>();
    for (const row of rows) if (row.SelectedEntity) entities.add(row.SelectedEntity);
    return [...entities].sort();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Same rule as EventRelayConfig below: the platform's absent-sObject shape means the feature
    // is genuinely not on this org, and absence is the finding, so no note and no unavailable
    // entry. Anything else is a refused read, which must not be allowed to render as a
    // confident "no entity has CDC enabled".
    if (!isAbsentSObjectError(message)) {
      const detail = `Change Data Capture channel membership unavailable: ${message}`;
      notes.push(detail);
      unavailable.push({ scope: 'capabilities.changeDataCapture', reason: 'failed', detail });
    }
    return [];
  }
}

export async function collectCapabilities(
  ctx: IntelContext,
  notes: string[],
  unavailable: Unavailable[],
): Promise<Capabilities> {
  const platformEvents: string[] = [];
  try {
    const all = await ctx.rest.get<{ sobjects?: Array<{ name?: string }> }>('/sobjects/');
    for (const s of all.sobjects ?? []) {
      const name = s.name ?? '';
      if (name.endsWith('__e')) platformEvents.push(name);
    }
  } catch (e) {
    const detail = `sObject list unavailable: ${e instanceof Error ? e.message : String(e)}`;
    notes.push(detail);
    unavailable.push({ scope: 'capabilities.platformEvents', reason: 'failed', detail });
  }

  const changeDataCapture = await collectChangeDataCapture(ctx, notes, unavailable);

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
      const detail = `EventRelayConfig read unavailable: ${message}`;
      notes.push(detail);
      unavailable.push({ scope: 'capabilities.eventRelayConfigured', reason: 'failed', detail });
    }
  }

  return {
    apexClasses: await count(ctx, notes, unavailable, 'ApexClass', 'capabilities.apexClasses', 'SELECT COUNT(Id) FROM ApexClass'),
    apexTriggers: await count(ctx, notes, unavailable, 'ApexTrigger', 'capabilities.apexTriggers', 'SELECT COUNT(Id) FROM ApexTrigger'),
    flows: await count(ctx, notes, unavailable, 'FlowDefinition', 'capabilities.flows', 'SELECT COUNT(Id) FROM FlowDefinition'),
    lwc: await count(ctx, notes, unavailable, 'LightningComponentBundle', 'capabilities.lwc', 'SELECT COUNT(Id) FROM LightningComponentBundle'),
    aura: await count(ctx, notes, unavailable, 'AuraDefinitionBundle', 'capabilities.aura', 'SELECT COUNT(Id) FROM AuraDefinitionBundle'),
    namedCredentials: await count(ctx, notes, unavailable, 'NamedCredential', 'capabilities.namedCredentials', 'SELECT COUNT(Id) FROM NamedCredential'),
    externalDataSources: await count(ctx, notes, unavailable, 'ExternalDataSource', 'capabilities.externalDataSources', 'SELECT COUNT(Id) FROM ExternalDataSource'),
    remoteSites: await count(ctx, notes, unavailable, 'RemoteProxy', 'capabilities.remoteSites', 'SELECT COUNT(Id) FROM RemoteProxy'),
    platformEvents: platformEvents.sort(),
    changeDataCapture,
    eventRelayConfigured,
  };
}
