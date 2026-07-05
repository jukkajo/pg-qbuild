import { compileQuery, type CompiledQuery } from '../compiler/index.js';
import { updateQuery, type Assignment, type Predicate } from '../core/index.js';
import {
  assertNonEmptyArray,
  assertUniqueColumns,
  assertNonEmptyString,
  freezeArray,
  freezeObject,
  type NonEmptyArray,
} from '../core/invariants.js';
import { appendFrozen, normalizeColumns, normalizeStrings } from './internal.js';
import type { ColumnName, SchemaDefinition, TableName } from '../types/index.js';

export interface UpdateBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> {
  set(...assignments: NonEmptyArray<Assignment>): UpdateBuilder<Schema, Table>;
  where(predicate: Predicate): UpdateBuilder<Schema, Table>;
  returning(
    ...columns: NonEmptyArray<ColumnName<Schema, Table>>
  ): UpdateBuilder<Schema, Table>;
  compile(): CompiledQuery;
}

interface UpdateBuilderState {
  readonly assignments: readonly Assignment[];
  readonly predicates: readonly Predicate[];
  readonly returningColumns: readonly string[];
}

export function createUpdateBuilder<
  Schema extends SchemaDefinition = Record<string, Record<string, unknown>>,
  Table extends TableName<Schema> = TableName<Schema>,
>(
  targetTable: Table,
  compileQueryFn: typeof compileQuery = compileQuery,
): UpdateBuilder<Schema, Table> {
  assertNonEmptyString(targetTable, 'target table');
  return createUpdateBuilderFromState(
    targetTable,
    compileQueryFn,
    freezeObject({
      assignments: freezeArray([]),
      predicates: freezeArray([]),
      returningColumns: freezeArray([]),
    }),
  );
}

function createUpdateBuilderFromState<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
>(
  targetTable: Table,
  compileQueryFn: typeof compileQuery,
  state: UpdateBuilderState,
): UpdateBuilder<Schema, Table> {
  return freezeObject({
    set(...assignments) {
      assertNonEmptyArray(assignments, 'update assignments');
      const normalizedAssignments = freezeArray(assignments);
      assertUniqueColumns(
        freezeArray([...state.assignments, ...normalizedAssignments]),
        'update assignments',
      );

      return createUpdateBuilderFromState(
        targetTable,
        compileQueryFn,
        freezeObject({
          ...state,
          assignments: appendFrozen(state.assignments, normalizedAssignments),
        }),
      );
    },
    where(predicate) {
      return createUpdateBuilderFromState(
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

      return createUpdateBuilderFromState(
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
        updateQuery({
          targetTable,
          assignments: freezeArray(state.assignments) as NonEmptyArray<Assignment>,
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
