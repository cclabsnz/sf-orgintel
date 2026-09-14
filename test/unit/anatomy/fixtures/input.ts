// Shared deterministic fixture for anatomy-assembly tests.
//
// `artifacts()` is the one call to `runAnatomy()` that both the golden byte-pinning suite
// (golden.test.ts) and any later behavioral work exercise. It builds a *populated* IntelContext
// -- not the `emptyCtx()` in runAnatomy.test.ts -- because a freeze over an empty org pins
// almost nothing: every one of the six collectors needs to return something for the byte
// comparison to mean anything.
//
// A later task in the map/anatomy convergence plan adds an `input()` export here, mirroring
// `test/unit/map/fixtures/input.ts`, once the anatomy equivalent of `FragmentInput` exists. Room
// is deliberately left for it; it is not implemented yet because there is nothing for it to feed.
import { mockSoql, mockTooling, mockRest, mockIntelContext } from '../../helpers/mocks.js';
import { runAnatomy, type AnatomyProvenance } from '../../../../src/anatomy/runAnatomy.js';
import type { AnatomyArtifact } from '../../../../src/anatomy/types.js';
import type { AnatomyFragmentInput } from '../../../../src/anatomy/fragment.js';

/**
 * Fixed provenance. `generatedAt` and `toolVersion` are the only fields that would otherwise
 * move between runs (a real run stamps the wall clock and the installed package version), and
 * pinning them here is what makes a byte comparison meaningful rather than a test of the clock.
 * Ids are kept synthetic throughout -- `org1` -- so the fixture never resembles a real org id.
 */
export const PROVENANCE: AnatomyProvenance = {
  generatedAt: '2026-01-01T00:00:00Z',
  orgId: 'org1',
  toolVersion: '0.0.0-test',
  apiVersion: '62.0',
};

/**
 * A populated `IntelContext`: fixed rows for every SOQL/Tooling/REST query the six collectors in
 * `src/anatomy/collectors/` issue. Each handler matches its query string exactly, so a collector
 * reaching for a query this fixture does not expect fails loudly (`mockSoql`/`mockTooling` throw
 * on an unmatched string) instead of silently returning an empty result that would understate
 * what the freeze covers.
 *
 * The data tells one small, coherent story so the artifact it produces is legible on its own:
 * an org that installed a package called `acme`, built a console app named `Acme_Console`, and
 * has a handful of Apex classes and Flows carrying an `Acme` prefix, three of which make outbound
 * callouts reachable through OmniStudio Integration Procedures. A second prefix, `Zeta`, clears
 * the frequency floor without matching any app/package/record-type name, so `products.ts`'s
 * unresolved path is exercised too. A `PayGatewayCallout` class and a `Legacy_SFTP_Cred` /
 * `Old_Partner_Site` pair of endpoints carry no recognisable prefix at all, so some edges stay
 * `unattributed` on purpose.
 */
