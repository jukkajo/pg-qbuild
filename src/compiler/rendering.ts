import {
  assertNonEmptyArray,
  assertNonNegativeInteger,
  assertUniqueColumns,
} from '../core/invariants.js';
import type {
  Assignment,
  ColumnExpression,
  ComparisonPredicate,
  DeleteQuery,
  Expression,
  InsertQuery,
  MembershipPredicate,
  NullCheckPredicate,
  OrderItem,
  Predicate,
  Query,
  SelectQuery,
  UpdateQuery,
} from '../core/index.js';
import { quoteIdentifier } from '../dialect/index.js';

export interface CompiledQuery {
  sql: string;
  params: unknown[];
}

interface RenderState {
  readonly params: unknown[];
}

export function compileQuery(query: Query): CompiledQuery {
  assertQueryObject(query);

  const state: RenderState = { params: [] };
  const sql = renderQuery(query, state);

  return {
    sql,
    params: state.params.slice(),
  };
}

function renderQuery(query: Query, state: RenderState): string {
  switch (query.kind) {
    case 'select':
      return renderSelect(query, state);
    case 'insert':
      return renderInsert(query, state);
    case 'update':
      return renderUpdate(query, state);
    case 'delete':
      return renderDelete(query, state);
    default:
      throw new TypeError(`unsupported query kind: ${String((query as { kind?: unknown }).kind)}`);
  }
}

function renderSelect(query: SelectQuery, state: RenderState): string {
  assertNonEmptyArray(query.selectedColumns, 'selected columns');
  assertNonNegativeIntegerIfDefined(query.limit, 'limit');
  assertNonNegativeIntegerIfDefined(query.offset, 'offset');

  const parts = [
    `SELECT ${renderColumnList(query.selectedColumns)}`,
    `FROM ${quoteIdentifier(query.sourceTable)}`,
  ];

  const whereClause = renderWhereClause(query.predicates, state);
  if (whereClause !== '') {
    parts.push(whereClause);
  }

  const orderByClause = renderOrderByClause(query.orderBy, state);
  if (orderByClause !== '') {
    parts.push(orderByClause);
  }

  if (query.limit !== undefined) {
    parts.push(`LIMIT ${renderBoundValue(query.limit, state)}`);
  }

  if (query.offset !== undefined) {
    parts.push(`OFFSET ${renderBoundValue(query.offset, state)}`);
  }

  return parts.join(' ');
}

function renderInsert(query: InsertQuery, state: RenderState): string {
  assertNonEmptyArray(query.rows, 'insert rows');
  const firstRow = assertNonEmptyRow(query.rows[0], 'insert rows');
  const normalizedRows = query.rows.map((row, rowIndex) =>
    assertNonEmptyInsertRow(row, rowIndex),
  );

  const columns = firstRow.map((assignment) => assignment.column);
  assertUniqueColumns(firstRow, 'insert rows');

  for (let index = 1; index < normalizedRows.length; index += 1) {
    assertSameInsertRowShape(firstRow, normalizedRows[index]!, index + 1);
  }

  const valuesSql = normalizedRows
    .map((row) => `(${row.map((assignment) => renderExpression(assignment.value, state)).join(', ')})`)
    .join(', ');

  const parts = [
    `INSERT INTO ${quoteIdentifier(query.targetTable)} (${renderIdentifierList(columns)})`,
    `VALUES ${valuesSql}`,
  ];

  if (query.returningColumns !== undefined) {
    assertNonEmptyArray(query.returningColumns, 'returning columns');
    parts.push(`RETURNING ${renderColumnList(query.returningColumns)}`);
  }

  return parts.join(' ');
}

function renderUpdate(query: UpdateQuery, state: RenderState): string {
  assertNonEmptyArray(query.assignments, 'update assignments');
  assertUniqueColumns(query.assignments, 'update assignments');

  const parts = [
    `UPDATE ${quoteIdentifier(query.targetTable)}`,
    `SET ${query.assignments.map((assignment) => renderAssignment(assignment, state)).join(', ')}`,
  ];

  const whereClause = renderWhereClause(query.predicates, state);
  if (whereClause !== '') {
    parts.push(whereClause);
  }

  if (query.returningColumns !== undefined) {
    assertNonEmptyArray(query.returningColumns, 'returning columns');
    parts.push(`RETURNING ${renderColumnList(query.returningColumns)}`);
  }

  return parts.join(' ');
}

function renderDelete(query: DeleteQuery, state: RenderState): string {
  const parts = [`DELETE FROM ${quoteIdentifier(query.targetTable)}`];

  const whereClause = renderWhereClause(query.predicates, state);
  if (whereClause !== '') {
    parts.push(whereClause);
  }

  if (query.returningColumns !== undefined) {
    assertNonEmptyArray(query.returningColumns, 'returning columns');
    parts.push(`RETURNING ${renderColumnList(query.returningColumns)}`);
  }

  return parts.join(' ');
}

function renderWhereClause(predicates: readonly Predicate[], state: RenderState): string {
  if (predicates.length === 0) {
    return '';
  }

  return `WHERE ${predicates.map((predicate) => renderPredicate(predicate, state)).join(' AND ')}`;
}

