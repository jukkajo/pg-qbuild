import {
  assignment,
  column,
  comparison,
  createDatabase,
  nullCheck,
  orderItem,
  parameter,
} from '../../src/index.js';

interface AppSchema {
  users: {
    id: number;
    email: string;
    status: string;
  };
  audit_logs: {
    id: number;
    message: string;
  };
}

const db = createDatabase<AppSchema>();

const selectCompiled = db
  .selectFrom('users')
  .select('id', 'email')
  .where(comparison(column('status'), 'equals', parameter('active')))
  .where(nullCheck(column('deleted_at')))
  .orderBy(orderItem(column('email')))
  .limit(10)
  .offset(5)
  .compile();

const insertCompiled = db
  .insertInto('users')
  .values([
    assignment('email', parameter('ada@example.com')),
    assignment('status', parameter('active')),
  ])
  .returning('id')
  .compile();

const updateCompiled = db
  .updateTable('users')
  .set(assignment('status', parameter('inactive')))
  .returning('id', 'status')
  .compile();

const deleteCompiled = db
  .deleteFrom('users')
  .where(comparison(column('id'), 'equals', parameter(1)))
  .compile();

const compiledResult: { sql: string; params: unknown[] } = selectCompiled;

void compiledResult;
void insertCompiled;
void updateCompiled;
void deleteCompiled;

// @ts-expect-error invalid column name
db.selectFrom('users').select('missing');
// @ts-expect-error invalid table name
db.selectFrom('missing');

// @ts-expect-error invalid column name for returning
db.updateTable('users').returning('missing');

// @ts-expect-error invalid column name for insert returning
db.insertInto('users').returning('missing');

// @ts-expect-error insert rows must be supplied
db.insertInto('users').values();

// @ts-expect-error update assignments must be supplied
db.updateTable('users').set();

// @ts-expect-error orderBy requires at least one item
db.selectFrom('users').select('id').orderBy();
