# pg-qbuild

A small SQL-first TypeScript query builder for PostgreSQL with immutable builders, a pure compiler, and basic schema typing.

## What it is

`pg-qbuild` builds single-table PostgreSQL queries in TypeScript and compiles them to SQL plus parameter values.

It provides separate builders for `select`, `insert`, `update`, and `delete`, plus a thin Postgres execution layer and transaction support. The internal query model is structured and immutable, and SQL generation stays separate from runtime execution.

## Why use it

Use it when you want:

- a small query builder instead of an ORM
- SQL-shaped APIs that stay close to the queries you are writing
- protocol-bound PostgreSQL parameters and Postgres-safe identifier quoting
- simple schema-aware typing for tables, columns, inserts, updates, and selected rows
- one builder API that works both directly and inside transactions

## Installation

This repository still keeps `"private": true` to avoid accidental publication, but the built package can still be consumed from a local path or git dependency.

Build this project first:

```bash
npm install
npm run build
```

Then add it to another project from a local path or git URL:

```bash
npm install /path/to/pg-qbuild
```

If you later publish the package to a registry, remove `"private": true` first.

## Basic usage

```ts
import {
  column,
  comparison,
  createDb,
  createPostgresDriver,
  orderItem,
  parameter,
} from 'pg-qbuild';

interface AppSchema {
  readonly users: {
    readonly id: number;
    readonly email: string;
    readonly status: string;
  };
}

const driver = createPostgresDriver({
  connectionString: process.env.DATABASE_URL,
});

const db = createDb<AppSchema>(driver);

const activeUsers = await db
  .selectFrom('users')
  .select('id', 'email')
  .where(comparison(column('status'), 'equals', parameter('active')))
  .orderBy(orderItem(column('id'), 'asc'))
  .limit(10)
  .execute();

const insertedUser = await db
  .insertInto('users')
  .values({
    email: 'ada@example.com',
    status: 'active',
  })
  .returning('id', 'email')
  .executeTakeFirst();

const compiled = db
  .updateTable('users')
  .set({ status: 'inactive' })
  .where(comparison(column('email'), 'equals', parameter('ada@example.com')))
  .compile();

await db.execute(compiled);

await db.execute(
  'CREATE INDEX IF NOT EXISTS users_email_idx ON users (email)',
);

await db.transaction(async (tx) => {
  await tx.execute('SELECT pg_advisory_xact_lock($1::bigint)', [42n]);

  await tx
    .deleteFrom('users')
    .where(comparison(column('status'), 'equals', parameter('inactive')))
    .execute();
});

await driver.close();

void activeUsers;
void insertedUser;
```

## Direct SQL execution

Use `db.execute(...)` or `tx.execute(...)` when you need SQL that is outside the query builder:

```ts
await db.execute(
  `
    CREATE TABLE IF NOT EXISTS app_private.audit_log (
      id BIGSERIAL PRIMARY KEY,
      actor_id UUID NOT NULL,
      action TEXT NOT NULL
    )
  `,
);

await db.execute(
  'INSERT INTO app_private.audit_log (actor_id, action) VALUES ($1::uuid, $2)',
  ['00000000-0000-0000-0000-000000000001', 'bootstrap'],
);
```

`execute(...)` accepts either:

- a raw SQL string plus `params`
- a compiled query object shaped like `{ sql, params }`, including the output of `.compile()`

This is intentionally just a SQL execution path. Migration discovery, migration journals, schema introspection, and other higher-level workflows stay outside the library.

## Parameter handling

- Builder parameters created with `parameter(...)` and direct `execute(sql, params)` calls use PostgreSQL protocol-level parameter binding through the extended query protocol.
- `pg-qbuild` does not cache named prepared statements. Each parameterized execution uses the unnamed prepared statement/portal for that round-trip only.
- `rawFragment(...)` bypasses parameter binding and injects SQL text directly. Only use it with trusted SQL.
- Plain objects are encoded as JSON text. JavaScript arrays are encoded as PostgreSQL array values.
- Empty arrays work when PostgreSQL can infer the target array type, or when you cast explicitly in raw SQL.
- Raw SQL parameters still need a PostgreSQL type context. If the server cannot infer a type, add an explicit cast such as `$1::jsonb`, `$1::text[]`, or `$1::uuid`.
- Multi-statement raw SQL is supported when `params` is empty. Parameterized raw SQL should be a single statement.

Input binding is protocol-bound, but result decoding remains intentionally small and explicit. Common scalars, JSON, and `bytea` are decoded for you; timestamps and arrays are left in PostgreSQL text form unless you cast them in SQL.

## Migrations

Schema migrations are intentionally outside `pg-qbuild`.

Use any migration runner you prefer, and let each migration step call `db.execute(...)` or `tx.execute(...)` for DDL, grants, RLS policies, functions, triggers, indexes, extensions, or advisory locks. The library stays focused on compiling and executing SQL, not on discovering or journaling migration files.

## Features

- PostgreSQL-only query compilation and execution
- Single-table `select`, `insert`, `update`, and `delete`
- `where` predicates with:
  - equality and inequality
  - greater than / greater than or equal
  - less than / less than or equal
  - `in` / `not in`
  - `is null` / `is not null`
  - `like` / `ilike`
  - repeated `where` clauses combined with `AND`
- `orderBy`, `limit`, and `offset`
- `returning` on `insert`, `update`, and `delete`
- `.compile()` to `{ sql, params }`
- `db.execute(sql, params?)` and `tx.execute(sql, params?)`
- `db.execute(compiledQuery)` and `tx.execute(compiledQuery)`
- `.execute()`, `.executeTakeFirst()`, and `.executeTakeFirstOrThrow()`
- transaction-scoped facade with the same builder API
- optional query lifecycle hooks for before/after execution events
- basic schema typing for table names, column names, payloads, and selected row shapes

## What it does not support

- joins
- grouped boolean expressions or an `OR` predicate DSL
- `group by`, `having`, or aggregate helpers
- cursor or keyset pagination helpers
- migrations or schema introspection
- relation modeling, eager loading, or repository-style helpers
- auth, policy, RLS, or RBAC abstractions
- multi-dialect SQL support
- advanced type inference beyond simple single-table typing

## Design summary

- Builders are immutable: each call returns a fresh builder state.
- The internal query model is the canonical representation of a query.
- The compiler is pure and deterministic: it turns the query model into `{ sql, params }`.
- The driver executes compiled SQL and owns transaction behavior.
- The public API stays SQL-first rather than ORM-shaped.
