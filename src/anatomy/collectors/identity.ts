// How people authenticate. Described, never graded: whether a posture is acceptable belongs
// to sf-audit. This collector reports configuration and observed behaviour side by side and
// draws no conclusion from the gap between them.
import type { IntelContext } from '../../lib/wire.js';
import type { Identity, SsoConfig, Unavailable } from '../types.js';

export async function collectIdentity(
  ctx: IntelContext,
  notes: string[],
  unavailable: Unavailable[],
): Promise<Identity> {
  const ssoConfigs: SsoConfig[] = [];
  try {
    const rows = await ctx.tooling.query<{ Issuer?: string }>('SELECT Issuer FROM SamlSsoConfig');
    for (const r of rows) {
      ssoConfigs.push({ type: 'saml', issuer: r.Issuer ?? null, identityMapping: null, userProvisioning: false });
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
  // Null-safe: `SamlSsoConfig` rows without an issuer are legitimate, and a plain
  // localeCompare on a null would throw. Nulls sort first, then issuers alphabetically.
  ssoConfigs.sort((a, b) => {
    if (a.issuer === b.issuer) return 0;
    if (a.issuer === null) return -1;
    if (b.issuer === null) return 1;
    return a.issuer.localeCompare(b.issuer);
  });
  return { ssoConfigs, loginsByType };
}