function ctx() {
  return mockIntelContext({
    tooling: mockTooling([
      // -- products.ts --
      { test: (s) => s === 'SELECT DeveloperName FROM CustomApplication WHERE NamespacePrefix = null',
        records: [{ DeveloperName: 'Acme_Console' }, { DeveloperName: 'Ops_Portal' }] },
      { test: (s) => s === 'SELECT SubscriberPackage.NamespacePrefix FROM InstalledSubscriberPackage',
        records: [
          { SubscriberPackage: { NamespacePrefix: 'acme' } },
          { SubscriberPackage: { NamespacePrefix: null } },
          { SubscriberPackage: { NamespacePrefix: 'flowlib' } },
        ] },
      { test: (s) => s === 'SELECT Name FROM ApexClass WHERE NamespacePrefix = null',
        records: [
          { Name: 'AcmeOrderSync' },
          { Name: 'AcmeInvoiceBuilder' },
          { Name: 'AcmeShippingCalc' },
          { Name: 'PayGatewayCallout' },
          { Name: 'UtilHelper' },
          { Name: 'ZetaSync1' },
          { Name: 'ZetaSync2' },
          { Name: 'ZetaBridge' },
        ] },
      { test: (s) => s === 'SELECT DeveloperName FROM FlowDefinition WHERE NamespacePrefix = null',
        records: [
          { DeveloperName: 'Acme_Order_Router' },
          { DeveloperName: 'Acme_Invoice_Approval' },
          { DeveloperName: 'Case_Router' },
        ] },
      // -- integrationEdges.ts: Apex body scan --
      { test: (s) => s === 'SELECT Id, Name, Body FROM ApexClass WHERE NamespacePrefix = null ORDER BY Id',
        records: [
          { Name: 'AcmeOrderSync', Body: "public class AcmeOrderSync { void run(){ String x = 'callout:Acme_Payment_API'; } }" },
          { Name: 'AcmeInvoiceBuilder', Body: null },
          { Name: 'AcmeShippingCalc', Body: "public class AcmeShippingCalc { void ship(){ String x = 'callout:Acme_Shipping_API'; } }" },
          { Name: 'PayGatewayCallout', Body: "public class PayGatewayCallout { void call(){ String x = 'callout:External_Payments'; } }" },
          { Name: 'UtilHelper', Body: 'public class UtilHelper { }' },
          { Name: 'ZetaBridge', Body: 'public class ZetaBridge { }' },
        ] },
      { test: (s) => s === 'SELECT COUNT(Id) FROM ApexClass WHERE NamespacePrefix != null',
        records: [{ expr0: 2 }] },
      { test: (s) => s === 'SELECT DeveloperName FROM NamedCredential ORDER BY DeveloperName',
        records: [{ DeveloperName: 'Acme_ERP_Cred' }, { DeveloperName: 'Legacy_SFTP_Cred' }] },
      { test: (s) => s === 'SELECT SiteName FROM RemoteProxy ORDER BY SiteName',
        records: [{ SiteName: 'Acme_Shipping_API' }, { SiteName: 'Old_Partner_Site' }] },
      // -- identity.ts --
      { test: (s) => s === 'SELECT Issuer FROM SamlSsoConfig',
        records: [{ Issuer: 'https://acme.okta.com' }] },
      // -- capabilities.ts: COUNT(Id) aggregates. Each is an exact, distinct query string, so
      // no two of these -- or the two ApexClass queries above -- can collide on a substring
      // match the way `s.includes('ApexClass')` would.
      { test: (s) => s === 'SELECT COUNT(Id) FROM ApexClass', records: [{ expr0: 9 }] },
      { test: (s) => s === 'SELECT COUNT(Id) FROM ApexTrigger', records: [{ expr0: 4 }] },
      { test: (s) => s === 'SELECT COUNT(Id) FROM FlowDefinition', records: [{ expr0: 6 }] },
      { test: (s) => s === 'SELECT COUNT(Id) FROM LightningComponentBundle', records: [{ expr0: 12 }] },
      { test: (s) => s === 'SELECT COUNT(Id) FROM AuraDefinitionBundle', records: [{ expr0: 2 }] },
      { test: (s) => s === 'SELECT COUNT(Id) FROM NamedCredential', records: [{ expr0: 2 }] },
      { test: (s) => s === 'SELECT COUNT(Id) FROM ExternalDataSource', records: [{ expr0: 1 }] },
      { test: (s) => s === 'SELECT COUNT(Id) FROM RemoteProxy', records: [{ expr0: 2 }] },
      { test: (s) => s === 'SELECT SelectedEntity FROM PlatformEventChannelMember',
        records: [
          { SelectedEntity: 'Acme_Order_Event__e' },
          { SelectedEntity: 'Acme_Shipment_Event__e' },
          { SelectedEntity: 'Acme_Order_Event__e' },
        ] },
    ]),
    soql: mockSoql([
      // -- products.ts --
      { test: (s) => s === "SELECT DeveloperName FROM RecordType WHERE SobjectType IN ('Case','Account')",
        records: [{ DeveloperName: 'Acme_Support_Case' }, { DeveloperName: 'Standard_Account' }] },
      // -- personas.ts --
      { test: (s) => s === 'SELECT Profile.Name profileName, Profile.UserLicense.Name licenceName, ' +
          'COUNT(Id) userCount FROM User WHERE IsActive = true GROUP BY Profile.Name, Profile.UserLicense.Name',
        records: [
          { profileName: 'System Administrator', licenceName: 'Salesforce', userCount: 5 },
          { profileName: 'Acme Support Agent', licenceName: 'Salesforce Platform', userCount: 42 },
          { profileName: 'Community User', licenceName: 'Customer Community Plus', userCount: 120 },
        ] },
      // -- channels.ts --
      { test: (s) => s === 'SELECT Name, Status FROM Site',
        records: [
          { Name: 'Acme Customer Portal', Status: 'Active' },
          { Name: 'Acme Partner Portal', Status: 'Inactive' },
        ] },
      // -- capabilities.ts --
      { test: (s) => s === 'SELECT Id FROM EventRelayConfig LIMIT 1',
        records: [{ Id: '0YR000000000001' }], totalSize: 1 },
      // -- identity.ts --
      { test: (s) => s === 'SELECT Application, LoginType, COUNT(Id) FROM LoginHistory ' +
          'WHERE LoginTime = LAST_N_DAYS:90 GROUP BY Application, LoginType',
        records: [
          { Application: 'Salesforce for Android', LoginType: 'Application', expr0: 12 },
          { Application: 'Browser', LoginType: 'SAML Sso', expr0: 340 },
        ] },
      // -- integrationEdges.ts: OmniStudio --
      { test: (s) => s === "SELECT Type, PropertySetConfig, OmniProcess.Id, OmniProcess.Name FROM " +
          "OmniProcessElement WHERE OmniProcess.OmniProcessType = 'Integration Procedure' " +
          "AND OmniProcess.IsActive = true AND Type IN ('REST Action', 'Remote Action', " +
          "'Integration Procedure Action') ORDER BY Id",
        records: [
          { Type: 'Remote Action', PropertySetConfig: JSON.stringify({ remoteClass: 'AcmeOrderSync' }),
            OmniProcess: { Id: '0Wp01', Name: 'AcmeCheckoutFlow' } },
          { Type: 'REST Action', PropertySetConfig: JSON.stringify({ namedCredential: 'Acme_ERP_Cred' }),
            OmniProcess: { Id: '0Wp02', Name: 'AcmeSyncProcedure' } },
          { Type: 'REST Action', PropertySetConfig: null,
            OmniProcess: { Id: '0Wp03', Name: 'AcmeAuditProcedure' } },
          { Type: 'Remote Action', PropertySetConfig: null,
            OmniProcess: { Id: '0Wp04', Name: 'AcmeLegacyProcedure' } },
          { Type: 'Integration Procedure Action', PropertySetConfig: null,
            OmniProcess: { Id: '0Wp05', Name: 'AcmeChainProcedure' } },
        ] },
      { test: (s) => s === "SELECT COUNT(Id) FROM OmniProcessElement WHERE " +
          "OmniProcess.OmniProcessType = 'Integration Procedure' AND OmniProcess.IsActive != true " +
          "AND Type IN ('REST Action', 'Remote Action', 'Integration Procedure Action')",
        records: [{ expr0: 3 }] },
    ]),
    rest: mockRest([
      { name: 'Account' },
      { name: 'Case' },
      { name: 'Acme_Config__c' },
      { name: 'Acme_Order_Event__e' },
      { name: 'Acme_Shipment_Event__e' },
      { name: 'Acme_Internal_Event__e' },
    ]),
  });
}

