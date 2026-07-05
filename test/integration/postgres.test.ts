import { createDb, createPostgresDriver } from '../../src/index.js';
import {
  column,
  comparison,
  orderItem,
  parameter,
  type DatabaseFacade,
} from '../../src/index.js';

interface TestSchema {
  readonly pg_qbuild_users: {
    readonly id: number;
    readonly email: string;
    readonly name: string;
    readonly status: string;
    readonly archived: boolean;
  };
}

const TABLE = 'pg_qbuild_users' as const;

const BASE_ROWS = [
  {
    email: 'ada@example.com',
    name: 'Ada',
    status: 'active',
    archived: false,
  },
  {
    email: 'bea@example.com',
    name: 'Bea',
    status: 'inactive',
    archived: false,
  },
] as const;

async function main(): Promise<void> {
  const options = resolveConnectionOptions();
  if (options === null) {
    console.log(
      'Skipping PostgreSQL integration tests because no database connection environment is configured.',
    );
    return;
  }

  const driver = createPostgresDriver(options);
  const db = createDb<TestSchema>(driver);

  try {
    await prepareSchema(driver);

  await withSeededTable(db, async () => {
    const rows = await db
      .selectFrom(TABLE)
      .select('id', 'email', 'status', 'archived')
      .orderBy(orderItem(column('id'), 'asc'))
      .execute();

      assertEqual(rows, [
        { id: 1, email: 'ada@example.com', status: 'active', archived: false },
        { id: 2, email: 'bea@example.com', status: 'inactive', archived: false },
      ], 'select against seeded data should return the seeded rows');

      const activeRows = await db
        .selectFrom(TABLE)
        .select('id', 'email')
        .where(comparison(column('status'), 'equals', parameter('active')))
        .execute();

      assertEqual(
        activeRows,
        [{ id: 1, email: 'ada@example.com' }],
        'where filters should restrict select results',
      );
    });

    await withSeededTable(db, async () => {
      const firstRow = await db
        .selectFrom(TABLE)
        .select('id', 'email')
        .orderBy(orderItem(column('id'), 'asc'))
        .executeTakeFirst();

      assertEqual(
        firstRow,
        { id: 1, email: 'ada@example.com' },
        'executeTakeFirst should return the first row',
      );

      const missingRow = await db
        .selectFrom(TABLE)
        .select('id')
        .where(comparison(column('email'), 'equals', parameter('missing@example.com')))
        .executeTakeFirst();

      assert(
        missingRow === undefined,
        'executeTakeFirst should resolve undefined when no rows match',
      );

      const firstOrThrow = await db
        .selectFrom(TABLE)
        .select('id')
        .orderBy(orderItem(column('id'), 'asc'))
        .executeTakeFirstOrThrow();

      assertEqual(
        firstOrThrow,
        { id: 1 },
        'executeTakeFirstOrThrow should return the first row',
      );

      await assertRejects(
        () =>
          db.selectFrom(TABLE)
            .select('id')
            .where(comparison(column('email'), 'equals', parameter('missing@example.com')))
            .executeTakeFirstOrThrow(),
        'query returned no rows',
      );
    });

    await withSeededTable(db, async () => {
      const events: Array<{
        readonly phase: 'before' | 'success' | 'failure';
        readonly kind: string;
        readonly sql: string;
        readonly durationMs?: number;
      }> = [];

      const hookedDb = createDb<TestSchema>(driver, {
        hooks: {
          beforeExecute(event) {
            events.push({
              phase: 'before',
              kind: event.kind,
              sql: event.sql,
            });
          },
          afterSuccess(event) {
            events.push({
              phase: 'success',
              kind: event.kind,
              sql: event.sql,
              durationMs: event.durationMs,
            });
          },
          afterFailure(event) {
            events.push({
              phase: 'failure',
              kind: event.kind,
              sql: event.sql,
              durationMs: event.durationMs,
            });
          },
        },
      });

      await hookedDb
        .selectFrom(TABLE)
        .select('email')
        .orderBy(orderItem(column('id'), 'asc'))
        .execute();

      await assertRejects(
        () =>
          hookedDb.insertInto(TABLE).values({
            email: 'ada@example.com',
            name: 'Duplicate',
            status: 'active',
            archived: false,
          }).execute(),
        'PostgreSQL query failed',
      );

      assertEqual(
        events.map((event) => `${event.phase}:${event.kind}`),
        ['before:select', 'success:select', 'before:insert', 'failure:insert'],
        'hooks should observe query lifecycle events',
      );
      assert(
        typeof events[0]?.sql === 'string' && events[0]!.sql.includes('SELECT'),
        'beforeExecute should include SQL text',
      );
      assert(
        typeof events[1]?.durationMs === 'number',
        'afterSuccess should include duration',
      );
      assert(
        typeof events[3]?.durationMs === 'number',
        'afterFailure should include duration',
      );
    });

    await withSeededTable(db, async () => {
      await db.insertInto(TABLE).values({
        email: 'cara@example.com',
        name: 'Cara',
        status: 'active',
        archived: false,
      }).execute();

      const rows = await db.selectFrom(TABLE)
        .select('email')
        .orderBy(orderItem(column('id'), 'asc'))
        .execute();

      assertEqual(
        rows,
        [
          { email: 'ada@example.com' },
          { email: 'bea@example.com' },
          { email: 'cara@example.com' },
        ],
        'insert one row should persist through execute',
      );
    });

    await withSeededTable(db, async () => {
      await db.insertInto(TABLE).values(
        {
          email: 'cara@example.com',
          name: 'Cara',
          status: 'active',
          archived: false,
        },
        {
          email: 'dave@example.com',
          name: 'Dave',
          status: 'active',
          archived: true,
        },
      ).execute();

      const rows = await db.selectFrom(TABLE)
        .select('email', 'archived')
        .orderBy(orderItem(column('id'), 'asc'))
        .execute();

      assertEqual(
        rows,
        [
          { email: 'ada@example.com', archived: false },
          { email: 'bea@example.com', archived: false },
          { email: 'cara@example.com', archived: false },
          { email: 'dave@example.com', archived: true },
        ],
        'insert multiple rows should persist both rows',
      );
    });

    await withSeededTable(db, async () => {
      const inserted = await db
        .insertInto(TABLE)
        .values({
          email: 'cara@example.com',
          name: 'Cara',
          status: 'active',
          archived: false,
        })
        .returning('id', 'email')
        .execute();

      assertEqual(
        inserted,
        [{ id: 3, email: 'cara@example.com' }],
        'insert returning should surface the inserted row',
      );
    });

    await withSeededTable(db, async () => {
      const inserted = await db
        .insertInto(TABLE)
        .values(
          {
            email: 'cara@example.com',
            name: 'Cara',
            status: 'active',
            archived: false,
          },
          {
            email: 'dave@example.com',
            name: 'Dave',
            status: 'active',
            archived: true,
          },
        )
        .returning('id', 'email')
        .execute();

      assertEqual(
        inserted,
        [
          { id: 3, email: 'cara@example.com' },
          { id: 4, email: 'dave@example.com' },
        ],
        'insert returning should preserve row order for multi-row inserts',
      );
    });

    await withSeededTable(db, async () => {
      const updated = await db
        .updateTable(TABLE)
        .set({ status: 'suspended' })
        .where(comparison(column('email'), 'equals', parameter('ada@example.com')))
        .returning('id', 'status')
        .execute();

      assertEqual(
        updated,
        [{ id: 1, status: 'suspended' }],
        'update returning should surface the updated row',
      );
    });

    await withSeededTable(db, async () => {
      const deleted = await db
        .deleteFrom(TABLE)
        .where(comparison(column('email'), 'equals', parameter('bea@example.com')))
        .returning('id', 'email')
        .execute();

      assertEqual(
        deleted,
        [{ id: 2, email: 'bea@example.com' }],
        'delete returning should surface the deleted row',
      );
    });

    await withSeededTable(db, async () => {
      await db.transaction(async (tx) => {
        await tx.insertInto(TABLE).values({
          email: 'cara@example.com',
          name: 'Cara',
          status: 'active',
          archived: false,
        }).execute();

        await tx.updateTable(TABLE)
          .set({ status: 'suspended' })
          .where(comparison(column('email'), 'equals', parameter('ada@example.com')))
          .execute();
      });

      const rows = await db
        .selectFrom(TABLE)
        .select('email', 'status')
        .orderBy(orderItem(column('id'), 'asc'))
        .execute();

      assertEqual(
        rows,
        [
          { email: 'ada@example.com', status: 'suspended' },
          { email: 'bea@example.com', status: 'inactive' },
          { email: 'cara@example.com', status: 'active' },
        ],
        'transaction success should commit all changes',
      );
    });

    await withSeededTable(db, async () => {
      try {
        await db.transaction(async (tx) => {
          await tx.insertInto(TABLE).values({
            email: 'rollback@example.com',
            name: 'Rollback',
            status: 'active',
            archived: false,
          }).execute();

          throw new Error('force rollback');
        });
      } catch (error) {
        assert(
          error instanceof Error && error.message === 'force rollback',
          'transaction should rethrow the callback error',
        );
      }

      const rows = await db
        .selectFrom(TABLE)
        .select('email')
        .orderBy(orderItem(column('id'), 'asc'))
        .execute();

      assertEqual(
        rows,
        [{ email: 'ada@example.com' }, { email: 'bea@example.com' }],
        'transaction rollback should undo inserted rows',
      );
    });

    await withSeededTable(db, async () => {
      await assertRejects(
        () =>
          db.insertInto(TABLE).values({
            email: 'ada@example.com',
            name: 'Duplicate',
            status: 'active',
            archived: false,
          }).execute(),
        'PostgreSQL query failed',
      );
    });

    await withSeededTable(db, async () => {
      await db.insertInto(TABLE).values({
        email: 'cara@example.com',
        name: 'Cara',
        status: 'active',
        archived: false,
      }).execute();

      const deleted = await db.deleteFrom(TABLE)
        .where(comparison(column('email'), 'equals', parameter('bea@example.com')))
        .execute();

      assertEqual(deleted, [], 'delete without returning should resolve with an empty array');

      const rows = await db
        .selectFrom(TABLE)
        .select('email')
        .orderBy(orderItem(column('id'), 'asc'))
        .execute();

      assertEqual(
        rows,
        [{ email: 'ada@example.com' }, { email: 'cara@example.com' }],
        'delete with where should remove matching rows',
      );
    });
  } finally {
    await teardownSchema(driver).catch(() => {});
    await driver.close();
  }
}

