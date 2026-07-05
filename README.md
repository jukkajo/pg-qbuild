# pg-qbuild

A small SQL-first TypeScript query builder for PostgreSQL with immutable builders, a pure compiler, and basic schema typing.

## What it is

`pg-qbuild` builds single-table PostgreSQL queries in TypeScript and compiles them to parameterized SQL.

It provides separate builders for `select`, `insert`, `update`, and `delete`, plus a thin Postgres execution layer and transaction support. The internal query model is structured and immutable, and SQL generation stays separate from runtime execution.

## Why use it

Use it when you want:

- a small query builder instead of an ORM
- SQL-shaped APIs that stay close to the queries you are writing
- parameterized SQL and Postgres-safe identifier quoting
- simple schema-aware typing for tables, columns, inserts, updates, and selected rows
- one builder API that works both directly and inside transactions

## Installation

This repository is currently marked `private`, so installation is local or registry-managed rather than a public package install.

Build this project first:

```bash
npm install
npm run build
```

Then add it to another project from a local path or your own registry:

```bash
npm install /path/to/pg-qbuild
```

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

await db.transaction(async (tx) => {
  await tx
    .deleteFrom('users')
    .where(comparison(column('status'), 'equals', parameter('inactive')))
    .execute();
});

await driver.close();

void activeUsers;
void insertedUser;
void compiled;
```

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
