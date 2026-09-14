// anatomy's half of one canonical graph. It emits only kinds sf-orgintel owns; everything it
// knows about an object, a profile or the org itself travels as a namespaced contribution,
// because those nodes belong to sf-orgviz. See sf-orgviz/docs/CONVERGENCE_SPEC.md 3.3 and 4.2.
import { describe, it, expect } from '@jest/globals';
import { ownerOfKind, isKnownGraphKind, type GraphNodeKind } from '@cclabsnz/sf-core';
import { buildAnatomyFragment } from '../../../src/anatomy/fragment.js';
import { input } from './fixtures/input.js';

const fragment = () => buildAnatomyFragment(input());

describe('buildAnatomyFragment', () => {
  it('names sf-orgintel as its producer', () => {
    expect(fragment().producer).toBe('orgintel');
  });

  it('emits only kinds sf-orgintel owns', () => {
    for (const n of fragment().nodes) {
      expect(isKnownGraphKind(n.kind)).toBe(true);
      expect(ownerOfKind(n.kind as GraphNodeKind)).toBe('orgintel');
    }
  });

  it('emits no node for an entity another producer owns', () => {
    // Objects, profiles and the org itself are sf-orgviz's. A fragment emitting one is refused
    // by the merge on ownership, which would take the whole graph with it.
    const ids = fragment().nodes.map((n) => n.id);
    expect(ids.filter((id) => /^(obj|profile|org)\./.test(id))).toEqual([]);
  });

  it('marks products as derived, with a rule naming what mined them', () => {
    // A product is not declared anywhere in the org -- it is inferred from component name
    // prefixes. Calling that metadata would present an inference as an observation.
    for (const n of fragment().nodes.filter((x) => x.kind === 'product')) {
      expect(n.provenance.source).toBe('derived');
      expect(n.provenance.rule).toBeTruthy();
    }
  });

  it('contributes persona measurements to the profile node that already exists', () => {
    const c = (fragment().contributions ?? []).filter((x) => x.nodeId.startsWith('profile.'));
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].attrs).toHaveProperty('activeUsers');
  });

  it('contributes org-wide counts to org.root rather than inventing a node for them', () => {
    const org = (fragment().contributions ?? []).filter((x) => x.nodeId === 'org.root');
    expect(org).toHaveLength(1);
    expect(org[0].attrs).toHaveProperty('lwc');
    expect(org[0].attrs).toHaveProperty('loginsByType');
  });

  it('emits nodes, edges and contributions in a fixed order', () => {
    // Asserted as sortedness, not as two runs agreeing: identical inputs iterate identically in
    // one process, so a two-run comparison passes with every sort removed.
    const f = fragment();
    const ids = f.nodes.map((n) => n.id);
    expect(ids).toEqual([...ids].sort());
    const contribs = (f.contributions ?? []).map((c) => c.nodeId);
    expect(contribs).toEqual([...contribs].sort());
  });

  it('never targets an integration edge at an id no producer emits', () => {
    // sf-orgviz writes named credentials as `ncred.<DeveloperName>` (src/extract/landscape.ts),
    // not `namedCredential.<endpoint>` -- `endpoint` is frequently a URL, not the DeveloperName
    // the owning producer keys on. An edge built on the wrong id/prefix never resolves, on every
    // real run, which is a permanently broken graph rather than the designed "unresolved until
    // merged" state.
    const f = fragment();
    expect(f.edges.length).toBeGreaterThan(0);
    for (const e of f.edges) {
      expect(e.from.startsWith('product.')).toBe(true);
      expect(e.to.startsWith('ncred.')).toBe(true);
    }
  });

  it('records every integration edge it declines to emit, never silently', () => {
    // Absence is data (CONVERGENCE_SPEC.md 3.2): an edge dropped for lack of a resolvable
    // endpoint must show up in this fragment's own coverage, not vanish as if it never existed.
    const unavailable = fragment().coverage.unavailable;
    const scopes = unavailable.map((u) => u.scope);
    expect(scopes).toContain('anatomy.edges.unattributed');
    expect(scopes).toContain('anatomy.edges.remoteProxy');
    expect(scopes).toContain('anatomy.edges.unresolvedTarget');
    for (const u of unavailable) {
      expect(u.reason).toBe('deferred');
      expect(u.detail.length).toBeGreaterThan(0);
    }
  });

  describe('ssoConfig/site node ids (finding 1: collision destroys the whole merged graph)', () => {
    it('gives two issuer-less, same-type SSO configs distinct node ids from distinct keys', () => {
      const base = input();
      const f = buildAnatomyFragment({
        ...base,
        identity: {
          ...base.identity,
          ssoConfigs: [
            { type: 'saml', issuer: null, identityMapping: null, userProvisioning: false },
            { type: 'saml', issuer: null, identityMapping: null, userProvisioning: false },
          ],
        },
        ssoConfigKeys: ['Internal_IdP', 'Experience_Cloud_IdP'],
      });
      const ids = f.nodes.filter((n) => n.kind === 'ssoConfig').map((n) => n.id);
      expect(ids).toEqual(['ssoConfig.Experience_Cloud_IdP', 'ssoConfig.Internal_IdP']);
    });

    it('collapses two SSO configs onto one node, never two nodes sharing an id, when their keys still collide', () => {
      const base = input();
      const f = buildAnatomyFragment({
        ...base,
        identity: {
          ...base.identity,
          ssoConfigs: [
            { type: 'saml', issuer: null, identityMapping: null, userProvisioning: false },
            { type: 'saml', issuer: null, identityMapping: null, userProvisioning: false },
          ],
        },
        ssoConfigKeys: ['', ''],
      });
      const ssoNodes = f.nodes.filter((n) => n.kind === 'ssoConfig');
      const ids = ssoNodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ssoNodes).toHaveLength(1);
      expect(f.coverage.unavailable.map((u) => u.scope)).toContain('anatomy.identity.ssoConfigIdCollision');
    });

    it('gives two unnamed sites distinct node ids from distinct keys', () => {
      const base = input();
      const f = buildAnatomyFragment({
        ...base,
        channels: [
          { type: 'site', name: 'unknown', status: 'Active' },
          { type: 'site', name: 'unknown', status: 'Active' },
        ],
        channelKeys: ['First_Unnamed_Site', 'Second_Unnamed_Site'],
      });
      const ids = f.nodes.filter((n) => n.kind === 'site').map((n) => n.id);
      expect(ids).toEqual(['site.First_Unnamed_Site', 'site.Second_Unnamed_Site']);
    });

    it('collapses two sites onto one node, never two nodes sharing an id, when their keys still collide', () => {
      const base = input();
      const f = buildAnatomyFragment({
        ...base,
        channels: [
          { type: 'site', name: 'unknown', status: 'Active' },
          { type: 'site', name: 'unknown', status: 'Active' },
        ],
        channelKeys: ['', ''],
      });
      const siteNodes = f.nodes.filter((n) => n.kind === 'site');
      const ids = siteNodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(siteNodes).toHaveLength(1);
      expect(f.coverage.unavailable.map((u) => u.scope)).toContain('anatomy.channels.idCollision');
    });
  });

  describe('changeDataCapture contributions (finding 2: CDC must target the base object)', () => {
    it('maps a standard change event name back to its object', () => {
      const f = buildAnatomyFragment({
        ...input(),
        capabilities: { ...input().capabilities, changeDataCapture: ['AccountChangeEvent'] },
      });
      const c = (f.contributions ?? []).find((x) => x.nodeId === 'obj.Account');
      expect(c).toBeDefined();
      expect(c!.attrs).toEqual({ changeDataCapture: true });
      // Never the tautological target the bug produced.
      expect((f.contributions ?? []).some((x) => x.nodeId === 'obj.AccountChangeEvent')).toBe(false);
    });

    it('maps a custom change event name back to its __c object', () => {
      const f = buildAnatomyFragment({
        ...input(),
        capabilities: { ...input().capabilities, changeDataCapture: ['Order__ChangeEvent'] },
      });
      const c = (f.contributions ?? []).find((x) => x.nodeId === 'obj.Order__c');
      expect(c).toBeDefined();
      expect(c!.attrs).toEqual({ changeDataCapture: true });
    });

    it('drops a change-data-capture entity matching neither naming shape, recorded, not silently', () => {
      const f = buildAnatomyFragment({
        ...input(),
        capabilities: { ...input().capabilities, changeDataCapture: ['NotAChangeEventName'] },
      });
      expect((f.contributions ?? []).some((x) => x.nodeId.includes('NotAChangeEventName'))).toBe(false);
      expect(f.coverage.unavailable.map((u) => u.scope)).toContain(
        'anatomy.capabilities.changeDataCaptureUnrecognized',
      );
    });
  });

  describe('integration edge de-duplication (finding 4: identical edges emitted repeatedly)', () => {
    it('collapses two edges sharing from/to/kind into one, carrying both endpoints as evidence', () => {
      const base = input();
      const f = buildAnatomyFragment({
        ...base,
        edges: [
          {
            endpoint: 'https://acme-erp.example.invalid/api/v1',
            from: 'acme',
            via: [{ type: 'ApexClass', name: 'AcmeOrderSync' }, { type: 'NamedCredential', name: 'Acme_ERP_Cred' }],
            detection: 'apexCallout',
            attribution: 'prefixMatch',
          },
          {
            endpoint: 'https://acme-erp.example.invalid/api/v2',
            from: 'acme',
            via: [{ type: 'ApexClass', name: 'AcmeInvoiceBuilder' }, { type: 'NamedCredential', name: 'Acme_ERP_Cred' }],
            detection: 'apexCallout',
            attribution: 'prefixMatch',
          },
        ],
      });
      expect(f.edges).toHaveLength(1);
      const edge = f.edges[0];
      expect(edge.from).toBe('product.acme');
      expect(edge.to).toBe('ncred.Acme_ERP_Cred');
      expect(edge.attrs.endpoints).toEqual([
        'https://acme-erp.example.invalid/api/v1',
        'https://acme-erp.example.invalid/api/v2',
      ]);
      // Both call sites are still visible, not collapsed away.
      expect(edge.attrs.via).toEqual([
        [
          { type: 'ApexClass', name: 'AcmeInvoiceBuilder' },
          { type: 'NamedCredential', name: 'Acme_ERP_Cred' },
        ],
        [
          { type: 'ApexClass', name: 'AcmeOrderSync' },
          { type: 'NamedCredential', name: 'Acme_ERP_Cred' },
        ],
      ]);
    });
  });
});
