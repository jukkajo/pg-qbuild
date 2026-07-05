import { column, type ColumnExpression } from '../core/index.js';
import {
  assertNonEmptyArray,
  assertNonEmptyString,
  assertNonNegativeInteger,
  freezeArray,
  type NonEmptyArray,
} from '../core/invariants.js';

export function appendFrozen<T>(
  existing: readonly T[],
  values: readonly T[],
): readonly T[] {
  return freezeArray([...existing, ...values]);
}

export function normalizeStrings(
  values: readonly string[],
  listName: string,
  itemName: string,
): NonEmptyArray<string> {
  const nonEmptyValues = assertNonEmptyArray(values, listName);
  return freezeArray(
    nonEmptyValues.map((value) => assertNonEmptyString(value, itemName)),
  ) as unknown as NonEmptyArray<string>;
}

export function normalizeColumns(
  values: readonly string[],
  listName: string,
  itemName: string,
): NonEmptyArray<ColumnExpression> {
  const nonEmptyValues = normalizeStrings(values, listName, itemName);
  return freezeArray(nonEmptyValues.map((value) => column(value))) as unknown as NonEmptyArray<ColumnExpression>;
}

export function assertNonNegativeIntegerIfDefined(
  value: number | undefined,
  name: string,
): void {
  if (value !== undefined) {
    assertNonNegativeInteger(value, name);
  }
}
