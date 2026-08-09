# `sf intel anatomy` Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `sf intel anatomy`, a read-only command that collects org products, personas, channels, capabilities, identity posture and integration edges, and writes `anatomy.json`.

**Architecture:** Six IO collectors, each failing independently into a shared `notes` array, feeding three pure functions (prefix registry, chain resolution, attribution) that carry all the logic worth testing. An orchestrator assembles the artifact. Rendering is out of scope for this plan; the JSON is the contract.

**Tech Stack:** TypeScript (NodeNext, strict), oclif via `@salesforce/sf-plugins-core`, Jest with ts-jest ESM, clients from `@cclabsnz/sf-core`.

## Global Constraints

- **Read-only.** SOQL, Tooling and REST GET only. `test/unit/invariants/readonly-invariant.test.ts` must keep passing with no allowlist additions.
- **No network egress** beyond the authenticated org. `test/unit/invariants/network-egress.test.ts` must keep passing.
- **No test touches a real org.** Use `test/unit/helpers/mocks.ts` (`mockSoql`, `mockTooling`, `mockRest`).
- **Deterministic output.** Same org in, same bytes out. Sort every array by a stable key before writing. Never embed `Date.now()` except in `provenance.generatedAt`.
- **Imports use `.js` extensions** (NodeNext), e.g. `import { x } from './types.js'`.
- **No em dashes in any user-facing string or comment.** Use a colon, a period or parentheses.
- **Never invent a product.** A prefix candidate becomes a product only if it also matches an app, package or record type. See spec section 5.3.
- **`unattributed` is never replaced by a guess.**
- Spec: `docs/ANATOMY_SPEC.md`. Where this plan and the spec disagree, the spec wins.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/anatomy/types.ts` | Every interface in `anatomy.json`. No logic. |
| `src/anatomy/prefixRegistry.ts` | Pure. Candidate derivation, denylist, merging, source matching. |
| `src/anatomy/attribute.ts` | Pure. `resolveChains`, `attributeEdges`. |
| `src/anatomy/collectors/products.ts` | Packages, `CustomApplication`, record types. |
| `src/anatomy/collectors/personas.ts` | Licences, users by profile. |
| `src/anatomy/collectors/channels.ts` | `Site`, `Network`, landing apps. |
| `src/anatomy/collectors/capabilities.ts` | Component counts, events, CDC, event relay. |
| `src/anatomy/collectors/identity.ts` | SSO config, logins by type. Describes only. |
| `src/anatomy/collectors/integrationEdges.ts` | Named credentials, remote sites, Apex bodies, OmniStudio. |
| `src/anatomy/runAnatomy.ts` | Orchestration. Calls collectors, then pure functions, assembles artifact. |
| `src/commands/intel/anatomy.ts` | oclif command. Flags, output, terminal summary. |

Collectors do IO and nothing else. Everything worth arguing about lives in the two pure modules, which is where the tests concentrate.

---

### Task 1: Artifact types

**Files:**
- Create: `src/anatomy/types.ts`
- Test: none (types only, exercised by every later task)

**Interfaces:**
- Consumes: nothing
- Produces: `AnatomyArtifact`, `Product`, `Persona`, `Channel`, `Capabilities`, `Identity`, `IntegrationEdge`, `AnatomyCoverage`, `Detection`, `Attribution`, `ChainHop`, `PrefixRegistry`

- [ ] **Step 1: Create the types file**

```ts
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
  omniProceduresTotal: number;
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
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/anatomy/types.ts
git commit -m "feat(anatomy): define the anatomy.json artifact types"
```

---

### Task 2: Prefix registry

The highest-risk logic in the feature. Three orgs showed roughly half of frequency-derived candidates resolve to nothing, and infrastructure namespaces clear the floor everywhere.

**Files:**
- Create: `src/anatomy/prefixRegistry.ts`
- Test: `test/unit/anatomy/prefixRegistry.test.ts`

**Interfaces:**
- Consumes: `PrefixRegistry`, `Product` from `../types.js`
- Produces: `buildPrefixRegistry(componentNames: string[], sources: RegistrySources): PrefixRegistry`, where
  `RegistrySources = { apps: string[]; packages: string[]; recordTypes: string[] }`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/anatomy/prefixRegistry.test.ts
import { buildPrefixRegistry } from '../../../src/anatomy/prefixRegistry.js';

const names = (spec: Record<string, number>): string[] =>
  Object.entries(spec).flatMap(([prefix, n]) =>
    Array.from({ length: n }, (_, i) => `${prefix}_Thing${i}`),
  );

describe('buildPrefixRegistry', () => {
  it('promotes a frequent candidate that matches an app', () => {
    const r = buildPrefixRegistry(names({ ACME: 40 }), { apps: ['ACME_Console'], packages: [], recordTypes: [] });
    expect(r.products.map((p) => p.key)).toEqual(['ACME']);
    expect(r.byPrefix.get('ACME')).toBe('ACME');
    expect(r.unresolved).toEqual([]);
  });

  it('never creates a product from frequency alone', () => {
    // The failure this rule exists for: on a real org the single largest prefix matched
    // no application, and promoting it would have invented a product that does not exist.
    const r = buildPrefixRegistry(names({ ZZZ: 500 }), { apps: [], packages: [], recordTypes: [] });
    expect(r.products).toEqual([]);
    expect(r.unresolved).toEqual(['ZZZ']);
  });

  it('drops utility namespaces before matching, so they cannot resolve spuriously', () => {
    // 'Log' matched an unrelated application on a real org and would have become a product.
    const r = buildPrefixRegistry(names({ Log: 60, Logger: 30 }), {
      apps: ['Logistics_App'],
      packages: [],
      recordTypes: [],
    });
    expect(r.products).toEqual([]);
    expect(r.unresolved).toEqual([]);
  });

  it('merges a candidate that is a prefix of another', () => {
    const r = buildPrefixRegistry(names({ ACME: 30, ACMEX: 20 }), {
      apps: ['ACME_Console'],
      packages: [],
      recordTypes: [],
    });
    expect(r.products.map((p) => p.key)).toEqual(['ACME']);
    expect(r.products[0].componentCount).toBe(50);
  });

  it('accepts a package or a record type as a source, not only an app', () => {
    const byPackage = buildPrefixRegistry(names({ BETA: 20 }), { apps: [], packages: ['BETA'], recordTypes: [] });
    expect(byPackage.products[0]).toMatchObject({ key: 'BETA', source: 'package' });

    const byRt = buildPrefixRegistry(names({ GAMMA: 20 }), { apps: [], packages: [], recordTypes: ['GAMMA_Request'] });
    expect(byRt.products[0]).toMatchObject({ key: 'GAMMA', source: 'recordType' });
  });

  it('ignores candidates below the floor', () => {
    const r = buildPrefixRegistry(names({ TINY: 2, BIG: 200 }), {
      apps: ['TINY_App', 'BIG_App'],
      packages: [],
      recordTypes: [],
    });
    expect(r.products.map((p) => p.key)).toEqual(['BIG']);
  });

  it('is deterministic and sorted', () => {
    const src = { apps: ['B_App', 'A_App'], packages: [], recordTypes: [] };
    const one = buildPrefixRegistry(names({ B: 30, A: 30 }), src);
    const two = buildPrefixRegistry(names({ A: 30, B: 30 }), src);
    expect(one.products.map((p) => p.key)).toEqual(['A', 'B']);
    expect(one).toEqual(two);
  });

  it('returns empty structures for an org with no components', () => {
    const r = buildPrefixRegistry([], { apps: [], packages: [], recordTypes: [] });
    expect(r).toEqual({ byPrefix: new Map(), products: [], unresolved: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec node --experimental-vm-modules node_modules/jest/bin/jest.js test/unit/anatomy/prefixRegistry.test.ts`
