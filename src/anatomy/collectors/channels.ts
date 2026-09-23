// The surfaces people actually arrive on.
import type { IntelContext } from '../../lib/wire.js';
import type { Channel, Unavailable } from '../types.js';

/**
 * `collectChannels`'s return, plus the one fact `Channel` itself cannot carry: a stable unique
 * key per site, threaded to `buildAnatomyFragment` only (mirrors how `workflowRulesFor` is
 * threaded past the published shape in `src/map/fragment.ts`'s `FragmentInput`). `Channel` is
 * frozen at three fields (`type`, `name`, `status`) as part of the artifact `sf intel anatomy
 * --json` emits and `test/unit/anatomy/golden.test.ts` byte-freezes, so a `SiteName` column added
 * here must never join that shape or it moves the golden. (The freeze outlived `anatomy.json`:
 * 1.0 retired the file, not the shape it carried.)
 *
 * `channelKeys[i]` names `channels[i]`, in the same order -- both are sorted together below,
 * never independently. `Site.Name` (the label surfaced as `Channel.name`) cannot serve as this
 * key: it is user-editable, not guaranteed unique, and defaults to the same literal `'unknown'`
 * for every site missing one. `Site.SiteName` is the site's unique, required technical name --
 * the string Force.com Sites URLs are actually built from -- so it is the field that stays
 * distinct even when two sites both go unnamed. Empty for the non-site `Channel` variants (`app`
 * /`console`/`api`), which the collector does not populate today and which never reach the
 * fragment as nodes regardless.
 */
export interface CollectedChannels {
  channels: Channel[];
  channelKeys: string[];
}

export async function collectChannels(
  ctx: IntelContext,
  notes: string[],
  unavailable: Unavailable[],
): Promise<CollectedChannels> {
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
  const keys: string[] = [];
  try {
    const sites = await ctx.soql.queryAll<{ Name: string; SiteName?: string; Status: string }>(
      'SELECT Name, SiteName, Status FROM Site',
    );
    for (const s of sites) {
      out.push({ type: 'site', name: s.Name ?? 'unknown', status: s.Status ?? 'unknown' });
      keys.push(s.SiteName ?? '');
    }
  } catch (e) {
    const detail = `Sites could not be read: ${e instanceof Error ? e.message : String(e)}`;
    notes.push(detail);
    unavailable.push({ scope: 'channels', reason: 'failed', detail });
  }
  // Sorted as `{ channel, key }` pairs, never `out` alone -- see the identical note in
  // identity.ts's ssoConfigs sort for why sorting the two arrays independently can silently
  // mismatch the pairing. `key` (unique) is the tiebreaker for two sites sharing a name (both
  // 'unknown', or a genuine duplicate label), so the order is total.
  const paired = out.map((channel, i) => ({ channel, key: keys[i] }));
  paired.sort((a, b) => a.channel.name.localeCompare(b.channel.name) || a.key.localeCompare(b.key));
  return {
    channels: paired.map((p) => p.channel),
    channelKeys: paired.map((p) => p.key),
  };
}
