import {
  assignment,
  column,
  comparison,
  compileQuery,
  createDatabase,
  deleteQuery,
  insertQuery,
  nullCheck,
  orderItem,
  parameter,
  selectQuery,
  type CompiledQuery,
  type QueryRows,
  updateQuery,
} from '../../src/index.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);

  assert(actualText === expectedText, `${message}\nexpected: ${expectedText}\nactual:   ${actualText}`);
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

async function assertRejects(
  fn: () => Promise<unknown>,
  messagePart: string,
): Promise<void> {
  let rejected = false;

  try {
    await fn();
  } catch (error) {
    rejected = true;
    assert(error instanceof Error, 'expected an Error to be thrown');
    assert(
      error.message.includes(messagePart),
      `expected "${error.message}" to include "${messagePart}"`,
    );
  }

  assert(rejected, `expected promise to reject with "${messagePart}"`);
}

const db = createDatabase();
const selectBase = db.selectFrom('users');
const selectWithId = selectBase.select('id');
const selectWithIdAndEmail = selectWithId.select('email');

assert(selectBase !== selectWithId, 'select builder should return a new instance');
assert(selectWithId !== selectWithIdAndEmail, 'select builder chaining should keep returning new instances');
assert(typeof selectWithId.executeTakeFirst === 'function', 'select builder should expose executeTakeFirst');
assert(
  typeof selectWithId.executeTakeFirstOrThrow === 'function',
  'select builder should expose executeTakeFirstOrThrow',
);

assertThrows('selected columns', () => {
  selectBase.compile();
});

assertThrows('order by items', () => {
  // @ts-expect-error deliberate runtime arity check
  db.selectFrom('users').select('id').orderBy();
});

assertEqual(
  selectWithId.compile(),
  compileQuery(selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id')],
  })),
  'select builder should compile through the canonical compiler',
);

assertEqual(
  selectWithIdAndEmail
    .where(comparison(column('status'), 'equals', parameter('active')))
    .where(nullCheck(column('deleted_at')))
    .orderBy(orderItem(column('created_at'), 'desc'))
    .limit(10)
    .offset(5)
    .compile(),
  compileQuery(selectQuery({
    sourceTable: 'users',
    selectedColumns: [column('id'), column('email')],
    predicates: [
      comparison(column('status'), 'equals', parameter('active')),
      nullCheck(column('deleted_at')),
    ],
    orderBy: [orderItem(column('created_at'), 'desc')],
    limit: 10,
    offset: 5,
  })),
  'select builder should preserve SQL-first clause ordering',
);

const insertBase = db.insertInto('users');
assertThrows('insert rows', () => {
  // @ts-expect-error deliberate runtime arity check
  insertBase.values();
});

const insertOneRow = insertBase.values([
  assignment('email', parameter('ada@example.com')),
  assignment('name', parameter('Ada')),
]);
const insertTwoRows = insertOneRow.values([
  assignment('email', parameter('bea@example.com')),
  assignment('name', parameter('Bea')),
]);

assert(insertBase !== insertOneRow, 'insert builder should return a new instance');
assert(insertOneRow !== insertTwoRows, 'insert builder chaining should keep returning new instances');
assert(typeof insertOneRow.executeTakeFirst === 'function', 'insert builder should expose executeTakeFirst');

assertEqual(
  insertOneRow.compile(),
  compileQuery(insertQuery({
    targetTable: 'users',
    rows: [
      [
        assignment('email', parameter('ada@example.com')),
        assignment('name', parameter('Ada')),
      ],
    ],
  })),
  'insert builder should compile a single-row insert',
);

assertEqual(
  insertTwoRows.returning('id').compile(),
  compileQuery(insertQuery({
    targetTable: 'users',
    rows: [
      [
        assignment('email', parameter('ada@example.com')),
        assignment('name', parameter('Ada')),
      ],
      [
        assignment('email', parameter('bea@example.com')),
        assignment('name', parameter('Bea')),
      ],
    ],
    returningColumns: [column('id')],
  })),
  'insert builder should preserve multiple rows and returning columns',
);

const updateBase = db.updateTable('users');
assertThrows('update assignments', () => {
  // @ts-expect-error deliberate runtime arity check
  updateBase.set();
});
assertThrows('duplicate column', () => {
  db.updateTable('users').set(assignment('name', parameter('Ada')), assignment('name', parameter('Bea')));
});