Expected: FAIL, cannot find module `prefixRegistry.js`.

- [ ] **Step 3: Implement**

```ts
// src/anatomy/prefixRegistry.ts
// Derives the org's own product naming scheme. Measured on three orgs: roughly half of
// frequency-derived candidates match no application, and infrastructure namespaces clear the
// floor on every org. So frequency proposes and a source disposes: a candidate becomes a
// product only when an app, package or record type independently names it.
import type { PrefixRegistry, Product } from './types.js';

export interface RegistrySources {
  apps: string[];
  packages: string[];
  recordTypes: string[];
}

/**
 * Namespaces that are infrastructure, not products. Dropped before source matching, because
 * a short utility token will eventually collide with an unrelated application name and
 * manufacture a product that nobody in the org would recognise.
 */
const UTILITY = new Set([
  'log', 'logger', 'logging', 'trigger', 'triggers', 'test', 'tests', 'util', 'utils',
  'helper', 'helpers', 'batch', 'sched', 'scheduler', 'mock', 'mocks', 'wrapper', 'const',
  'constants', 'base', 'common', 'shared', 'email', 'data', 'site', 'sites', 'global',
]);

/** Leading token, up to an underscore or a lower-to-upper camel boundary. */
function candidateOf(name: string): string | null {
  const m = /^([A-Za-z][A-Za-z0-9]*?)(?:_|(?=[A-Z][a-z]))/.exec(name);
  const tok = m?.[1];
  return tok && tok.length >= 2 && tok.length <= 12 ? tok : null;
}

export function buildPrefixRegistry(
  componentNames: readonly string[],
  sources: RegistrySources,
): PrefixRegistry {
  const counts = new Map<string, number>();
  for (const name of componentNames) {
    const tok = candidateOf(name);
    if (!tok || UTILITY.has(tok.toLowerCase())) continue;
    const key = tok.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Merge a candidate into any shorter candidate it starts with, so ACME and ACMEX do not
  // compete for the same components.
  const keys = [...counts.keys()].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const canonical = new Map<string, string>();
  for (const key of keys) {
    const parent = keys.find((k) => k !== key && k.length < key.length && key.startsWith(k));
    canonical.set(key, parent ? (canonical.get(parent) ?? parent) : key);
  }
  const merged = new Map<string, number>();
  for (const [key, n] of counts) {
    const root = canonical.get(key) ?? key;
    merged.set(root, (merged.get(root) ?? 0) + n);
  }

  const total = componentNames.length;
  const floor = Math.max(3, Math.round(total * 0.01));

  const matchSource = (key: string): Product['source'] | null => {
    const starts = (s: string): boolean => s.toUpperCase().startsWith(key);
    if (sources.apps.some(starts)) return 'app';
    if (sources.packages.some(starts)) return 'package';
    if (sources.recordTypes.some(starts)) return 'recordType';
    return null;
  };

  const products: Product[] = [];
  const unresolved: string[] = [];
  const byPrefix = new Map<string, string>();

  for (const [key, count] of [...merged.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count < floor) continue;
    const source = matchSource(key);
    if (!source) {
      unresolved.push(key);
      continue;
    }
    products.push({ key, label: key, source, componentCount: count, prefixes: [key] });
    byPrefix.set(key, key);
  }

  return { byPrefix, products, unresolved: unresolved.sort() };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec node --experimental-vm-modules node_modules/jest/bin/jest.js test/unit/anatomy/prefixRegistry.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/anatomy/prefixRegistry.ts test/unit/anatomy/prefixRegistry.test.ts
git commit -m "feat(anatomy): derive a prefix registry that never invents a product"
```

---

### Task 3: Chain resolution and attribution

**Files:**
- Create: `src/anatomy/attribute.ts`
- Test: `test/unit/anatomy/attribute.test.ts`

**Interfaces:**
- Consumes: `IntegrationEdge`, `ChainHop`, `PrefixRegistry` from `./types.js`
- Produces:
  - `resolveChains(remoteActions: RemoteActionRef[], apexCallouts: Map<string, string[]>): IntegrationEdge[]`
    where `RemoteActionRef = { omniProcess: string; remoteClass: string }`
  - `attributeEdges(edges: IntegrationEdge[], registry: PrefixRegistry): IntegrationEdge[]`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/anatomy/attribute.test.ts
import { attributeEdges, resolveChains } from '../../../src/anatomy/attribute.js';
import type { IntegrationEdge, PrefixRegistry } from '../../../src/anatomy/types.js';

const registry = (pairs: Array<[string, string]>): PrefixRegistry => ({
  byPrefix: new Map(pairs),
  products: [],
  unresolved: [],
});

const edge = (over: Partial<IntegrationEdge>): IntegrationEdge => ({
  endpoint: 'https://example.invalid',
  from: null,
  via: [],
  detection: 'endpointOnly',
  attribution: 'unattributed',
  ...over,
});

describe('resolveChains', () => {
  it('records both hops when a Remote Action reaches a class with a callout', () => {
    const out = resolveChains(
      [{ omniProcess: 'ACME_GetThing', remoteClass: 'ACME_Service' }],
      new Map([['ACME_Service', ['Payments_API']]]),
    );
    expect(out).toEqual([
      {
        endpoint: 'Payments_API',
        from: null,
        via: [
          { type: 'OmniProcess', name: 'ACME_GetThing' },
          { type: 'ApexClass', name: 'ACME_Service' },
        ],
        detection: 'remoteActionChain',
        attribution: 'unattributed',
      },
    ]);
  });

  it('records the procedure with no endpoint when the class body was unreadable', () => {
    const out = resolveChains([{ omniProcess: 'ACME_GetThing', remoteClass: 'Hidden' }], new Map());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ endpoint: null, detection: 'remoteActionChain' });
    expect(out[0].via).toEqual([
      { type: 'OmniProcess', name: 'ACME_GetThing' },
      { type: 'ApexClass', name: 'Hidden' },
    ]);
  });

  it('emits one edge per callout when a class makes several', () => {
    const out = resolveChains(
      [{ omniProcess: 'P', remoteClass: 'C' }],
      new Map([['C', ['A_API', 'B_API']]]),
    );
    expect(out.map((e) => e.endpoint)).toEqual(['A_API', 'B_API']);
  });
});

