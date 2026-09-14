// How people authenticate. Described, never graded: whether a posture is acceptable belongs
// to sf-audit. This collector reports configuration and observed behaviour side by side and
// draws no conclusion from the gap between them.
import type { IntelContext } from '../../lib/wire.js';
import type { Identity, SsoConfig, Unavailable } from '../types.js';

/**
 * `collectIdentity`'s return, plus the one fact `SsoConfig` itself cannot carry: a stable unique
 * key per config, threaded to `buildAnatomyFragment` only (mirrors how `workflowRulesFor` is
 * threaded past the published shape in `src/map/fragment.ts`'s `FragmentInput`). `SsoConfig` is
 * frozen as part of `anatomy.json` (`identityMapping`, `userProvisioning`, `issuer`, `type`), so
 * a `DeveloperName` column added here must never join that shape or it moves the golden.
 *
 * `ssoConfigKeys[i]` names `ssoConfigs[i]`, in the same order -- both are sorted together below,
 * never independently, so the pairing never drifts. `issuer` cannot serve as this key on its
 * own: plenty of real configs carry none, and two SAML configs legitimately point at the same
 * IdP (an internal one plus an Experience Cloud one), so falling back to `issuer ?? type` (the
 * fragment's old id formula) collapses both onto one id. `DeveloperName` is the column
 * `SamlSsoConfig` actually guarantees is present and unique.
 */
export interface CollectedIdentity {
  ssoConfigs: SsoConfig[];
  ssoConfigKeys: string[];
  loginsByType: Identity['loginsByType'];
}

export async function collectIdentity(
  ctx: IntelContext,
  notes: string[],
  unavailable: Unavailable[],
): Promise<CollectedIdentity> {
  const ssoConfigs: SsoConfig[] = [];
  const ssoConfigKeys: string[] = [];
  try {
    const rows = await ctx.tooling.query<{ Issuer?: string; DeveloperName?: string }>(
      'SELECT DeveloperName, Issuer FROM SamlSsoConfig',
    );
    for (const r of rows) {
      ssoConfigs.push({ type: 'saml', issuer: r.Issuer ?? null, identityMapping: null, userProvisioning: false });
      ssoConfigKeys.push(r.DeveloperName ?? '');
    }
  } catch (e) {
    const detail = `SSO configuration could not be read: ${e instanceof Error ? e.message : String(e)}`;
    notes.push(detail);
    unavailable.push({ scope: 'identity.ssoConfigs', reason: 'failed', detail });
  }

  const loginsByType: Identity['loginsByType'] = [];
  try {
    const rows = await ctx.soql.queryAll<{ Application?: string; LoginType?: string; expr0?: number }>(
      'SELECT Application, LoginType, COUNT(Id) FROM LoginHistory WHERE LoginTime = LAST_N_DAYS:90 GROUP BY Application, LoginType',
    );
    for (const r of rows) {
      loginsByType.push({
        application: r.Application ?? 'unknown',
        loginType: r.LoginType ?? 'unknown',
        count: Number(r.expr0 ?? 0),
      });
    }
  } catch (e) {
    const detail = `Login history could not be read: ${e instanceof Error ? e.message : String(e)}`;
    notes.push(detail);
    unavailable.push({ scope: 'identity.loginsByType', reason: 'failed', detail });
  }

  loginsByType.sort((a, b) => a.application.localeCompare(b.application) || a.loginType.localeCompare(b.loginType));
  // Sorted as `{ config, key }` pairs, never `ssoConfigs` alone: sorting the two arrays
  // independently (even by the same comparator) is not guaranteed to permute them identically
  // once ties are broken by array position, and that would silently mismatch `ssoConfigKeys[i]`
  // against `ssoConfigs[i]`. Null-safe on issuer -- `SamlSsoConfig` rows without one are
  // legitimate, and a plain localeCompare on a null would throw. Nulls sort first, then issuers
  // alphabetically, then `key` (unique) as the final tiebreaker so the order is total even when
  // two configs share a null issuer.
  const paired = ssoConfigs.map((config, i) => ({ config, key: ssoConfigKeys[i] }));
  paired.sort((a, b) => {
    if (a.config.issuer !== b.config.issuer) {
      if (a.config.issuer === null) return -1;
      if (b.config.issuer === null) return 1;
      return a.config.issuer.localeCompare(b.config.issuer);
    }
    return a.key.localeCompare(b.key);
  });
  return {
    ssoConfigs: paired.map((p) => p.config),
    ssoConfigKeys: paired.map((p) => p.key),
    loginsByType,
  };
}
