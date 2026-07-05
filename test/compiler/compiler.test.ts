import { compileQuery } from '../../src/compiler/index.js';
import { quoteIdentifier } from '../../src/dialect/index.js';
import {
  assignment,
  column,
  comparison,
  deleteQuery,
  insertQuery,
  membership,
  nullCheck,
  orderItem,
  parameter,
  rawFragment,
  selectQuery,
  updateQuery,
} from '../../src/core/index.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);

  assert(
    actualText === expectedText,
    `${message}\nexpected: ${expectedText}\nactual:   ${actualText}`,
  );
}

function assertCompile(
  query: Parameters<typeof compileQuery>[0],
  expectedSql: string,
  expectedParams: readonly unknown[],
): void {
  const compiled = compileQuery(query);

  assertEqual(compiled.sql, expectedSql, 'compiled SQL should match');
  assertEqual(compiled.params, expectedParams, 'compiled params should match');
}

function assertThrows(messagePart: string, fn: () => void): void {
  let thrown = false;

  try {
    fn();
  } catch (error) {
    thrown = true;
    assert(error instanceof Error, 'expected an Error to be thrown');
    assert(
      error.message.includes(messagePart),
      `expected "${error.message}" to include "${messagePart}"`,
    );
  }

  assert(thrown, `expected function to throw "${messagePart}"`);
}

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id'), column('email')],
    predicates: [comparison(column('status'), 'equals', parameter('active'))],
    orderBy: [orderItem(column('created_at'), 'desc')],
    limit: 25,
    offset: 5,
  }),
  'SELECT "id", "email" FROM "users" WHERE "status" = $1 ORDER BY "created_at" DESC LIMIT $2 OFFSET $3',
  ['active', 25, 5],
);

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [
      comparison(column('status'), 'equals', parameter('active')),
      nullCheck(column('deleted_at')),
      membership(column('role'), [parameter('admin'), parameter('editor')]),
    ],
  }),
  'SELECT "id" FROM "users" WHERE "status" = $1 AND "deleted_at" IS NULL AND "role" IN ($2, $3)',
  ['active', 'admin', 'editor'],
);

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [comparison(column('role'), 'notEquals', parameter('guest'))],
  }),
  'SELECT "id" FROM "users" WHERE "role" <> $1',
  ['guest'],
);

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [comparison(column('login_count'), 'greaterThan', parameter(10))],
  }),
  'SELECT "id" FROM "users" WHERE "login_count" > $1',
  [10],
);

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [comparison(column('login_count'), 'greaterThanOrEqual', parameter(10))],
  }),
  'SELECT "id" FROM "users" WHERE "login_count" >= $1',
  [10],
);

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [comparison(column('login_count'), 'lessThan', parameter(10))],
  }),
  'SELECT "id" FROM "users" WHERE "login_count" < $1',
  [10],
);

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [comparison(column('login_count'), 'lessThanOrEqual', parameter(10))],
  }),
  'SELECT "id" FROM "users" WHERE "login_count" <= $1',
  [10],
);

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [nullCheck(column('deleted_at'))],
  }),
  'SELECT "id" FROM "users" WHERE "deleted_at" IS NULL',
  [],
);

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [nullCheck(column('deleted_at'), true)],
  }),
  'SELECT "id" FROM "users" WHERE "deleted_at" IS NOT NULL',
  [],
);

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [membership(column('role'), [parameter('admin'), parameter('editor')])],
  }),
  'SELECT "id" FROM "users" WHERE "role" IN ($1, $2)',
  ['admin', 'editor'],
);

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [membership(column('role'), [parameter('archived')], true)],
  }),
  'SELECT "id" FROM "users" WHERE "role" NOT IN ($1)',
  ['archived'],
);

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [comparison(column('email'), 'like', parameter('%@example.com'))],
  }),
  'SELECT "id" FROM "users" WHERE "email" LIKE $1',
  ['%@example.com'],
);

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [comparison(column('email'), 'ilike', parameter('%@example.com'))],
  }),
  'SELECT "id" FROM "users" WHERE "email" ILIKE $1',
  ['%@example.com'],
);

