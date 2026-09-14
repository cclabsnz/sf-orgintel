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
