import { compileQuery } from '../compiler/index.js';
import { assertNonEmptyString, freezeObject } from '../core/invariants.js';
import type { SchemaDefinition, TableName } from '../types/index.js';
import type { CompiledQuery } from '../compiler/index.js';
import type { Query } from '../core/index.js';
import type { DeleteBuilder } from '../builders/delete.js';
import { createDeleteBuilder } from '../builders/delete.js';
import type { InsertBuilder } from '../builders/insert.js';
import { createInsertBuilder } from '../builders/insert.js';
import type { SelectBuilder } from '../builders/select.js';
import { createSelectBuilder } from '../builders/select.js';
import type { UpdateBuilder } from '../builders/update.js';
import { createUpdateBuilder } from '../builders/update.js';

export interface DatabaseOptions {
  readonly compileQuery?: (query: Query) => CompiledQuery;
  readonly executionContext?: unknown;
  readonly transactionEntryPoint?: unknown;
}

export interface Database<Schema extends SchemaDefinition> {
  selectFrom<Table extends TableName<Schema>>(
    sourceTable: Table,
  ): SelectBuilder<Schema, Table>;
  insertInto<Table extends TableName<Schema>>(
    targetTable: Table,
  ): InsertBuilder<Schema, Table>;
  updateTable<Table extends TableName<Schema>>(
    targetTable: Table,
  ): UpdateBuilder<Schema, Table>;
  deleteFrom<Table extends TableName<Schema>>(
    targetTable: Table,
  ): DeleteBuilder<Schema, Table>;
}

export function createDatabase<
  Schema extends SchemaDefinition = Record<string, Record<string, unknown>>,
>(
  options: DatabaseOptions = {},
): Database<Schema> {
  const compileQueryFn = options.compileQuery ?? compileQuery;
  const executionContext = options.executionContext;
  const transactionEntryPoint = options.transactionEntryPoint;

  return freezeObject({
    selectFrom<Table extends TableName<Schema>>(sourceTable: Table) {
      assertNonEmptyString(sourceTable, 'source table');

      void executionContext;
      void transactionEntryPoint;

      return createSelectBuilder<Schema, Table>(sourceTable, compileQueryFn);
    },
    insertInto<Table extends TableName<Schema>>(targetTable: Table) {
      assertNonEmptyString(targetTable, 'target table');

      return createInsertBuilder<Schema, Table>(targetTable, compileQueryFn);
    },
    updateTable<Table extends TableName<Schema>>(targetTable: Table) {
      assertNonEmptyString(targetTable, 'target table');

      return createUpdateBuilder<Schema, Table>(targetTable, compileQueryFn);
    },
    deleteFrom<Table extends TableName<Schema>>(targetTable: Table) {
      assertNonEmptyString(targetTable, 'target table');

      return createDeleteBuilder<Schema, Table>(targetTable, compileQueryFn);
    },
  });
}
