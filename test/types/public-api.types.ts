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

const db = createDb<Schema>(createPostgresDriver());

const selectRowsPromise = db
  .selectFrom('users')
  .select('id', 'email')
  .where(comparison(column('active'), 'equals', parameter(true)))
  .execute();

type SelectRows = Awaited<typeof selectRowsPromise>;
const selectRow: SelectRows[number] = {
  id: 1,
  email: 'ada@example.com',
};

db.selectFrom('users').select('id', 'email');

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
void txRow;

// @ts-expect-error unknown column should fail
db.selectFrom('users').select('id', 'missing');

db.insertInto('users').values({
  // @ts-expect-error unknown column should fail
  missing: 1,
});

db.updateTable('users').set({
  // @ts-expect-error unknown column should fail
  missing: 1,
});

db.selectFrom('users').select('id').where(
  comparison(column('id'), 'equals', parameter(1)),
);
