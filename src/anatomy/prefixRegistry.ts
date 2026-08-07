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