function renderOrderByClause(orderBy: readonly OrderItem[], state: RenderState): string {
  if (orderBy.length === 0) {
    return '';
  }

  return `ORDER BY ${orderBy
    .map((item) => `${renderExpression(item.expression, state)} ${renderDirection(item.direction)}`)
    .join(', ')}`;
}

function renderPredicate(predicate: Predicate, state: RenderState): string {
  switch (predicate.kind) {
    case 'comparison':
      return renderComparisonPredicate(predicate, state);
    case 'null-check':
      return renderNullCheckPredicate(predicate, state);
    case 'membership':
      return renderMembershipPredicate(predicate, state);
    default:
      throw new TypeError(
        `unsupported predicate kind: ${String((predicate as { kind?: unknown }).kind)}`,
      );
  }
}

function renderComparisonPredicate(
  predicate: ComparisonPredicate,
  state: RenderState,
): string {
  return `${renderExpression(predicate.left, state)} ${renderComparisonOperator(predicate.operator)} ${renderExpression(predicate.right, state)}`;
}

function renderNullCheckPredicate(
  predicate: NullCheckPredicate,
  state: RenderState,
): string {
  return `${renderExpression(predicate.expression, state)} IS${predicate.negated ? ' NOT' : ''} NULL`;
}

function renderMembershipPredicate(
  predicate: MembershipPredicate,
  state: RenderState,
): string {
  assertNonEmptyArray(predicate.values, 'membership values');

  return `${renderExpression(predicate.expression, state)} ${predicate.negated ? 'NOT IN' : 'IN'} (${predicate.values
    .map((value) => renderExpression(value, state))
    .join(', ')})`;
}

function renderComparisonOperator(operator: ComparisonPredicate['operator']): string {
  switch (operator) {
    case 'equals':
      return '=';
    case 'notEquals':
      return '<>';
    case 'lessThan':
      return '<';
    case 'lessThanOrEqual':
      return '<=';
    case 'greaterThan':
      return '>';
    case 'greaterThanOrEqual':
      return '>=';
    case 'like':
      return 'LIKE';
    case 'ilike':
      return 'ILIKE';
    default:
      throw new TypeError(`unsupported comparison operator: ${String(operator)}`);
  }
}

function renderExpression(expression: Expression, state: RenderState): string {
  switch (expression.kind) {
    case 'column':
      return quoteIdentifier(expression.name);
    case 'parameter':
      return renderBoundValue(expression.value, state);
    case 'null':
      return 'NULL';
    case 'raw':
      return expression.text;
    default:
      throw new TypeError(
        `unsupported expression kind: ${String((expression as { kind?: unknown }).kind)}`,
      );
  }
}

function renderAssignment(assignment: Assignment, state: RenderState): string {
  assertAssignmentShape(assignment);

  return `${quoteIdentifier(assignment.column)} = ${renderExpression(assignment.value, state)}`;
}

function renderColumnList(columns: readonly ColumnExpression[]): string {
  assertNonEmptyArray(columns, 'selected columns');

  return columns.map((column) => quoteIdentifier(column.name)).join(', ');
}

function renderIdentifierList(columns: readonly string[]): string {
  assertNonEmptyArray(columns, 'identifier list');

  return columns.map((column) => quoteIdentifier(column)).join(', ');
}

function renderDirection(direction: OrderItem['direction']): string {
  switch (direction) {
    case 'asc':
      return 'ASC';
    case 'desc':
      return 'DESC';
    default:
      throw new TypeError(`unsupported order direction: ${String(direction)}`);
  }
}

function renderBoundValue(value: unknown, state: RenderState): string {
  state.params.push(value);
  return `$${state.params.length}`;
}

function assertQueryObject(value: Query): asserts value is Query {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('query must be an object');
  }
}

function assertNonNegativeIntegerIfDefined(value: number | undefined, name: string): void {
  if (value !== undefined) {
    assertNonNegativeInteger(value, name);
  }
}

function assertNonEmptyRow(
  row: readonly Assignment[] | undefined,
  context: string,
): readonly Assignment[] {
  if (row === undefined || row.length === 0) {
    throw new TypeError(`${context} must contain at least one row`);
  }

  return row;
}

function assertNonEmptyInsertRow(
  row: readonly Assignment[],
  rowIndex: number,
): readonly Assignment[] {
  if (row.length === 0) {
    throw new TypeError(`insert row ${rowIndex + 1} must contain at least one assignment`);
  }

  assertUniqueColumns(row, `insert row ${rowIndex + 1}`);

  return row;
}

function assertSameInsertRowShape(
  firstRow: readonly Assignment[],
  otherRow: readonly Assignment[],
  rowNumber: number,
): void {
  if (firstRow.length !== otherRow.length) {
    throw new TypeError('insert rows must use the same column set in every row and preserve column order');
  }

  for (let index = 0; index < firstRow.length; index += 1) {
    const firstAssignment = firstRow[index];
    const otherAssignment = otherRow[index];

    if (firstAssignment?.column !== otherAssignment?.column) {
      throw new TypeError('insert rows must use the same column set in every row and preserve column order');
    }
  }

  assertUniqueColumns(otherRow, `insert row ${rowNumber}`);
}

function assertAssignmentShape(value: Assignment): asserts value is Assignment {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('assignment must be an object');
  }

  if (value.kind !== 'assignment') {
    throw new TypeError(`unsupported assignment kind: ${String(value.kind)}`);
  }
}