assertCompile(
  insertQuery({
    targetTable: 'users',
    rows: [
      [assignment('email', parameter('ada@example.com')), assignment('name', parameter('Ada'))],
    ],
  }),
  'INSERT INTO "users" ("email", "name") VALUES ($1, $2)',
  ['ada@example.com', 'Ada'],
);

assertCompile(
  insertQuery({
    targetTable: 'users',
    rows: [
      [assignment('email', parameter('ada@example.com')), assignment('name', parameter('Ada'))],
      [assignment('email', parameter('bea@example.com')), assignment('name', parameter('Bea'))],
    ],
    returningColumns: [column('id')],
  }),
  'INSERT INTO "users" ("email", "name") VALUES ($1, $2), ($3, $4) RETURNING "id"',
  ['ada@example.com', 'Ada', 'bea@example.com', 'Bea'],
);

assertCompile(
  updateQuery({
    targetTable: 'users',
    assignments: [assignment('name', parameter('Updated'))],
    predicates: [comparison(column('id'), 'equals', parameter(1))],
  }),
  'UPDATE "users" SET "name" = $1 WHERE "id" = $2',
  ['Updated', 1],
);

assertCompile(
  updateQuery({
    targetTable: 'users',
    assignments: [
      assignment('name', parameter('Updated')),
      assignment('status', parameter('active')),
    ],
    predicates: [
      comparison(column('id'), 'equals', parameter(1)),
      nullCheck(column('deleted_at')),
    ],
    returningColumns: [column('id'), column('status')],
  }),
  'UPDATE "users" SET "name" = $1, "status" = $2 WHERE "id" = $3 AND "deleted_at" IS NULL RETURNING "id", "status"',
  ['Updated', 'active', 1],
);

assertCompile(
  deleteQuery({
    targetTable: 'users',
    predicates: [comparison(column('id'), 'equals', parameter(1))],
  }),
  'DELETE FROM "users" WHERE "id" = $1',
  [1],
);

assertCompile(
  deleteQuery({
    targetTable: 'users',
    predicates: [
      comparison(column('status'), 'equals', parameter('inactive')),
      nullCheck(column('deleted_at')),
    ],
    returningColumns: [column('id')],
  }),
  'DELETE FROM "users" WHERE "status" = $1 AND "deleted_at" IS NULL RETURNING "id"',
  ['inactive'],
);

assert(
  quoteIdentifier('analytics.users') === '"analytics"."users"',
  'schema-qualified identifiers should be quoted per segment',
);

assert(
  quoteIdentifier('weird"name') === '"weird""name"',
  'embedded quotes should be doubled',
);

assertCompile(
  selectQuery({
    sourceTable: 'app.users',
    selectedColumns: [column('full"name')],
    predicates: [comparison(column('status'), 'equals', parameter('active'))],
  }),
  'SELECT "full""name" FROM "app"."users" WHERE "status" = $1',
  ['active'],
);

assertCompile(
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [comparison(column('status'), 'equals', parameter('active'))],
    orderBy: [orderItem(rawFragment('lower("email")'), 'asc')],
    limit: 10,
    offset: 2,
  }),
  'SELECT "id" FROM "users" WHERE "status" = $1 ORDER BY lower("email") ASC LIMIT $2 OFFSET $3',
  ['active', 10, 2],
);

assertThrows('unsupported query kind', () =>
  compileQuery({
    kind: 'merge',
  } as any),
);

assertThrows('selected columns', () =>
  compileQuery({
    kind: 'select',
    sourceTable: 'users',
    selectedColumns: [],
    predicates: [],
    orderBy: [],
  } as any),
);

assertThrows('unsupported predicate kind', () =>
  compileQuery({
    kind: 'select',
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [{ kind: 'between' }],
    orderBy: [],
  } as any),
);

assertThrows('unsupported expression kind', () =>
  compileQuery({
    kind: 'select',
    sourceTable: 'users',
    selectedColumns: [column('id')],
    predicates: [
      comparison({ kind: 'mystery' } as any, 'equals', parameter(1)),
    ],
    orderBy: [],
  }),
);
