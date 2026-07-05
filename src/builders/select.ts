import { compileQuery, type CompiledQuery } from '../compiler/index.js';
import { selectQuery, type OrderItem, type Predicate } from '../core/index.js';
import {
  assertNonEmptyArray,
  assertNonEmptyString,
  freezeArray,
  freezeObject,
  type NonEmptyArray,
} from '../core/invariants.js';
import {
  appendFrozen,
  assertNonNegativeIntegerIfDefined,
  normalizeColumns,
  normalizeStrings,
} from './internal.js';
import type { ColumnName, SchemaDefinition, TableName } from '../types/index.js';

export interface SelectBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> {
  select(
    ...columns: NonEmptyArray<ColumnName<Schema, Table>>
  ): SelectBuilder<Schema, Table>;
  where(predicate: Predicate): SelectBuilder<Schema, Table>;
  orderBy(...items: NonEmptyArray<OrderItem>): SelectBuilder<Schema, Table>;
  limit(value: number): SelectBuilder<Schema, Table>;
  offset(value: number): SelectBuilder<Schema, Table>;
  compile(): CompiledQuery;
}

interface SelectBuilderState {
  readonly selectedColumns: readonly string[];
  readonly predicates: readonly Predicate[];
  readonly orderBy: readonly OrderItem[];
  readonly limit?: number;
  readonly offset?: number;
}

export function createSelectBuilder<
  Schema extends SchemaDefinition = Record<string, Record<string, unknown>>,
  Table extends TableName<Schema> = TableName<Schema>,
>(
  sourceTable: Table,
  compileQueryFn: typeof compileQuery = compileQuery,
): SelectBuilder<Schema, Table> {
  assertNonEmptyString(sourceTable, 'source table');
  return createSelectBuilderFromState(
    sourceTable,
    compileQueryFn,
    freezeObject({
      selectedColumns: freezeArray([]),
      predicates: freezeArray([]),
      orderBy: freezeArray([]),
    }),
  );
}

function createSelectBuilderFromState<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
>(
  sourceTable: Table,
  compileQueryFn: typeof compileQuery,
  state: SelectBuilderState,
): SelectBuilder<Schema, Table> {
  return freezeObject({
    select(...columns) {
      const selectedColumns = normalizeStrings(columns, 'selected columns', 'selected column');

      return createSelectBuilderFromState(
        sourceTable,
        compileQueryFn,
        freezeObject({
          ...state,
          selectedColumns: appendFrozen(state.selectedColumns, selectedColumns),
        }),
      );
    },
    where(predicate) {
      return createSelectBuilderFromState(
        sourceTable,
        compileQueryFn,
        freezeObject({
          ...state,
          predicates: appendFrozen(state.predicates, freezeArray([predicate])),
        }),
      );
    },
    orderBy(...items) {
      assertNonEmptyArray(items, 'order by items');
      const normalizedItems = freezeArray(items);

      return createSelectBuilderFromState(
        sourceTable,
        compileQueryFn,
        freezeObject({
          ...state,
          orderBy: appendFrozen(state.orderBy, normalizedItems),
        }),
      );
    },
    limit(value) {
      assertNonNegativeIntegerIfDefined(value, 'limit');

      return createSelectBuilderFromState(
        sourceTable,
        compileQueryFn,
        freezeObject({
          ...state,
          limit: value,
        }),
      );
    },
    offset(value) {
      assertNonNegativeIntegerIfDefined(value, 'offset');

      return createSelectBuilderFromState(
        sourceTable,
        compileQueryFn,
        freezeObject({
          ...state,
          offset: value,
        }),
      );
    },
    compile() {
      const selectedColumns = normalizeColumns(
        state.selectedColumns,
        'selected columns',
        'selected column',
      );

      return compileQueryFn(
        selectQuery({
          sourceTable,
          selectedColumns,
          predicates: state.predicates,
          orderBy: state.orderBy,
          limit: state.limit,
          offset: state.offset,
        }),
      );
    },
  });
}
