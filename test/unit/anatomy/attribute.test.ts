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
