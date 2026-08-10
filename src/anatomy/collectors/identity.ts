// How people authenticate. Described, never graded: whether a posture is acceptable belongs
// to sf-audit. This collector reports configuration and observed behaviour side by side and
// draws no conclusion from the gap between them.
import type { IntelContext } from '../../lib/wire.js';
import type { Identity, SsoConfig } from '../types.js';

export async function collectIdentity(ctx: IntelContext, notes: string[]): Promise<Identity> {
  const ssoConfigs: SsoConfig[] = [];
  try {
    const rows = await ctx.tooling.query<{ Issuer?: string }>('SELECT Issuer FROM SamlSsoConfig');
    for (const r of rows) {
      ssoConfigs.push({ type: 'saml', issuer: r.Issuer ?? null, identityMapping: null, userProvisioning: false });
    }
  } catch (e) {
    notes.push(`SSO configuration could not be read: ${e instanceof Error ? e.message : String(e)}`);
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
    notes.push(`Login history could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }

  loginsByType.sort((a, b) => a.application.localeCompare(b.application) || a.loginType.localeCompare(b.loginType));
  return { ssoConfigs, loginsByType };
}