function resolveConnectionOptions() {
  const connectionString = process.env.PGQBUILD_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (typeof connectionString === 'string' && connectionString.length > 0) {
    return { connectionString };
  }

  const host = readEnv('PGHOST');
  const port = readEnv('PGPORT');
  const database = readEnv('PGDATABASE');
  const user = readEnv('PGUSER');
  const password = readEnv('PGPASSWORD');

  if (host !== undefined || port !== undefined || database !== undefined || user !== undefined || password !== undefined) {
    return {
      host,
      port: port !== undefined ? Number(port) : undefined,
      database,
      user,
      password,
    };
  }

  return null;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function prepareSchema(driver: ReturnType<typeof createPostgresDriver>): Promise<void> {
  await driver.query({
    sql: `DROP TABLE IF EXISTS "${TABLE}"`,
    params: [],
  });

  await driver.query({
    sql: `
      CREATE TABLE "${TABLE}" (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        archived BOOLEAN NOT NULL DEFAULT FALSE
      )
    `,
    params: [],
  });
}

async function teardownSchema(driver: ReturnType<typeof createPostgresDriver>): Promise<void> {
  await driver.query({
    sql: `DROP TABLE IF EXISTS "${TABLE}"`,
    params: [],
  });
}

async function withSeededTable(
  db: DatabaseFacade<TestSchema>,
  callback: () => Promise<void>,
): Promise<void> {
  await db.deleteFrom(TABLE).execute();

  await db.insertInto(TABLE).values(...BASE_ROWS).execute();

  await callback();
}

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
    assert(
      typeof (error as { sql?: unknown }).sql === 'string',
      'wrapped execution errors should include the SQL text',
    );
    assert(
      Array.isArray((error as { params?: unknown }).params),
      'wrapped execution errors should include the bound params',
    );
  }

  assert(rejected, `expected promise to reject with "${messagePart}"`);
}

await main();
