// src/anatomy/types.ts
// Shape of anatomy.json. Data only, no logic, so every consumer agrees on one definition.

/**
 * How an integration edge was proven to exist. Independent of who owns it.
 *
 * `endpointOnly` covers two shapes of incomplete-but-real evidence, not just one: a
 * `NamedCredential`/`RemoteProxy` that names a destination with no code path found to it, and
 * (since one side of the pair is still missing either way) a scanned element that confirms an
 * integration point exists, such as a REST Action, whose config carries no usable credential.
 * Neither claims a resolution mechanism succeeded, which is why the value is safe for both:
 * the alternative of leaving a credential-less REST Action as `namedCredential` asserts a
 * named endpoint was found when none was.
 */
export type Detection = 'namedCredential' | 'apexCallout' | 'remoteActionChain' | 'endpointOnly';

/** How an edge was traced to a product. Independent of how strongly it was detected. */
export type Attribution = 'prefixMatch' | 'packageOwner' | 'unattributed';

export interface ChainHop {
  type: 'OmniProcess' | 'ApexClass' | 'NamedCredential' | 'RemoteProxy';
  name: string;
}

export interface Product {
  key: string;
  label: string;
  source: 'app' | 'package' | 'recordType';
  componentCount: number;
  prefixes: string[];
}

export interface Persona {
  profile: string;
  licence: string;
  activeUsers: number;
  landingApp: string | null;
}

export interface Channel {
  type: 'site' | 'app' | 'console' | 'api';
  name: string;
  status: string;
}

export interface Capabilities {
  apexClasses: number;
  apexTriggers: number;
  flows: number;
  lwc: number;
  aura: number;
  /** Custom platform event sObjects defined in the org, by API name. */
  platformEvents: string[];
  /**
   * Change event entities this org has actually selected for Change Data Capture, on the
   * standard `ChangeEvents` channel or any custom one, read from `PlatformEventChannelMember`.
   *
   * Not "every object that supports CDC". Version 1 of this artifact meant the latter, which is
   * a property of the platform rather than of the org: it read 419 on an org where CDC was
   * switched off entirely. An empty array here means no entity is publishing change events.
   */
  changeDataCapture: string[];
  namedCredentials: number;
  externalDataSources: number;
  remoteSites: number;
  /** False is a finding, not a default. Bounds who can consume the delivery allocation. */
  eventRelayConfigured: boolean;
}

export interface SsoConfig {
  type: 'saml' | 'authProvider';
  issuer: string | null;
  identityMapping: string | null;
  userProvisioning: boolean;
}

export interface Identity {
  ssoConfigs: SsoConfig[];
  loginsByType: Array<{ application: string; loginType: string; count: number }>;
}

export interface IntegrationEdge {
  endpoint: string | null;
  from: string | null;
  via: ChainHop[];
  detection: Detection;
  attribution: Attribution;
}

/** Why a piece of the artifact is absent. `deferred` means this phase never gathers it; `failed` means a read was attempted and refused or errored. */
export type UnavailableReason = 'deferred' | 'failed';

export interface Unavailable {
  /** Stable machine key naming what is missing, dotted to match the artifact field it affects, for example 'channels.network' or 'capabilities.apexClasses'. */
  scope: string;
  reason: UnavailableReason;
  /** Human detail, including the underlying error message where there was one. */
  detail: string;
}

export interface AnatomyCoverage {
  apexBodiesScanned: number;
  apexBodiesUnreadable: number;
  omniElementsScanned: number;
  /**
   * Distinct Integration Procedure names reached by a scanned element on its active version,
   * not distinct OmniProcess ids (OmniProcess rows are versions; several can share one name).
   */
  omniProceduresWithIntegrationElements: number;
  /** Elements excluded because they sit on a superseded (inactive) Integration Procedure version. */
  omniElementsSkippedSuperseded: number;
  prefixesUnresolved: string[];
  notes: string[];
  /**
   * The structured counterpart to `notes`: what is missing, as data rather than prose. `notes`
   * stays prose for a human reading the terminal summary; `unavailable` is what consumers (View
   * A among them) key off, so a reworded note can never silently break a band's emptiness
   * classification. Sorted by `scope` for determinism.
   */
  unavailable: Unavailable[];
}

export interface AnatomyArtifact {
  /**
   * 2 since `capabilities.changeDataCapture` changed meaning from "objects the platform supports
   * CDC for" to "entities this org enabled CDC on". Bumped because the key kept its name while
   * the number behind it changed by two orders of magnitude, and a consumer holding both a v1
   * and a v2 artifact would otherwise read that as CDC having been switched off.
   */
  version: 2;
  provenance: { generatedAt: string; orgId: string; toolVersion: string; apiVersion: string };
  products: Product[];
  personas: Persona[];
  channels: Channel[];
  capabilities: Capabilities;
  identity: Identity;
  edges: IntegrationEdge[];
  coverage: AnatomyCoverage;
}

/** Output of buildPrefixRegistry. `unresolved` is reported, never used for attribution. */
export interface PrefixRegistry {
  /** prefix token, uppercased, to product key */
  byPrefix: Map<string, string>;
  products: Product[];
  unresolved: string[];
}
