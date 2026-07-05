import {
  assertNonEmptyString,
  freezeArray,
  freezeObject,
  type NonEmptyArray,
} from './invariants.js';

export type ComparisonOperator =
  | 'equals'
  | 'notEquals'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'greaterThan'
  | 'greaterThanOrEqual';

export type OrderDirection = 'asc' | 'desc';

export interface ColumnExpression {
  readonly kind: 'column';
  readonly name: string;
}

export interface ParameterExpression<T = unknown> {
  readonly kind: 'parameter';
  readonly value: T;
}

export interface NullLiteralExpression {
  readonly kind: 'null';
}

export interface RawFragmentExpression {
  readonly kind: 'raw';
  readonly text: string;
}

export type Expression =
  | ColumnExpression
  | ParameterExpression
  | NullLiteralExpression
  | RawFragmentExpression;

export interface ComparisonPredicate {
  readonly kind: 'comparison';
  readonly left: Expression;
  readonly operator: ComparisonOperator;
  readonly right: Expression;
}

export interface NullCheckPredicate {
  readonly kind: 'null-check';
  readonly expression: Expression;
  readonly negated: boolean;
}

export interface MembershipPredicate {
  readonly kind: 'membership';
  readonly expression: Expression;
  readonly values: NonEmptyArray<Expression>;
  readonly negated: boolean;
}

export type Predicate = ComparisonPredicate | NullCheckPredicate | MembershipPredicate;

export interface OrderItem {
  readonly kind: 'order-item';
  readonly expression: Expression;
  readonly direction: OrderDirection;
}

export interface Assignment {
  readonly kind: 'assignment';
  readonly column: string;
  readonly value: Expression;
}

export function column(name: string): ColumnExpression {
  return freezeObject({
    kind: 'column',
    name: assertNonEmptyString(name, 'column name'),
  });
}

export function parameter<T>(value: T): ParameterExpression<T> {
  return freezeObject({
    kind: 'parameter',
    value,
  });
}

export function nullLiteral(): NullLiteralExpression {
  return freezeObject({
    kind: 'null',
  });
}

export function rawFragment(text: string): RawFragmentExpression {
  return freezeObject({
    kind: 'raw',
    text: assertNonEmptyString(text, 'raw fragment text'),
  });
}

export function comparison(
  left: Expression,
  operator: ComparisonOperator,
  right: Expression,
): ComparisonPredicate {
  assertComparisonOperator(operator);

  return freezeObject({
    kind: 'comparison',
    left,
    operator,
    right,
  });
}

export function nullCheck(
  expression: Expression,
  negated = false,
): NullCheckPredicate {
  return freezeObject({
    kind: 'null-check',
    expression,
    negated,
  });
}

export function membership(
  expression: Expression,
  values: NonEmptyArray<Expression>,
  negated = false,
): MembershipPredicate {
  return freezeObject({
    kind: 'membership',
    expression,
    values: freezeArray(values),
    negated,
  });
}

export function orderItem(
  expression: Expression,
  direction: OrderDirection = 'asc',
): OrderItem {
  assertOrderDirection(direction);

  return freezeObject({
    kind: 'order-item',
    expression,
    direction,
  });
}

export function assignment(columnName: string, value: Expression): Assignment {
  return freezeObject({
    kind: 'assignment',
    column: assertNonEmptyString(columnName, 'assignment column'),
    value,
  });
}

function assertComparisonOperator(
  operator: ComparisonOperator,
): ComparisonOperator {
  switch (operator) {
    case 'equals':
    case 'notEquals':
    case 'lessThan':
    case 'lessThanOrEqual':
    case 'greaterThan':
    case 'greaterThanOrEqual':
      return operator;
    default:
      throw new TypeError(`invalid comparison operator: ${String(operator)}`);
  }
}

function assertOrderDirection(direction: OrderDirection): OrderDirection {
  switch (direction) {
    case 'asc':
    case 'desc':
      return direction;
    default:
      throw new TypeError(`invalid order direction: ${String(direction)}`);
  }
}
