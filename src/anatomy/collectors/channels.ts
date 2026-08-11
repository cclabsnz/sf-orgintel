// The surfaces people actually arrive on.
import type { IntelContext } from '../../lib/wire.js';
import type { Channel } from '../types.js';

export async function collectChannels(ctx: IntelContext, notes: string[]): Promise<Channel[]> {
  // `Channel.type` also declares `app`, `console` and `api`, and the spec's collector table
  // lists a `UserAppInfo`/`AppDefinition` join and `Network`. None of that is implemented yet;
  // recorded here so "not attempted" is never mistaken for "none found".
  notes.push(
    'Channels currently reflect Site only; app, console and api channel types and the ' +
      'Network join were not attempted.',
  );

  const out: Channel[] = [];
  try {
    const sites = await ctx.soql.queryAll<{ Name: string; Status: string }>(
      'SELECT Name, Status FROM Site',
    );
    for (const s of sites) out.push({ type: 'site', name: s.Name ?? 'unknown', status: s.Status ?? 'unknown' });
  } catch (e) {
    notes.push(`Sites could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
