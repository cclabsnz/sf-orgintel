// Who uses the org, on what licence, and where they land. Entitlement against consumption is
// the point: a licence count alone says nothing about whether it is used.
import type { IntelContext } from '../../lib/wire.js';
import type { Persona } from '../types.js';

interface UserRow {
  Profile?: { Name?: string; UserLicense?: { Name?: string } };
  expr0?: number;
}

export async function collectPersonas(ctx: IntelContext, notes: string[]): Promise<Persona[]> {
  let rows: UserRow[] = [];
  try {
    rows = await ctx.soql.queryAll<UserRow>(
      'SELECT Profile.Name, Profile.UserLicense.Name, COUNT(Id) FROM User WHERE IsActive = true GROUP BY Profile.Name, Profile.UserLicense.Name',
    );
  } catch (e) {
    notes.push(`Active user counts could not be read: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }

  return rows
    .map((r) => ({
      profile: r.Profile?.Name ?? 'unknown',
      licence: r.Profile?.UserLicense?.Name ?? 'unknown',
      activeUsers: Number(r.expr0 ?? 0),
      landingApp: null,
    }))
    .sort((a, b) => a.profile.localeCompare(b.profile));
}
