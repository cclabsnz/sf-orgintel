// src/anatomy/types.ts
// Shape of anatomy.json. Data only, no logic, so every consumer agrees on one definition.

/** How an integration edge was proven to exist. Independent of who owns it. */
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
  platformEvents: string[];
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

export interface AnatomyCoverage {
  apexBodiesScanned: number;
  apexBodiesUnreadable: number;
  omniElementsScanned: number;
  /** Distinct OmniProcess ids reached by a scanned element, not distinct names. */
  omniProceduresWithIntegrationElements: number;
  prefixesUnresolved: string[];
  notes: string[];
}

export interface AnatomyArtifact {
  version: 1;
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