describe('attributeEdges', () => {
  it('attributes from a prefix on any hop in the chain', () => {
    const [out] = attributeEdges(
      [edge({ via: [{ type: 'OmniProcess', name: 'ACME_GetThing' }] })],
      registry([['ACME', 'ACME']]),
    );
    expect(out).toMatchObject({ from: 'ACME', attribution: 'prefixMatch' });
  });

  it('leaves a confirmed edge unattributed when no prefix resolves', () => {
    // The state the two-axis model exists to express: we know the call happens, we do not
    // know whose it is. Collapsing these would report certainty that was never established.
    const [out] = attributeEdges(
      [edge({ detection: 'namedCredential', via: [{ type: 'NamedCredential', name: 'Zzz_Api' }] })],
      registry([['ACME', 'ACME']]),
    );
    expect(out).toMatchObject({ from: null, attribution: 'unattributed', detection: 'namedCredential' });
  });

  it('varies the two axes independently', () => {
    const out = attributeEdges(
      [
        edge({ detection: 'namedCredential', via: [{ type: 'ApexClass', name: 'ACME_X' }] }),
        edge({ detection: 'endpointOnly', via: [{ type: 'ApexClass', name: 'ACME_Y' }] }),
      ],
      registry([['ACME', 'ACME']]),
    );
    expect(out.map((e) => [e.detection, e.attribution])).toEqual([
      ['namedCredential', 'prefixMatch'],
      ['endpointOnly', 'prefixMatch'],
    ]);
  });

  it('prefers the first hop that resolves, so the procedure wins over the class', () => {
    const [out] = attributeEdges(
      [
        edge({
          via: [
            { type: 'OmniProcess', name: 'ACME_Flow' },
            { type: 'ApexClass', name: 'BETA_Service' },
          ],
        }),
      ],
      registry([
        ['ACME', 'ACME'],
        ['BETA', 'BETA'],
      ]),
    );
    expect(out.from).toBe('ACME');
  });

  it('does not mutate its input', () => {
    const input = [edge({ via: [{ type: 'ApexClass', name: 'ACME_X' }] })];
    attributeEdges(input, registry([['ACME', 'ACME']]));
    expect(input[0].from).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec node --experimental-vm-modules node_modules/jest/bin/jest.js test/unit/anatomy/attribute.test.ts`
Expected: FAIL, cannot find module `attribute.js`.

- [ ] **Step 3: Implement**

```ts
// src/anatomy/attribute.ts
// Pure. Everything here is a judgement about evidence, so it is kept away from IO and tested
// directly. Detection and attribution are separate axes: an edge can be proven and still
// have no known owner, which on a real org is the most common honest state.
import type { ChainHop, IntegrationEdge, PrefixRegistry } from './types.js';

export interface RemoteActionRef {
  omniProcess: string;
  remoteClass: string;
}

/**
 * Turn OmniStudio Remote Actions into edges. A Remote Action names an Apex class rather than
 * an endpoint, so the real path is procedure to class to callout. Both hops are recorded:
 * the procedure is the consumer, the class is where the call physically lives, and a reader
 * deciding who to talk to needs both.
 */
export function resolveChains(
  remoteActions: readonly RemoteActionRef[],
  apexCallouts: ReadonlyMap<string, readonly string[]>,
): IntegrationEdge[] {
  const out: IntegrationEdge[] = [];
  for (const ref of remoteActions) {
    const via: ChainHop[] = [
      { type: 'OmniProcess', name: ref.omniProcess },
      { type: 'ApexClass', name: ref.remoteClass },
    ];
    const endpoints = apexCallouts.get(ref.remoteClass) ?? [];
    if (endpoints.length === 0) {
      // Unreadable or callout-free class. The procedure still reached out; we cannot say where.
      out.push({ endpoint: null, from: null, via, detection: 'remoteActionChain', attribution: 'unattributed' });
      continue;
    }
    for (const endpoint of endpoints) {
      out.push({ endpoint, from: null, via, detection: 'remoteActionChain', attribution: 'unattributed' });
    }
  }
  return out;
}

/** Longest prefix wins, so ACMEX is not attributed to ACME when both are registered. */
function productFor(name: string, registry: PrefixRegistry): string | null {
  const upper = name.toUpperCase();
  let best: string | null = null;
  for (const [prefix, product] of registry.byPrefix) {
    if (upper.startsWith(prefix) && (best === null || prefix.length > best.length)) best = product;
  }
  return best;
}

/**
 * Attach an owner where one can be established. Hops are tried in order, so the consuming
 * artifact wins over the shared plumbing it calls. Never guesses: an edge with no resolvable
 * hop stays `unattributed` regardless of how firmly it was detected.
 */
export function attributeEdges(
  edges: readonly IntegrationEdge[],
  registry: PrefixRegistry,
): IntegrationEdge[] {
  return edges.map((e) => {
    for (const hop of e.via) {
      const product = productFor(hop.name, registry);
      if (product) return { ...e, from: product, attribution: 'prefixMatch' };
    }
    return { ...e, from: null, attribution: 'unattributed' };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec node --experimental-vm-modules node_modules/jest/bin/jest.js test/unit/anatomy/attribute.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/anatomy/attribute.ts test/unit/anatomy/attribute.test.ts
git commit -m "feat(anatomy): resolve OmniStudio chains and attribute edges without guessing"
```

---

### Task 4: Products, personas and channels collectors

Grouped because all three are plain SOQL over the same client and share one failure convention. Splitting them would give a reviewer three near-identical diffs.

**Files:**
- Create: `src/anatomy/collectors/products.ts`, `src/anatomy/collectors/personas.ts`, `src/anatomy/collectors/channels.ts`
- Test: `test/unit/anatomy/collectors.test.ts`

**Interfaces:**
- Consumes: `IntelContext` from `../../lib/wire.js`; types from `../types.js`
- Produces:
  - `collectProducts(ctx, notes): Promise<{ apps: string[]; packages: string[]; recordTypes: string[] }>`
  - `collectPersonas(ctx, notes): Promise<Persona[]>`
  - `collectChannels(ctx, notes): Promise<Channel[]>`

Every collector takes `notes: string[]` and pushes on failure. None throws.

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/anatomy/collectors.test.ts
import { mockSoql, mockTooling } from '../helpers/mocks.js';
import { collectProducts } from '../../../src/anatomy/collectors/products.js';
import { collectPersonas } from '../../../src/anatomy/collectors/personas.js';
import { collectChannels } from '../../../src/anatomy/collectors/channels.js';

const ctx = (over: Record<string, unknown>): any => ({ soql: mockSoql([]), tooling: mockTooling([]), ...over });

describe('collectProducts', () => {
  it('returns app, package and record type names', async () => {
    const notes: string[] = [];
    const out = await collectProducts(
      ctx({
        tooling: mockTooling([{ test: (s) => s.includes('CustomApplication'), records: [{ DeveloperName: 'ACME_Console' }] }]),
        soql: mockSoql([{ test: (s) => s.includes('RecordType'), records: [{ DeveloperName: 'ACME_Request' }] }]),
      }),
      notes,
    );
    expect(out.apps).toEqual(['ACME_Console']);
    expect(out.recordTypes).toEqual(['ACME_Request']);
    expect(notes).toEqual([]);
  });

  it('records a note and returns empty rather than throwing', async () => {
    const notes: string[] = [];
    const out = await collectProducts(
      ctx({
        tooling: mockTooling([{ test: () => true, error: new Error('INSUFFICIENT_ACCESS') }]),
        soql: mockSoql([{ test: () => true, error: new Error('nope') }]),
      }),
      notes,
    );
    expect(out).toEqual({ apps: [], packages: [], recordTypes: [] });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.join(' ')).not.toContain('—');
  });
});

describe('collectPersonas', () => {
  it('joins active user counts to licences and sorts deterministically', async () => {
    const notes: string[] = [];
    const out = await collectPersonas(
      ctx({
        soql: mockSoql([
          { test: (s) => s.includes('FROM User'), records: [
            { Profile: { Name: 'Zed' }, Profile_UserLicense: null, expr0: 3 },
            { Profile: { Name: 'Alpha' }, expr0: 7 },
          ] },
        ]),
      }),
      notes,
    );
    expect(out.map((p) => p.profile)).toEqual(['Alpha', 'Zed']);
    expect(out[0].activeUsers).toBe(7);
  });
});

describe('collectChannels', () => {
  it('returns sites as channels', async () => {
    const notes: string[] = [];
    const out = await collectChannels(
      ctx({ soql: mockSoql([{ test: (s) => s.includes('FROM Site'), records: [{ Name: 'Portal', Status: 'Active' }] }]) }),
      notes,
    );
    expect(out).toContainEqual({ type: 'site', name: 'Portal', status: 'Active' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec node --experimental-vm-modules node_modules/jest/bin/jest.js test/unit/anatomy/collectors.test.ts`
Expected: FAIL, cannot find module `products.js`.

- [ ] **Step 3: Implement the three collectors**

```ts
// src/anatomy/collectors/products.ts
// Sources the prefix registry matches against. Each read is independent: a permission gap on
// one must not blank the others, because a half-populated registry is still useful and a
// crashed command is not.
import type { IntelContext } from '../../lib/wire.js';

export interface RegistrySourceNames {
  apps: string[];
  packages: string[];
  recordTypes: string[];
}

async function safe<T>(label: string, notes: string[], fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    notes.push(`${label} could not be read: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

export async function collectProducts(ctx: IntelContext, notes: string[]): Promise<RegistrySourceNames> {
  // NOTE: ToolingClient.query resolves to T[] directly. It has no `.records` and no
  // `.totalSize`, unlike SoqlClient.query which returns a QueryResult.
  const apps = await safe('CustomApplication', notes, async () =>
    (await ctx.tooling.query<{ DeveloperName: string }>(
      'SELECT DeveloperName FROM CustomApplication WHERE NamespacePrefix = null',
    )).map((r) => r.DeveloperName),
  );

  const packages = await safe('InstalledSubscriberPackage', notes, async () =>
    (await ctx.tooling.query<{ SubscriberPackage: { NamespacePrefix: string | null } }>(
      'SELECT SubscriberPackage.NamespacePrefix FROM InstalledSubscriberPackage',
    )).map((r) => r.SubscriberPackage?.NamespacePrefix ?? '').filter((s) => s.length > 0),
  );

  const recordTypes = await safe('RecordType', notes, async () =>
    (await ctx.soql.queryAll<{ DeveloperName: string }>(
      "SELECT DeveloperName FROM RecordType WHERE SobjectType IN ('Case','Account')",
    )).map((r) => r.DeveloperName),
  );

  return { apps: apps.sort(), packages: packages.sort(), recordTypes: recordTypes.sort() };
}
```

```ts
// src/anatomy/collectors/personas.ts
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
```

```ts
// src/anatomy/collectors/channels.ts
// The surfaces people actually arrive on.
import type { IntelContext } from '../../lib/wire.js';
import type { Channel } from '../types.js';

export async function collectChannels(ctx: IntelContext, notes: string[]): Promise<Channel[]> {
  const out: Channel[] = [];
  try {
    const sites = await ctx.soql.queryAll<{ Name: string; Status: string }>(
      'SELECT Name, Status FROM Site',
    );
    for (const s of sites) out.push({ type: 'site', name: s.Name, status: s.Status ?? 'unknown' });
  } catch (e) {
    notes.push(`Sites could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec node --experimental-vm-modules node_modules/jest/bin/jest.js test/unit/anatomy/collectors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anatomy/collectors test/unit/anatomy/collectors.test.ts
git commit -m "feat(anatomy): collect products, personas and channels"
```

---

### Task 5: Capabilities and identity collectors

**Files:**
- Create: `src/anatomy/collectors/capabilities.ts`, `src/anatomy/collectors/identity.ts`
- Test: `test/unit/anatomy/capabilities.test.ts`, `test/unit/anatomy/identity.test.ts`

**Interfaces:**
- Consumes: `IntelContext`, `Capabilities`, `Identity`
- Produces: `collectCapabilities(ctx, notes): Promise<Capabilities>`, `collectIdentity(ctx, notes): Promise<Identity>`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/anatomy/capabilities.test.ts
import { mockSoql, mockTooling, mockRest } from '../helpers/mocks.js';
import { collectCapabilities } from '../../../src/anatomy/collectors/capabilities.js';

describe('collectCapabilities', () => {
  it('reports eventRelayConfigured false when none exist, rather than omitting it', async () => {
    // Absence is a finding: it bounds who can consume the delivery allocation.
    const notes: string[] = [];
    const out = await collectCapabilities(
      { soql: mockSoql([{ test: () => true, records: [], totalSize: 0 }]),
        tooling: mockTooling([{ test: () => true, records: [], totalSize: 0 }]),
        rest: mockRest([]) } as any,
      notes,
    );
    expect(out.eventRelayConfigured).toBe(false);
  });

  it('separates platform events from change data capture by suffix', async () => {
    const notes: string[] = [];
    const out = await collectCapabilities(
      { soql: mockSoql([{ test: () => true, records: [], totalSize: 0 }]),
        tooling: mockTooling([{ test: () => true, records: [], totalSize: 0 }]),
        rest: mockRest([{ path: /sobjects/, body: { sobjects: [
          { name: 'Order__e' }, { name: 'AccountChangeEvent' }, { name: 'Account' },
        ] } }]) } as any,
      notes,
    );
    expect(out.platformEvents).toEqual(['Order__e']);
    expect(out.changeDataCapture).toEqual(['AccountChangeEvent']);
  });
});
```

```ts
// test/unit/anatomy/identity.test.ts
import { mockSoql, mockTooling } from '../helpers/mocks.js';
import { collectIdentity } from '../../../src/anatomy/collectors/identity.js';

describe('collectIdentity', () => {
  it('reports login counts by type as facts, with no grading', async () => {
    const notes: string[] = [];
    const out = await collectIdentity(
      { soql: mockSoql([{ test: (s) => s.includes('LoginHistory'), records: [
          { Application: 'Portal', LoginType: 'Application', expr0: 900 },
          { Application: 'Portal', LoginType: 'SAML Sfdc Initiated SSO', expr0: 80 },
        ] }]),
        tooling: mockTooling([{ test: () => true, records: [] }]),
        metadata: { list: async () => [] } } as any,
      notes,
    );
    expect(out.loginsByType).toHaveLength(2);
    const serialised = JSON.stringify(out);
    for (const word of ['risk', 'weak', 'insecure', 'recommend', 'should']) {
      expect(serialised.toLowerCase()).not.toContain(word);
    }
  });

  it('still returns login data when SSO metadata cannot be retrieved', async () => {
    const notes: string[] = [];
    const out = await collectIdentity(
      { soql: mockSoql([{ test: (s) => s.includes('LoginHistory'), records: [
          { Application: 'X', LoginType: 'Application', expr0: 1 } ] }]),
        tooling: mockTooling([{ test: () => true, error: new Error('no access') }]),
        metadata: { list: async () => { throw new Error('denied'); } } } as any,
      notes,
    );
    expect(out.ssoConfigs).toEqual([]);
    expect(out.loginsByType).toHaveLength(1);
    expect(notes.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `pnpm exec node --experimental-vm-modules node_modules/jest/bin/jest.js test/unit/anatomy/capabilities.test.ts test/unit/anatomy/identity.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// src/anatomy/collectors/capabilities.ts
// What the platform is being used for. Counts, not judgements. An absent capability is
// recorded as absent rather than left out, because a missing key reads as "not checked".
import type { IntelContext } from '../../lib/wire.js';
import type { Capabilities } from '../types.js';

/**
 * Count via a COUNT(Id) aggregate rather than COUNT().
 *
 * ToolingClient.query resolves to T[] and drops the QueryResult wrapper, so `totalSize` is
 * not available through it. COUNT(Id) returns a single row carrying `expr0`, which survives
 * that. Several of the objects counted here (LightningComponentBundle, AuraDefinitionBundle,
 * RemoteProxy) are Tooling-only, so the data API is not an alternative.
 */
async function count(ctx: IntelContext, notes: string[], label: string, soql: string): Promise<number> {
  try {
    const rows = await ctx.tooling.query<{ expr0?: number }>(soql);
    return Number(rows[0]?.expr0 ?? 0);
  } catch (e) {
    notes.push(`${label} count unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

export async function collectCapabilities(ctx: IntelContext, notes: string[]): Promise<Capabilities> {
  const platformEvents: string[] = [];
  const changeDataCapture: string[] = [];
  try {
    const all = await ctx.rest.get<{ sobjects?: Array<{ name?: string }> }>('/sobjects');
    for (const s of all.sobjects ?? []) {
      const name = s.name ?? '';
      if (name.endsWith('__e')) platformEvents.push(name);
      else if (name.endsWith('ChangeEvent')) changeDataCapture.push(name);
    }
  } catch (e) {
    notes.push(`sObject list unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }

  let eventRelayConfigured = false;
  try {
    eventRelayConfigured = ((await ctx.soql.query('SELECT Id FROM EventRelayConfig LIMIT 1')).totalSize ?? 0) > 0;
  } catch {
    // Not queryable on orgs without the feature. Absence is the finding; no note needed.
  }

  return {
    apexClasses: await count(ctx, notes, 'ApexClass', 'SELECT COUNT(Id) FROM ApexClass'),
    apexTriggers: await count(ctx, notes, 'ApexTrigger', 'SELECT COUNT(Id) FROM ApexTrigger'),
    flows: await count(ctx, notes, 'FlowDefinition', 'SELECT COUNT(Id) FROM FlowDefinition'),
    lwc: await count(ctx, notes, 'LightningComponentBundle', 'SELECT COUNT(Id) FROM LightningComponentBundle'),
    aura: await count(ctx, notes, 'AuraDefinitionBundle', 'SELECT COUNT(Id) FROM AuraDefinitionBundle'),
    namedCredentials: await count(ctx, notes, 'NamedCredential', 'SELECT COUNT(Id) FROM NamedCredential'),
    externalDataSources: await count(ctx, notes, 'ExternalDataSource', 'SELECT COUNT(Id) FROM ExternalDataSource'),
    remoteSites: await count(ctx, notes, 'RemoteProxy', 'SELECT COUNT(Id) FROM RemoteProxy'),
    platformEvents: platformEvents.sort(),
    changeDataCapture: changeDataCapture.sort(),
    eventRelayConfigured,
  };
}
```

```ts
// src/anatomy/collectors/identity.ts
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm exec node --experimental-vm-modules node_modules/jest/bin/jest.js test/unit/anatomy/capabilities.test.ts test/unit/anatomy/identity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anatomy/collectors test/unit/anatomy
git commit -m "feat(anatomy): collect capabilities and identity posture without grading it"
```

---

### Task 6: Integration edges collector

The only collector with real logic. Reads named credentials, remote sites, Apex bodies and OmniStudio elements, and returns raw material for `resolveChains`.

**Files:**
- Create: `src/anatomy/collectors/integrationEdges.ts`
- Test: `test/unit/anatomy/integrationEdges.test.ts`

**Interfaces:**
- Consumes: `IntelContext`, `IntegrationEdge`, `RemoteActionRef` from `../attribute.js`
- Produces: `collectIntegrationEdges(ctx, notes): Promise<IntegrationEdgeInput>` where

```ts
export interface IntegrationEdgeInput {
  direct: IntegrationEdge[];
  remoteActions: RemoteActionRef[];
  apexCallouts: Map<string, string[]>;
  apexBodiesScanned: number;
  apexBodiesUnreadable: number;
  omniElementsScanned: number;
  omniProceduresTotal: number;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/anatomy/integrationEdges.test.ts
import { mockSoql, mockTooling } from '../helpers/mocks.js';
import { collectIntegrationEdges, extractCallouts, extractRestActionCredential } from '../../../src/anatomy/collectors/integrationEdges.js';

describe('extractCallouts', () => {
  it('finds every named credential referenced in a body', () => {
    expect(extractCallouts("x = 'callout:Payments_API/v1'; y='callout:Maps_API';")).toEqual([
      'Maps_API',
      'Payments_API',
    ]);
  });

  it('returns nothing for a body with no callouts', () => {
    expect(extractCallouts('Integer i = 1;')).toEqual([]);
  });
});

describe('extractRestActionCredential', () => {
  it('reads namedCredential out of a REST Action PropertySetConfig', () => {
    expect(extractRestActionCredential(JSON.stringify({ namedCredential: 'Payments_API', restMethod: 'GET' })))
      .toBe('Payments_API');
  });

  it('returns null for malformed config rather than throwing', () => {
    expect(extractRestActionCredential('{ not json')).toBeNull();
    expect(extractRestActionCredential(JSON.stringify({ restMethod: 'GET' }))).toBeNull();
  });
});

describe('collectIntegrationEdges', () => {
  it('counts unreadable Apex bodies instead of silently dropping them', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      { tooling: mockTooling([
          { test: (s) => s.includes('FROM ApexClass'), records: [
            { Id: '01p1', Name: 'A', Body: "callout:Payments_API" },
            { Id: '01p2', Name: 'B', Body: null },
          ] },
          { test: () => true, records: [] },
        ]),
        soql: mockSoql([{ test: () => true, records: [] }]) } as any,
      notes,
    );
    expect(out.apexBodiesScanned).toBe(1);
    expect(out.apexBodiesUnreadable).toBe(1);
    expect(out.apexCallouts.get('A')).toEqual(['Payments_API']);
  });

  it('does not fail the collector when OmniStudio is absent', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      { tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([{ test: (s) => s.includes('OmniProcessElement'), error: new Error("sObject type 'OmniProcessElement' is not supported") },
                        { test: () => true, records: [] }]) } as any,
      notes,
    );
    expect(out.remoteActions).toEqual([]);
    expect(out.omniElementsScanned).toBe(0);
    expect(notes.join(' ')).toContain('OmniStudio');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec node --experimental-vm-modules node_modules/jest/bin/jest.js test/unit/anatomy/integrationEdges.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/anatomy/collectors/integrationEdges.ts
// Every source of outbound-call evidence in one place.
//
// Apex bodies come through the Tooling API rather than source retrieve: retrieve returns only
// a fraction of classes on a real org because the rest live in managed and unlocked packages,
// while Tooling returns bodies for unlocked-package classes retrieve refuses.
//
// OmniStudio is read through the ordinary Data API. Tooling rejects OmniProcess outright.
import type { IntelContext } from '../../lib/wire.js';
import type { IntegrationEdge } from '../types.js';
import type { RemoteActionRef } from '../attribute.js';

export interface IntegrationEdgeInput {
  direct: IntegrationEdge[];
  remoteActions: RemoteActionRef[];
  apexCallouts: Map<string, string[]>;
  apexBodiesScanned: number;
  apexBodiesUnreadable: number;
  omniElementsScanned: number;
  omniProceduresTotal: number;
}

/** `callout:<name>` is the only confirmed outbound reference obtainable from a body. */
export function extractCallouts(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/callout:([A-Za-z0-9_]+)/g)) out.add(m[1]);
  return [...out].sort();
}

/** A REST Action element carries its credential as a plain field. No parsing required. */
export function extractRestActionCredential(config: string | null): string | null {
  if (!config) return null;
  try {
    const parsed = JSON.parse(config) as { namedCredential?: unknown };
    return typeof parsed.namedCredential === 'string' && parsed.namedCredential.length > 0
      ? parsed.namedCredential
      : null;
  } catch {
    return null;
  }
}

function remoteClassOf(config: string | null): string | null {
  if (!config) return null;
  try {
    const parsed = JSON.parse(config) as { remoteClass?: unknown };
    return typeof parsed.remoteClass === 'string' && parsed.remoteClass.length > 0 ? parsed.remoteClass : null;
  } catch {
    return null;
  }
}

export async function collectIntegrationEdges(
  ctx: IntelContext,
  notes: string[],
): Promise<IntegrationEdgeInput> {
  const direct: IntegrationEdge[] = [];
  const apexCallouts = new Map<string, string[]>();
  let apexBodiesScanned = 0;
  let apexBodiesUnreadable = 0;

  try {
    // ToolingClient.query resolves to T[] directly; there is no `.records` wrapper.
    const rows = await ctx.tooling.query<{ Name: string; Body: string | null }>(
      'SELECT Id, Name, Body FROM ApexClass WHERE NamespacePrefix = null ORDER BY Id',
    );
    for (const r of rows) {
      if (typeof r.Body !== 'string' || r.Body.length === 0) {
        apexBodiesUnreadable += 1;
        continue;
      }
      apexBodiesScanned += 1;
      const found = extractCallouts(r.Body);
      if (found.length > 0) apexCallouts.set(r.Name, found);
    }
  } catch (e) {
    notes.push(`Apex bodies could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }

  const remoteActions: RemoteActionRef[] = [];
  let omniElementsScanned = 0;
  let omniProceduresTotal = 0;
  try {
    const rows = await ctx.soql.queryAll<{
      Type: string;
      PropertySetConfig: string | null;
      OmniProcess?: { Name?: string };
    }>(
      "SELECT Type, PropertySetConfig, OmniProcess.Name FROM OmniProcessElement " +
        "WHERE OmniProcess.OmniProcessType = 'Integration Procedure' " +
        "AND Type IN ('REST Action', 'Remote Action') ORDER BY Id",
    );
    omniElementsScanned = rows.length;
    const procedures = new Set<string>();
    for (const r of rows) {
      const owner = r.OmniProcess?.Name ?? 'unknown';
      procedures.add(owner);
      if (r.Type === 'REST Action') {
        const credential = extractRestActionCredential(r.PropertySetConfig);
        if (credential) {
          direct.push({
            endpoint: credential,
            from: null,
            via: [{ type: 'OmniProcess', name: owner }],
            detection: 'namedCredential',
            attribution: 'unattributed',
          });
        }
      } else {
        const remoteClass = remoteClassOf(r.PropertySetConfig);
        if (remoteClass) remoteActions.push({ omniProcess: owner, remoteClass });
      }
    }
    omniProceduresTotal = procedures.size;
  } catch (e) {
    notes.push(`OmniStudio integration elements could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }

  direct.sort((a, b) => String(a.endpoint).localeCompare(String(b.endpoint)));
  remoteActions.sort((a, b) => a.omniProcess.localeCompare(b.omniProcess) || a.remoteClass.localeCompare(b.remoteClass));

  return {
    direct,
    remoteActions,
    apexCallouts,
    apexBodiesScanned,
    apexBodiesUnreadable,
    omniElementsScanned,
    omniProceduresTotal,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec node --experimental-vm-modules node_modules/jest/bin/jest.js test/unit/anatomy/integrationEdges.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anatomy/collectors/integrationEdges.ts test/unit/anatomy/integrationEdges.test.ts
git commit -m "feat(anatomy): collect integration evidence from Apex and OmniStudio"
```

---

### Task 7: Orchestrator

**Files:**
- Create: `src/anatomy/runAnatomy.ts`
- Test: `test/unit/anatomy/runAnatomy.test.ts`

**Interfaces:**
- Consumes: every collector, `buildPrefixRegistry`, `resolveChains`, `attributeEdges`
- Produces: `runAnatomy(ctx: IntelContext, provenance: AnatomyProvenance): Promise<AnatomyArtifact>` where
  `AnatomyProvenance = { generatedAt: string; orgId: string; toolVersion: string; apiVersion: string }`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/anatomy/runAnatomy.test.ts
import { mockSoql, mockTooling, mockRest } from '../helpers/mocks.js';
import { runAnatomy } from '../../../src/anatomy/runAnatomy.js';

const emptyCtx = (): any => ({
  soql: mockSoql([{ test: () => true, records: [], totalSize: 0 }]),
  tooling: mockTooling([{ test: () => true, records: [], totalSize: 0 }]),
  rest: mockRest([{ path: /sobjects/, body: { sobjects: [] } }]),
  metadata: { list: async () => [] },
});

const prov = { generatedAt: '2026-08-05T00:00:00Z', orgId: '00Dxx0000000000EAA', toolVersion: '0.1.0', apiVersion: '62.0' };

describe('runAnatomy', () => {
  it('produces a complete artifact for an org that yields nothing', async () => {
    const a = await runAnatomy(emptyCtx(), prov);
    expect(a.version).toBe(1);
    expect(a.products).toEqual([]);
    expect(a.edges).toEqual([]);
    expect(a.capabilities.eventRelayConfigured).toBe(false);
    expect(a.coverage).toMatchObject({ apexBodiesScanned: 0, prefixesUnresolved: [] });
  });

  it('is byte-identical across two runs on the same input', async () => {
    const one = await runAnatomy(emptyCtx(), prov);
    const two = await runAnatomy(emptyCtx(), prov);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  it('never throws when every read fails', async () => {
    const broken = (): any => ({
      soql: mockSoql([{ test: () => true, error: new Error('denied') }]),
      tooling: mockTooling([{ test: () => true, error: new Error('denied') }]),
      rest: mockRest([]),
      metadata: { list: async () => { throw new Error('denied'); } },
    });
    const a = await runAnatomy(broken(), prov);
    expect(a.coverage.notes.length).toBeGreaterThan(0);
    expect(a.version).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec node --experimental-vm-modules node_modules/jest/bin/jest.js test/unit/anatomy/runAnatomy.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/anatomy/runAnatomy.ts
// Assembles the artifact. Collectors run first and independently, then the pure functions
// turn their raw output into products and attributed edges. Nothing here throws: an org that
// yields little produces a small, honest artifact rather than a failed command.
import type { IntelContext } from '../lib/wire.js';
import type { AnatomyArtifact } from './types.js';
import { buildPrefixRegistry } from './prefixRegistry.js';
import { attributeEdges, resolveChains } from './attribute.js';
import { collectProducts } from './collectors/products.js';
import { collectPersonas } from './collectors/personas.js';
import { collectChannels } from './collectors/channels.js';
import { collectCapabilities } from './collectors/capabilities.js';
import { collectIdentity } from './collectors/identity.js';
import { collectIntegrationEdges } from './collectors/integrationEdges.js';

export interface AnatomyProvenance {
  generatedAt: string;
  orgId: string;
  toolVersion: string;
  apiVersion: string;
}

export async function runAnatomy(
  ctx: IntelContext,
  provenance: AnatomyProvenance,
): Promise<AnatomyArtifact> {
  const notes: string[] = [];

  const sources = await collectProducts(ctx, notes);
  const personas = await collectPersonas(ctx, notes);
  const channels = await collectChannels(ctx, notes);
  const capabilities = await collectCapabilities(ctx, notes);
  const identity = await collectIdentity(ctx, notes);
  const evidence = await collectIntegrationEdges(ctx, notes);

  // Component names for the registry: the classes we could read plus their callers.
  const componentNames = [...evidence.apexCallouts.keys()].sort();
  const registry = buildPrefixRegistry(componentNames, sources);

  const chained = resolveChains(evidence.remoteActions, evidence.apexCallouts);
  const edges = attributeEdges([...evidence.direct, ...chained], registry).sort(
    (a, b) =>
      String(a.endpoint).localeCompare(String(b.endpoint)) ||
      String(a.via[0]?.name).localeCompare(String(b.via[0]?.name)),
  );

  return {
    version: 1,
    provenance,
    products: registry.products,
    personas,
    channels,
    capabilities,
    identity,
    edges,
    coverage: {
      apexBodiesScanned: evidence.apexBodiesScanned,
      apexBodiesUnreadable: evidence.apexBodiesUnreadable,
      omniElementsScanned: evidence.omniElementsScanned,
      omniProceduresTotal: evidence.omniProceduresTotal,
      prefixesUnresolved: registry.unresolved,
      notes: notes.slice().sort(),
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec node --experimental-vm-modules node_modules/jest/bin/jest.js test/unit/anatomy/runAnatomy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anatomy/runAnatomy.ts test/unit/anatomy/runAnatomy.test.ts
git commit -m "feat(anatomy): assemble the artifact from collectors and pure attribution"
```

---

### Task 8: The command

**Files:**
- Create: `src/commands/intel/anatomy.ts`
- Modify: `src/index.ts` if it re-exports command types (check first; add nothing if it does not)
- Test: `test/unit/anatomy/command.test.ts`

**Interfaces:**
- Consumes: `runAnatomy`, `buildAuditContext`/`resolveOrgInfo` equivalents from `../../lib/wire.js`, `TOOL_VERSION` and `API_VERSION` from `../../version.js`
- Produces: default-exported oclif command class `IntelAnatomyCommand`

Read `src/commands/intel/map.ts` first and mirror its structure: same flag names, same context wiring, same summary style.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/anatomy/command.test.ts
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeArtifact } from '../../../src/commands/intel/anatomy.js';

describe('writeArtifact', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'anatomy-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes anatomy.json and returns its path', () => {
    const artifact = { version: 1, edges: [] } as any;
    const p = writeArtifact(dir, artifact);
    expect(p).toBe(join(dir, 'anatomy.json'));
    expect(JSON.parse(readFileSync(p, 'utf-8'))).toEqual(artifact);
  });

  it('writes stable JSON, so two runs of the same artifact diff cleanly', () => {
    const artifact = { version: 1, edges: [] } as any;
    const a = readFileSync(writeArtifact(dir, artifact), 'utf-8');
    const b = readFileSync(writeArtifact(dir, artifact), 'utf-8');
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec node --experimental-vm-modules node_modules/jest/bin/jest.js test/unit/anatomy/command.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the command**

Mirror `src/commands/intel/map.ts`. Flags: `--target-org` (required), `--output` (default `.`), `--json`. No `--html` in this plan; View A is a later plan.

```ts
// src/commands/intel/anatomy.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { buildAuditContext, resolveOrgInfo } from '../../lib/wire.js';
import { runAnatomy } from '../../anatomy/runAnatomy.js';
import type { AnatomyArtifact } from '../../anatomy/types.js';
import { TOOL_VERSION, API_VERSION } from '../../version.js';

/** Two spaces and a trailing newline, so consecutive runs diff cleanly in git. */
export function writeArtifact(outputDir: string, artifact: AnatomyArtifact): string {
  mkdirSync(outputDir, { recursive: true });
  const path = join(outputDir, 'anatomy.json');
  writeFileSync(path, JSON.stringify(artifact, null, 2) + '\n', 'utf-8');
  return path;
}

export default class IntelAnatomyCommand extends SfCommand<AnatomyArtifact> {
  public static summary = 'Map the org one level above coupling: products, personas, channels and integrations';
  public static description =
    'Collects what products live in the org, who uses it on what licence, what it integrates with, and how ' +
    'people authenticate. Every integration edge records how it was detected and, separately, how it was ' +
    'attributed to a product, so a confirmed call with an unknown owner is reported as exactly that. ' +
    'Read-only and deterministic: same org in, same anatomy.json out.';
  public static examples = ['<%= config.bin %> <%= command.id %> --target-org myOrg'];

  public static flags = {
    'target-org': Flags.requiredOrg(),
    output: Flags.string({
      char: 'o',
      default: '.',
      summary: 'Directory to write anatomy.json to.',
    }),
  };

  public async run(): Promise<AnatomyArtifact> {
    const { flags } = await this.parse(IntelAnatomyCommand);
    const conn = flags['target-org'].getConnection(API_VERSION) as never;
    const orgInfo = await resolveOrgInfo(conn);
    const ctx = buildAuditContext(conn, orgInfo);

    const artifact = await runAnatomy(ctx, {
      generatedAt: new Date().toISOString(),
      orgId: orgInfo.id,
      toolVersion: TOOL_VERSION,
      apiVersion: API_VERSION,
    });

    const path = writeArtifact(flags.output, artifact);

    this.log('');
    this.log(`  Products: ${artifact.products.length}   Personas: ${artifact.personas.length}`);
    this.log(`  Integration edges: ${artifact.edges.length}`);
    const unattributed = artifact.edges.filter((e) => e.attribution === 'unattributed').length;
    this.log(`  Unattributed: ${unattributed} of ${artifact.edges.length}`);
    this.log(`  Apex bodies: ${artifact.coverage.apexBodiesScanned} scanned, ${artifact.coverage.apexBodiesUnreadable} unreadable`);
    if (artifact.coverage.prefixesUnresolved.length > 0) {
      this.log(`  Prefixes with no product source: ${artifact.coverage.prefixesUnresolved.join(', ')}`);
    }
    for (const note of artifact.coverage.notes) this.log(`  note: ${note}`);
    this.log(`  Saved to: ${path}`);

    return artifact;
  }
}
```

- [ ] **Step 4: Run the full suite and build**

Run: `pnpm build && pnpm test`
Expected: build clean, all suites pass including both invariant tests.

- [ ] **Step 5: Verify the command is discoverable**

Run: `sf intel anatomy --help`
Expected: summary and flags print. If the plugin is not linked, run `sf plugins link .` first.

- [ ] **Step 6: Commit**

```bash
git add src/commands/intel/anatomy.ts test/unit/anatomy/command.test.ts
git commit -m "feat(anatomy): add the sf intel anatomy command"
```

---

### Task 9: Live verification against a sandbox

Not optional. Every defect found in this codebase over the last week came from running against a real org, not from a unit test.

**Files:**
- Modify: `docs/ANATOMY_SPEC.md` (record measured results in section 2 if they differ)

- [ ] **Step 1: Run against a sandbox, never production first**

```bash
sf intel anatomy --target-org <sandbox-alias> --output /tmp/anatomy-check
```

Expected: exits 0. Inspect `anatomy.json`.

- [ ] **Step 2: Confirm determinism**

```bash
sf intel anatomy --target-org <sandbox-alias> --output /tmp/anatomy-check-2
diff <(jq 'del(.provenance.generatedAt)' /tmp/anatomy-check/anatomy.json) \
     <(jq 'del(.provenance.generatedAt)' /tmp/anatomy-check-2/anatomy.json)
```

Expected: no output. Any difference is a sorting bug; fix it before continuing.

- [ ] **Step 3: Confirm the registry behaves as designed**

Check that `coverage.prefixesUnresolved` is populated rather than empty, and that no entry in `products` is an infrastructure namespace. A product named `LOG` or `TRIGGER` means the denylist is not working.

- [ ] **Step 4: Repeat against a second org**

Acceptance criterion 5. The registry heuristic was measured on three orgs and resolves roughly half its candidates; confirm the shape holds before trusting it.

- [ ] **Step 5: Delete the generated artifacts**

```bash
rm -rf /tmp/anatomy-check /tmp/anatomy-check-2
```

They contain real product names, user counts and endpoints.

- [ ] **Step 6: Commit any spec corrections**

```bash
git add docs/ANATOMY_SPEC.md
git commit -m "docs: record measured anatomy results from live verification"
```

---

## Self-Review

**Spec coverage.** Section 4 artifact is Task 1. Section 4.1 two axes is Tasks 1 and 3. Section 5 collectors are Tasks 4, 5, 6. Section 5.1 Apex via Tooling is Task 6. Section 5.2 OmniStudio is Task 6. Section 5.3 registry is Task 2. Section 7 error handling is spread across every collector and asserted in Task 7. Section 8 testing is inline in each task. Section 9 acceptance is Task 9. Section 6, View A, is deliberately out of scope for this plan.

**Gaps carried forward, deliberately:** `personas[].landingApp` is typed and always `null` in this plan; `UserAppInfo` joins land with View A, which is the only consumer. `Capabilities` counts flows and Apex equally, which the spec lists as an open question. `channels` covers sites only; apps and consoles land with View A.

**Type consistency.** `RemoteActionRef` is defined in `attribute.ts` (Task 3) and imported by `integrationEdges.ts` (Task 6). `IntegrationEdgeInput` is defined in Task 6 and consumed in Task 7. `PrefixRegistry` is defined in Task 1 and produced in Task 2. `buildPrefixRegistry` takes `(componentNames, sources)` in both its definition and its call site.

**Placeholders.** None. Every code step contains the actual implementation.
