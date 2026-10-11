import type { Connection } from '@salesforce/core';
import {
  SoqlClientImpl,
  ToolingClientImpl,
  RestClientImpl,
  MetadataClientImpl,
} from '@cclabsnz/sf-core';
import type {
  SoqlClient,
  ToolingClient,
  RestClient,
  MetadataClient,
  OrgInfo,
} from '@cclabsnz/sf-core';

/**
 * The read-only client surface every OrgIntel analysis runs against. Deliberately
 * lean and dependency-free so analysis functions are pure over these interfaces and
 * testable with hand-mocked clients (no live org).
 */
export interface IntelContext {
  soql: SoqlClient;
  tooling: ToolingClient;
  rest: RestClient;
  metadata: MetadataClient;
  /**
   * Null when the running user cannot read `Organization` (it needs View Setup and
   * Configuration). Only `map` and `anatomy` run then, and neither reads it; `probe` and
   * `discover` resolve it strictly and stop if it is missing. See `resolveOrgIdentity`.
   */
  orgInfo: OrgInfo | null;
  /** API version the connection queries with (e.g. "62.0"). */
  apiVersion: string;
  /** Organization.NamespacePrefix, or null for orgs without a namespace. */
  namespace: string | null;
}

export function buildApiClients(conn: Connection): {
  soql: SoqlClient;
  tooling: ToolingClient;
  rest: RestClient;
  metadata: MetadataClient;
} {
  return {
    soql: new SoqlClientImpl(conn),
    tooling: new ToolingClientImpl(conn),
    rest: new RestClientImpl(conn),
    metadata: new MetadataClientImpl(conn),
  };
}

interface OrgRecord {
  Id: string;
  Name: string;
  OrganizationType: string;
  IsSandbox: boolean;
  InstanceName: string;
  NamespacePrefix: string | null;
}

const ORG_PERMISSION = 'View Setup and Configuration';

/**
 * The org's full record, for commands that report its edition and sandbox status (`probe`,
 * `discover`). Those cannot be guessed, so a refused read stops the command -- with the missing
 * permission named rather than the platform's bare "sObject type 'Organization' is not
 * supported", which reads as a tool defect.
 */
export async function resolveOrgInfo(
  conn: Connection,
): Promise<{ orgInfo: OrgInfo; namespace: string | null }> {
  let result;
  try {
    result = await conn.query<OrgRecord>(
      'SELECT Id, Name, OrganizationType, IsSandbox, InstanceName, NamespacePrefix FROM Organization LIMIT 1',
    );
  } catch (e) {
    throw new Error(
      `This user cannot read the Organization record, which this command needs; it requires the ` +
        `"${ORG_PERMISSION}" permission. (${e instanceof Error ? e.message : String(e)})`,
      { cause: e },
    );
  }
  const rec = result.records[0];
  if (!rec) throw new Error('Could not retrieve Organization record');
  return {
    orgInfo: {
      id: rec.Id,
      name: rec.Name,
      type: rec.OrganizationType,
      isSandbox: rec.IsSandbox,
      instance: rec.InstanceName,
      instanceUrl: conn.instanceUrl,
    },
    namespace: rec.NamespacePrefix ?? null,
  };
}

export interface OrgIdentity {
  id: string;
  /** The org's name, or its id when the name could not be read. Never invented. */
  name: string;
  /** The full record when it was readable; null rather than a guessed edition and sandbox flag. */
  orgInfo: OrgInfo | null;
  namespace: string | null;
  /** Why the record was not read, for the run's notes; null when it was. */
  note: string | null;
}

/**
 * Just enough to identify the org, for commands that describe what a user can see (`map`,
 * `anatomy`). A user without View Setup and Configuration cannot read `Organization`, and before
 * this every command stopped there, so the tool could not be run as the restricted users whose
 * view of an org it exists to describe. The org id is in the connection's own auth info, so only
 * the name is lost, and the id stands in for it.
 */
export async function resolveOrgIdentity(conn: Connection): Promise<OrgIdentity> {
  try {
    const { orgInfo, namespace } = await resolveOrgInfo(conn);
    return { id: orgInfo.id, name: orgInfo.name, orgInfo, namespace, note: null };
  } catch (e) {
    const id = conn.getAuthInfoFields().orgId;
    if (!id) throw e;
    // The platform's own reason, not resolveOrgInfo's wrapper, which says the command needs the
    // record -- untrue here, since this command carries on without it.
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    const note =
      `The Organization record could not be read (it needs "${ORG_PERMISSION}"), so the org is ` +
      `named by its id. (${cause instanceof Error ? cause.message : String(cause)})`;
    return { id, name: id, orgInfo: null, namespace: null, note };
  }
}

/**
 * The full org record, for the analyses that report it (`probe`, `discover`). Their commands
 * resolve it strictly, so this only fails if one is driven with an identity-only context.
 */
export function requireOrgInfo(ctx: IntelContext): OrgInfo {
  if (!ctx.orgInfo) throw new Error('This analysis needs the Organization record, which was not read.');
  return ctx.orgInfo;
}

export function buildIntelContext(
  conn: Connection,
  orgInfo: OrgInfo | null,
  namespace: string | null,
  apiVersion: string,
): IntelContext {
  const clients = buildApiClients(conn);
  return {
    soql: clients.soql,
    tooling: clients.tooling,
    rest: clients.rest,
    metadata: clients.metadata,
    orgInfo,
    apiVersion,
    namespace,
  };
}
