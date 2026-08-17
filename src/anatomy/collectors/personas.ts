// Who uses the org, on what licence, and where they land. Entitlement against consumption is
// the point: a licence count alone says nothing about whether it is used.
import type { IntelContext } from '../../lib/wire.js';
import type { Persona, Unavailable } from '../types.js';

interface UserRow {
  profileName?: string;
  licenceName?: string;
  userCount?: number;
}

export async function collectPersonas(
  ctx: IntelContext,
  notes: string[],
  unavailable: Unavailable[],
): Promise<Persona[]> {
  // landingApp is deliberately deferred: it needs the UserAppInfo/AppDefinition join the spec
  // describes, which is not implemented yet. Left silent, a hardcoded null reads as "no
  // landing app configured" rather than "not attempted", so the deferral is recorded here. This
  // is a field-level deferral, not a category one: `activeUsers`, the metric the `users` band
  // actually renders, is queried for real on every run, so this must not read as "the users
  // band was never collected".
  const landingAppDetail = 'landingApp is not collected in this phase; the UserAppInfo/AppDefinition join was not attempted.';
  notes.push(landingAppDetail);
  unavailable.push({ scope: 'personas.landingApp', reason: 'deferred', detail: landingAppDetail });

  let rows: UserRow[] = [];
  try {
    // Profile.Name and Profile.UserLicense.Name both terminate in a field literally called
    // `Name`. Left unaliased, Salesforce assigns each the implicit alias of its last path
    // segment, so the two collide and the org rejects the query with
    // "MALFORMED_QUERY: duplicate alias: Name". Aliasing is valid on any field, not only
    // aggregates, in a query that already has a GROUP BY, so giving each grouped field its own
    // alias (per Salesforce's "Use Aliases with GROUP BY" reference) resolves the collision.
    // GROUP BY still names the original field paths, not the aliases.
    rows = await ctx.soql.queryAll<UserRow>(
      'SELECT Profile.Name profileName, Profile.UserLicense.Name licenceName, COUNT(Id) userCount ' +
        'FROM User WHERE IsActive = true GROUP BY Profile.Name, Profile.UserLicense.Name',
    );
  } catch (e) {
    const detail = `Active user counts could not be read: ${e instanceof Error ? e.message : String(e)}`;
    notes.push(detail);
    unavailable.push({ scope: 'personas', reason: 'failed', detail });
    return [];
  }

  return rows
    .map((r) => ({
      profile: r.profileName ?? 'unknown',
      licence: r.licenceName ?? 'unknown',
      activeUsers: Number(r.userCount ?? 0),
      landingApp: null,
    }))
    .sort((a, b) => a.profile.localeCompare(b.profile));
}
