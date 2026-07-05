import type { CompiledQuery } from '../compiler/index.js';

export type QueryRows = readonly Record<string, unknown>[];

export interface QueryExecutor {
  query(compiled: CompiledQuery): Promise<QueryRows>;
}

export interface PostgresExecutor extends QueryExecutor {
  transaction<T>(
    callback: (executor: PostgresExecutor) => Promise<T> | T,
  ): Promise<T>;

  close(): Promise<void>;
}

export interface PostgresConnectionOptions {
  readonly connectionString?: string;
  readonly host?: string;
  readonly port?: number;
  readonly database?: string;
  readonly user?: string;
  readonly password?: string;
  readonly applicationName?: string;
}