/** The deterministic `runAnatomy()` call shared by golden.test.ts and any later behavioral test. */
export async function artifacts(): Promise<AnatomyArtifact> {
  return runAnatomy(ctx(), PROVENANCE);
}

/**
 * The `AnatomyFragmentInput` for `buildAnatomyFragment` (fragment.test.ts). A plain literal, not
 * `artifacts()`'s output sliced apart: `input()` must be synchronous (`buildAnatomyFragment` is a
 * pure function over already-collected data, not over an `IntelContext`), while `artifacts()` is
 * `runAnatomy()` awaiting six collectors. The two fixtures tell a smaller version of the same
 * "Acme" story on purpose -- a product with a real prefix match, a persona pair, a site channel
 * alongside a non-site one the fragment must skip, one CDC-enabled object, one SSO config, and
 * four integration edges exercising the four edge outcomes: a NamedCredential hop (emitted,
 * targeting `ncred.<DeveloperName>`), an attributed edge with no NamedCredential hop to name the
 * destination (`anatomy.edges.unresolvedTarget`), a RemoteProxy destination with no owned kind
 * yet (`anatomy.edges.remoteProxy`), and a fully unattributed chain with no endpoint at all
 * (`anatomy.edges.unattributed`). Does not touch `ctx()`, `PROVENANCE` or `artifacts()` -- none
 * of the golden's values move.
 */
