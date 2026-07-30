import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { TOOL_VERSION } from '../version.js';

/** Deterministic sha256 of a string, used to key cached analysis by input content. */
export function contentHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export interface CacheOptions {
  /**
   * Analysis version this cache belongs to. Entries written under a different version are
   * never served. Defaults to the tool version.
   */
  version?: string;
  /** Ignore existing entries and recompute, while still writing fresh results. */
  refresh?: boolean;
}

/**
 * Content-hash cache under `~/.orgintel/cache/<orgId>/<version>/<kind>/<hash>.json`.
 *
 * The cache is a pure memo: same input, same result, so it can never change an answer. That
 * guarantee only holds while the *analysis* is unchanged, so the tool version is part of the
 * path — otherwise a summary computed by older logic survives an upgrade and silently
 * contradicts the determinism the product claims. Superseded versions are left on disk rather
 * than deleted, so rolling back a release finds its cache intact.
 *
 * Corrupt or unreadable entries are treated as misses, never as errors: an interrupted run
 * must degrade to a slow run, not a broken one.
 */
export class OrgIntelCache {
  private readonly dir: string;
  private readonly refresh: boolean;

  constructor(
    orgId: string,
    baseDir: string = join(homedir(), '.orgintel', 'cache'),
    opts: CacheOptions = {},
  ) {
    this.dir = join(baseDir, orgId, `v${opts.version ?? TOOL_VERSION}`);
    this.refresh = opts.refresh ?? false;
  }

  /** Absolute path of an entry. Exposed so tests can assert and corrupt real files. */
  pathFor(kind: string, hash: string): string {
    return join(this.dir, kind, `${hash}.json`);
  }

  get<T>(kind: string, hash: string): T | null {
    if (this.refresh) return null;
    const p = this.pathFor(kind, hash);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  set<T>(kind: string, hash: string, value: T): void {
    const p = this.pathFor(kind, hash);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(value), 'utf8');
  }

  /** Return cached analysis for `content`, or run `analyze`, cache, and return it. */
  async memoize<T>(kind: string, content: string, analyze: () => Promise<T> | T): Promise<T> {
    const hash = contentHash(content);
    const hit = this.get<T>(kind, hash);
    if (hit !== null) return hit;
    const value = await analyze();
    this.set(kind, hash, value);
    return value;
  }
}
