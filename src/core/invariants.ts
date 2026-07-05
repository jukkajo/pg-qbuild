export function assertNonEmptyString(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }

  return value;
}

export type NonEmptyArray<T> = readonly [T, ...T[]];

export function assertFiniteInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite integer`);
  }

  return value;
}

export function assertNonNegativeInteger(value: number, name: string): number {
  assertFiniteInteger(value, name);

  if (value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }

  return value;
}

export function assertNonEmptyArray<T>(
  values: readonly T[],
  name: string,
): NonEmptyArray<T> {
  if (values.length === 0) {
    throw new TypeError(`${name} must contain at least one item`);
  }

  return values as NonEmptyArray<T>;
}

export function freezeArray<T extends readonly unknown[]>(values: T): T {
  return Object.freeze([...values]) as T;
}

export function freezeObject<T extends object>(value: T): T {
  return Object.freeze(value) as T;
}

export function assertUniqueColumns(
  entries: readonly { readonly column: string }[],
  context: string,
): void {
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.column)) {
      throw new TypeError(`${context} cannot contain duplicate column "${entry.column}"`);
    }

    seen.add(entry.column);
  }
}

export function assertSameColumnOrder(
  firstRow: readonly { readonly column: string }[],
  otherRow: readonly { readonly column: string }[],
  context: string,
): void {
  if (firstRow.length !== otherRow.length) {
    throw new TypeError(
      `${context} must use the same column set in every row and preserve column order`,
    );
  }

  for (let index = 0; index < firstRow.length; index += 1) {
    if (firstRow[index]?.column !== otherRow[index]?.column) {
      throw new TypeError(
        `${context} must use the same column set in every row and preserve column order`,
      );
    }
  }
}
