# Phase 0: Foundation Lock and Repo Contract

This phase freezes the structure, ownership, and scope of the project. It deliberately does not add runtime query behavior.

## Phase 0 includes

- repository contract documentation
- module scaffolding
- layer ownership rules
- MVP scope boundaries
- deferred scope
- test taxonomy
- delivery discipline for later phases

## Phase 0 excludes

- query execution
- a real SQL compiler
- joins
- grouped predicates
- migrations
- schema introspection
- auth, RBAC, RLS, or policy logic
- ORM-style entity or repository abstractions

## Architecture Lock

The project is split into four layers plus supporting modules.

| Layer | Owns | Does not own |
| --- | --- | --- |
| `src/builders/` | public fluent API, immutable builder state, terminal `compile` and `execute` entrypoints | SQL rendering, DB calls, auth/policy logic |
| `src/core/` | canonical immutable query model, expressions, predicates, serialized state shape | fluent ergonomics, SQL rendering, execution context |
| `src/compiler/` | pure conversion from query model to `{ sql, params }`, deterministic placeholder numbering, identifier quoting | DB access, transactions, query mutation |
| `src/driver/` | execution of compiled SQL, rows/errors, transaction-scoped execution context | query construction, compilation, business rules |
| `src/db/` | root db facade and transaction facade wiring | query model design, SQL rendering, driver internals |
| `src/dialect/` | PostgreSQL-specific quoting and rendering conventions | multi-dialect support, generic SQL abstraction |
| `src/types/` | basic schema typing helpers | advanced inference machinery, entity modeling |
| `src/errors/` | shared structured error types | policy, auth, or application-specific rules |

### Layer rules

- Public builders must stay immutable.
- The compiler must stay pure, deterministic, and side-effect free.
- PostgreSQL is the only target dialect.
- The canonical query model must remain structured, immutable, and serializable as plain JavaScript objects.
- The builder layer owns SQL composition, not authorization or policy logic.
- Transactions belong to execution context, not query definition.

## Module Map

The planned repository structure is:

```text
src/
  core/
  builders/
  compiler/
  dialect/
  driver/
  db/
  types/
  errors/
test/
  compiler/
  integration/
  types/
```

### `src/core/`

Canonical immutable query model, expressions, predicates, and state transitions.

### `src/builders/`

Public fluent builders and terminal methods. This layer composes query model objects and returns new immutable builder instances.

### `src/compiler/`

Pure SQL compiler that accepts the canonical query model and returns `{ sql, params }`.

### `src/dialect/`

PostgreSQL-specific rendering conventions and identifier quoting helpers. This is a seam, not a multi-dialect system.

### `src/driver/`

Thin execution adapters that run compiled SQL and surface rows and errors.

### `src/db/`

Root database facade and transaction-scoped facade. Both must use the same builder implementation.

### `src/types/`

Basic schema typing helpers for single-table queries.

### `src/errors/`

Shared error types and constructors.

### `test/`

Test taxonomy and future test placement.

## MVP Boundary

### In MVP

- select
- insert
- update
- delete
- single-table queries only
- where predicates
- chained `AND` conditions
- order by
- limit
- offset
- returning on insert, update, and delete
- compile
- execute
- transaction facade
- basic schema typing

### Out of MVP

- joins
- group by
- having
- aggregates as first-class helpers
- `OR` predicate DSL
- nested boolean groups
- cursor pagination
- keyset pagination helpers
- migrations
- schema introspection
- eager loading
- relation modeling
- repository helpers
- entity models
- policy DSL
- RBAC abstractions
- RLS helpers
- service vs user auth logic
- dialect expansion
- advanced Kysely-style type inference
- hidden convenience methods like `findById`

## Test Taxonomy

### Compiler tests

Compiler tests verify that the canonical query model renders to the expected SQL and parameter list.

They must cover:

- placeholder ordering
- identifier quoting
- clause ordering
- `WHERE` chaining with `AND`
- `ORDER BY`
- `LIMIT`
- `OFFSET`
- `RETURNING`

The first phase that introduces compiler logic must add these tests.

### Integration tests

Integration tests exercise the driver and transaction facade against PostgreSQL.

They must cover:

- root db execution
- transaction-scoped execution
- returned rows
- surfaced execution errors

The first phase that introduces execution must add these tests.

### Type tests

Type tests verify the public API surface and basic schema typing behavior.

They must cover:

- builder input/output typing
- table and column shape typing
- compile and execute method typing
- transaction facade typing

The first phase that introduces public typing behavior must add these tests.

## Delivery Discipline

Every later phase must:

- obey `COMMON_GUIDANCE.md`
- stay within the stated scope
- add the required tests for the behavior it introduces
- explicitly document deferred items
- avoid future-phase leakage
- keep the compiler pure and the builders immutable
- keep PostgreSQL as the only supported target

If a phase would require joins, multi-dialect support, or policy logic, it must stop and document the deferral instead of widening scope.
