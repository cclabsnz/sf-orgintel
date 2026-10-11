import { requireOrgInfo, type IntelContext } from '../lib/wire.js';
import type { OrgBasics } from './types.js';

export function buildOrgBasics(ctx: IntelContext): OrgBasics {
  const org = requireOrgInfo(ctx);
  return {
    orgId: org.id,
    name: org.name,
    organizationType: org.type,
    isSandbox: org.isSandbox,
    instanceUrl: org.instanceUrl,
    apiVersion: ctx.apiVersion,
    namespace: ctx.namespace,
  };
}
