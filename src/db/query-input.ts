import type { CompiledQuery } from '../compiler/index.js';
import { assertNonEmptyString, freezeArray, freezeObject } from '../core/invariants.js';

export function normalizeCompiledQueryInput(
  compiledOrSql: CompiledQuery | string,
  params?: readonly unknown[],
): CompiledQuery {
  if (typeof compiledOrSql === 'string') {
    return createCompiledQuery(compiledOrSql, params ?? []);
  }

  if (typeof compiledOrSql !== 'object' || compiledOrSql === null) {
    throw new TypeError('compiled query must be an object or SQL string');
  }

  if (params !== undefined) {
    throw new TypeError('params must not be provided when executing a compiled query object');
  }

  const candidate = compiledOrSql as {
    readonly sql?: unknown;
    readonly params?: unknown;
  };

  if (!Array.isArray(candidate.params)) {
    throw new TypeError('compiled query params must be an array');
  }

  return createCompiledQuery(
    assertNonEmptyString(readSql(candidate.sql), 'sql'),
    candidate.params,
  );
}

function createCompiledQuery(
  sql: string,
  params: readonly unknown[],
): CompiledQuery {
  return freezeObject({
    sql: assertNonEmptyString(sql, 'sql'),
    params: freezeArray(params),
  });
}

function readSql(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('compiled query sql must be a string');
  }

  return value;
}
