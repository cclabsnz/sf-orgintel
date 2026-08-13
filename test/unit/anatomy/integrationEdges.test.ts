import { mockSoql, mockTooling, mockIntelContext } from '../helpers/mocks.js';
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
      mockIntelContext({ tooling: mockTooling([
          { test: (s) => s.includes('FROM ApexClass'), records: [
            { Id: '01p1', Name: 'A', Body: "callout:Payments_API" },
            { Id: '01p2', Name: 'B', Body: null },
          ] },
          { test: () => true, records: [] },
        ]),
        soql: mockSoql([{ test: () => true, records: [] }]) }),
      notes,
    );
    expect(out.apexBodiesScanned).toBe(1);
    expect(out.apexBodiesUnreadable).toBe(1);
    expect(out.apexCallouts.get('A')).toEqual(['Payments_API']);
  });

  it('does not fail the collector when OmniStudio is absent', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([{ test: (s) => s.includes('OmniProcessElement'), error: new Error("sObject type 'OmniProcessElement' is not supported") },
                        { test: () => true, records: [] }]) }),
      notes,
    );
    expect(out.remoteActions).toEqual([]);
    expect(out.omniElementsScanned).toBe(0);
    expect(notes.join(' ')).toContain('OmniStudio');
  });

  it('emits an apexCallout edge for a callout with no OmniStudio reference to its class', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([
          { test: (s) => s.includes('FROM ApexClass'), records: [
            { Id: '01p1', Name: 'OrphanService', Body: 'callout:Payments_API' },
          ] },
          { test: () => true, records: [] },
        ]),
        soql: mockSoql([{ test: () => true, records: [] }]) }),
      notes,
    );
    expect(out.direct).toContainEqual({
      endpoint: 'Payments_API',
      from: null,
      via: [{ type: 'ApexClass', name: 'OrphanService' }],
      detection: 'apexCallout',
      attribution: 'unattributed',
    });
  });

  it('reads NamedCredential and RemoteProxy names for endpointOnly detection', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([
          { test: (s) => s.includes('FROM ApexClass'), records: [] },
          { test: (s) => s.includes('FROM NamedCredential'), records: [{ DeveloperName: 'Payments_API' }] },
          { test: (s) => s.includes('FROM RemoteProxy'), records: [{ SiteName: 'Legacy_Site' }] },
        ]),
        soql: mockSoql([{ test: () => true, records: [] }]) }),
      notes,
    );
    expect(out.namedCredentials).toEqual(['Payments_API']);
    expect(out.remoteProxies).toEqual(['Legacy_Site']);
  });

  it('records a note rather than throwing when NamedCredential or RemoteProxy cannot be read', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([
          { test: (s) => s.includes('FROM ApexClass'), records: [] },
          { test: (s) => s.includes('FROM NamedCredential'), error: new Error('INSUFFICIENT_ACCESS') },
          { test: (s) => s.includes('FROM RemoteProxy'), error: new Error('INSUFFICIENT_ACCESS') },
        ]),
        soql: mockSoql([{ test: () => true, records: [] }]) }),
      notes,
    );
    expect(out.namedCredentials).toEqual([]);
    expect(out.remoteProxies).toEqual([]);
    expect(notes.join(' ')).toContain('Named credentials');
    expect(notes.join(' ')).toContain('Remote site settings');
  });

  it('matches the platform casing "Rest Action" and produces a namedCredential edge', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([
          { test: (s) => s.includes('OmniProcessElement'), records: [
            {
              Type: 'Rest Action',
              PropertySetConfig: JSON.stringify({ namedCredential: 'Payments_API' }),
              OmniProcess: { Name: 'ACME_GetThing' },
            },
          ] },
          { test: () => true, records: [] },
        ]) }),
      notes,
    );
    expect(out.direct).toContainEqual({
      endpoint: 'Payments_API',
      from: null,
      via: [{ type: 'OmniProcess', name: 'ACME_GetThing' }],
      detection: 'namedCredential',
      attribution: 'unattributed',
    });
    expect(out.remoteActions).toEqual([]);
  });

  it('still chains a "Remote Action" element to its class', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([
          { test: (s) => s.includes('OmniProcessElement'), records: [
            {
              Type: 'Remote Action',
              PropertySetConfig: JSON.stringify({ remoteClass: 'ACME_Service' }),
              OmniProcess: { Name: 'ACME_GetThing' },
            },
          ] },
          { test: () => true, records: [] },
        ]) }),
      notes,
    );
    expect(out.remoteActions).toEqual([{ omniProcess: 'ACME_GetThing', remoteClass: 'ACME_Service' }]);
  });

  it('emits an endpointOnly edge with endpoint: null for a REST Action whose config carries no namedCredential', async () => {
    // On a live org three of thirteen REST Actions took this path: reported as scanned,
    // actually discarded. The evidence must survive with its via hop intact, and it must not
    // be labelled `namedCredential`, which asserts a named endpoint was found when none was.
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([
          { test: (s) => s.includes('OmniProcessElement'), records: [
            {
              Type: 'Rest Action',
              PropertySetConfig: JSON.stringify({ restMethod: 'GET' }),
              OmniProcess: { Id: '0ax1', Name: 'ACME_GetThing' },
            },
          ] },
          { test: () => true, records: [] },
        ]) }),
      notes,
    );
    expect(out.omniElementsScanned).toBe(1);
    expect(out.direct).toContainEqual({
      endpoint: null,
      from: null,
      via: [{ type: 'OmniProcess', name: 'ACME_GetThing' }],
      detection: 'endpointOnly',
      attribution: 'unattributed',
    });
  });

  it('still emits a namedCredential edge when a REST Action config carries a credential', async () => {
    // Pins the boundary against the endpointOnly fix above: a REST Action that does name a
    // credential must keep detection: namedCredential, not fall through to endpointOnly.
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([
          { test: (s) => s.includes('OmniProcessElement'), records: [
            {
              Type: 'Rest Action',
              PropertySetConfig: JSON.stringify({ namedCredential: 'Payments_API' }),
              OmniProcess: { Id: '0ax1', Name: 'ACME_GetThing' },
            },
          ] },
          { test: () => true, records: [] },
        ]) }),
      notes,
    );
    expect(out.direct).toContainEqual({
      endpoint: 'Payments_API',
      from: null,
      via: [{ type: 'OmniProcess', name: 'ACME_GetThing' }],
      detection: 'namedCredential',
      attribution: 'unattributed',
    });
  });

  it('emits a remoteActionChain edge with endpoint: null for a Remote Action whose config carries no remoteClass', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([
          { test: (s) => s.includes('OmniProcessElement'), records: [
            {
              Type: 'Remote Action',
              PropertySetConfig: JSON.stringify({}),
              OmniProcess: { Id: '0ax2', Name: 'ACME_GetThing' },
            },
          ] },
          { test: () => true, records: [] },
        ]) }),
      notes,
    );
    expect(out.omniElementsScanned).toBe(1);
    expect(out.remoteActions).toEqual([]);
    expect(out.direct).toContainEqual({
      endpoint: null,
      from: null,
      via: [{ type: 'OmniProcess', name: 'ACME_GetThing' }],
      detection: 'remoteActionChain',
      attribution: 'unattributed',
    });
  });

  it('counts distinct procedure names, not distinct OmniProcess ids, for omniProceduresWithIntegrationElements', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([
          { test: (s) => s.includes('OmniProcessElement'), records: [
            {
              Type: 'Rest Action',
              PropertySetConfig: JSON.stringify({ namedCredential: 'Payments_API' }),
              OmniProcess: { Id: '0ax1', Name: 'ACME_GetThing' },
            },
            {
              Type: 'Rest Action',
              PropertySetConfig: JSON.stringify({ namedCredential: 'Maps_API' }),
              OmniProcess: { Id: '0ax1', Name: 'ACME_GetThing' },
            },
          ] },
          { test: () => true, records: [] },
        ]) }),
      notes,
    );
    expect(out.omniProceduresWithIntegrationElements).toBe(1);
  });

  it('counts one procedure, not two versions, when two active-version elements share a procedure name but different OmniProcess ids', async () => {
    // OmniProcess rows are versions. Two elements naming the same procedure by name but two
    // different ids (as if two versions of one procedure were both, implausibly, active) must
    // still count as one procedure: the field counts procedures, not versions.
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([
          { test: (s) => s.includes('OmniProcessElement'), records: [
            {
              Type: 'Rest Action',
              PropertySetConfig: JSON.stringify({ namedCredential: 'Payments_API' }),
              OmniProcess: { Id: '0ax1', Name: 'ACME_GetThing' },
            },
            {
              Type: 'Rest Action',
              PropertySetConfig: JSON.stringify({ namedCredential: 'Maps_API' }),
              OmniProcess: { Id: '0ax2', Name: 'ACME_GetThing' },
            },
            {
              Type: 'Rest Action',
              PropertySetConfig: JSON.stringify({ namedCredential: 'Weather_API' }),
              OmniProcess: { Id: '0ax3', Name: 'ACME_OtherThing' },
            },
          ] },
          { test: () => true, records: [] },
        ]) }),
      notes,
    );
    expect(out.omniProceduresWithIntegrationElements).toBe(2);
  });

  it('counts two distinct procedures when both have no OmniProcess.Name, not one', async () => {
    // Regression pin: the 'unknown' display fallback for a missing OmniProcess.Name was also
    // used as the counting key, so two rows on different procedures with no name both added
    // the literal 'unknown' to the set and collapsed into a single counted procedure. The
    // count must key on OmniProcess.Id when the name is absent, since the Id is unique per row.
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([
          { test: (s) => s.includes('OmniProcessElement'), records: [
            {
              Type: 'Rest Action',
              PropertySetConfig: JSON.stringify({ namedCredential: 'Payments_API' }),
              OmniProcess: { Id: '0ax1' },
            },
            {
              Type: 'Rest Action',
              PropertySetConfig: JSON.stringify({ namedCredential: 'Maps_API' }),
              OmniProcess: { Id: '0ax2' },
            },
          ] },
          { test: () => true, records: [] },
        ]) }),
      notes,
    );
    expect(out.omniProceduresWithIntegrationElements).toBe(2);
  });

  it('restricts the OmniStudio element query to active versions', async () => {
    // Finding A: the query itself must ask for OmniProcess.IsActive = true, not filter
    // client-side, so an org's OmniProcessElement rows for superseded versions are never
    // fetched or emitted as edges in the first place.
    const notes: string[] = [];
    let capturedQuery = '';
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([
          { test: (s) => s.includes('COUNT(Id)') && s.includes('OmniProcessElement'), records: [{ expr0: 0 }] },
          { test: (s) => {
              if (s.includes('OmniProcessElement')) capturedQuery = s;
              return s.includes('OmniProcessElement');
            }, records: [] },
          { test: () => true, records: [] },
        ]) }),
      notes,
    );
    expect(capturedQuery).toContain('OmniProcess.IsActive = true');
    expect(out.omniElementsScanned).toBe(0);
  });

  it('counts and notes elements skipped because their OmniProcess version is superseded', async () => {
    // Finding A: silently narrowing the scan to active versions is the same failure as
    // silently dropping evidence. The exclusion must be counted and stated.
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([
          { test: (s) => s.includes('COUNT(Id)') && s.includes('OmniProcessElement'), records: [{ expr0: 116 }] },
          { test: (s) => s.includes('OmniProcessElement'), records: [
            {
              Type: 'Rest Action',
              PropertySetConfig: JSON.stringify({ namedCredential: 'Payments_API' }),
              OmniProcess: { Id: '0ax1', Name: 'ACME_GetThing' },
            },
          ] },
          { test: () => true, records: [] },
        ]) }),
      notes,
    );
    expect(out.omniElementsScanned).toBe(1);
    expect(out.omniElementsSkippedSuperseded).toBe(116);
    expect(notes.join(' ')).toContain('116');
    expect(notes.join(' ').toLowerCase()).toContain('superseded');
  });

  it('does not add a superseded note when nothing was excluded', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([
          { test: (s) => s.includes('COUNT(Id)') && s.includes('OmniProcessElement'), records: [{ expr0: 0 }] },
          { test: (s) => s.includes('OmniProcessElement'), records: [
            {
              Type: 'Rest Action',
              PropertySetConfig: JSON.stringify({ namedCredential: 'Payments_API' }),
              OmniProcess: { Id: '0ax1', Name: 'ACME_GetThing' },
            },
          ] },
          { test: () => true, records: [] },
        ]) }),
      notes,
    );
    expect(out.omniElementsSkippedSuperseded).toBe(0);
    expect(notes.join(' ').toLowerCase()).not.toContain('superseded');
  });

  it('counts and notes Integration Procedure Action elements rather than dropping them silently', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([
          { test: (s) => s.includes('OmniProcessElement'), records: [
            {
              Type: 'Integration Procedure Action',
              PropertySetConfig: JSON.stringify({}),
              OmniProcess: { Id: '0ax3', Name: 'ACME_Router' },
            },
          ] },
          { test: () => true, records: [] },
        ]) }),
      notes,
    );
    expect(out.omniElementsScanned).toBe(1);
    expect(out.direct).toEqual([]);
    expect(notes.join(' ')).toContain('Integration Procedure Action');
  });

  it('notes namespaced Apex classes excluded from body scanning rather than letting apexBodiesUnreadable read as complete coverage', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([
          { test: (s) => s.includes('WHERE NamespacePrefix = null'), records: [
            { Id: '01p1', Name: 'A', Body: 'callout:Payments_API' },
          ] },
          { test: (s) => s.includes('WHERE NamespacePrefix != null'), records: [{ expr0: 42 }] },
          { test: () => true, records: [] },
        ]),
        soql: mockSoql([{ test: () => true, records: [] }]) }),
      notes,
    );
    expect(out.apexBodiesScanned).toBe(1);
    expect(out.apexBodiesUnreadable).toBe(0);
    expect(notes.join(' ')).toContain('42');
    expect(notes.join(' ').toLowerCase()).toContain('namespaced');
  });

  it('records a note and drops the element when Type matches neither branch', async () => {
    const notes: string[] = [];
    const out = await collectIntegrationEdges(
      mockIntelContext({ tooling: mockTooling([{ test: () => true, records: [] }]),
        soql: mockSoql([
          { test: (s) => s.includes('OmniProcessElement'), records: [
            {
              Type: 'DataRaptor Post Action',
              PropertySetConfig: JSON.stringify({ sourceSystem: 'Whatever' }),
              OmniProcess: { Name: 'ACME_GetThing' },
            },
          ] },
          { test: () => true, records: [] },
        ]) }),
      notes,
    );
    expect(out.direct).toEqual([]);
    expect(out.remoteActions).toEqual([]);
    expect(notes.join(' ')).toContain('unexpected Type');
    expect(notes.join(' ')).toContain('DataRaptor Post Action');
  });
});
