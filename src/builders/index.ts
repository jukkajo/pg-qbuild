import { compileQuery, type CompiledQuery } from '../compiler/index.js';
import {
  assignment,
  column,
  parameter,
  type Assignment,
  type ColumnExpression,
  type Expression,
  type OrderItem,
  type Predicate,
  deleteQuery,
  insertQuery,
  selectQuery,
  updateQuery,
} from '../core/index.js';
import {
  assertNonEmptyArray,
  assertNonEmptyString,
  assertNonNegativeInteger,
  assertSameColumnOrder,
  assertUniqueColumns,
  freezeArray,
  freezeObject,
} from '../core/invariants.js';
import type { QueryExecutor, QueryRows } from '../driver/index.js';
import type {
  ColumnName,
  InsertRowInput,
  NonEmptyTuple,
  QueryKind,
  SchemaDefinition,
  TableName,
  TableRow,
} from '../types/index.js';

type SelectableColumn<Schema extends SchemaDefinition, Table extends TableName<Schema>> =
  | ColumnName<Schema, Table>
  | ColumnExpression;

type NonEmptyColumnExpressions = readonly [ColumnExpression, ...ColumnExpression[]];
type NonEmptyAssignmentRow = readonly [Assignment, ...Assignment[]];
type NonEmptyAssignmentRows = readonly [NonEmptyAssignmentRow, ...NonEmptyAssignmentRow[]];

type ResolvedColumnName<Column> = Column extends string
  ? Column
  : Column extends { readonly name: infer Name extends string }
    ? Name
    : never;

type SelectedRow<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
  Columns extends readonly SelectableColumn<Schema, Table>[],
> = Pick<
  TableRow<Schema, Table>,
  Extract<ResolvedColumnName<Columns[number]>, keyof TableRow<Schema, Table>>
>;

type InsertRowValue<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> = InsertRowInput<Schema, Table> | readonly Assignment[];

type UpdateValue<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> = InsertRowInput<Schema, Table> | Assignment | readonly Assignment[];

interface BuilderContext {
  readonly execute: (kind: QueryKind, compiled: CompiledQuery) => Promise<QueryRows>;
}

interface RowsExecutionMethods<Row> {
  execute(): Promise<readonly Row[]>;
  executeTakeFirst(): Promise<Row | undefined>;
  executeTakeFirstOrThrow(): Promise<Row>;
}

export type SelectStartBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> = SelectQueryBuilder<Schema, Table, readonly []>;

export interface SelectQueryBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
  Columns extends readonly SelectableColumn<Schema, Table>[],
> extends RowsExecutionMethods<SelectedRow<Schema, Table, Columns>> {
  select<NewColumns extends NonEmptyTuple<SelectableColumn<Schema, Table>>>(
    ...columns: NewColumns
  ): SelectQueryBuilder<Schema, Table, [...Columns, ...NewColumns]>;
  where(predicate: Predicate): SelectQueryBuilder<Schema, Table, Columns>;
  orderBy(
    ...items: readonly [OrderItem, ...OrderItem[]]
  ): SelectQueryBuilder<Schema, Table, Columns>;
  limit(limit: number): SelectQueryBuilder<Schema, Table, Columns>;
  offset(offset: number): SelectQueryBuilder<Schema, Table, Columns>;
  compile(): CompiledQuery;
}

export type InsertStartBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> = InsertValuesBuilder<Schema, Table, readonly []>;

export interface InsertValuesBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
  Rows extends readonly InsertRowValue<Schema, Table>[],
> extends RowsExecutionMethods<QueryRows[number]> {
  values<NewRows extends NonEmptyTuple<InsertRowValue<Schema, Table>>>(
    ...rows: NewRows
  ): InsertValuesBuilder<Schema, Table, [...Rows, ...NewRows]>;
  returning<Columns extends NonEmptyTuple<SelectableColumn<Schema, Table>>>(
    ...columns: Columns
  ): InsertValuesBuilder<Schema, Table, Rows>;
  compile(): CompiledQuery;
}

export type UpdateStartBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> = UpdateValuesBuilder<Schema, Table, readonly []>;

export interface UpdateValuesBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
  Assignments extends readonly UpdateValue<Schema, Table>[],
