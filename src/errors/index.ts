export interface ExecutionErrorDetails {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly cause?: unknown;
  readonly code?: string;
  readonly detail?: string;
  readonly hint?: string;
  readonly position?: number;
}

export class QueryExecutionError extends Error {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly code?: string;
  readonly detail?: string;
  readonly hint?: string;
  readonly position?: number;

  constructor(message: string, details: ExecutionErrorDetails) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });

    this.name = 'QueryExecutionError';
    this.sql = details.sql;
    this.params = details.params;
    this.code = details.code;
    this.detail = details.detail;
    this.hint = details.hint;
    this.position = details.position;
  }
}

export function wrapQueryExecutionError(
  error: unknown,
  sql: string,
  params: readonly unknown[],
): QueryExecutionError {
  if (error instanceof QueryExecutionError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const details = extractExecutionErrorDetails(error);

  return new QueryExecutionError(`PostgreSQL query failed: ${message}`, {
    sql,
    params,
    cause: error,
    ...details,
  });
}

function extractExecutionErrorDetails(error: unknown): Omit<ExecutionErrorDetails, 'sql' | 'params' | 'cause'> {
  if (typeof error !== 'object' || error === null) {
    return {};
  }

  const candidate = error as Record<string, unknown>;

  return {
    code: readString(candidate.code),
    detail: readString(candidate.detail),
    hint: readString(candidate.hint),
    position: readNumber(candidate.position),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
