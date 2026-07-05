# test

Test taxonomy and future test placement.

## Compiler tests

`test/compiler/` is for SQL compilation tests that compare the canonical model to `{ sql, params }`.

## Integration tests

`test/integration/` is for execution tests against PostgreSQL, including transaction-scoped behavior.

## Type tests

`test/types/` is for compile-time checks of the public API and schema typing surface.

Every later phase must add the tests for the behavior it introduces.
