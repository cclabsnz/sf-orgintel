// The surfaces people actually arrive on.
import type { IntelContext } from '../../lib/wire.js';
import type { Channel } from '../types.js';

export async function collectChannels(ctx: IntelContext, notes: string[]): Promise<Channel[]> {
  const out: Channel[] = [];
  try {
    const sites = await ctx.soql.queryAll<{ Name: string; Status: string }>(
      'SELECT Name, Status FROM Site',
    );
    for (const s of sites) out.push({ type: 'site', name: s.Name, status: s.Status ?? 'unknown' });
  } catch (e) {
    notes.push(`Sites could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
