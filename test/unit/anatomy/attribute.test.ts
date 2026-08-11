// test/unit/anatomy/attribute.test.ts
import { addEndpointOnlyEdges, attributeEdges, resolveChains } from '../../../src/anatomy/attribute.js';
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

  it('gives sibling edges their own via array, so mutating one cannot corrupt the others', () => {
    // A shared array instance across edges emitted for the same class would let a later
    // enrichment pass that appends a hop to one edge silently rewrite every sibling's chain.
    const out = resolveChains(
      [{ omniProcess: 'P', remoteClass: 'C' }],
      new Map([['C', ['A_API', 'B_API']]]),
    );
    expect(out[0].via).not.toBe(out[1].via);
    expect(out[0].via).toEqual(out[1].via);
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

  it('does not let output edges alias the via array of their input edge', () => {
    // A shallow spread of the input edge would otherwise carry the same via array reference
    // straight into the output, so mutating the output's via would corrupt the input's too.
    const input = [edge({ via: [{ type: 'ApexClass', name: 'ACME_X' }] })];
    const [out] = attributeEdges(input, registry([['ACME', 'ACME']]));
    expect(out.via).not.toBe(input[0].via);
    expect(out.via).toEqual(input[0].via);
  });
});

describe('addEndpointOnlyEdges', () => {
  it('emits an endpointOnly edge for a named credential referenced by nothing', () => {
    const out = addEndpointOnlyEdges([], ['Orphan_API'], []);
    expect(out).toEqual([
      {
        endpoint: 'Orphan_API',
        from: null,
        via: [{ type: 'NamedCredential', name: 'Orphan_API' }],
        detection: 'endpointOnly',
        attribution: 'unattributed',
      },
    ]);
  });

  it('emits an endpointOnly edge for a remote site referenced by nothing', () => {
    const out = addEndpointOnlyEdges([], [], ['Legacy_Site']);
    expect(out).toEqual([
      {
        endpoint: 'Legacy_Site',
        from: null,
        via: [{ type: 'RemoteProxy', name: 'Legacy_Site' }],
        detection: 'endpointOnly',
        attribution: 'unattributed',
      },
    ]);
  });

  it('does not duplicate a named credential already referenced by a REST Action', () => {
    const existing = edge({
      endpoint: 'Payments_API',
      via: [{ type: 'OmniProcess', name: 'ACME_GetThing' }],
      detection: 'namedCredential',
    });
    const out = addEndpointOnlyEdges([existing], ['Payments_API'], []);
    expect(out).toEqual([existing]);
    expect(out.filter((e) => e.detection === 'endpointOnly')).toHaveLength(0);
  });

  it('does not duplicate a named credential already reached by an apexCallout or remoteActionChain edge', () => {
    const apexEdge = edge({ endpoint: 'Payments_API', detection: 'apexCallout' });
    const chainEdge = edge({ endpoint: 'Maps_API', detection: 'remoteActionChain' });
    const out = addEndpointOnlyEdges([apexEdge, chainEdge], ['Payments_API', 'Maps_API'], []);
    expect(out).toEqual([apexEdge, chainEdge]);
  });

  it('keys dedupe by type and name, so a RemoteProxy is not suppressed by an unrelated apexCallout/remoteActionChain endpoint of the same name', () => {
    // Both an apexCallout and a NamedCredential-style endpoint are, per the spec, ultimately
    // NamedCredential references. A RemoteProxy (Remote Site Setting) is a different
    // configuration object entirely, and can coincidentally share a name with one without
    // being the same resource. A flat name-only dedupe would wrongly drop the real
    // RemoteProxy edge; keying by type and name must not.
    const apexEdge = edge({ endpoint: 'Payments_API', detection: 'apexCallout' });
    const chainEdge = edge({ endpoint: 'Maps_API', detection: 'remoteActionChain' });
    const out = addEndpointOnlyEdges([apexEdge, chainEdge], [], ['Payments_API', 'Maps_API']);
    expect(out).toEqual([
      apexEdge,
      chainEdge,
      {
        endpoint: 'Payments_API',
        from: null,
        via: [{ type: 'RemoteProxy', name: 'Payments_API' }],
        detection: 'endpointOnly',
        attribution: 'unattributed',
      },
      {
        endpoint: 'Maps_API',
        from: null,
        via: [{ type: 'RemoteProxy', name: 'Maps_API' }],
        detection: 'endpointOnly',
        attribution: 'unattributed',
      },
    ]);
  });

  it('still suppresses a RemoteProxy edge when a prior endpointOnly RemoteProxy edge already names it', () => {
    const existing = edge({
      endpoint: 'Legacy_Site',
      via: [{ type: 'RemoteProxy', name: 'Legacy_Site' }],
      detection: 'endpointOnly',
    });
    const out = addEndpointOnlyEdges([existing], [], ['Legacy_Site']);
    expect(out).toEqual([existing]);
  });
});
