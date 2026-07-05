import { assertNonEmptyString } from '../core/invariants.js';

export function quoteIdentifier(identifier: string): string {
  assertNonEmptyString(identifier, 'identifier');

  const parts = identifier.split('.');

  if (parts.some((part) => part.trim().length === 0)) {
    throw new TypeError('identifier must not contain empty path segments');
  }

  return parts.map(quoteIdentifierPart).join('.');
}

function quoteIdentifierPart(part: string): string {
  return `"${part.replaceAll('"', '""')}"`;
}
