import { compileQuery, type CompiledQuery } from '../compiler/index.js';
import { deleteQuery, type Predicate } from '../core/index.js';
import {
  assertNonEmptyString,
  freezeArray,
  freezeObject,
  type NonEmptyArray,
} from '../core/invariants.js';
import { appendFrozen, normalizeColumns, normalizeStrings } from './internal.js';
import type { ColumnName, SchemaDefinition, TableName } from '../types/index.js';

export interface DeleteBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> {
  where(predicate: Predicate): DeleteBuilder<Schema, Table>;
  returning(
    ...columns: NonEmptyArray<ColumnName<Schema, Table>>
  ): DeleteBuilder<Schema, Table>;
  compile(): CompiledQuery;
}

interface DeleteBuilderState {
  readonly predicates: readonly Predicate[];
  readonly returningColumns: readonly string[];
}

export function createDeleteBuilder<
  Schema extends SchemaDefinition = Record<string, Record<string, unknown>>,
  Table extends TableName<Schema> = TableName<Schema>,
>(
  targetTable: Table,
  compileQueryFn: typeof compileQuery = compileQuery,
): DeleteBuilder<Schema, Table> {
  assertNonEmptyString(targetTable, 'target table');
  return createDeleteBuilderFromState(
    targetTable,
    compileQueryFn,
    freezeObject({
      predicates: freezeArray([]),
      returningColumns: freezeArray([]),
    }),
  );
}

function createDeleteBuilderFromState<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
>(
  targetTable: Table,
  compileQueryFn: typeof compileQuery,
  state: DeleteBuilderState,
): DeleteBuilder<Schema, Table> {
  return freezeObject({
    where(predicate) {
      return createDeleteBuilderFromState(
        targetTable,
        compileQueryFn,
        freezeObject({
          ...state,
          predicates: appendFrozen(state.predicates, freezeArray([predicate])),
        }),
      );
    },
    returning(...columns) {
      const returningColumns = normalizeStrings(
        columns,
        'returning columns',
        'returning column',
      );

      return createDeleteBuilderFromState(
        targetTable,
        compileQueryFn,
        freezeObject({
          ...state,
          returningColumns: appendFrozen(state.returningColumns, returningColumns),
        }),
      );
    },
    compile() {
      return compileQueryFn(
        deleteQuery({
          targetTable,
          predicates: state.predicates,
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
