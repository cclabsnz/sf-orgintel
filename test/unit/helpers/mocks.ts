import type { SoqlClient, ToolingClient, RestClient, MetadataClient, QueryResult, OrgInfo } from '@cclabsnz/sf-core';
import type { IntelContext } from '../../../src/lib/wire.js';

export interface SoqlHandler {
  test: (soql: string) => boolean;
  records?: unknown[];
  totalSize?: number;
  error?: Error;
}

/** Mock SoqlClient that dispatches by matching the SOQL string. Throws on unmatched queries. */
export function mockSoql(handlers: SoqlHandler[]): SoqlClient {
  const pick = (soql: string): SoqlHandler => {
    const h = handlers.find((x) => x.test(soql));
    if (!h) throw new Error(`Unexpected SOQL: ${soql}`);
    if (h.error) throw h.error;
    return h;
  };
  return {
    async query<T>(soql: string): Promise<QueryResult<T>> {
      const h = pick(soql);
      const records = (h.records ?? []) as T[];
      return { totalSize: h.totalSize ?? records.length, done: true, records };
    },
    async queryAll<T>(soql: string): Promise<T[]> {
      const h = pick(soql);
      return (h.records ?? []) as T[];
    },
  };
}

export interface SObjectEntry {
  name: string;
  label?: string;
  custom?: boolean;
  queryable?: boolean;
}

/**
 * Mock RestClient answering the global describe (`/sobjects/`) and, optionally, per-object
 * describes (`/sobjects/<name>/describe/`) from a fixture map.
 *
 * Pass an `Error` instead of a list to make every GET fail, which is how a collector's
 * describe-refused path gets exercised without casting a hand-rolled object into `RestClient`.
 */
export function mockRest(
  sobjects: SObjectEntry[] | Error,
  describes: Record<string, unknown> = {},
): RestClient {
  if (sobjects instanceof Error) {
    const err = sobjects;
    return {
      async get<T>(): Promise<T> {
        throw err;
      },
      async getRaw(): Promise<string> {
        throw err;
      },
      async getRawToFile(): Promise<number> {
        throw err;
      },
    };
  }
  const full = sobjects.map((s) => ({
    name: s.name,
    label: s.label ?? s.name,
    custom: s.custom ?? /__c$/i.test(s.name),
    queryable: s.queryable ?? true,
  }));
  return {
    async get<T>(path: string): Promise<T> {
      if (path === '/sobjects/') return { sobjects: full } as T;
      const m = /^\/sobjects\/([^/]+)\/describe\/$/.exec(path);
      if (m) {
        const d = describes[m[1]];
        if (d) return d as T;
        throw new Error(`No describe fixture for ${m[1]}`);
      }
      throw new Error(`Unexpected REST GET: ${path}`);
    },
    async getRaw(): Promise<string> {
      throw new Error('not implemented in mock');
    },
    async getRawToFile(): Promise<number> {
      return 0;
    },
  };
}

export interface ToolingHandler {
  test: (soql: string) => boolean;
  records?: unknown[];
  error?: Error;
}

/** Mock ToolingClient that dispatches query() by matching the SOQL string. */
export function mockTooling(handlers: ToolingHandler[]): ToolingClient {
  return {
    async query<T>(soql: string): Promise<T[]> {
      const h = handlers.find((x) => x.test(soql));
      if (!h) throw new Error(`Unexpected Tooling SOQL: ${soql}`);
      if (h.error) throw h.error;
      return (h.records ?? []) as T[];
    },
    async getRecord<T>(): Promise<T> {
      throw new Error('not implemented in mock');
    },
  };
}

export const noopTooling: ToolingClient = {
  async query<T>(): Promise<T[]> {
    return [];
  },
  async getRecord<T>(): Promise<T> {
    throw new Error('not implemented in mock');
  },
};

export const noopMetadata: MetadataClient = {
  async read<T>(): Promise<T | null> {
    return null;
  },
};

function unconfiguredSoql(): SoqlClient {
  return {
    async query<T>(): Promise<QueryResult<T>> {
      throw new Error('mockIntelContext: soql was not provided but was called');
    },
    async queryAll<T>(): Promise<T[]> {
      throw new Error('mockIntelContext: soql was not provided but was called');
    },
  };
}

function unconfiguredTooling(): ToolingClient {
  return {
    async query<T>(): Promise<T[]> {
      throw new Error('mockIntelContext: tooling was not provided but was called');
    },
    async getRecord<T>(): Promise<T> {
      throw new Error('mockIntelContext: tooling was not provided but was called');
    },
  };
}

function unconfiguredRest(): RestClient {
  return {
    async get<T>(): Promise<T> {
      throw new Error('mockIntelContext: rest was not provided but was called');
    },
    async getRaw(): Promise<string> {
      throw new Error('mockIntelContext: rest was not provided but was called');
    },
    async getRawToFile(): Promise<number> {
      throw new Error('mockIntelContext: rest was not provided but was called');
    },
  };
}

function unconfiguredMetadata(): MetadataClient {
  return {
    async read<T>(): Promise<T | null> {
      throw new Error('mockIntelContext: metadata was not provided but was called');
    },
  };
}

const unconfiguredOrgInfo: OrgInfo = {
  id: 'mockIntelContext: orgInfo was not provided',
  name: 'mockIntelContext: orgInfo was not provided',
  type: 'mockIntelContext: orgInfo was not provided',
  isSandbox: false,
  instance: 'mockIntelContext: orgInfo was not provided',
  instanceUrl: 'mockIntelContext: orgInfo was not provided',
};

/**
 * Builds a real, compiler-checked IntelContext for anatomy collector tests. Every field the
 * caller does not supply is filled with a stub that throws a clear error the moment it is
 * used, so a test that reaches for a client it never configured fails loudly instead of
 * silently reading undefined. This is what makes a mock whose shape does not match the real
 * client interface (e.g. reading `.records`/`.totalSize` off ToolingClient.query, which
 * resolves to a bare array) a build error rather than a runtime surprise.
 */
export function mockIntelContext(parts: Partial<IntelContext> = {}): IntelContext {
  return {
    soql: parts.soql ?? unconfiguredSoql(),
    tooling: parts.tooling ?? unconfiguredTooling(),
    rest: parts.rest ?? unconfiguredRest(),
    metadata: parts.metadata ?? unconfiguredMetadata(),
    orgInfo: parts.orgInfo ?? unconfiguredOrgInfo,
    apiVersion: parts.apiVersion ?? '62.0',
    namespace: parts.namespace === undefined ? null : parts.namespace,
  };
}