export function input(): AnatomyFragmentInput {
  return {
    products: [
      { key: 'acme', label: 'Acme', source: 'package', componentCount: 8, prefixes: ['ACME'] },
      { key: 'ops-portal', label: 'Ops Portal', source: 'app', componentCount: 2, prefixes: ['OPS'] },
    ],
    personas: [
      { profile: 'SystemAdministrator', licence: 'Salesforce', activeUsers: 5, landingApp: 'Acme_Console' },
      { profile: 'AcmeSupportAgent', licence: 'Salesforce Platform', activeUsers: 42, landingApp: null },
    ],
    channels: [
      { type: 'site', name: 'Acme_Customer_Portal', status: 'Active' },
      { type: 'site', name: 'Acme_Partner_Portal', status: 'Inactive' },
      // Not yet a population the collector fills in -- exercises the fragment's "only site"
      // filter, per CONVERGENCE_SPEC.md 4.2 ("channels are sites, today").
      { type: 'app', name: 'Acme_Mobile', status: 'Active' },
    ],
    capabilities: {
      apexClasses: 9,
      apexTriggers: 4,
      flows: 6,
      lwc: 12,
      aura: 2,
      // Read by the fragment's input type but never emitted -- already derivable from the merged
      // graph per CONVERGENCE_SPEC.md 4.2.
      platformEvents: ['Acme_Order_Event__e', 'Acme_Shipment_Event__e'],
      changeDataCapture: ['Account', 'Case'],
      namedCredentials: 2,
      externalDataSources: 1,
      remoteSites: 2,
      eventRelayConfigured: true,
    },
    identity: {
      ssoConfigs: [
        { type: 'saml', issuer: 'https://acme.okta.com', identityMapping: 'Federation Id', userProvisioning: true },
      ],
      loginsByType: [
        { application: 'Salesforce for Android', loginType: 'Application', count: 12 },
        { application: 'Browser', loginType: 'SAML Sso', count: 340 },
      ],
    },
    // Exercises all four edge outcomes `buildAnatomyFragment` distinguishes: emitted, and the
    // three distinct reasons an edge is left out (each counted in the fragment's own
    // `coverage.unavailable`, never silently dropped).
    edges: [
      // Attributed, and its via chain names a NamedCredential hop directly -- the one shape
      // that becomes a graph edge, targeting `ncred.<DeveloperName>` (the id sf-orgviz's
      // extraction actually writes), not `edge.endpoint` (a URL here, not an id).
      {
        endpoint: 'https://acme-erp.example.invalid/api',
        from: 'acme',
        via: [{ type: 'NamedCredential', name: 'Acme_ERP_Cred' }],
        detection: 'endpointOnly',
        attribution: 'prefixMatch',
      },
      // Attributed, with real endpoint evidence, but no NamedCredential hop names the
      // destination -- `edge.endpoint` here is a raw callout-literal, not a DeveloperName, so no
      // node id can be formed for it. Left out as `anatomy.edges.unresolvedTarget`.
      {
        endpoint: 'Acme_Payment_API',
        from: 'acme',
        via: [{ type: 'ApexClass', name: 'AcmeOrderSync' }],
        detection: 'apexCallout',
        attribution: 'prefixMatch',
      },
      // Attributed, but the via chain names a RemoteProxy (Remote Site Setting) destination,
      // which has no owned graph kind yet. Left out as `anatomy.edges.remoteProxy`.
      {
        endpoint: 'Old_Partner_Site',
        from: 'ops-portal',
        via: [{ type: 'RemoteProxy', name: 'Old_Partner_Site' }],
        detection: 'endpointOnly',
        attribution: 'prefixMatch',
      },
      // Reached out, but neither attributed to a product nor resolved to an endpoint -- nothing
      // on either side to anchor a graph edge to. Left out as `anatomy.edges.unattributed`.
      {
        endpoint: null,
        from: null,
        via: [{ type: 'OmniProcess', name: 'AcmeLegacyProcedure' }],
        detection: 'remoteActionChain',
        attribution: 'unattributed',
      },
    ],
    capturedAt: '2026-01-01T00:00:00Z',
    orgId: 'org1',
  };
}
