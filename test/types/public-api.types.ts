import { createDb, createPostgresDriver } from '../../src/index.js';
import {
  column,
  comparison,
  parameter,
} from '../../src/index.js';

interface Schema {
  readonly users: {
    readonly id: number;
    readonly email: string;
    readonly name: string;
    readonly active: boolean;
  };
  readonly posts: {
    readonly id: number;
    readonly title: string;
    readonly published: boolean;
  };
}

const db = createDb<Schema>(createPostgresDriver(), {
  hooks: {
    beforeExecute(event) {
      const kind: 'select' | 'insert' | 'update' | 'delete' = event.kind;
      const sql: string = event.sql;
      const params: readonly unknown[] = event.params;

      void kind;
      void sql;
      void params;
    },
    afterSuccess(event) {
      const durationMs: number = event.durationMs;
      void durationMs;
    },
    afterFailure(event) {
      const durationMs: number = event.durationMs;
      const error: unknown = event.error;

      void durationMs;
      void error;
    },
  },
});

db.selectFrom('users');
db.selectFrom('posts');
db.insertInto('users');
db.updateTable('users');
db.deleteFrom('posts');

const selectRowsPromise = db
  .selectFrom('users')
  .select('id', 'email')
  .execute();

type SelectRows = Awaited<typeof selectRowsPromise>;
const selectRow: SelectRows[number] = {
  id: 1,
  email: 'ada@example.com',
};

const firstUserPromise = db.selectFrom('users').select('id', 'email').executeTakeFirst();
type FirstUser = Awaited<typeof firstUserPromise>;
const firstUser: NonNullable<FirstUser> = {
  id: 1,
  email: 'ada@example.com',
};

const firstUserOrThrowPromise = db
  .selectFrom('users')
  .select('id', 'email')
  .executeTakeFirstOrThrow();
type FirstUserOrThrow = Awaited<typeof firstUserOrThrowPromise>;
const firstUserOrThrow: FirstUserOrThrow = {
  id: 1,
  email: 'ada@example.com',
};

db.insertInto('users').values({
  email: 'ada@example.com',
  name: 'Ada',
  active: true,
});

db.updateTable('users').set({
  name: 'Updated',
});

const txRowsPromise = db.transaction(async (tx) => {
  return await tx
    .selectFrom('posts')
    .select('id', 'title')
    .execute();
});

type TxRows = Awaited<typeof txRowsPromise>;
const txRow: TxRows[number] = {
  id: 1,
  title: 'Hello',
};

void selectRow;
void firstUser;
void firstUserOrThrow;
void txRow;

// @ts-expect-error unknown table should fail
db.selectFrom('comments');

// @ts-expect-error unknown column should fail
db.selectFrom('users').select('id', 'missing');

// @ts-expect-error unknown column should fail
db.insertInto('users').values({ missing: 1 });

// @ts-expect-error invalid insert value type should fail
db.insertInto('users').values({ email: 123 });

// @ts-expect-error unknown column should fail
db.updateTable('users').set({ missing: 1 });

// @ts-expect-error invalid update value type should fail
db.updateTable('users').set({ active: 'yes' });

db.selectFrom('users').select('id').where(
  comparison(column('id'), 'equals', parameter(1)),
);