> extends RowsExecutionMethods<QueryRows[number]> {
  set<NewAssignments extends NonEmptyTuple<UpdateValue<Schema, Table>>>(
    ...values: NewAssignments
  ): UpdateValuesBuilder<Schema, Table, [...Assignments, ...NewAssignments]>;
  where(predicate: Predicate): UpdateValuesBuilder<Schema, Table, Assignments>;
  returning<Columns extends NonEmptyTuple<SelectableColumn<Schema, Table>>>(
    ...columns: Columns
  ): UpdateValuesBuilder<Schema, Table, Assignments>;
  compile(): CompiledQuery;
}

export interface DeleteBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> extends RowsExecutionMethods<QueryRows[number]> {
  where(predicate: Predicate): DeleteBuilder<Schema, Table>;
  returning<Columns extends NonEmptyTuple<SelectableColumn<Schema, Table>>>(
    ...columns: Columns
  ): DeleteBuilder<Schema, Table>;
  compile(): CompiledQuery;
}

export function createSelectStartBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
>(
  context: BuilderContext,
  table: Table,
): SelectStartBuilder<Schema, Table> {
  assertNonEmptyString(table, 'source table');
  return createSelectQueryBuilder(context, {
    sourceTable: table,
    selectedColumns: freezeArray([] as ColumnExpression[]),
    predicates: freezeArray([] as Predicate[]),
    orderBy: freezeArray([] as OrderItem[]),
  });
}

export function createInsertStartBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
>(
  context: BuilderContext,
  table: Table,
): InsertStartBuilder<Schema, Table> {
  assertNonEmptyString(table, 'target table');
  return createInsertValuesBuilder(context, {
    targetTable: table,
    rows: freezeArray([] as NonEmptyAssignmentRow[]),
  });
}

export function createUpdateStartBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
>(
  context: BuilderContext,
  table: Table,
): UpdateStartBuilder<Schema, Table> {
  assertNonEmptyString(table, 'target table');
  return createUpdateValuesBuilder(context, {
    targetTable: table,
    assignments: freezeArray([] as Assignment[]),
    predicates: freezeArray([] as Predicate[]),
  });
}

export function createDeleteBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
>(
  context: BuilderContext,
  table: Table,
): DeleteBuilder<Schema, Table> {
  assertNonEmptyString(table, 'target table');
  return createDeleteQueryBuilder(context, {
    targetTable: table,
    predicates: freezeArray([] as Predicate[]),
  });
}

interface SelectState {
  readonly sourceTable: string;
  readonly selectedColumns: readonly ColumnExpression[];
  readonly predicates: readonly Predicate[];
  readonly orderBy: readonly OrderItem[];
  readonly limit?: number;
  readonly offset?: number;
}

interface InsertState {
  readonly targetTable: string;
  readonly rows: readonly (readonly Assignment[])[];
  readonly returningColumns?: readonly ColumnExpression[];
}

interface UpdateState {
  readonly targetTable: string;
  readonly assignments: readonly Assignment[];
  readonly predicates: readonly Predicate[];
  readonly returningColumns?: readonly ColumnExpression[];
}

interface DeleteState {
  readonly targetTable: string;
  readonly predicates: readonly Predicate[];
  readonly returningColumns?: readonly ColumnExpression[];
}

function createSelectQueryBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
  Columns extends readonly SelectableColumn<Schema, Table>[],
>(
  context: BuilderContext,
  state: SelectState,
): SelectQueryBuilder<Schema, Table, Columns> {
  const compile = (): CompiledQuery => {
    if (state.selectedColumns.length === 0) {
      throw new TypeError('selected columns must contain at least one item before compile()');
    }

    return compileQuery(
      selectQuery({
        sourceTable: state.sourceTable,
        selectedColumns: freezeArray(state.selectedColumns) as NonEmptyColumnExpressions,
        predicates: state.predicates,
        orderBy: state.orderBy,
        limit: state.limit,
        offset: state.offset,
      }),
    );
  };

  const execute = async (): Promise<readonly SelectedRow<Schema, Table, Columns>[]> =>
    (await context.execute('select', compile())) as readonly SelectedRow<
      Schema,
      Table,
      Columns
    >[];
  const rowsExecution = createRowsExecutionMethods(execute, 'select');

  return freezeObject({
    ...rowsExecution,
    select<NewColumns extends NonEmptyTuple<SelectableColumn<Schema, Table>>>(
      ...columns: NewColumns
    ): SelectQueryBuilder<Schema, Table, NewColumns> {
      const normalized = normalizeSelectedColumns(columns);
      return createSelectQueryBuilder(context, {
        ...state,
        selectedColumns: freezeArray([...state.selectedColumns, ...normalized]),
      });
    },
    where(predicate: Predicate): SelectQueryBuilder<Schema, Table, Columns> {
      return createSelectQueryBuilder(context, {
        ...state,
        predicates: freezeArray([...state.predicates, predicate]),
      });
    },
    orderBy(
      ...items: readonly [OrderItem, ...OrderItem[]]
    ): SelectQueryBuilder<Schema, Table, Columns> {
      const normalized = normalizeOrderItems(items);
      return createSelectQueryBuilder(context, {
        ...state,
        orderBy: freezeArray([...state.orderBy, ...normalized]),
      });
    },
    limit(limit: number): SelectQueryBuilder<Schema, Table, Columns> {
      assertNonNegativeInteger(limit, 'limit');
      return createSelectQueryBuilder(context, { ...state, limit });
    },
    offset(offset: number): SelectQueryBuilder<Schema, Table, Columns> {
      assertNonNegativeInteger(offset, 'offset');
      return createSelectQueryBuilder(context, { ...state, offset });
    },
    compile,
  });
}

function createInsertValuesBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
  Rows extends readonly InsertRowValue<Schema, Table>[],
>(
  context: BuilderContext,
  state: InsertState,
): InsertValuesBuilder<Schema, Table, Rows> {
  const compile = (): CompiledQuery => {
    if (state.rows.length === 0) {
      throw new TypeError('insert rows must contain at least one item before compile()');
    }

    return compileQuery(
      insertQuery({
        targetTable: state.targetTable,
        rows: freezeArray(state.rows) as NonEmptyAssignmentRows,
        returningColumns: state.returningColumns === undefined
          ? undefined
          : freezeArray(state.returningColumns) as NonEmptyColumnExpressions,
      }),
    );
  };

  const execute = async (): Promise<QueryRows> => context.execute('insert', compile());
  const rowsExecution = createRowsExecutionMethods(execute, 'insert');

  return freezeObject({
    ...rowsExecution,
    values<NewRows extends NonEmptyTuple<InsertRowValue<Schema, Table>>>(
      ...rows: NewRows
    ): InsertValuesBuilder<Schema, Table, NewRows> {
      const normalizedRows = normalizeInsertRows(rows);
      return createInsertValuesBuilder(context, {
        ...state,
        rows: freezeArray([...state.rows, ...normalizedRows]),
      });
    },
    returning<Columns extends NonEmptyTuple<SelectableColumn<Schema, Table>>>(
      ...columns: Columns
    ): InsertValuesBuilder<Schema, Table, Rows> {
      return createInsertValuesBuilder(context, {
        ...state,
        returningColumns: normalizeSelectedColumns(columns),
      });
    },
    compile,
  });
}

function createUpdateValuesBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
  Assignments extends readonly UpdateValue<Schema, Table>[],
>(
  context: BuilderContext,
  state: UpdateState,
): UpdateValuesBuilder<Schema, Table, Assignments> {
  const compile = (): CompiledQuery => {
    if (state.assignments.length === 0) {
      throw new TypeError('update assignments must contain at least one item before compile()');
    }

    return compileQuery(
      updateQuery({
        targetTable: state.targetTable,
        assignments: freezeArray(state.assignments) as NonEmptyAssignmentRow,
        predicates: state.predicates,
        returningColumns: state.returningColumns === undefined
          ? undefined
          : freezeArray(state.returningColumns) as NonEmptyColumnExpressions,
      }),
    );
  };

  const execute = async (): Promise<QueryRows> => context.execute('update', compile());
  const rowsExecution = createRowsExecutionMethods(execute, 'update');

  return freezeObject({
    ...rowsExecution,
    set<NewAssignments extends NonEmptyTuple<UpdateValue<Schema, Table>>>(
      ...values: NewAssignments
    ): UpdateValuesBuilder<Schema, Table, NewAssignments> {
      const normalizedAssignments = normalizeUpdateValues(values);
      return createUpdateValuesBuilder(context, {
        ...state,
        assignments: freezeArray([...state.assignments, ...normalizedAssignments]),
      });
    },
    where(predicate: Predicate): UpdateValuesBuilder<Schema, Table, Assignments> {
      return createUpdateValuesBuilder(context, {
        ...state,
        predicates: freezeArray([...state.predicates, predicate]),
      });
    },
    returning<Columns extends NonEmptyTuple<SelectableColumn<Schema, Table>>>(
      ...columns: Columns
    ): UpdateValuesBuilder<Schema, Table, Assignments> {
      return createUpdateValuesBuilder(context, {
        ...state,
        returningColumns: normalizeSelectedColumns(columns),
      });
    },
    compile,
  });
}

