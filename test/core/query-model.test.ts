import {
  assignment,
  column,
  comparison,
  deleteQuery,
  insertQuery,
  membership,
  nullCheck,
  nullLiteral,
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

const select = selectQuery({
  sourceTable: 'users',
  selectedColumns: [column('id'), column('email')],
  predicates: [
    comparison(column('status'), 'equals', parameter('active')),
    nullCheck(column('deleted_at')),
    membership(column('role'), [parameter('admin'), parameter('editor')]),
  ],
  orderBy: [orderItem(column('created_at'), 'desc')],
  limit: 10,
  offset: 5,
});

assert(select.kind === 'select', 'select query should be tagged');
assert(Object.isFrozen(select), 'select query should be frozen');
assert(Object.isFrozen(select.selectedColumns), 'selected columns should be frozen');
assert(Object.isFrozen(select.selectedColumns[0]!), 'selected column should be frozen');
assert(Object.isFrozen(select.predicates), 'predicates should be frozen');
assert(Object.isFrozen(select.predicates[0]!), 'predicate should be frozen');
assert(Object.isFrozen(select.orderBy), 'order items should be frozen');
assert(select.limit === 10, 'limit should be preserved');
assert(select.offset === 5, 'offset should be preserved');

const insert = insertQuery({
  targetTable: 'users',
  rows: [
    [assignment('email', parameter('a@example.com')), assignment('name', parameter('A'))],
    [assignment('email', parameter('b@example.com')), assignment('name', parameter('B'))],
  ],
  returningColumns: [column('id')],
});

assert(insert.kind === 'insert', 'insert query should be tagged');
assert(Object.isFrozen(insert.rows), 'insert rows should be frozen');
assert(Object.isFrozen(insert.rows[0]!), 'insert row should be frozen');
assert(Object.isFrozen(insert.rows[0]![0]!), 'insert assignment should be frozen');
assert(insert.rows.length === 2, 'insert should keep both rows');
assert(insert.rows[0]![0]!.column === 'email', 'insert should preserve column order');
assert(insert.returningColumns?.[0]?.name === 'id', 'returning columns should be preserved');

const update = updateQuery({
  targetTable: 'users',
  assignments: [assignment('name', parameter('Updated'))],
  predicates: [comparison(column('id'), 'equals', parameter(1))],
  returningColumns: [column('id'), column('name')],
});

assert(update.kind === 'update', 'update query should be tagged');
assert(update.assignments.length === 1, 'update should keep assignments');
assert(Object.isFrozen(update.assignments[0]!), 'update assignment should be frozen');
assert(update.predicates.length === 1, 'update should keep predicates');

const del = deleteQuery({
  targetTable: 'users',
  predicates: [comparison(column('id'), 'equals', parameter(1))],
  returningColumns: [column('id')],
});

assert(del.kind === 'delete', 'delete query should be tagged');
assert(del.predicates.length === 1, 'delete should keep predicates');

assertThrows('selected columns', () =>
  selectQuery({
    sourceTable: 'users',
    selectedColumns: [] as never,
  }),
);

assertThrows('insert rows must use the same column set', () =>
  insertQuery({
    targetTable: 'users',
    rows: [
      [assignment('email', parameter('a@example.com'))],
      [assignment('name', parameter('b@example.com'))],
    ],
  }),
);

assertThrows('update assignments cannot contain duplicate column', () =>
  updateQuery({
    targetTable: 'users',
    assignments: [
      assignment('name', parameter('A')),
      assignment('name', parameter('B')),
    ],
  }),
);

void rawFragment;
void nullLiteral;
