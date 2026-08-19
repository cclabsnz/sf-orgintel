import { renderStrataViewer } from '../../../src/report/strataViewer.js';
import type { CouplingGraph } from '@cclabsnz/sf-core';

const graph = (objectName: string): CouplingGraph =>
  ({
    version: 1,
    provenance: { generatedAt: '2026-08-12T00:00:00Z', orgId: '00Dxx0000000000EAA' },
    nodes: [{ object: objectName, layer: 'business' }, { object: 'Account', layer: 'business' }],
    edges: [{ from: objectName, to: 'Account', weight: 1, operations: [], components: [] }],
  }) as unknown as CouplingGraph;

describe('renderStrataViewer payload', () => {
  it('cannot be closed early by a string in the data', () => {
    // The payload goes inside <script type="application/json">, and JSON.stringify escapes
    // neither `<` nor `/`. A value containing a closing script tag would end the element and
    // everything after it would be parsed as markup, in a file written to be sent to a client.
    // Salesforce API names cannot contain `<` today, so this is the guard rather than the cure:
    // it has to hold for whatever field is added to the payload next.
    const html = renderStrataViewer({
      couplingGraph: graph('</script><img src=x onerror=alert(1)>'),
      objects: ['</script><img src=x onerror=alert(1)>', 'Account'],
    });
    expect(html).not.toContain('</script><img');
    expect(html).toContain('\\u003c');
  });

  it('still parses as JSON after escaping, and round-trips the value intact', () => {
    // Escaping must not corrupt the data: `<` is a valid JSON escape for `<`, so the
    // browser's JSON.parse returns exactly the original string.
    const name = 'Weird<Object>';
    const html = renderStrataViewer({ couplingGraph: graph(name), objects: [name, 'Account'] });
    const payload = /<script type="application\/json" data-strata>(.*?)<\/script>/s.exec(html)?.[1];
    expect(payload).toBeDefined();
    const parsed = JSON.parse(payload!) as { nodes: Array<{ object: string }> };
    expect(parsed.nodes.map((n) => n.object)).toContain(name);
  });
});
