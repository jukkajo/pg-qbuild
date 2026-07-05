import {
  assertNonEmptyArray,
  assertNonEmptyString,
  assertNonNegativeInteger,
  assertSameColumnOrder,
  assertUniqueColumns,
  freezeArray,
  freezeObject,
  type NonEmptyArray,
} from './invariants.js';
import type {
  Assignment,
  ColumnExpression,
  OrderItem,
  Predicate,
} from './primitives.js';

export type InsertRow = NonEmptyArray<Assignment>;

export interface SelectQuery {
  readonly kind: 'select';
  readonly sourceTable: string;
  readonly selectedColumns: NonEmptyArray<ColumnExpression>;
  readonly predicates: readonly Predicate[];
  readonly orderBy: readonly OrderItem[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface InsertQuery {
  readonly kind: 'insert';
  readonly targetTable: string;
  readonly rows: NonEmptyArray<InsertRow>;
  readonly returningColumns?: NonEmptyArray<ColumnExpression>;
}

export interface UpdateQuery {
  readonly kind: 'update';
  readonly targetTable: string;
  readonly assignments: NonEmptyArray<Assignment>;
  readonly predicates: readonly Predicate[];
  readonly returningColumns?: NonEmptyArray<ColumnExpression>;
}

export interface DeleteQuery {
  readonly kind: 'delete';
  readonly targetTable: string;
  readonly predicates: readonly Predicate[];
  readonly returningColumns?: NonEmptyArray<ColumnExpression>;
}

export type Query = SelectQuery | InsertQuery | UpdateQuery | DeleteQuery;

export interface SelectQueryInput {
  readonly sourceTable: string;
  readonly selectedColumns: NonEmptyArray<ColumnExpression>;
  readonly predicates?: readonly Predicate[];
  readonly orderBy?: readonly OrderItem[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface InsertQueryInput {
  readonly targetTable: string;
  readonly rows: NonEmptyArray<InsertRow>;
  readonly returningColumns?: NonEmptyArray<ColumnExpression>;
}

export interface UpdateQueryInput {
  readonly targetTable: string;
  readonly assignments: NonEmptyArray<Assignment>;
  readonly predicates?: readonly Predicate[];
  readonly returningColumns?: NonEmptyArray<ColumnExpression>;
}

export interface DeleteQueryInput {
  readonly targetTable: string;
  readonly predicates?: readonly Predicate[];
  readonly returningColumns?: NonEmptyArray<ColumnExpression>;
}

export function selectQuery(input: SelectQueryInput): SelectQuery {
  assertNonEmptyString(input.sourceTable, 'source table');
  assertNonEmptyArray(input.selectedColumns, 'selected columns');

  const query = {
    kind: 'select',
    sourceTable: input.sourceTable,
    selectedColumns: freezeArray(input.selectedColumns),
    predicates: freezeArray(input.predicates ?? []),
    orderBy: freezeArray(input.orderBy ?? []),
    limit: input.limit,
    offset: input.offset,
  } satisfies SelectQuery;

  if (query.limit !== undefined) {
    assertNonNegativeInteger(query.limit, 'limit');
  }

  if (query.offset !== undefined) {
    assertNonNegativeInteger(query.offset, 'offset');
  }

  return freezeObject(query);
}

export function insertQuery(input: InsertQueryInput): InsertQuery {
  assertNonEmptyString(input.targetTable, 'target table');
  assertNonEmptyArray(input.rows, 'insert rows');

  const normalizedRows = assertNonEmptyArray(
    input.rows.map((row, rowIndex) => {
      assertNonEmptyArray(row, `insert row ${rowIndex + 1}`);
      assertUniqueColumns(row, `insert row ${rowIndex + 1}`);

      return freezeArray(row);
    }),
    'insert rows',
  );

  for (let index = 1; index < normalizedRows.length; index += 1) {
    assertSameColumnOrder(normalizedRows[0]!, normalizedRows[index]!, 'insert rows');
  }

  const query = {
    kind: 'insert',
    targetTable: input.targetTable,
    rows: freezeArray(normalizedRows),
    returningColumns:
      input.returningColumns !== undefined
        ? freezeArray(assertNonEmptyArray(input.returningColumns, 'returning columns'))
        : undefined,
  } satisfies InsertQuery;

  return freezeObject(query);
}

export function updateQuery(input: UpdateQueryInput): UpdateQuery {
  assertNonEmptyString(input.targetTable, 'target table');
  assertNonEmptyArray(input.assignments, 'update assignments');
  assertUniqueColumns(input.assignments, 'update assignments');

  const query = {
    kind: 'update',
    targetTable: input.targetTable,
    assignments: freezeArray(input.assignments),
    predicates: freezeArray(input.predicates ?? []),
    returningColumns:
      input.returningColumns !== undefined
        ? freezeArray(assertNonEmptyArray(input.returningColumns, 'returning columns'))
        : undefined,
  } satisfies UpdateQuery;

  return freezeObject(query);
}

export function deleteQuery(input: DeleteQueryInput): DeleteQuery {
  assertNonEmptyString(input.targetTable, 'target table');

  const query = {
    kind: 'delete',
    targetTable: input.targetTable,
    predicates: freezeArray(input.predicates ?? []),
    returningColumns:
      input.returningColumns !== undefined
        ? freezeArray(assertNonEmptyArray(input.returningColumns, 'returning columns'))
        : undefined,
  } satisfies DeleteQuery;

  return freezeObject(query);
}
