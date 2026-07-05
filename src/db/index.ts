import {
  createDeleteBuilder,
  createInsertStartBuilder,
  createSelectStartBuilder,
  createUpdateStartBuilder,
  type DeleteBuilder,
  type InsertStartBuilder,
  type SelectStartBuilder,
  type UpdateStartBuilder,
} from '../builders/index.js';
import type { CompiledQuery } from '../compiler/index.js';
import { freezeArray, freezeObject } from '../core/invariants.js';
import type { PostgresExecutor, QueryRows } from '../driver/index.js';
import type {
  QueryExecutionHooks,
  QueryKind,
  SchemaDefinition,
  TableName,
} from '../types/index.js';

interface DatabaseContext {
  readonly execute: (kind: QueryKind, compiled: CompiledQuery) => Promise<QueryRows>;
}

interface DatabaseOptions {
  readonly hooks?: QueryExecutionHooks;
}

export interface DatabaseFacade<
  Schema extends SchemaDefinition = Record<string, Record<string, unknown>>,
> {
  selectFrom<Table extends TableName<Schema>>(
    table: Table,
  ): SelectStartBuilder<Schema, Table>;
  insertInto<Table extends TableName<Schema>>(
    table: Table,
  ): InsertStartBuilder<Schema, Table>;
  updateTable<Table extends TableName<Schema>>(
    table: Table,
  ): UpdateStartBuilder<Schema, Table>;
  deleteFrom<Table extends TableName<Schema>>(
    table: Table,
  ): DeleteBuilder<Schema, Table>;
  transaction<T>(
    callback: (db: DatabaseFacade<Schema>) => Promise<T> | T,
  ): Promise<T>;
}

export type TransactionFacade<
  Schema extends SchemaDefinition = Record<string, Record<string, unknown>>,
> = DatabaseFacade<Schema>;

export function createDb<
  Schema extends SchemaDefinition = Record<string, Record<string, unknown>>,
>(
  executor: PostgresExecutor,
  options: DatabaseOptions = {},
): DatabaseFacade<Schema> {
  const context: DatabaseContext = {
    execute: createExecuteQuery(executor, options.hooks),
  };

  return freezeObject({
    selectFrom<Table extends TableName<Schema>>(
      table: Table,
    ): SelectStartBuilder<Schema, Table> {
      return createSelectStartBuilder(context, table);
    },
    insertInto<Table extends TableName<Schema>>(
      table: Table,
    ): InsertStartBuilder<Schema, Table> {
      return createInsertStartBuilder(context, table);
    },
    updateTable<Table extends TableName<Schema>>(
      table: Table,
    ): UpdateStartBuilder<Schema, Table> {
      return createUpdateStartBuilder(context, table);
    },
    deleteFrom<Table extends TableName<Schema>>(
      table: Table,
    ): DeleteBuilder<Schema, Table> {
      return createDeleteBuilder(context, table);
    },
    async transaction<T>(
      callback: (db: DatabaseFacade<Schema>) => Promise<T> | T,
    ): Promise<T> {
      return await executor.transaction((transactionExecutor) =>
        callback(createDb<Schema>(transactionExecutor, options)),
      );
    },
  });
}

function createExecuteQuery(
  executor: PostgresExecutor,
  hooks: QueryExecutionHooks | undefined,
): (kind: QueryKind, compiled: CompiledQuery) => Promise<QueryRows> {
  return async (kind, compiled) => {
    const baseEvent = createQueryExecutionEvent(kind, compiled);
    await callHook(hooks?.beforeExecute, baseEvent);

    const startedAt = Date.now();

    try {
      const rows = await executor.query(compiled);
      await callHook(
        hooks?.afterSuccess,
        freezeObject({
          ...baseEvent,
          durationMs: Date.now() - startedAt,
        }),
      );
      return rows;
    } catch (error) {
      await callHook(
        hooks?.afterFailure,
        freezeObject({
          ...baseEvent,
          durationMs: Date.now() - startedAt,
          error,
        }),
      );
      throw error;
    }
  };
}

function createQueryExecutionEvent(kind: QueryKind, compiled: CompiledQuery) {
  return freezeObject({
    kind,
    sql: compiled.sql,
    params: freezeArray(compiled.params),
  });
}

async function callHook<Event>(
  hook: ((event: Event) => void | Promise<void>) | undefined,
  event: Event,
): Promise<void> {
  if (hook === undefined) {
    return;
  }

  try {
    await hook(event);
  } catch {
    // Hooks are best-effort and must not change query behavior.
  }
}