function createDeleteQueryBuilder<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
>(
  context: BuilderContext,
  state: DeleteState,
): DeleteBuilder<Schema, Table> {
  const compile = (): CompiledQuery =>
    compileQuery(
      deleteQuery({
        targetTable: state.targetTable,
        predicates: state.predicates,
        returningColumns: state.returningColumns === undefined
          ? undefined
          : freezeArray(state.returningColumns) as NonEmptyColumnExpressions,
      }),
    );

  const execute = async (): Promise<QueryRows> => context.execute('delete', compile());
  const rowsExecution = createRowsExecutionMethods(execute, 'delete');

  return freezeObject({
    ...rowsExecution,
    where(predicate: Predicate): DeleteBuilder<Schema, Table> {
      return createDeleteQueryBuilder(context, {
        ...state,
        predicates: freezeArray([...state.predicates, predicate]),
      });
    },
    returning<Columns extends NonEmptyTuple<SelectableColumn<Schema, Table>>>(
      ...columns: Columns
    ): DeleteBuilder<Schema, Table> {
      return createDeleteQueryBuilder(context, {
        ...state,
        returningColumns: normalizeSelectedColumns(columns),
      });
    },
    compile,
  });
}

function createRowsExecutionMethods<Row>(
  execute: () => Promise<readonly Row[]>,
  kind: QueryKind,
): RowsExecutionMethods<Row> {
  const executeTakeFirst = async (): Promise<Row | undefined> => (await execute())[0];
  const executeTakeFirstOrThrow = async (): Promise<Row> => {
    const row = await executeTakeFirst();
    if (row === undefined) {
      throw new Error(`${kind} query returned no rows`);
    }

    return row;
  };

  return freezeObject({
    execute,
    executeTakeFirst,
    executeTakeFirstOrThrow,
  });
}

function normalizeSelectedColumns<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
>(
  columns: readonly unknown[],
): NonEmptyColumnExpressions {
  const values = normalizeMaybeArray(columns);
  if (values.length === 0) {
    throw new TypeError('columns must contain at least one item');
  }

  const normalized = values.map((value) => {
    if (typeof value === 'string') {
      return column(value);
    }

    if (isColumnExpression(value)) {
      return column(value.name);
    }

    throw new TypeError('columns must be column names or column expressions');
  });

  return freezeArray(normalized) as unknown as NonEmptyColumnExpressions;
}

function normalizeOrderItems(items: readonly unknown[]): readonly OrderItem[] {
  const values = normalizeMaybeArray(items);
  if (values.length === 0) {
    throw new TypeError('order by items must contain at least one item');
  }

  return freezeArray(
    values.map((value) => {
      if (!isOrderItem(value)) {
        throw new TypeError('order by items must be order items');
      }

      return value;
    }),
  );
}

function normalizeInsertRows(rows: readonly unknown[]): NonEmptyAssignmentRows {
  if (rows.length === 0) {
    throw new TypeError('insert rows must contain at least one item');
  }

  if (rows.length === 1) {
    const single = rows[0];

    if (isAssignmentRow(single)) {
      return freezeArray([normalizeAssignmentRow(single, 'insert row')]) as unknown as NonEmptyAssignmentRows;
    }

    if (isPlainObject(single)) {
      return freezeArray([normalizeInsertRowValue(single, 'insert row 1')]) as unknown as NonEmptyAssignmentRows;
    }
  }

  if (rows.every(isAssignment)) {
    return freezeArray([normalizeAssignmentRow(rows as readonly Assignment[], 'insert rows')]) as unknown as NonEmptyAssignmentRows;
  }

  const normalizedRows = rows.map((value, index) =>
    normalizeInsertRowValue(value, `insert row ${index + 1}`),
  );

  for (let index = 1; index < normalizedRows.length; index += 1) {
    assertSameColumnOrder(normalizedRows[0], normalizedRows[index]!, 'insert rows');
  }

  return freezeArray(normalizedRows) as unknown as NonEmptyAssignmentRows;
}

function normalizeInsertRowValue(
  value: unknown,
  context: string,
): NonEmptyAssignmentRow {
  if (isAssignmentRow(value)) {
    return normalizeAssignmentRow(value, context);
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
    if (entries.length === 0) {
      throw new TypeError(`${context} must contain at least one column`);
    }

    const assignments = entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => assignment(key, normalizeExpressionValue(entryValue)));

    assertUniqueColumns(assignments, context);
    return freezeArray(assignments) as unknown as NonEmptyAssignmentRow;
  }

  throw new TypeError(`${context} must be a plain object or assignment list`);
}

