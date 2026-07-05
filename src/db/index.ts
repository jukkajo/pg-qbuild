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
import { freezeObject } from '../core/invariants.js';
import type { PostgresExecutor } from '../driver/index.js';
import type { SchemaDefinition, TableName } from '../types/index.js';

interface DatabaseContext {
  readonly executor: PostgresExecutor;
}

export interface DatabaseFacade<Schema extends SchemaDefinition> {
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

export type TransactionFacade<Schema extends SchemaDefinition> = DatabaseFacade<Schema>;

export function createDb<Schema extends SchemaDefinition>(
  executor: PostgresExecutor,
): DatabaseFacade<Schema> {
  const context: DatabaseContext = { executor };

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
        callback(createDb<Schema>(transactionExecutor)),
      );
    },
  });
}
