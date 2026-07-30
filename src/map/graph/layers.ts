/**
 * Architectural layers of a Salesforce org's coupling graph.
 *
 * A real org's graph is dominated by objects that carry no business process — User, Profile,
 * PermissionSet, logger tables, custom metadata — because Apex references them constantly.
 * Filtering them out is tempting and wrong: on a production org, business↔security was the
 * second-heaviest relationship in the entire graph, behind only business-internal coupling.
 * That is a genuine architectural finding (the business model is deeply wired into the
 * permission model) and deleting the objects deletes the finding.
 *
 * Classifying instead of filtering keeps every object, and turns the noise into structure.
 */
export type Layer =
  | 'integration'
  | 'configuration'
  | 'business'
  | 'content'
  | 'sharing'
  | 'security'
  | 'observability';

/** Ordered by distance from the business core — the order layers are drawn in. */
export const LAYERS: readonly Layer[] = [
  'integration',
  'configuration',
  'business',
  'content',
  'sharing',
  'security',
  'observability',
];

export const LAYER_DESCRIPTIONS: Readonly<Record<Layer, string>> = {
  integration: 'platform events and external data',
  configuration: 'custom metadata driving behaviour',
  business: 'business process',
  content: 'files, documents and email',
  sharing: 'sharing, history and change tracking',
  security: 'identity and permissions',
  observability: 'logging and instrumentation',
};

/**
 * Setup and platform objects. Matched exactly rather than by prefix: `Contract` must not be
 * mistaken for `ContentDocument`, nor `UserStory__c` for `User`.
 */
const SECURITY_OBJECTS: ReadonlySet<string> = new Set([
  'User', 'Profile', 'PermissionSet', 'PermissionSetAssignment', 'PermissionSetGroup',
  'PermissionSetGroupComponent', 'PermissionSetLicense', 'PermissionSetLicenseAssign',
  'UserRole', 'UserLicense', 'UserRecordAccess', 'UserPermissionAccess', 'SetupEntityAccess',
  'CustomPermission', 'Organization', 'LoginHistory', 'AuthSession', 'AuthProvider',
  'ThirdPartyAccountLink', 'CronTrigger', 'AsyncApexJob', 'ApexClass', 'ApexTrigger',
  'ApexEmailNotification', 'AuraDefinitionBundle', 'FlowDefinitionView', 'FlowVersionView',
  'Group', 'GroupMember', 'QueueSobject', 'ObjectPermissions', 'FieldPermissions',
  'EntityDefinition', 'FieldDefinition', 'Identifier', 'StaticResource', 'Topic',
  'TopicAssignment', 'SetupAuditTrail', 'NetworkMemberGroup',
]);

const CONTENT_OBJECTS: ReadonlySet<string> = new Set([
  'Attachment', 'Document', 'EmailMessage', 'EmailTemplate', 'Note',
]);

/** Which layer an object belongs to. Unrecognised objects are business, never hidden. */
export function layerOf(object: string): Layer {
  if (SECURITY_OBJECTS.has(object)) return 'security';
  if (/^Logger?[A-Z_]/.test(object) || /^Log(Entry|Status|Retention)/.test(object)) return 'observability';
  if (object.endsWith('__mdt')) return 'configuration';
  if (object.endsWith('__e') || object.endsWith('__x')) return 'integration';
  if (/(?:Share|History|Feed|ChangeEvent)$/.test(object)) return 'sharing';
  if (CONTENT_OBJECTS.has(object) || /^Content[A-Z]/.test(object)) return 'content';
  return 'business';
}

export interface LayerSummary {
  layer: Layer;
  count: number;
  description: string;
}

/** Object counts per layer, in draw order. Layers with no objects are omitted. */
export function summariseLayers(objects: readonly string[]): LayerSummary[] {
  const counts = new Map<Layer, number>();
  for (const o of objects) {
    const l = layerOf(o);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return LAYERS.filter((l) => counts.has(l)).map((layer) => ({
    layer,
    count: counts.get(layer)!,
    description: LAYER_DESCRIPTIONS[layer],
  }));
}

export interface LayerPair {
  from: Layer;
  to: Layer;
  couplings: number;
  weight: number;
}

/**
 * Couplings aggregated by layer pair, heaviest first. A within-layer relationship reports the
 * same layer on both sides. This is what makes "the business model is wired into the
 * permission model" a number rather than an impression.
 */
export function crossLayerCoupling(
  edges: readonly { from: string; to: string; weight: number }[],
): LayerPair[] {
  const acc = new Map<string, LayerPair>();
  for (const e of edges) {
    const a = layerOf(e.from);
    const b = layerOf(e.to);
    // Canonical order so a↔b and b↔a aggregate together, and output is input-order independent.
    const [from, to] = LAYERS.indexOf(a) <= LAYERS.indexOf(b) ? [a, b] : [b, a];
    const key = `${from}|${to}`;
    const cur = acc.get(key) ?? { from, to, couplings: 0, weight: 0 };
    cur.couplings++;
    cur.weight += e.weight;
    acc.set(key, cur);
  }
  return [...acc.values()].sort(
    (x, y) => y.weight - x.weight || `${x.from}|${x.to}`.localeCompare(`${y.from}|${y.to}`),
  );
}