const updateWithName = updateBase.set(assignment('name', parameter('Ada')));
const updateWithStatus = updateWithName
  .set(assignment('status', parameter('active')))
  .where(comparison(column('id'), 'equals', parameter(1)))
  .returning('id', 'status');

assert(updateBase !== updateWithName, 'update builder should return a new instance');
assert(updateWithName !== updateWithStatus, 'update builder chaining should keep returning new instances');
assert(typeof updateWithName.executeTakeFirstOrThrow === 'function', 'update builder should expose executeTakeFirstOrThrow');

assertEqual(
  updateWithName.compile(),
  compileQuery(updateQuery({
    targetTable: 'users',
    assignments: [assignment('name', parameter('Ada'))],
  })),
  'update builder should compile the base assignment set',
);

assertEqual(
  updateWithStatus.compile(),
  compileQuery(updateQuery({
    targetTable: 'users',
    assignments: [
      assignment('name', parameter('Ada')),
      assignment('status', parameter('active')),
    ],
    predicates: [comparison(column('id'), 'equals', parameter(1))],
    returningColumns: [column('id'), column('status')],
  })),
  'update builder should compile chained predicates and returning columns',
);

const deleteBase = db.deleteFrom('users');
const deleteWithWhere = deleteBase
  .where(comparison(column('status'), 'equals', parameter('inactive')))
  .returning('id');

assert(deleteBase !== deleteWithWhere, 'delete builder should return a new instance');
assert(typeof deleteWithWhere.executeTakeFirst === 'function', 'delete builder should expose executeTakeFirst');

assertEqual(
  deleteBase.compile(),
  compileQuery(deleteQuery({
    targetTable: 'users',
  })),
  'delete builder should compile a bare delete',
);

assertEqual(
  deleteWithWhere.compile(),
  compileQuery(deleteQuery({
    targetTable: 'users',
    predicates: [comparison(column('status'), 'equals', parameter('inactive'))],
    returningColumns: [column('id')],
  })),
  'delete builder should compile where clauses and returning columns',
);

const executedQueries: Array<{
  readonly scope: 'root' | 'transaction';
  readonly sql: string;
  readonly params: readonly unknown[];
}> = [];

const executingDb = createDatabase({
  async query(compiled: CompiledQuery): Promise<QueryRows> {
    executedQueries.push({
      scope: 'root',
      sql: compiled.sql,
      params: compiled.params,
    });

    return [{ ok: true }];
  },
  async transaction<T>(
    callback: (
      executor: {
        readonly query: (compiled: CompiledQuery) => Promise<QueryRows>;
        readonly transaction?: never;
      },
    ) => Promise<T> | T,
  ) {
    return await callback({
      async query(compiled: CompiledQuery): Promise<QueryRows> {
        executedQueries.push({
          scope: 'transaction',
          sql: compiled.sql,
          params: compiled.params,
        });

        return [];
      },
    });
  },
});

assertEqual(
  await executingDb.execute('SELECT $1 AS value', [`O'Reilly -- still literal`]),
  [{ ok: true }],
  'execute should forward raw SQL rows through the configured executor',
);

assertEqual(
  executedQueries[0],
  {
    scope: 'root',
    sql: 'SELECT $1 AS value',
    params: [`O'Reilly -- still literal`],
  },
  'execute should preserve raw SQL text and params',
);

const compiledSelect = db
  .selectFrom('users')
  .select('id')
  .where(comparison(column('email'), 'equals', parameter('ada@example.com')))
  .compile();

await executingDb.execute(compiledSelect);

assertEqual(
  executedQueries[1],
  {
    scope: 'root',
    sql: compiledSelect.sql,
    params: compiledSelect.params,
  },
  'execute should accept a precompiled query object',
);

await executingDb.transaction(async (tx) => {
  await tx.execute('SELECT $1::int AS value', [1]);
});

assertEqual(
  executedQueries[2],
  {
    scope: 'transaction',
    sql: 'SELECT $1::int AS value',
    params: [1],
  },
  'execute should remain available inside transactions',
);

await assertRejects(
  () => createDatabase().execute('SELECT 1'),
  'no PostgreSQL executor configured',
);

await assertRejects(
  () => executingDb.execute('   '),
  'sql must be a non-empty string',
);
