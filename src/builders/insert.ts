import { compileQuery, type CompiledQuery } from '../compiler/index.js';
import { insertQuery, type InsertRow } from '../core/index.js';
import {
  assertNonEmptyArray,
  assertNonEmptyString,
  freezeArray,
  freezeObject,
  type NonEmptyArray,
} from '../core/invariants.js';
import { appendFrozen, normalizeColumns, normalizeStrings } from './internal.js';
import type { ColumnName, SchemaDefinition, TableName } from '../types/index.js';

export interface InsertBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> {
  values(...rows: NonEmptyArray<InsertRow>): InsertBuilder<Schema, Table>;
  returning(
    ...columns: NonEmptyArray<ColumnName<Schema, Table>>
  ): InsertBuilder<Schema, Table>;
  compile(): CompiledQuery;
}

interface InsertBuilderState {
  readonly rows: readonly InsertRow[];
  readonly returningColumns: readonly string[];
}

export function createInsertBuilder<
  Schema extends SchemaDefinition = Record<string, Record<string, unknown>>,
  Table extends TableName<Schema> = TableName<Schema>,
>(
  targetTable: Table,
  compileQueryFn: typeof compileQuery = compileQuery,
): InsertBuilder<Schema, Table> {
  assertNonEmptyString(targetTable, 'target table');
  return createInsertBuilderFromState(
    targetTable,
    compileQueryFn,
    freezeObject({
    rows: freezeArray([]),
    returningColumns: freezeArray([]),
    }),
  );
}

function createInsertBuilderFromState<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
>(
  targetTable: Table,
  compileQueryFn: typeof compileQuery,
  state: InsertBuilderState,
): InsertBuilder<Schema, Table> {
  return freezeObject({
    values(...rows) {
      assertNonEmptyArray(rows, 'insert rows');
      const normalizedRows = freezeArray(rows.map((row) => freezeArray(row)));

      return createInsertBuilderFromState(
        targetTable,
        compileQueryFn,
        freezeObject({
          ...state,
          rows: appendFrozen(state.rows, normalizedRows),
        }),
      );
    },
    returning(...columns) {
      const returningColumns = normalizeStrings(
        columns,
        'returning columns',
        'returning column',
      );

      return createInsertBuilderFromState(
        targetTable,
        compileQueryFn,
        freezeObject({
          ...state,
          returningColumns: appendFrozen(state.returningColumns, returningColumns),
        }),
      );
    },
    compile() {
      const rows = assertNonEmptyArray(state.rows, 'insert rows');

      return compileQueryFn(
        insertQuery({
          targetTable,
          rows: freezeArray(rows) as NonEmptyArray<InsertRow>,
          returningColumns:
            state.returningColumns.length === 0
              ? undefined
              : normalizeColumns(
                  state.returningColumns,
                  'returning columns',
                  'returning column',
                ),
        }),
      );
    },
  });
}
