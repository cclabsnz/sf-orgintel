// The surfaces people actually arrive on.
import type { IntelContext } from '../../lib/wire.js';
import type { Channel, Unavailable } from '../types.js';

export async function collectChannels(
  ctx: IntelContext,
  notes: string[],
  unavailable: Unavailable[],
): Promise<Channel[]> {
  // `Channel.type` also declares `app`, `console` and `api`, and the spec's collector table
  // lists a `UserAppInfo`/`AppDefinition` join and `Network`. None of that is implemented yet;
  // recorded here so "not attempted" is never mistaken for "none found". Split into two
  // structured entries because the Network join and the app/console/api types are distinct
  // gaps, even though one sentence covers both for a human reader.
  notes.push(
    'Channels currently reflect Site only; app, console and api channel types and the ' +
      'Network join were not attempted.',
  );
  unavailable.push({
    scope: 'channels.network',
    reason: 'deferred',
    detail: 'The Network join was not attempted in this phase.',
  });
  unavailable.push({
    scope: 'channels.appConsoleApi',
    reason: 'deferred',
    detail: 'The app, console and api channel types were not attempted in this phase; only site is collected.',
  });

  const out: Channel[] = [];
  try {
    const sites = await ctx.soql.queryAll<{ Name: string; Status: string }>(
      'SELECT Name, Status FROM Site',
    );
    for (const s of sites) out.push({ type: 'site', name: s.Name ?? 'unknown', status: s.Status ?? 'unknown' });
  } catch (e) {
    const detail = `Sites could not be read: ${e instanceof Error ? e.message : String(e)}`;
    notes.push(detail);
    unavailable.push({ scope: 'channels', reason: 'failed', detail });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