function normalizeAssignmentRow(
  row: readonly Assignment[],
  context: string,
): NonEmptyAssignmentRow {
  assertUniqueColumns(row, context);
  return freezeArray(row) as unknown as NonEmptyAssignmentRow;
}

function normalizeUpdateValues(values: readonly unknown[]): NonEmptyAssignmentRow {
  const entries = normalizeMaybeArray(values);
  if (entries.length === 0) {
    throw new TypeError('update assignments must contain at least one item');
  }

  if (entries.length === 1) {
    const single = entries[0];
    if (isAssignment(single)) {
      return normalizeAssignmentRow([single], 'update assignments');
    }

    if (isAssignmentRow(single)) {
      return normalizeAssignmentRow(single, 'update assignments');
    }

    if (isPlainObject(single)) {
      const normalized = normalizeUpdateObject(single, 'update assignments');
      return normalized;
    }
  }

  if (entries.every(isAssignment)) {
    return normalizeAssignmentRow(entries as readonly Assignment[], 'update assignments');
  }

  throw new TypeError('update assignments must be a plain object or assignment list');
}

function normalizeUpdateObject(
  value: Record<string, unknown>,
  context: string,
): NonEmptyAssignmentRow {
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  if (entries.length === 0) {
    throw new TypeError(`${context} must contain at least one column`);
  }

  const assignments = entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => assignment(key, normalizeExpressionValue(entryValue)));

  assertUniqueColumns(assignments, context);
  return freezeArray(assignments) as unknown as NonEmptyAssignmentRow;
}

function normalizeExpressionValue(value: unknown): Expression {
  if (isExpression(value)) {
    return value;
  }

  return parameter(value);
}

function normalizeMaybeArray(values: readonly unknown[]): readonly unknown[] {
  if (values.length === 1 && Array.isArray(values[0])) {
    return values[0] as readonly unknown[];
  }

  return values;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAssignment(value: unknown): value is Assignment {
  return isPlainObject(value) && value.kind === 'assignment';
}

function isAssignmentRow(value: unknown): value is readonly Assignment[] {
  return Array.isArray(value) && value.length > 0 && value.every(isAssignment);
}

function isColumnExpression(value: unknown): value is ColumnExpression {
  return isPlainObject(value) && value.kind === 'column' && typeof value.name === 'string';
}

function isOrderItem(value: unknown): value is OrderItem {
  return (
    isPlainObject(value) &&
    value.kind === 'order-item' &&
    isExpression(value.expression) &&
    (value.direction === 'asc' || value.direction === 'desc')
  );
}

function isExpression(value: unknown): value is Expression {
  return (
    isColumnExpression(value) ||
    (isPlainObject(value) &&
      (value.kind === 'parameter' ||
        value.kind === 'null' ||
        value.kind === 'raw'))
  );
}

export function createDatabase<
  Schema extends SchemaDefinition = Record<string, Record<string, unknown>>,
>(
  executor?: QueryExecutor & {
    readonly transaction?: <T>(
      callback: (executor: QueryExecutor & { readonly transaction?: never }) => Promise<T> | T,
    ) => Promise<T>;
  },
): {
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
    callback: (db: ReturnType<typeof createDatabase<Schema>>) => Promise<T> | T,
  ): Promise<T>;
} {
  const fallbackExecutor = createUnavailableExecutor();
  const contextExecutor = executor ?? fallbackExecutor;
  const context: BuilderContext = {
    execute(_kind, compiled) {
      return contextExecutor.query(compiled);
    },
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
      callback: (db: ReturnType<typeof createDatabase<Schema>>) => Promise<T> | T,
    ): Promise<T> {
      if (typeof contextExecutor.transaction !== 'function') {
        throw new Error('no PostgreSQL executor configured for transactions');
      }

      return await contextExecutor.transaction((txExecutor) =>
        callback(createDatabase<Schema>(txExecutor)),
      );
    },
  });
}

function createUnavailableExecutor(): QueryExecutor & {
  readonly transaction: <T>(
    callback: (executor: QueryExecutor & { readonly transaction?: never }) => Promise<T> | T,
  ) => Promise<T>;
} {
  return {
    query() {
      throw new Error('no PostgreSQL executor configured');
    },
    async transaction<T>() {
      throw new Error('no PostgreSQL executor configured');
    },
  };
}
